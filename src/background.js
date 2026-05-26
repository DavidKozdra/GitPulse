console.log("GitPulse SW started", chrome.runtime?.id);
// background.js (MV3 service worker)

// ---------------------------
// Constants & helpers
// ---------------------------
const CACHE_PREFIX = "repoCache:";
const CACHE_SCHEMA_VERSION = 3;
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
const isPlainObject = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const DEFAULT_MAX_ACTIVITY_DAYS = 365;

function validateSegment(segment) {
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
  const response = Object.keys(options).length ? await fetch(url, options) : await fetch(url);
  if (response.status === 429) return { response, data: null, rateLimited: true };
  if (response.status === 403 && /api\.github\.com|crates\.io|hub\.docker\.com/.test(url)) {
    return { response, data: null, rateLimited: true };
  }
  if (!response.ok) return { response, data: null, rateLimited: false };
  return { response, data: await response.json(), rateLimited: false };
}

function maxIsoDate(values) {
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
  const markerIndex = parts.indexOf("-");
  return markerIndex === -1 ? parts : parts.slice(0, markerIndex);
}

async function smartClearCache(oldConfig, newConfig) {
  if (!isPlainObject(oldConfig) || !isPlainObject(newConfig)) {
    await clearCache();
    return { success: true, cleared: true };
  }

  const keys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
  const changedRuleKeys = [];

  for (const key of keys) {
    if (key.startsWith("emoji_")) continue;

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
    return activityStatus({
      host: "github.com",
      pushedAt: repoData.pushed_at,
      updatedAt: repoData.updated_at,
      archived: true,
    }, rules);
  }

  // 2) Open PR threshold (use search API for total_count)
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

  // 3) Last closed PR age
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

  // 4) Core push recency
  const pushOk = withinDays(
    repoData.pushed_at,
    Number.isFinite(rules.max_repo_update_time) ? rules.max_repo_update_time : 365
  );

  // 5) Issue activity recency
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

  // 6) Last release recency
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

  // 7) Oldest open issue age
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
    throw new Error(`Supabase github-status failed: ${resp.status}`);
  }

  const data = await resp.json();
  return data;
}



// Add other ecosystems similarly (GitLab, Bitbucket, npm, etc.)

async function fetchRepoStatusByUrl(rawUrl, rules) {
  const { hostname, pathname } = new URL(rawUrl);
  const parts = pathname.split("/").filter(Boolean);
  const pat = await getPAT(); // existing function that returns the user's PAT or null

  switch (hostname) {
    case "gitlab.com": {
      const repoParts = splitBeforeGitLabMarker(parts);
      if (repoParts.length < 2) throw new Error("Invalid GitLab URL");
      const projectPath = repoParts.map(validateSegment).join("/");
      return fetchGitlabRepoStatus({ projectPath }, rules);
    }

    case "codeberg.org": {
      if (parts.length < 2) throw new Error("Invalid Codeberg URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return fetchCodebergRepoStatus({ owner, repo }, rules);
    }

    case "github.com": {
      if (parts.length < 2) throw new Error("Invalid GitHub URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));

      
      if (typeof pat === "string" && pat.length > 0) {
        // Authenticated user → use GitHub directly with their PAT
        return fetchGithubRepoStatus({ owner, repo }, pat, rules);
      }
      

      console.log("no pat use the server")
      // No PAT → use Supabase edge function (server-side token)
      return fetchGithubRepoStatusViaSupabase({ owner, repo }, rules);
    }

    case "bitbucket.org": {
      if (parts.length < 2) throw new Error("Invalid Bitbucket URL");
      const workspace = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return fetchBitbucketRepoStatus({ workspace, repo }, rules);
    }

    case "www.npmjs.com":
    case "npmjs.com": {
      if (parts[0] !== "package" || parts.length < 2) throw new Error("Invalid npm package URL");
      const packageName = parts[1]?.startsWith("@")
        ? validatePackageName(`${parts[1]}/${parts[2] || ""}`)
        : validatePackageName(parts[1]);
      return fetchNpmPackageStatus({ packageName }, rules);
    }

    case "hub.docker.com": {
      if (parts[0] !== "r" || parts.length < 3) throw new Error("Invalid Docker Hub URL");
      const namespace = validateSegment(parts[1]);
      const repo = validateSegment(parts[2]);
      return fetchDockerHubRepoStatus({ namespace, repo }, rules);
    }

    case "pypi.org": {
      if (parts[0] !== "project" || parts.length < 2) throw new Error("Invalid PyPI project URL");
      const project = validatePackageName(parts[1]);
      return fetchPypiProjectStatus({ project }, rules);
    }

    case "crates.io": {
      if (parts[0] !== "crates" || parts.length < 2) throw new Error("Invalid crates.io URL");
      const crate = validatePackageName(parts[1]);
      return fetchCratesStatus({ crate }, rules);
    }

    case "packagist.org": {
      if (parts[0] !== "packages" || parts.length < 3) throw new Error("Invalid Packagist URL");
      const vendor = validateSegment(parts[1]);
      const packageName = validateSegment(parts[2]);
      return fetchPackagistStatus({ vendor, packageName }, rules);
    }

    case "git.sr.ht": {
      if (parts.length < 2) throw new Error("Invalid SourceHut URL");
      const owner = validateSegment(parts[0]);
      const repo = validateSegment((parts[1] || "").replace(/\.git$/i, ""));
      return fetchSourcehutRepoStatus({ owner, repo }, rules);
    }

    case "launchpad.net": {
      if (parts.length < 1) throw new Error("Invalid Launchpad URL");
      const project = validateSegment(parts[0]);
      return fetchLaunchpadStatus({ project }, rules);
    }

    default:
      return unsupportedStatus(hostname);
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
  const allowedOrigins = ["https://github.com", "https://codeberg.org"];
  if (!s?.origin || !allowedOrigins.includes(s.origin)) {
    r({ ok: false, error: "origin not allowed" });
    return;
  }
  handleMessage(m, s, r);
  return true; // keep channel open for async sendResponse
});
