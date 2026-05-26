// main.links.js
// Per-page in-memory cache to avoid duplicate lookups during the same session
const __linkStatusCache = new Map(); // key -> status

const LINK_STATUS_ATTR = "data-gitpulse-status";
const LINK_MARK_SELECTOR = 'span.repo-checker-mark[data-gitpulse-mark="1"]';

function normalizeStatus(status) {
  if (status === true) return "true";
  if (status === false) return "false";
  if (status === "private" || status === "rate_limited" || status === "unsupported") return status;
  return "";
}

function parseStatus(normalized) {
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (normalized === "private" || normalized === "rate_limited" || normalized === "unsupported") return normalized;
  return null;
}

function emojiForStatus(status) {
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
  try {
    const raw = link.getAttribute("data-gitpulse-details");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setOrRemoveLinkMark(link, status, details = {}, meta = {}) {
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

  const emoji = emojiForStatus(status);
  const existingMark = findOrAdoptLegacyMark(link);

  if (!emoji) {
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

  mark.textContent = `${emoji.icon} `;
  mark.style.color = emoji.color;
  const detailText =
    typeof window.__gp?.formatRepoStatusDetails === "function"
      ? window.__gp.formatRepoStatusDetails(status, details, meta)
      : "";
  mark.title = detailText ? `${emoji.title}: ${detailText}` : emoji.title;
}

// Simple concurrency pool for promises
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

function dedupeLinks(links) {
  const map = new Map(); // key -> array of elements
  for (const el of links) {
    const href = el.href;
    if (!href) continue;
    if (!isRepoUrl(href)) continue;
    try {
      const u = new URL(href);
      const key = u.hostname + u.pathname;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(el);
    } catch {
      // ignore
    }
  }
  return map;
}

async function processUniqueUrls(map) {
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
      const url = elements[0].href;
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
  const status = isPlainStatusResult(result) ? result.status : result;
  const details = isPlainStatusResult(result) ? result.details || {} : {};
  const meta = isPlainStatusResult(result) ? { fromCache: result.fromCache } : {};
  setOrRemoveLinkMark(link, status, details, meta);
}

function isPlainStatusResult(value) {
  return !!value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "status");
}

function refreshAllLinkMarks() {
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

