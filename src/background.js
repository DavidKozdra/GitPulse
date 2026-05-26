console.log("GitPulse SW started", chrome.runtime?.id);
// background.js (MV3 service worker)
//
// This service worker is the extension's privileged backend. Content scripts
// run on arbitrary web pages, so they ask this file to read extension storage,
// call remote APIs, and maintain the cache. Keeping those responsibilities here
// also avoids exposing the GitHub PAT to page scripts.

// ---------------------------
// Constants & helpers
// ---------------------------
const CACHE_PREFIX = "repoCache:";
const CACHE_SCHEMA_VERSION = 4;
// Normal status entries live for one day. That keeps browsing fast while still
// allowing repository activity to become visible without a manual cache clear.
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
// Rate-limit responses intentionally expire faster. A user can add a PAT or the
// host can reset its quota, and we do not want stale throttling to linger all day.
const RATE_TTL_MS = 1000 * 60 * 60 * 2;
const CONFIG_KEY = "repoCheckerConfig";   // unify on the same key used by popup.js

chrome.runtime.onInstalled.addListener(() => {
  console.log("GitPulse Installed");
});

// Storage helpers wrap Chrome's callback APIs into Promises so the rest of the
// service worker can use a straight async/await flow.
const getLocal = (keys) =>
  new Promise((resolve) => chrome.storage.local.get(keys, resolve));
const setLocal = (obj) =>
  new Promise((resolve) => chrome.storage.local.set(obj, resolve));
const removeLocal = (keys) =>
  new Promise((resolve) => chrome.storage.local.remove(keys, resolve));

// Small utils
const now = () => Date.now();
// A missing date is treated as passing. Some registries do not expose every
// timestamp we prefer, so callers opt into failure only when they provide a
// concrete timestamp that is older than the configured threshold.
const withinDays = (dateStr, maxDays) => {
  if (!dateStr || !Number.isFinite(maxDays)) return true;
  const last = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  return last >= cutoff;
};
const isString = (x) => typeof x === "string";
const isPlainObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const DEFAULT_MAX_ACTIVITY_DAYS = 365;
const DEFAULT_MIN_ACTIVE_SCORE = 70;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function clampScore(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function gradeForScore(score) {
  const value = clampScore(score);
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  if (value >= 60) return "D";
  return "F";
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const time = new Date(dateStr).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (now() - time) / MS_PER_DAY);
}

function recencyScore(dateStr, maxDays, missingScore = 0) {
  const ageDays = daysSince(dateStr);
  if (ageDays === null) return clampScore(missingScore);
  if (!Number.isFinite(maxDays)) return 100;
  if (maxDays <= 0) return ageDays <= 0 ? 100 : 0;
  // Decay starts at half the threshold so scores spread across the full A–F
  // range instead of staying at 100 until the hard cutoff.
  const decayStart = maxDays * 0.5;
  if (ageDays <= decayStart) return 100;
  if (ageDays >= maxDays * 2) return 0;
  return clampScore(100 * (1 - ((ageDays - decayStart) / (maxDays * 2 - decayStart))));
}

function maxCountScore(count, maxCount, missingScore = 0) {
  if (!Number.isFinite(count)) return clampScore(missingScore);
  if (!Number.isFinite(maxCount)) return 100;
  if (maxCount <= 0) return count <= 0 ? 100 : 0;
  if (count <= maxCount) return 100;
  if (count >= maxCount * 2) return 0;
  return clampScore(100 * (1 - ((count - maxCount) / maxCount)));
}

function scorePart(key, label, score, weight) {
  return { key, label, score: clampScore(score), weight };
}

function weightedScore(parts) {
  const usable = parts.filter((part) => Number.isFinite(part.weight) && part.weight > 0);
  const totalWeight = usable.reduce((sum, part) => sum + part.weight, 0);
  if (!totalWeight) return 0;
  return clampScore(
    usable.reduce((sum, part) => sum + (clampScore(part.score) * part.weight), 0) / totalWeight
  );
}

function minActiveScore(rules = {}) {
  const score = typeof rules.min_active_score === "number"
    ? rules.min_active_score
    : Number(rules.min_active_score);
  return Number.isFinite(score)
    ? clampScore(rules.min_active_score)
    : DEFAULT_MIN_ACTIVE_SCORE;
}

function finiteNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pickFirst(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function activityDateFromDetails(details = {}) {
  return pickFirst(
    details.pushedAt,
    details.updatedAt,
    details.pushed_at,
    details.updated_at,
    details.last_activity_at,
    details.lastActivityAt,
    details.modified,
    details.lastUpdated
  );
}

function isArchivedFromDetails(details = {}) {
  return details.isArchived === true || details.archived === true;
}

function normalizeRepoResult(result = {}) {
  if (!result || typeof result !== "object") return result;
  const status = result.status !== undefined ? result.status : result.isActive;
  const details = isPlainObject(result.details) ? result.details : {};
  return { ...result, status, details };
}

function booleanScore(value) {
  if (value === true) return 100;
  if (value === false) return 0;
  return null;
}

function recencyOrFlagScore(dateStr, maxDays, okFlag, missingScore = null) {
  if (dateStr) return recencyScore(dateStr, maxDays, missingScore ?? 0);
  const fromFlag = booleanScore(okFlag);
  return fromFlag === null ? missingScore : fromFlag;
}

function pushOkFromDetails(details = {}) {
  if (typeof details.pushOk === "boolean") return details.pushOk;
  if (typeof details.push_ok === "boolean") return details.push_ok;
  return undefined;
}

function flagFromDetails(details = {}, ...keys) {
  for (const key of keys) {
    if (typeof details[key] === "boolean") return details[key];
  }
  return undefined;
}

function calculateRepoScore(details = {}, rules = {}) {
  if (isArchivedFromDetails(details)) {
    return {
      score: 0,
      grade: "F",
      parts: [scorePart("archived", "Archived", 0, 100)],
      available: true,
    };
  }

  const parts = [];
  const activityScore = recencyOrFlagScore(
    activityDateFromDetails(details),
    maxActivityDays(rules),
    pushOkFromDetails(details),
    null
  );
  if (activityScore !== null) {
    parts.push(scorePart(
      "activity",
      "Recent activity",
      activityScore,
      50
    ));
  }

  // For each secondary signal, fall back to a sensible default threshold so the
  // grade reflects real data even when the user hasn't configured that rule.
  const openPrsMax = Number.isFinite(rules.open_prs_max) ? rules.open_prs_max : 20;
  const openPrCount = finiteNumber(details.openPrCount ?? details.open_pr_count);
  const openPrFlag = flagFromDetails(details, "openPrsOk", "open_prs_ok");
  if (openPrCount !== null || typeof openPrFlag === "boolean") {
    parts.push(scorePart(
      "openPrs",
      "Open PR load",
      openPrCount !== null ? maxCountScore(openPrCount, openPrsMax, 0) : booleanScore(openPrFlag),
      10
    ));
  }

  const closedPrMaxDays = Number.isFinite(rules.last_closed_pr_max_days) ? rules.last_closed_pr_max_days : 90;
  const lastClosedPrAt = details.lastClosedPrAt || details.last_closed_pr_at;
  const lastClosedPrFlag = flagFromDetails(details, "lastClosedPrOk", "last_closed_pr_ok");
  if (lastClosedPrAt || typeof lastClosedPrFlag === "boolean") {
    parts.push(scorePart(
      "closedPr",
      "Closed PR recency",
      recencyOrFlagScore(lastClosedPrAt, closedPrMaxDays, lastClosedPrFlag, 100),
      10
    ));
  }

  const issuesMaxDays = Number.isFinite(rules.max_issues_update_time) ? rules.max_issues_update_time : 180;
  const lastIssueUpdatedAt = details.lastIssueUpdatedAt || details.last_issue_updated_at;
  const issuesFlag = flagFromDetails(details, "issuesActivityOk", "issues_activity_ok");
  if (lastIssueUpdatedAt || typeof issuesFlag === "boolean") {
    parts.push(scorePart(
      "issues",
      "Issue activity",
      recencyOrFlagScore(lastIssueUpdatedAt, issuesMaxDays, issuesFlag, 100),
      10
    ));
  }

  const releaseMaxDays = Number.isFinite(rules.max_days_since_last_release) ? rules.max_days_since_last_release : 365;
  const lastReleaseAt = details.lastReleaseAt || details.last_release_at;
  const releaseFlag = flagFromDetails(details, "releaseOk", "release_ok");
  if (lastReleaseAt || typeof releaseFlag === "boolean") {
    parts.push(scorePart(
      "release",
      "Release recency",
      recencyOrFlagScore(lastReleaseAt, releaseMaxDays, releaseFlag, 0),
      10
    ));
  }

  const openIssueMaxDays = Number.isFinite(rules.max_open_issue_age) ? rules.max_open_issue_age : 365;
  const oldestOpenIssueCreatedAt = details.oldestOpenIssueCreatedAt || details.oldest_open_issue_created_at;
  const openIssueAgeFlag = flagFromDetails(details, "openIssueAgeOk", "open_issue_age_ok");
  if (oldestOpenIssueCreatedAt || typeof openIssueAgeFlag === "boolean") {
    parts.push(scorePart(
      "openIssueAge",
      "Open issue age",
      recencyOrFlagScore(oldestOpenIssueCreatedAt, openIssueMaxDays, openIssueAgeFlag, 100),
      10
    ));
  }

  if (!parts.length) {
    return { score: null, grade: null, parts: [], available: false };
  }

  const score = weightedScore(parts);
  return { score, grade: gradeForScore(score), parts, available: true };
}

function attachScore(result, rules = {}) {
  const normalized = normalizeRepoResult(result);
  if (!normalized || (normalized.status !== true && normalized.status !== false)) return normalized;

  const details = normalized.details || {};
  const scoreResult = isArchivedFromDetails(details)
    ? { score: 0, grade: "F", parts: [scorePart("archived", "Archived", 0, 100)], available: true }
    : (() => {
        const providedScore = finiteNumber(normalized.score ?? details.score);
        if (providedScore === null) return calculateRepoScore(details, rules);
        return {
          score: clampScore(providedScore),
          grade: gradeForScore(providedScore),
          parts: Array.isArray(details.scoreParts) ? details.scoreParts : [],
          available: true,
        };
    })();
  const canUseScoreForStatus = rules.score_decides_status === true && scoreResult.available === true;
  const activeByScore = isArchivedFromDetails(details) ? false : scoreResult.score >= minActiveScore(rules);
  const status = canUseScoreForStatus ? activeByScore : normalized.status;

  return {
    ...normalized,
    status,
    ...(scoreResult.available ? { score: scoreResult.score, grade: scoreResult.grade } : {}),
    details: {
      ...details,
      ...(scoreResult.available ? { score: scoreResult.score, grade: scoreResult.grade } : {}),
      minActiveScore: minActiveScore(rules),
      scoreParts: scoreResult.parts,
      scoreDecidesStatus: rules.score_decides_status === true,
      scoreAvailable: scoreResult.available === true,
    },
  };
}

function validateSegment(segment) {
  // URL path pieces are interpolated into remote API URLs. Validate them before
  // building a request so malformed or traversal-like input is rejected early.
  if (typeof segment !== "string") throw new Error("Invalid path segment");
  const value = segment.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error("Unsafe path segment");
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
    throw new Error("Invalid path segment");
  }
  return value;
}

