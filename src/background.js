console.log("GitPulse SW started", chrome.runtime?.id);
// background.js (MV3 service worker)

// ---------------------------
// Constants & helpers
// ---------------------------
const CACHE_PREFIX = "repoCache:";
const CACHE_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;   // 24h for normal entries
const RATE_TTL_MS  = 1000 * 60 * 60 * 2;    // 2h for rate-limited entries
const CONFIG_KEY   = "repoCheckerConfig";   // unify on the same key used by popup.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("GitPulse Installed");
});

// Storage helpers
const getLocal = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setLocal = (obj) =>
  new Promise((resolve) => chrome.storage.local.set(obj, resolve));
const removeLocal = (keys) =>
  new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

// Small utils
const now = () => Date.now();
const withinDays = (dateStr, maxDays) => {
  if (!dateStr || !Number.isFinite(maxDays)) return true;
  const last = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  return last >= cutoff;
};
const isString = (x) => typeof x === "string";

// Merge active, enabled config fields into a flat rules object
async function loadActiveRules() {
  const { [CONFIG_KEY]: cfg } = await getLocal([CONFIG_KEY]);
  if (!cfg) return {};
  return Object.entries(cfg)
    .filter(([, f]) => f && f.active && f.value !== undefined)
    .reduce((acc, [k, f]) => { acc[k] = f.value; return acc; }, {});
}

