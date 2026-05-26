// main.links.js
//
// This module scans non-repository pages for links that point at supported repo
// or package hosts, asks the background worker for each unique status, and
// injects a small emoji marker into each matching link.
//
// Per-page in-memory cache to avoid duplicate lookups during the same session.
const __linkStatusCache = new Map(); // key -> status

const LINK_STATUS_ATTR = "data-gitpulse-status";
const LINK_MARK_SELECTOR = 'span.repo-checker-mark[data-gitpulse-mark="1"]';

function normalizeStatus(status) {
  // DOM attributes can only store strings. Normalize the mixed status union
  // (boolean plus string states) before persisting it on a link element.
  if (status === true) return "true";
  if (status === false) return "false";
  if (status === "private" || status === "rate_limited" || status === "unsupported") return status;
  return "";
}

function parseStatus(normalized) {
  // Reverse normalizeStatus when config changes require re-rendering markers
  // without making another background/API request.
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "private" || normalized === "rate_limited" || normalized === "unsupported") return normalized;
  return null;
}

function emojiForStatus(status) {
  // Emoji values are user-configurable and independently disable-able. Returning
  // null tells the renderer to remove any existing marker for that status.
  const pick = (key, fallback) => {
    const field = config?.[key];
    if (field && field.active === false) return null;
    const raw = typeof field?.value === "string" ? field.value.trim() : "";
    return raw ? raw : fallback;
  };

  if (status === "private") {
    const e = pick("emoji_private", "🔒");
    if (!e) return null;
    return { icon: e, color: "#555", title: "Private repository" };
  }
  if (status === "rate_limited") {
    const e = pick("emoji_rate_limited", "⏳");
    if (!e) return null;
    return { icon: e, color: "#f57c00", title: "Rate limited" };
  }
  if (status === "unsupported") {
    const e = pick("emoji_unsupported", "❔");
    if (!e) return null;
    return { icon: e, color: "#6a737d", title: "Unsupported repository host" };
  }
  if (status === true) {
    const e = pick("emoji_active", "✅");
    if (!e) return null;
    return { icon: e, color: "green", title: "Active repository" };
  }
  if (status === false) {
    const e = pick("emoji_inactive", "❌");
    if (!e) return null;
    return { icon: e, color: "red", title: "Inactive repository" };
  }
  return null;
}

function findOrAdoptLegacyMark(link) {
  // Older GitPulse versions inserted a plain leading span. Adopt that element
  // when it looks safe so upgrades do not duplicate markers in already-open tabs.
  const existing = link.querySelector(LINK_MARK_SELECTOR);
  if (existing) return existing;

  // Best-effort adoption of legacy marks (older versions inserted a plain span)
  const first = link.firstElementChild;
  if (!first || first.tagName !== "SPAN") return null;
  if (first.getAttribute("aria-hidden") !== "true") return null;
  const title = first.title || "";
  const known = new Set([
    "Active repository",
    "Inactive repository",
    "Private repository",
    "Rate limited",
    "Unsupported repository host",
  ]);
  if (!known.has(title)) return null;
  if ((first.textContent || "").trim().length > 4) return null;

  first.classList.add("repo-checker-mark");
  first.dataset.gitpulseMark = "1";
  return first;
}