function validatePackageName(name) {
  // Package registries allow scoped names such as @scope/name, but still should
  // not receive slashes, traversal segments, or backslashes beyond that format.
  if (typeof name !== "string") throw new Error("Invalid package name");
  const value = name.trim();
  if (!value || value.includes("\\") || value.includes("..")) {
    throw new Error("Unsafe package name");
  }
  if (!/^(@[A-Za-z0-9._~-]+\/)?[A-Za-z0-9._~-]+$/.test(value)) {
    throw new Error("Invalid package name");
  }
  return value;
}

function maxActivityDays(rules) {
  return Number.isFinite(rules.max_repo_update_time)
    ? rules.max_repo_update_time
    : DEFAULT_MAX_ACTIVITY_DAYS;
}

function activityStatus({ host, updatedAt, pushedAt, archived = false, details = {} }, rules) {
  // All host adapters collapse their native response into this shared shape.
  // The UI only needs a stable status plus details for the tooltip/banner.
  const activityAt = pushedAt || updatedAt;
  const pushOk = !!activityAt && withinDays(activityAt, maxActivityDays(rules));
  const isArchived = !!archived;

  return {
    status: !isArchived && pushOk ? true : false,
    details: {
      host,
      updatedAt: updatedAt || null,
      pushedAt: pushedAt || null,
      pushOk,
      isArchived,
      ...details,
    },
  };
}

function rateLimitedStatus(host) {
  return { status: "rate_limited", details: { host } };
}

function privateStatus(host) {
  return { status: "private", details: { host } };
}

function unsupportedStatus(host, reason = "No checker is available for this host yet") {
  return { status: "unsupported", details: { host, reason } };
}

async function fetchJson(url, options = {}) {
  // Registry APIs use different status codes for throttling. Normalize those
  // into rateLimited so callers can cache and display that state consistently.
  const response = Object.keys(options).length ? await fetch(url, options) : await fetch(url);
  if (response.status === 429) return { response, data: null, rateLimited: true };
  if (response.status === 403 && /api\.github\.com|crates\.io|hub\.docker\.com/.test(url)) {
    return { response, data: null, rateLimited: true };
  }
  if (!response.ok) return { response, data: null, rateLimited: false };
  return { response, data: await response.json(), rateLimited: false };
}

function maxIsoDate(values) {
  // Several package APIs return one timestamp per release/file. Keep the newest
  // valid ISO-ish value and ignore absent or malformed values.
  let best = null;
  let bestTime = -Infinity;
  values.forEach((value) => {
    if (!value) return;
    const time = new Date(value).getTime();
    if (Number.isFinite(time) && time > bestTime) {
      bestTime = time;
      best = value;
    }
  });
  return best;
}

