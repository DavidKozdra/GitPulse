// main.helpers.js
// Shared helpers for the content script (extracted from main.js)
var rate_limited = false;

const STATUS_LABELS = {
  true: "Active repository",
  false: "Inactive repository",
  private: "Private repository",
  rate_limited: "Rate limited",
  unsupported: "Unsupported repository host",
};

function isReloadNavigation() {
  try {
    const perf = typeof performance !== "undefined" ? performance : null;
    if (!perf) return false;

    if (typeof perf.getEntriesByType === "function") {
      const navigation = perf.getEntriesByType("navigation")?.[0];
      if (navigation?.type === "reload") return true;
      if (navigation?.type && navigation.type !== "reload") return false;
    }

    return perf.navigation?.type === 1;
  } catch {
    return false;
  }
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "";

  const diffMs = Date.now() - time;
  if (diffMs < 0) return "in the future";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 24) return `${months} months ago`;

  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function formatRepoStatusDetails(status, details = {}, meta = {}) {
  if (status === "unsupported") {
    const host = details?.host || "this host";
    return `GitPulse does not check ${host} yet.`;
  }

  if (details?.error) {
    return `Check failed: ${String(details.error).replace(/^Error:\s*/, "")}`;
  }

  if (status === "private") {
    return `${details?.host || "The host"} reports this item as private or unavailable.`;
  }

  if (status === "rate_limited") {
    return "GitHub API limit reached. Add a token or try again later.";
  }

  const parts = [];
  const activityAt = details?.pushedAt || details?.updatedAt;
  const activityAgo = formatRelativeDate(activityAt);
  if (activityAgo) parts.push(`Last activity ${activityAgo}`);

  if (Number.isFinite(details?.openPrCount)) {
    parts.push(`${details.openPrCount} open PRs`);
  }

  const closedPrAgo = formatRelativeDate(details?.lastClosedPrAt);
  if (closedPrAgo) parts.push(`Last closed PR ${closedPrAgo}`);

  const releaseAgo = formatRelativeDate(details?.lastReleaseAt);
  if (releaseAgo) parts.push(`Last release ${releaseAgo}`);

  if (details?.latestVersion) parts.push(`Latest ${details.latestVersion}`);

  const failedChecks = [];
  if (details?.isArchived === true) failedChecks.push("archived");
  if (details?.pushOk === false) failedChecks.push("push recency");
  if (details?.openPrsOk === false) failedChecks.push("open PR count");
  if (details?.lastClosedPrOk === false) failedChecks.push("closed PR recency");
  if (details?.issuesActivityOk === false) failedChecks.push("issue activity");
  if (details?.releaseOk === false) failedChecks.push("release recency");
  if (details?.openIssueAgeOk === false) failedChecks.push("open issue age");
  if (failedChecks.length) parts.push(`Failed: ${failedChecks.join(", ")}`);

  if (meta?.fromCache) parts.push("Cached result");

  return parts.slice(0, 4).join(" | ");
}

function statusLabel(status) {
  if (status === true) return STATUS_LABELS.true;
  if (status === false) return STATUS_LABELS.false;
  return STATUS_LABELS[status] || "Repository status";
}

async function getRepoStatus(url, options = {}) {
  const message = { action: "fetchRepoStatus", url };
  if (options.bypassCache === true) message.forceRefresh = true;

  const res = await ext.sendMessage(message);
  if (!res || res.ok === false) {
    console.warn("[Repo check] background error", res?.error);
    return {
      status: false,
      details: { error: res?.error || "Background check failed" },
      fromCache: false,
    };
  }
  return {
    status: res.result?.status,
    details: res.result?.details || {},
    fromCache: !!res.fromCache,
  };
}

async function isRepoActive(url, options = {}) {
  const result = await getRepoStatus(url, options);
  return result.status; // true | false | "rate_limited" | "private" | "unsupported"
}

globalThis.__gp = globalThis.__gp || {};
globalThis.__gp.formatRepoStatusDetails = formatRepoStatusDetails;
globalThis.__gp.statusLabel = statusLabel;

// Export for Node test environment (jest) if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isRepoUrl,
    getActiveConfigMetrics,
    getRepoStatus,
    isRepoActive,
    isReloadNavigation,
    formatRepoStatusDetails,
    statusLabel,
  };
}

async function getCacheFromBackground(key) {
  return ext.sendMessage({ action: "getCache", key });
}

async function setCacheInBackground(key, value) {
  return ext.sendMessage({ action: "setCache", key, value });
}

function getActiveConfigMetrics() {
  return Object.entries(config)
    .filter(([key, field]) => field.active && field.value !== undefined)
    .reduce((acc, [key, field]) => {
      acc[key] = field.value;
      return acc;
    }, {});
}

function isRepoUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const parts = pathname.split("/").filter(Boolean);

    const reservedPaths = new Set([
      "topics", "explore", "features", "issues", "pulls",
      "marketplace", "orgs", "enterprise", "settings",
      "sponsors", "login", "logout", "signup", "register",
      "notifications", "dashboard", "admin", "administrator",
      "help", "support", "docs", "api", "about", "contact",
      "security", "apps", "blog", "events", "community",
      "organizations", "repositories", "search", "trending",
      "gist", "gist.github", "releases", "archive", "new",
      "watching", "stars", "forks", "followers", "following",
      "milestones", "projects", "teams", "labels", "topics",
      "codespaces", "actions", "discussions", "pages"
    ]);

    switch (hostname) {
      case "github.com":
      case "gitlab.com":
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "codeberg.org":
        // Gitea-based, similar structure: owner/repo
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "bitbucket.org":
        // /workspace/repo
        return parts.length >= 2 && !reservedPaths.has(parts[0]);

      case "git.sr.ht":
        // Sourcehut: /~user/repo or /user/repo
        return (parts.length >= 2 || (parts.length >= 1 && parts[0].startsWith("~")));

      case "launchpad.net":
        // /project or /project/series
        return parts.length >= 1 && !reservedPaths.has(parts[0]);

      case "www.npmjs.com":
      case "npmjs.com":
        return parts[0] === "package" && parts.length >= 2;

      case "hub.docker.com":
        return parts[0] === "r" && parts.length >= 3;

      case "pypi.org":
        return parts[0] === "project" && parts.length >= 2;

      case "crates.io":
        return parts[0] === "crates" && parts.length >= 2;

      case "packagist.org":
        return parts[0] === "packages" && parts.length >= 3;

      default:
        return false;
    }
  } catch {
    return false;
  }
}