function readStoredDetails(link) {
  // Details are stored as JSON for local re-rendering. Malformed data should not
  // break page annotation, so failures fall back to an empty details object.
  try {
    const raw = link.getAttribute("data-gitpulse-details");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setOrRemoveLinkMark(link, status, details = {}, meta = {}) {
  // This is the only function that mutates a link. It records status/details for
  // future refreshes, creates or updates the marker span, and removes it when
  // the relevant emoji is disabled.
  const normalized = normalizeStatus(status);
  if (normalized) {
    link.setAttribute(LINK_STATUS_ATTR, normalized);
  }
  if (details && Object.keys(details).length) {
    try {
      link.setAttribute("data-gitpulse-details", JSON.stringify(details));
    } catch {
      // ignore
    }
  }

  const showEmoji = typeof window.__gp?.emojiDisplayEnabled === "function"
    ? window.__gp.emojiDisplayEnabled("marker")
    : true;
  const emoji = showEmoji ? emojiForStatus(status) : null;
  const gradeBadge = typeof window.__gp?.createGradeBadge === "function"
    ? window.__gp.createGradeBadge(details, meta, "marker")
    : null;
  if (gradeBadge && (status === true || status === false)) {
    Object.assign(gradeBadge.style, {
      marginLeft: emoji ? "2px" : "0",
      marginRight: "4px",
      padding: "1px 5px",
      fontSize: "10px",
      lineHeight: "1.3",
    });
  }
  const existingMark = findOrAdoptLegacyMark(link);

  if (!emoji && !gradeBadge) {
    if (existingMark) existingMark.remove();
    return;
  }

  const mark = existingMark || document.createElement("span");
  if (!existingMark) {
    mark.className = "repo-checker-mark";
    mark.dataset.gitpulseMark = "1";
    mark.setAttribute("aria-hidden", "true");
    mark.style.marginRight = "4px";
    try {
      link.insertBefore(mark, link.firstChild);
    } catch {
      // ignore
    }
  }

  mark.textContent = emoji ? `${emoji.icon} ` : "";
  mark.style.color = emoji?.color || "";
  if (gradeBadge) mark.appendChild(gradeBadge);

  const detailText =
    typeof window.__gp?.formatRepoStatusDetails === "function"
      ? window.__gp.formatRepoStatusDetails(status, details, meta)
      : "";
  const title = emoji?.title || gradeBadge?.title || "";
  mark.title = detailText && title ? `${title}: ${detailText}` : (title || detailText);
}

// Simple concurrency pool for promises. Pages such as search results can expose
// many repo links at once, so this prevents a burst of background messages and
// host API requests from running at unlimited parallelism.
async function runWithConcurrency(tasks, concurrency = 6) {
  const results = [];
  const pool = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(task);
    results.push(p);
    pool.push(p);
    const onFinish = () => pool.splice(pool.indexOf(p), 1);
    p.then(onFinish, onFinish);
    if (pool.length >= concurrency) await Promise.race(pool);
  }
  return Promise.all(results);
}

function repoRootKey(hostname, parts) {
  // Return the canonical "owner/repo" root key for a given host so that
  // sub-pages of the same repo (e.g. /issues, /pulls, /tree/main/…) share one
  // status lookup instead of triggering duplicate grades.
  switch (hostname) {
    case "github.com":
    case "gitlab.com":
    case "codeberg.org":
    case "bitbucket.org":
      return hostname + "/" + parts.slice(0, 2).join("/");

    case "git.sr.ht":
      // Sourcehut: /~user/repo — root is always first two parts
      return hostname + "/" + parts.slice(0, 2).join("/");

    case "launchpad.net":
      return hostname + "/" + parts[0];

    case "www.npmjs.com":
    case "npmjs.com":
      // /package/name or /package/@scope/name
      return hostname + "/" + (parts[1].startsWith("@") ? parts.slice(1, 3).join("/") : parts[1]);

    case "hub.docker.com":
      // /r/org/repo
      return hostname + "/r/" + parts.slice(1, 3).join("/");

    case "pypi.org":
      return hostname + "/project/" + parts[1];

    case "crates.io":
      return hostname + "/crates/" + parts[1];

    case "packagist.org":
      return hostname + "/packages/" + parts.slice(1, 3).join("/");

    default:
      return hostname + "/" + parts.slice(0, 2).join("/");
  }
}

function linkTextLength(el) {
  return (el.textContent || "").trim().length;
}

function linkPathDepth(el) {
  try {
    return new URL(el.href).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

function betterLinkCandidate(a, b) {
  // Prefer the shallowest path first (owner/repo beats owner/repo/stars).
  // Among equal depth, prefer the shortest non-empty text to avoid picking
  // card wrappers that contain the full card body (name + description + stats).
  const depthA = linkPathDepth(a);
  const depthB = linkPathDepth(b);
  if (depthA !== depthB) return depthA < depthB ? a : b;

  const lenA = linkTextLength(a);
  const lenB = linkTextLength(b);
  if (lenA === 0) return b;
  if (lenB === 0) return a;
  return lenA <= lenB ? a : b;
}

function dedupeLinks(links) {
  // Dedupe by exact href, keeping the shortest non-empty-text link per URL.
  // Short text = inline repo name link. Long text = card wrapper containing
  // description, stats etc — we don't want to badge those.
  const byHref = new Map(); // exact href -> chosen element
  for (const el of links) {
    const href = el.href;
    if (!href) continue;
    if (!isRepoUrl(href)) continue;
    if (!byHref.has(href)) {
      byHref.set(href, el);
    } else {
      byHref.set(href, betterLinkCandidate(el, byHref.get(href)));
    }
  }

  // Group by repo root key so sub-pages share one fetch and one badge.
  const map = new Map(); // rootKey -> [element]
  for (const [href, el] of byHref) {
    try {
      const u = new URL(href);
      const parts = u.pathname.split("/").filter(Boolean);
      const key = repoRootKey(u.hostname, parts);
      if (!map.has(key)) {
        map.set(key, [el]);
      } else {
        map.set(key, [betterLinkCandidate(el, map.get(key)[0])]);
      }
    } catch {
      // ignore
    }
  }
  return map;
}

async function processUniqueUrls(map) {
  // Convert the deduped map into bounded async tasks. Cached per-page results
  // are reapplied immediately; uncached URLs go through the background worker.
  if(!map) {
    console.warn("link process error")
    return
  }
  const tasks = [];
  for (const [key, elements] of map.entries()) {
    if (__linkStatusCache.has(key)) {
      // apply cached status to all elements
      const status = __linkStatusCache.get(key);
      elements.forEach(el => annotateLink(el, status));
      continue;
    }

    tasks.push(async () => {
      // Use the root key as the canonical URL so the background always receives
      // the repo root regardless of which sub-page link was encountered first.
      const url = "https://" + key;
      let result;
      try {
        result = typeof getRepoStatus === "function"
          ? await getRepoStatus(url)
          : { status: await isRepoActive(url), details: {}, fromCache: false };
      } catch (e) {
        console.warn('[link-check] error', e);
        result = { status: false, details: { error: String(e) }, fromCache: false }; // fail-closed
      }
      __linkStatusCache.set(key, result);
      elements.forEach(el => annotateLink(el, result));
    });
  }
  await runWithConcurrency(tasks, 6);
}

function annotateLink(link, result) {
  // Support both the modern rich result object and the older raw status value so
  // fallback paths can still annotate links.
  const status = isPlainStatusResult(result) ? result.status : result;
  const details = isPlainStatusResult(result) ? result.details || {} : {};
  const meta = isPlainStatusResult(result)
    ? { fromCache: result.fromCache, score: result.score, grade: result.grade }
    : {};
  setOrRemoveLinkMark(link, status, details, meta);
}

function isPlainStatusResult(value) {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "status");
}

function refreshAllLinkMarks() {
  // Config changes that only affect emoji should not refetch status. Re-render
  // previously annotated links from their stored attributes instead.
  // Re-apply emojis for every previously checked link, without re-fetching.
  const links = Array.from(document.querySelectorAll(`a[${LINK_STATUS_ATTR}]`));

  // include same-origin iframe links
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      if (iframeDoc) links.push(...Array.from(iframeDoc.querySelectorAll(`a[${LINK_STATUS_ATTR}]`)));
    } catch {
      // cross-origin
    }
  }

  if (!links.length) return;
  for (const link of links) {
    const status = parseStatus(link.getAttribute(LINK_STATUS_ATTR));
    if (status === null) continue;
    setOrRemoveLinkMark(link, status, readStoredDetails(link));
  }
}

// Expose for bootstrap (config changes)
window.gitpulseRefreshAllLinkMarks = refreshAllLinkMarks;

// Debounced observer-based entry point
let __debounceTimer = null;
const DEBOUNCE_MS = 250;

async function markRepoLinks() {
  // Debounce because dynamic pages often batch DOM mutations. The delayed scan
  // catches document links plus same-origin iframe links without repeatedly
  // walking the DOM for each individual mutation.
  if (__debounceTimer) clearTimeout(__debounceTimer);
  __debounceTimer = setTimeout(async () => {
    __debounceTimer = null;
    // collect links in document and same-origin iframes
    const allLinks = Array.from(document.querySelectorAll('a'));
    // include same-origin iframe links
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc) allLinks.push(...Array.from(iframeDoc.querySelectorAll('a')));
      } catch {
        // cross-origin
      }
    }

    const map = dedupeLinks(allLinks);
    if (!map.size) return;
    await processUniqueUrls(map);
  }, DEBOUNCE_MS);
}