function splitBeforeGitLabMarker(parts) {
  // GitLab repository subpages can contain marker segments such as /-/issues.
  // Project paths before that marker may themselves be nested groups.
  const markerIndex = parts.indexOf("-");
  return markerIndex === -1 ? parts : parts.slice(0, markerIndex);
}

async function smartClearCache(oldConfig, newConfig) {
  // Emoji changes only affect rendering, not repository status decisions. Cache
  // can stay warm for those updates, but any rule value/active change requires a
  // full clear so old status results are not evaluated with stale thresholds.
  if (!isPlainObject(oldConfig) || !isPlainObject(newConfig)) {
    await clearCache();
    return { success: true, cleared: true };
  }

  const keys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
  const changedRuleKeys = [];

  for (const key of keys) {
    if (
      key.startsWith("emoji_") ||
      key === "grading_enabled" ||
      key === "marker_display" ||
      key === "banner_display"
    ) continue;

    const prev = oldConfig[key];
    const next = newConfig[key];
    const prevActive = prev?.active ?? false;
    const nextActive = next?.active ?? false;
    const prevValue = prev?.value;
    const nextValue = next?.value;

    if (prevActive !== nextActive || prevValue !== nextValue) {
      changedRuleKeys.push(key);
    }
  }

  if (!changedRuleKeys.length) {
    return { success: true, skipped: true };
  }

  await clearCache();
  return { success: true, cleared: true, changedRuleKeys };
}

// Merge active, enabled config fields into a flat rules object. Fetchers consume
// this compact rules shape instead of the popup's richer form-field metadata.
async function loadActiveRules() {
  const { [CONFIG_KEY]: cfg } = await getLocal([CONFIG_KEY]);
  if (!cfg) return {};
  return Object.entries(cfg)
    .filter(([, f]) => f && f.active && f.value !== undefined)
    .reduce((acc, [k, f]) => { acc[k] = f.value; return acc; }, {});
}

// Cache helpers store host+path entries under a versioned schema. Bumping
// CACHE_SCHEMA_VERSION makes older entries invisible without migrating them.
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

  // Direct GitHub API calls require a user-provided token. The token check is
  // intentionally simple: it catches obvious mistakes before issuing requests,
  // while GitHub remains the source of truth for authorization.
  if(!pat || pat.length === 0){
    throw new Error("No PAT provided");
  }
  if (!/^(ghp_|github_pat_)/i.test(pat)) {
    throw new Error("Invalid PAT format — expected a token starting with ghp_ or github_pat_");
  }

  const headers = {
    Accept: "application/vnd.github.v3+json",
    ...(pat ? { Authorization: `token ${pat}` } : {}),
  };

  // 1) Repo metadata supplies archive state plus the baseline activity dates.
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
    return activityStatus({
      host: "github.com",
      pushedAt: repoData.pushed_at,
      updatedAt: repoData.updated_at,
      archived: true,
    }, rules);
  }

  // 2) Open PR threshold. The search API exposes total_count without needing to
  // page through every open PR, which keeps checks cheap.
  let openPrsOk = true;
  let openPrCount = null;
  if (Number.isFinite(rules.open_prs_max)) {
    const prsRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:pr+is:open&per_page=1`,
      { headers }
    );
    if (prsRes.status === 403) return { status: "rate_limited" };
    if (!prsRes.ok) throw new Error(`GitHub search PRs failed: ${prsRes.status}`);
    const prs = await prsRes.json();
    openPrCount = prs.total_count || 0;
    openPrsOk = openPrCount <= rules.open_prs_max;
  }

  // 3) Last closed PR age. A repo can be active even with low commit volume if
  // maintainers are still closing or merging PRs.
  let lastClosedPrOk = true;
  let lastClosedPrAt = null;
  if (Number.isFinite(rules.last_closed_pr_max_days)) {
    const closedRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=1`,
      { headers }
    );
    if (closedRes.status === 403) return { status: "rate_limited" };
    if (!closedRes.ok) throw new Error(`GitHub closed PRs failed: ${closedRes.status}`);
    const closed = await closedRes.json();
    lastClosedPrAt = closed?.[0]?.closed_at || closed?.[0]?.merged_at || null;
    lastClosedPrOk = withinDays(lastClosedPrAt, rules.last_closed_pr_max_days);
  }

  // 4) Core push recency. This is the default rule and remains the main signal
  // when optional rules are not enabled.
  const pushOk = withinDays(
    repoData.pushed_at,
    Number.isFinite(rules.max_repo_update_time) ? rules.max_repo_update_time : 365
  );

  // 5) Issue activity recency. This optional rule catches repos where issues are
  // still being triaged even if pushes are infrequent.
  let issuesActivityOk = true;
  let lastIssueUpdatedAt = null;
  if (Number.isFinite(rules.max_issues_update_time)) {
    const issuesRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:issue&sort=updated&order=desc&per_page=1`,
      { headers }
    );
    if (issuesRes.status === 403) return { status: "rate_limited" };
    if (!issuesRes.ok) throw new Error(`GitHub search issues failed: ${issuesRes.status}`);
    const issues = await issuesRes.json();
    lastIssueUpdatedAt = issues?.items?.[0]?.updated_at || null;
    issuesActivityOk = withinDays(lastIssueUpdatedAt, rules.max_issues_update_time);
  }

  // 6) Last release recency. Missing releases fail this optional rule because a
  // configured release threshold means the user explicitly cares about releases.
  let releaseOk = true;
  let lastReleaseAt = null;
  if (Number.isFinite(rules.max_days_since_last_release)) {
    const relRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=1`,
      { headers }
    );
    if (relRes.status === 403) return { status: "rate_limited" };
    if (!relRes.ok && relRes.status !== 404) throw new Error(`GitHub releases failed: ${relRes.status}`);
    if (relRes.ok) {
      const rels = await relRes.json();
      const rel = rels?.[0];
      lastReleaseAt = rel?.published_at || rel?.created_at;
    }
    // If no releases, consider not OK only if rule is active
    releaseOk = withinDays(lastReleaseAt, rules.max_days_since_last_release);
  }

  // 7) Oldest open issue age. A stale oldest issue is a weak maintenance signal,
  // so it is only evaluated when the user enables that threshold.
  let openIssueAgeOk = true;
  let oldestOpenIssueCreatedAt = null;
  if (Number.isFinite(rules.max_open_issue_age)) {
    const oldestOpenRes = await fetch(
      `https://api.github.com/search/issues?q=repo:${owner}/${repo}+is:issue+is:open&sort=created&order=asc&per_page=1`,
      { headers }
    );
    if (oldestOpenRes.status === 403) return { status: "rate_limited" };
    if (!oldestOpenRes.ok) throw new Error(`GitHub oldest open issue failed: ${oldestOpenRes.status}`);
    const oldest = await oldestOpenRes.json();
    oldestOpenIssueCreatedAt = oldest?.items?.[0]?.created_at || null;
    // Pass if there are no open issues (items empty) or if oldest is within threshold
    openIssueAgeOk = withinDays(oldestOpenIssueCreatedAt, rules.max_open_issue_age);
  }

  const isActive = !isArchived && openPrsOk && lastClosedPrOk && pushOk && issuesActivityOk && releaseOk && openIssueAgeOk;
  return {
    status: isActive ? true : false,
    details: {
      host: "github.com",
      pushedAt: repoData.pushed_at,
      updatedAt: repoData.updated_at,
      openPrCount,
      lastClosedPrAt,
      lastIssueUpdatedAt,
      lastReleaseAt,
      oldestOpenIssueCreatedAt,
      pushOk,
      openPrsOk,
      lastClosedPrOk,
      issuesActivityOk,
      releaseOk,
      openIssueAgeOk,
      isArchived,
    }
  };
}

