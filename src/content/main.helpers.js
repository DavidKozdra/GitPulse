// main.helpers.js
// Shared helpers for the content script (extracted from main.js).
//
// These helpers intentionally avoid direct Chrome APIs except through `ext`.
// That keeps them testable in Jest and keeps browser differences isolated in
// compat.js.
var rate_limited = false;

const STATUS_LABELS = {
  true: "Active repository",
  false: "Inactive repository",
  private: "Private repository",
  rate_limited: "Rate limited",
  unsupported: "Unsupported repository host",
};
const GRADE_COLORS = {
  A: "#1a8917",
  B: "#43a047",
  C: "#fbc02d",
  D: "#f57c00",
  F: "#d32f2f",
};

function isGradingEnabled() {
  const field = typeof config !== "undefined" ? config?.grading_enabled : null;
  return field?.active !== false && field?.value === true;
}

function displayMode(surface = "marker") {
  const key = surface === "banner" ? "banner_display" : "marker_display";
  const value = typeof config !== "undefined" ? config?.[key]?.value : null;
  return value === "badge" || value === "both" || value === "emoji" ? value : "emoji";
}

function emojiDisplayEnabled(surface = "marker") {
  const mode = displayMode(surface);
  return mode === "emoji" || mode === "both";
}

function gradeDisplayEnabled(surface = "marker") {
  return isGradingEnabled();
}

function gradeForScore(score) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (value >= 90) return "A";
  if (value >= 80) return "B";
  if (value >= 70) return "C";
  if (value >= 60) return "D";
  return "F";
}

function finiteNumber(value) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedGrade(value, score) {
  return gradeForScore(score);
}

function gradeColor(grade) {
  return GRADE_COLORS[grade] || GRADE_COLORS.F;
}

function gradeTextColor(grade) {
  return grade === "C" ? "#1f2933" : "#fff";
}

function repoGradeInfo(details = {}, meta = {}) {
  if (!isGradingEnabled()) return null;
  const rawScore = finiteNumber(meta.score ?? details?.score);
  if (rawScore === null) return null;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const grade = normalizedGrade(meta.grade || details?.grade, score);
  return {
    score,
    grade,
    color: gradeColor(grade),
    textColor: gradeTextColor(grade),
    label: `Grade ${grade}`,
  };
}

function gradeIconSrc() {
  try {
    const rawRuntime = ext?.runtime?.raw;
    if (typeof rawRuntime?.getURL === "function") return rawRuntime.getURL("src/icon.png");
    if (typeof chrome?.runtime?.getURL === "function") return chrome.runtime.getURL("src/icon.png");
    if (typeof browser?.runtime?.getURL === "function") return browser.runtime.getURL("src/icon.png");
  } catch {
    // fall through to test/local fallback
  }
  return "../icon.png";
}

function createGradeBadge(details = {}, meta = {}, surface = "marker") {
  if (!gradeDisplayEnabled(surface)) return null;
  const info = repoGradeInfo(details, meta);
  if (!info || typeof document === "undefined") return null;

  const badge = document.createElement("span");
  badge.className = "gitpulse-grade-badge";
  badge.iconSrc = "../icon.png"; // Used by tests to verify badge presence without relying on styles
  badge.title = `GitPulse ${info.label} (${info.score})`;
  badge.setAttribute("aria-label", badge.title);

  const icon = document.createElement("img");
  icon.src = gradeIconSrc();
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  Object.assign(icon.style, {
    width: "12px",
    height: "12px",
    marginRight: "4px",
    borderRadius: "2px",
    objectFit: "contain",
    flex: "0 0 auto",
  });

  const label = document.createElement("span");
  label.textContent = info.label;

  badge.appendChild(icon);
  badge.appendChild(label);
  Object.assign(badge.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "8px",
    padding: "2px 7px",
    borderRadius: "5%",
    backgroundColor: info.color,
    color: info.textColor,
    fontSize: "11px",
    fontWeight: "700",
    lineHeight: "1.4",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  });
  return badge;
}

