console.log("GitPulse SW started", chrome.runtime?.id);
// background.js (MV3 service worker)

// ---------------------------
// Constants & helpers
// ---------------------------
const CACHE_PREFIX = "repoCache:";
const CACHE_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;   // 24h for normal entries
const RATE_TTL_MS = 1000 * 60 * 60 * 2;    // 2h for rate-limited entries
const CONFIG_KEY = "repoCheckerConfig";   // unify on the same key used by popup.js

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
  const isArchived = !!repoData.archived;

  // Archived repos are immediately inactive; no need to continue with more GitHub calls
  if (isArchived) {
    return { status: false, details: { isArchived: true } };
  }

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

  const isActive = !isArchived && openPrsOk && lastClosedPrOk && pushOk && issuesActivityOk && releaseOk && openIssueAgeOk;
  return {
    status: isActive ? true : false,
    details: { pushOk, openPrsOk, lastClosedPrOk, issuesActivityOk, releaseOk, openIssueAgeOk, isArchived }
  };
}

// Minimal Codeberg status fetcher, mirroring core GitHub logic where fields exist.
// Uses the public Gitea-compatible API: https://codeberg.org/api/v1/repos/{owner}/{repo}
async function fetchCodebergRepoStatus({ owner, repo }, rules) {
  const repoRes = await fetch(`https://codeberg.org/api/v1/repos/${owner}/${repo}`);
  if (repoRes.status === 404 || repoRes.status === 401) {
    return { status: "private" };
  }
  if (!repoRes.ok) throw new Error(`Codeberg repo API failed: ${repoRes.status}`);

  const repoData = await repoRes.json();
  const isArchived = !!repoData.archived;

  const pushOk = withinDays(
    repoData.updated_at,
    Number.isFinite(rules.max_repo_update_time) ? rules.max_repo_update_time : 365
  );

  const isActive = !isArchived && pushOk;
  return {
    status: isActive ? true : false,
    details: { pushOk, isArchived }
  };
}

// Supabase config for unauthenticated GitHub status checks
const SUPABASE_GITHUB_STATUS_URL =
  "https://wmzfmdgkixsgmhmzpwlq.supabase.co/functions/v1/quick-responder";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtemZtZGdraXhzZ21obXpwd2xxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2OTA5MTcsImV4cCI6MjA3ODI2NjkxN30.FWl5v15JqRVc8kfKEv9s-BjSEUx4wZBW2NiH1N18zP8";

// Call the Supabase edge function when the user has no PAT.
// It returns the same shape as fetchGithubRepoStatus: { status, details: {...} }
async function fetchGithubRepoStatusViaSupabase({ owner, repo }, rules) {
  const resp = await fetch(SUPABASE_GITHUB_STATUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ owner, repo, rules }),
  });

  if (!resp.ok) {
    // You can get fancy here if you want (map 401/500/etc),
    // but throwing is fine for now.
    throw new Error(`Supabase github-status failed: ${resp.status}`);
  }

  // Supabase function already returns:
  // { status: true|false|"rate_limited"|"private", details: {...} }
  return resp.json();
}


// Add other ecosystems similarly (GitLab, Bitbucket, npm, etc.)

async function fetchRepoStatusByUrl(rawUrl, rules) {
  const { hostname, pathname } = new URL(rawUrl);
  const parts = pathname.split("/").filter(Boolean);
  const pat = await getPAT(); // existing function that returns the user's PAT or null

  switch (hostname) {
    case "codeberg.org": {
      if (parts.length < 2) throw new Error("Invalid Codeberg URL");
      const [owner, repo] = parts;
      return fetchCodebergRepoStatus({ owner, repo }, rules);
    }

    case "github.com": {
      if (parts.length < 2) throw new Error("Invalid GitHub URL");
      const [owner, repo] = parts;

      if (pat) {
        // Authenticated user → use GitHub directly with their PAT
        return fetchGithubRepoStatus({ owner, repo }, pat, rules);
      }


      console.log("no pat use the server")
      // No PAT → use Supabase edge function (server-side token)
      return fetchGithubRepoStatusViaSupabase({ owner, repo }, rules);
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
          const manifest = (chrome.runtime && typeof chrome.runtime.getManifest === "function")
            ? chrome.runtime.getManifest()
            : {};
          const popupPath =
            (manifest.action && manifest.action.default_popup) ||
            (manifest.browser_action && manifest.browser_action.default_popup) ||
            "popup.html";
          const url = chrome.runtime.getURL(popupPath);
          chrome.tabs.create({ url, active: true }, () => {
            const err = chrome.runtime.lastError; // read to avoid unchecked lastError
            // ignore error; still respond OK to avoid breaking UX
            sendResponse({ ok: true });
          });
          return; // async response
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
          return false;
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