// Minimal Codeberg status fetcher, mirroring core GitHub logic where fields exist.
// Uses the public Gitea-compatible API: https://codeberg.org/api/v1/repos/{owner}/{repo}
async function fetchCodebergRepoStatus({ owner, repo }, rules) {
  // Codeberg exposes a Gitea-compatible repo endpoint. It lacks every GitHub
  // detail we check above, so this adapter returns the common activity fields.
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
    details: {
      host: "codeberg.org",
      updatedAt: repoData.updated_at,
      pushedAt: repoData.updated_at,
      pushOk,
      isArchived,
    }
  };
}

async function fetchGitlabRepoStatus({ projectPath }, rules) {
  // GitLab project IDs are URL-encoded full paths such as group/subgroup/repo.
  // last_activity_at is the closest equivalent to GitHub pushed_at.
  const url = `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("gitlab.com");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("gitlab.com");
  }
  if (!response.ok) throw new Error(`GitLab project API failed: ${response.status}`);

  return activityStatus({
    host: "gitlab.com",
    updatedAt: data.last_activity_at || data.updated_at,
    archived: !!data.archived,
    details: { projectPath },
  }, rules);
}

async function fetchBitbucketRepoStatus({ workspace, repo }, rules) {
  // Bitbucket reports private repositories explicitly when visible through the
  // unauthenticated API; inaccessible repos still appear as auth/not-found codes.
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("bitbucket.org");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("bitbucket.org");
  }
  if (!response.ok) throw new Error(`Bitbucket repository API failed: ${response.status}`);
  if (data.is_private === true) return privateStatus("bitbucket.org");

  return activityStatus({
    host: "bitbucket.org",
    updatedAt: data.updated_on || data.created_on,
    details: { workspace, repo },
  }, rules);
}

async function fetchNpmPackageStatus({ packageName }, rules) {
  // npm package pages are treated like repositories for browsing purposes. The
  // registry's modified time is the activity timestamp used by GitPulse.
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("npmjs.com");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("npmjs.com");
  }
  if (!response.ok) throw new Error(`npm registry API failed: ${response.status}`);

  return activityStatus({
    host: "npmjs.com",
    updatedAt: data?.time?.modified || null,
    archived: !!data?.time?.unpublished,
    details: { packageName, latestVersion: data?.["dist-tags"]?.latest || null },
  }, rules);
}

async function fetchDockerHubRepoStatus({ namespace, repo }, rules) {
  // Docker Hub's last_updated field is preferred, with registration dates kept
  // as a fallback so old-but-valid images still produce a deterministic status.
  const url = `https://hub.docker.com/v2/repositories/${namespace}/${repo}/`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("hub.docker.com");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("hub.docker.com");
  }
  if (!response.ok) throw new Error(`Docker Hub API failed: ${response.status}`);
  if (data.is_private === true) return privateStatus("hub.docker.com");

  return activityStatus({
    host: "hub.docker.com",
    updatedAt: data.last_updated || data.updated_at || data.date_registered,
    details: {
      namespace,
      repo,
      pullCount: Number.isFinite(data.pull_count) ? data.pull_count : null,
      starCount: Number.isFinite(data.star_count) ? data.star_count : null,
    },
  }, rules);
}

