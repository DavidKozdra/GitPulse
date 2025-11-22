// main.helpers.js
// Shared helpers for the content script (extracted from main.js)
var rate_limited = false;

async function isRepoActive(url) {
  const res = await ext.sendMessage({ action: "fetchRepoStatus", url });
  if (!res || res.ok === false) {
    console.warn("[Repo check] background error", res?.error);
    return false; // fail closed
  }
  return res.result?.status; // true | false | "rate_limited" | "private"
}

// Export for Node test environment (jest) if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isRepoUrl, getActiveConfigMetrics, isRepoActive };
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