// Cache helpers
async function readCache(key) {
  const full = CACHE_PREFIX + key;
  const item = (await getLocal([full]))[full];
  if (!item) return null;
  if (item.v !== CACHE_SCHEMA_VERSION) return null;

  const age = now() - (item.checkedAt || 0);
  const ttl = item.isActive === "rate_limited" ? RATE_TTL_MS : CACHE_TTL_MS;
  if (age < ttl) return item;
  return null;
}
async function writeCache(key, value) {
  const full = CACHE_PREFIX + key;
  return setLocal({ [full]: { ...value, checkedAt: now(), v: CACHE_SCHEMA_VERSION } });
}
async function clearCache() {
  const all = await getLocal(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
  if (keys.length) await removeLocal(keys);
  return { success: true };
}

// Read PAT only in background
async function getPAT() {
  const { githubPAT } = await getLocal(["githubPAT"]);
  return githubPAT || "";
}

// ---------------------------
// Host-specific fetchers
//   (Add more hosts here and return { status, details? })
// ---------------------------
async function fetchGithubRepoStatus({ owner, repo }, pat, rules) {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    ...(pat ? { Authorization: `token ${pat}` } : {}),
  };

  // 1) repo metadata
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
  if (repoRes.status === 403) return { status: "rate_limited" };
  if (repoRes.status === 404 || repoRes.status === 401) {
    // Unauthenticated access to a private repo is surfaced as 404 by GitHub.
    // Treat 401 similarly when token lacks access.
    return { status: "private" };
  }
  if (!repoRes.ok) throw new Error(`GitHub repo API failed: ${repoRes.status}`);
  const repoData = await repoRes.json();

  // Optional rule: require not archived
  const isArchivedOk = (rules.require_not_archived === undefined)
    ? true
    : !repoData.archived;

  // 2) Open PR threshold (use search API for total_count)
  let openPrsOk = true;
  if (Number.isFinite(rules.open_prs_max)) {
    const prsRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:pr+is:open&per_page=1`,
      { headers }
    );
    if (prsRes.status === 403) return { status: "rate_limited" };
    if (!prsRes.ok) throw new Error(`GitHub search PRs failed: ${prsRes.status}`);
    const prs = await prsRes.json();
    openPrsOk = (prs.total_count || 0) <= rules.open_prs_max;
  }

  // 3) Last closed PR age
  let lastClosedPrOk = true;
  if (Number.isFinite(rules.last_closed_pr_max_days)) {
    const closedRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=1`,
      { headers }
    );
    if (closedRes.status === 403) return { status: "rate_limited" };
    if (!closedRes.ok) throw new Error(`GitHub closed PRs failed: ${closedRes.status}`);
    const closed = await closedRes.json();
    const lastClosed = closed?.[0]?.closed_at || closed?.[0]?.merged_at;
    lastClosedPrOk = withinDays(lastClosed, rules.last_closed_pr_max_days);
  }

  // 4) Core push recency
  const pushOk = withinDays(
    repoData.pushed_at,
    Number.isFinite(rules.max_repo_update_time) ? rules.max_repo_update_time : 365
  );

  // 5) Issue activity recency
  let issuesActivityOk = true;
  if (Number.isFinite(rules.max_issues_update_time)) {
    const issuesRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:issue&sort=updated&order=desc&per_page=1`,
      { headers }
    );
    if (issuesRes.status === 403) return { status: "rate_limited" };
    if (!issuesRes.ok) throw new Error(`GitHub search issues failed: ${issuesRes.status}`);
    const issues = await issuesRes.json();
    const lastIssueUpdated = issues?.items?.[0]?.updated_at;
    issuesActivityOk = withinDays(lastIssueUpdated, rules.max_issues_update_time);
  }

  // 6) Last release recency
  let releaseOk = true;
  if (Number.isFinite(rules.max_days_since_last_release)) {
    const relRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`,
      { headers }
    );
    if (relRes.status === 403) return { status: "rate_limited" };
    if (!relRes.ok && relRes.status !== 404) throw new Error(`GitHub releases failed: ${relRes.status}`);
    let lastReleaseAt = null;
    if (relRes.ok) {
      const rels = await relRes.json();
      const rel = rels?.[0];
      lastReleaseAt = rel?.published_at || rel?.created_at;
    }
    // If no releases, consider not OK only if rule is active
    releaseOk = withinDays(lastReleaseAt, rules.max_days_since_last_release);
  }

  // 7) Oldest open issue age
  let openIssueAgeOk = true;
  if (Number.isFinite(rules.max_open_issue_age)) {
    const oldestOpenRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:issue+is:open&sort=created&order=asc&per_page=1`,
      { headers }
    );
    if (oldestOpenRes.status === 403) return { status: "rate_limited" };
    if (!oldestOpenRes.ok) throw new Error(`GitHub oldest open issue failed: ${oldestOpenRes.status}`);
    const oldest = await oldestOpenRes.json();
    const oldestCreated = oldest?.items?.[0]?.created_at;
    // Pass if there are no open issues (items empty) or if oldest is within threshold
    openIssueAgeOk = withinDays(oldestCreated, rules.max_open_issue_age);
  }

  const isActive = isArchivedOk && openPrsOk && lastClosedPrOk && pushOk && issuesActivityOk && releaseOk && openIssueAgeOk;
  return {
    status: isActive ? true : false,
    details: { pushOk, isArchivedOk, openPrsOk, lastClosedPrOk, issuesActivityOk, releaseOk, openIssueAgeOk }
  };
}

// Add other ecosystems similarly (GitLab, Bitbucket, npm, etc.)

async function fetchRepoStatusByUrl(rawUrl, rules) {
  const { hostname, pathname } = new URL(rawUrl);
  const parts = pathname.split("/").filter(Boolean);
  const pat = await getPAT();

  switch (hostname) {
    case "github.com": {
      if (parts.length < 2) throw new Error("Invalid GitHub URL");
      const [owner, repo] = parts;
      return fetchGithubRepoStatus({ owner, repo }, pat, rules);
    }
    default:
      // No integration → assume active to avoid blocking
      return { status: true };
  }
}

// ---------------------------
// Unified message handler
// ---------------------------
async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message?.action) {
      case "ping": {
        sendResponse({ pong: true, id: chrome.runtime?.id, external: !!sender?.origin });
        return;
      }

      case "open-url": {
        const tabs = await new Promise((resolve) => {
          try {
            chrome.tabs.query({ active: true, currentWindow: true }, (t) => {
              const _ = chrome.runtime?.lastError;
              resolve(Array.isArray(t) ? t : []);
            });
          } catch (e) {
            resolve([]);
          }
        });
        if (!tabs?.length || !tabs[0]?.url) {
          sendResponse({ ok: false, error: "No active tab URL available" });
          return;
        }
        sendResponse({ ok: true });
        return;
      }

      case "getCache": {
        const key = isString(message.key) ? message.key : "";
        const item = key ? await readCache(key) : null;
        if (item) {
          console.log(`[Cache] HIT for ${CACHE_PREFIX + key}`);
          sendResponse({ isActive: item.isActive, fromCache: true, details: item.details });
        } else {
          console.log(`[Cache] MISS or STALE for ${CACHE_PREFIX + key}`);
          sendResponse({ isActive: null, fromCache: false });
        }
        return;
      }

      case "setCache": {
        const key = isString(message.key) ? message.key : "";
        if (!key) { sendResponse({ success: false, error: "Missing key" }); return; }
        await writeCache(key, message.value || {});
        console.log(`[Cache] Stored ${CACHE_PREFIX + key}`, message.value);
        sendResponse({ success: true });
        return;
      }

      case "clearCache": {
        await clearCache();
        sendResponse({ success: true });
        return;
      }

      case "open_popup": {
        try {
          const url = chrome.runtime.getURL("popup.html");
          chrome.tabs.create({ url, active: true }, () => {
            const err = chrome.runtime.lastError; // read to avoid unchecked lastError
            // ignore error; still respond OK to avoid breaking UX
            sendResponse({ ok: true });
          });
          return; // async response
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
          return;
        }
      }

      case "setPAT": {
        await setLocal({ githubPAT: String(message.pat || "") });
        await clearCache();
        sendResponse({ success: true });
        return;
      }

      case "setConfig": {
        await setLocal({ [CONFIG_KEY]: message.config || {} });
        sendResponse({ success: true });
        return;
      }

      case "getConfig": {
        const stored = (await getLocal([CONFIG_KEY]))[CONFIG_KEY] || {};
        sendResponse({ config: stored });
        return;
      }

      case "fetchRepoStatus": {
        console.log("fetchRepoStatus received:", message.url);
        if (typeof message.url !== "string") { sendResponse({ ok: false, error: "Missing url" }); return; }

        const cacheKey = (() => {
          try { const u = new URL(message.url); return u.hostname + u.pathname; }
          catch { return ""; }
        })();
        if (!cacheKey) { sendResponse({ ok: false, error: "Invalid URL" }); return; }

        const cached = await readCache(cacheKey);
        if (cached) {
          sendResponse({ ok: true, result: { status: cached.isActive, details: cached.details }, fromCache: true });
          return;
        }

        const rules = await loadActiveRules();
        try {
          const result = await fetchRepoStatusByUrl(message.url, rules);
          await writeCache(cacheKey, { isActive: result.status, details: result.details });
          sendResponse({ ok: true, result, fromCache: false });
        } catch (err) {
          await writeCache(cacheKey, { isActive: false, details: { error: String(err) } });
          sendResponse({ ok: true, result: { status: false }, fromCache: false });
        }
        return;
      }

      default:
        sendResponse({ ok: false, error: "Unknown action" });
        return;
    }
  } catch (e) {
    sendResponse({ ok: false, error: String(e) });
  }
}

// ---------------------------
// Listeners (single source of truth)
// ---------------------------

// Internal (popup, content scripts)
chrome.runtime.onMessage.addListener((m, s, r) => {
  handleMessage(m, s, r);
  return true; // keep channel open for async sendResponse
});

// External (web pages using your extension ID)
chrome.runtime.onMessageExternal.addListener((m, s, r) => {
  // Tighten origin if desired
  if (!s?.origin?.endsWith("github.com")) {
    r({ ok: false, error: "origin not allowed" });
    return;
  }
  handleMessage(m, s, r);
  return true; // keep channel open for async sendResponse
});