async function fetchPypiProjectStatus({ project }, rules) {
  // PyPI exposes activity per release file. We scan those upload timestamps and
  // use the newest one as the package's last activity date.
  const url = `https://pypi.org/pypi/${encodeURIComponent(project)}/json`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("pypi.org");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("pypi.org");
  }
  if (!response.ok) throw new Error(`PyPI API failed: ${response.status}`);

  const releaseDates = [];
  Object.values(data.releases || {}).forEach((files) => {
    if (!Array.isArray(files)) return;
    files.forEach((file) => releaseDates.push(file.upload_time_iso_8601 || file.upload_time));
  });

  return activityStatus({
    host: "pypi.org",
    updatedAt: maxIsoDate(releaseDates),
    details: { project, latestVersion: data?.info?.version || null },
  }, rules);
}

async function fetchCratesStatus({ crate }, rules) {
  // crates.io has a compact crate payload with updated_at and max_version, which
  // maps directly into GitPulse's shared activity/details shape.
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(crate)}`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("crates.io");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("crates.io");
  }
  if (!response.ok) throw new Error(`crates.io API failed: ${response.status}`);

  return activityStatus({
    host: "crates.io",
    updatedAt: data?.crate?.updated_at || data?.crate?.created_at,
    details: { crate, latestVersion: data?.crate?.max_version || null },
  }, rules);
}

async function fetchPackagistStatus({ vendor, packageName }, rules) {
  // Packagist returns many versions under the full vendor/package key. The most
  // recent version timestamp is the useful maintenance signal.
  const fullName = `${vendor}/${packageName}`;
  const url = `https://repo.packagist.org/p2/${vendor}/${packageName}.json`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("packagist.org");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("packagist.org");
  }
  if (!response.ok) throw new Error(`Packagist API failed: ${response.status}`);

  const versions = data?.packages?.[fullName] || [];
  const updatedAt = maxIsoDate(versions.map((version) => version.time));

  return activityStatus({
    host: "packagist.org",
    updatedAt,
    details: { packageName: fullName, latestVersion: versions?.[0]?.version || null },
  }, rules);
}

function newestDatetimeFromHtml(html) {
  // SourceHut does not expose an unauthenticated JSON endpoint for this check,
  // so we parse the page's datetime attributes as a best-effort signal.
  const matches = [...String(html).matchAll(/datetime=["']([^"']+)["']/gi)];
  return maxIsoDate(matches.map((match) => match[1]));
}

async function fetchSourcehutRepoStatus({ owner, repo }, rules) {
  const url = `https://git.sr.ht/${owner}/${repo}`;
  const response = await fetch(url);
  if (response.status === 429) return rateLimitedStatus("git.sr.ht");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("git.sr.ht");
  }
  if (!response.ok) throw new Error(`SourceHut page fetch failed: ${response.status}`);

  const html = await response.text();
  const updatedAt = newestDatetimeFromHtml(html);
  if (!updatedAt) return unsupportedStatus("git.sr.ht", "No activity timestamp found on the repository page");

  return activityStatus({
    host: "git.sr.ht",
    updatedAt,
    details: { owner, repo },
  }, rules);
}