function isReloadNavigation() {
  // A hard reload is a strong signal that the user wants fresh data for the
  // current page. Prefer the modern Navigation Timing entry, but keep the legacy
  // performance.navigation fallback for older browser engines.
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
  // Tooltips and banners should stay compact, so details use coarse relative
  // wording instead of full timestamps. Invalid dates are omitted from output.
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
  // Convert the background service worker's structured details into a short
  // human-readable sentence. The output is deliberately bounded so a long set of
  // failed checks cannot make link tooltips noisy.
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
  const activityAt =
    details?.pushedAt ||
    details?.updatedAt ||
    details?.pushed_at ||
    details?.updated_at ||
    details?.last_activity_at ||
    details?.lastActivityAt;
  const activityAgo = formatRelativeDate(activityAt);
  if (activityAgo) parts.push(`Last activity ${activityAgo}`);

  const openPrCount = finiteNumber(details?.openPrCount ?? details?.open_pr_count);
  if (openPrCount !== null) {
    parts.push(`${openPrCount} open PRs`);
  }

  const closedPrAgo = formatRelativeDate(details?.lastClosedPrAt || details?.last_closed_pr_at);
  if (closedPrAgo) parts.push(`Last closed PR ${closedPrAgo}`);

  const releaseAgo = formatRelativeDate(details?.lastReleaseAt || details?.last_release_at);
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

  const gradeInfo = repoGradeInfo(details, meta);
  if (gradeInfo) parts.push(`${gradeInfo.label} ${gradeInfo.score}`);

  if (meta?.fromCache) parts.push("Cached result");

  return parts.slice(0, 4).join(" | ");
}

function statusLabel(status) {
  // Accessibility labels use a stable vocabulary that mirrors the status values
  // returned by the background script.
  if (status === true) return STATUS_LABELS.true;
  if (status === false) return STATUS_LABELS.false;
  return STATUS_LABELS[status] || "Repository status";
}

async function getRepoStatus(url, options = {}) {
  // Content scripts cannot safely call every remote API themselves, and they
  // should never read the PAT. Delegate the check to background.js and normalize
  // failed responses into a false status with an error detail.
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
    score: res.result?.score,
    grade: res.result?.grade,
    fromCache: !!res.fromCache,
  };
}

async function isRepoActive(url, options = {}) {
  // Legacy convenience wrapper. Newer UI paths use getRepoStatus so they can
  // render details, but some tests and fallback code only need the status value.
  const result = await getRepoStatus(url, options);
  return result.status; // true | false | "rate_limited" | "private" | "unsupported"
}

globalThis.__gp = globalThis.__gp || {};
globalThis.__gp.formatRepoStatusDetails = formatRepoStatusDetails;
globalThis.__gp.statusLabel = statusLabel;
globalThis.__gp.gradeColor = gradeColor;
globalThis.__gp.gradeTextColor = gradeTextColor;
globalThis.__gp.gradeIconSrc = gradeIconSrc;
globalThis.__gp.emojiDisplayEnabled = emojiDisplayEnabled;
globalThis.__gp.gradeDisplayEnabled = gradeDisplayEnabled;
globalThis.__gp.repoGradeInfo = repoGradeInfo;
globalThis.__gp.createGradeBadge = createGradeBadge;

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
    gradeColor,
    gradeTextColor,
    gradeIconSrc,
    emojiDisplayEnabled,
    gradeDisplayEnabled,
    repoGradeInfo,
    createGradeBadge,
  };
}

async function getCacheFromBackground(key) {
  // Kept for older call sites/tests that address cache directly through the
  // background message API.
  return ext.sendMessage({ action: "getCache", key });
}

async function setCacheInBackground(key, value) {
  // Kept for older call sites/tests that seed cache through the background
  // message API.
  return ext.sendMessage({ action: "setCache", key, value });
}

function getActiveConfigMetrics() {
  // Flatten active config fields into a simple key/value object. Background.js
  // performs the authoritative read, but this is useful for content-side tests
  // and debugging.
  return Object.entries(config)
    .filter(([key, field]) => field.active && field.value !== undefined)
    .reduce((acc, [key, field]) => {
      acc[key] = field.value;
      return acc;
    }, {});
}

function isRepoUrl(url) {
  // GitPulse annotates links for repository-like pages and selected package
  // registries. Host-specific rules are conservative so profile, settings, and
  // discovery pages do not receive status markers.
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