async function fetchLaunchpadStatus({ project }, rules) {
  // Launchpad's API has a project-level activity date and active flag, which is
  // enough for the shared archive/activity decision.
  const url = `https://api.launchpad.net/1.0/${project}`;
  const { response, data, rateLimited } = await fetchJson(url);
  if (rateLimited) return rateLimitedStatus("launchpad.net");
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return privateStatus("launchpad.net");
  }
  if (!response.ok) throw new Error(`Launchpad API failed: ${response.status}`);

  return activityStatus({
    host: "launchpad.net",
    updatedAt: data.date_last_updated || data.date_created,
    archived: data.active === false,
    details: { project },
  }, rules);
}

// Supabase config for unauthenticated GitHub status checks
const SUPABASE_GITHUB_STATUS_URL =
  "https://wmzfmdgkixsgmhmzpwlq.supabase.co/functions/v1/quick-responder";

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtemZtZGdraXhzZ21obXpwd2xxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2OTA5MTcsImV4cCI6MjA3ODI2NjkxN30.FWl5v15JqRVc8kfKEv9s-BjSEUx4wZBW2NiH1N18zP8";

// Call the Supabase edge function when the user has no PAT.
// It returns the same shape as fetchGithubRepoStatus: { status, details: {...} }
async function fetchGithubRepoStatusViaSupabase({ owner, repo }, rules) {
  // When there is no user PAT, defer GitHub checks to the edge function. It
  // returns the same status shape as the direct GitHub adapter so callers do not
  // need a special case.
  const resp = await fetch(SUPABASE_GITHUB_STATUS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ owner, repo, rules }),
  });

  if (!resp.ok) {
    console.error("Supabase response not ok:", resp.status);
    if (resp.status === 429 || resp.status === 403) {
      return rateLimitedStatus("github.com");
    }
    throw new Error(`Supabase github-status failed: ${resp.status}`);
  }

  const data = await resp.json();
  if (data?.status === "rate_limited" || data?.rateLimited === true) {
    return rateLimitedStatus("github.com");
  }
  return data;
}



// Add other ecosystems similarly (GitLab, Bitbucket, npm, etc.)

async function fetchRepoStatusByUrl(rawUrl, rules) {
  // Route a browser URL to the adapter that understands that host's URL shape
  // and public API. Every branch validates path segments before interpolation.
  const { hostname, pathname } = new URL(rawUrl);
  const parts = pathname.split("/").filter(Boolean);
  const pat = await getPAT(); // existing function that returns the user's PAT or null

  switch (hostname) {
    case "gitlab.com": {
      const repoParts = splitBeforeGitLabMarker(parts);
      if (repoParts.length < 2) throw new Error("Invalid GitLab URL");
      const projectPath = repoParts.map(validateSegment).join("/");
      return attachScore(await fetchGitlabRepoStatus({ projectPath }, rules), rules);
    }

    case "codeberg.org": {
      if (parts.length < 2) throw new Error("Invalid Codeberg URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return attachScore(await fetchCodebergRepoStatus({ owner, repo }, rules), rules);
    }

    case "github.com": {
      if (parts.length < 2) throw new Error("Invalid GitHub URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));

      
      if (typeof pat === "string" && pat.length > 0) {
        // Authenticated user → use GitHub directly with their PAT
        return attachScore(await fetchGithubRepoStatus({ owner, repo }, pat, rules), rules);
      }
      

      console.log("no pat use the server")
      // No PAT → use Supabase edge function (server-side token)
      return attachScore(await fetchGithubRepoStatusViaSupabase({ owner, repo }, rules), rules);
    }

    case "bitbucket.org": {
      if (parts.length < 2) throw new Error("Invalid Bitbucket URL");
      const workspace = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return attachScore(await fetchBitbucketRepoStatus({ workspace, repo }, rules), rules);
    }

    case "www.npmjs.com":
    case "npmjs.com": {
      if (parts[0] !== "package" || parts.length < 2) throw new Error("Invalid npm package URL");
      const packageName = parts[1]?.startsWith("@")
        ? validatePackageName(`${parts[1]}/${parts[2] || ""}`)
        : validatePackageName(parts[1]);
      return attachScore(await fetchNpmPackageStatus({ packageName }, rules), rules);
    }

    case "hub.docker.com": {
      if (parts[0] !== "r" || parts.length < 3) throw new Error("Invalid Docker Hub URL");
      const namespace = validateSegment(parts[1]);
      const repo = validateSegment(parts[2]);
      return attachScore(await fetchDockerHubRepoStatus({ namespace, repo }, rules), rules);
    }

    case "pypi.org": {
      if (parts[0] !== "project" || parts.length < 2) throw new Error("Invalid PyPI project URL");
      const project = validatePackageName(parts[1]);
      return attachScore(await fetchPypiProjectStatus({ project }, rules), rules);
    }

    case "crates.io": {
      if (parts[0] !== "crates" || parts.length < 2) throw new Error("Invalid crates.io URL");
      const crate = validatePackageName(parts[1]);
      return attachScore(await fetchCratesStatus({ crate }, rules), rules);
    }

    case "packagist.org": {
      if (parts[0] !== "packages" || parts.length < 3) throw new Error("Invalid Packagist URL");
      const vendor = validateSegment(parts[1]);
      const packageName = validateSegment(parts[2]);
      return attachScore(await fetchPackagistStatus({ vendor, packageName }, rules), rules);
    }

    case "git.sr.ht": {
      if (parts.length < 2) throw new Error("Invalid SourceHut URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return attachScore(await fetchSourcehutRepoStatus({ owner, repo }, rules), rules);
    }

    case "launchpad.net": {
      if (parts.length < 1) throw new Error("Invalid Launchpad URL");
      const project = validateSegment(parts[0]);
      return attachScore(await fetchLaunchpadStatus({ project }, rules), rules);
    }

    default:
      return attachScore(unsupportedStatus(hostname), rules);
  }
}


// ---------------------------
// Unified message handler
// ---------------------------
async function handleMessage(message, sender, sendResponse) {
  // This is the single message boundary for popup/content requests. Each case
  // sends exactly one response and returns, while the listener below keeps the
  // message channel open for async work.
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
          sendResponse({
            isActive: item.isActive,
            fromCache: true,
            details: item.details,
            score: item.score,
            grade: item.grade,
          });
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

          // Chrome/Edge won't let us open the action popup UI directly from a content script.
          // Best approximation: open the same popup page in a small popup window.
          try {
            chrome.windows.create(
              {
                url,
                type: "popup",
                width: 420,
                height: 600,
                focused: true,
              },
              () => {
                const err = chrome.runtime.lastError; // read to avoid unchecked lastError
                if (err) {
                  // If popup windows are blocked, fall back to a normal tab.
                  chrome.tabs.create({ url, active: true }, () => {
                    const _ = chrome.runtime.lastError;
                    sendResponse({ ok: true });
                  });
                  return;
                }
                sendResponse({ ok: true });
              }
            );
          } catch {
            chrome.tabs.create({ url, active: true }, () => {
              const _ = chrome.runtime.lastError;
              sendResponse({ ok: true });
            });
          }
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
        const nextConfig = isPlainObject(message.config) ? message.config : {};
        const { [CONFIG_KEY]: oldConfig } = await getLocal([CONFIG_KEY]);
        await setLocal({ [CONFIG_KEY]: nextConfig });
        const cacheResult = await smartClearCache(oldConfig, nextConfig);
        sendResponse({ success: true, cache: cacheResult });
        return;
      }
      
      case "getConfig": {
        getLocal([CONFIG_KEY])
          .then(result => {
            const stored = result[CONFIG_KEY];
            sendResponse({ config: isPlainObject(stored) ? stored : {} });
          })
          .catch(err => {
            console.error("Failed to read config:", err);
            sendResponse({ config: {} }); // fail-safe fallback
          });

        return true; // KEEP MESSAGE CHANNEL OPEN
      }



      case "fetchRepoStatus": {
        console.log("fetchRepoStatus received:", message.url);
        if (typeof message.url !== "string") { sendResponse({ ok: false, error: "Missing url" }); return; }

        const cacheKey = (() => {
          try { const u = new URL(message.url); return u.hostname + u.pathname; }
          catch { return ""; }
        })();
        if (!cacheKey) { sendResponse({ ok: false, error: "Invalid URL" }); return; }

        const forceRefresh = message.forceRefresh === true;
        const cached = forceRefresh ? null : await readCache(cacheKey);
        if (cached) {
          const cachedResult = { status: cached.isActive, details: cached.details };
          if (Number.isFinite(cached.score)) cachedResult.score = cached.score;
          if (typeof cached.grade === "string") cachedResult.grade = cached.grade;
          sendResponse({
            ok: true,
            result: cachedResult,
            fromCache: true,
          });
          return;
        }

        const rules = await loadActiveRules();
        try {
          const result = await fetchRepoStatusByUrl(message.url, rules);
          if (result && (result.status === true || result.status === false)) {
            await writeCache(cacheKey, {
              isActive: result.status,
              details: result.details,
              score: result.score,
              grade: result.grade,
            });
          }
          sendResponse({ ok: true, result, fromCache: false });
        } catch (err) {
          const errMsg = String(err);
          const isRateLimit = /rate.limit|429|403/i.test(errMsg);
          sendResponse({
            ok: true,
            result: {
              status: isRateLimit ? "rate_limited" : false,
              details: { error: errMsg },
            },
            fromCache: false,
          });
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
  const allowedOrigins = ["https://github.com", "https://codeberg.org"];
  if (!s?.origin || !allowedOrigins.includes(s.origin)) {
    r({ ok: false, error: "origin not allowed" });
    return;
  }
  handleMessage(m, s, r);
  return true; // keep channel open for async sendResponse
});
