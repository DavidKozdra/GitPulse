// main.detect.js
//
// GitHub is a single-page app, so URL shape alone is not enough to know whether
// the current document is a fully loaded repository page. These DOM probes keep
// the banner from appearing on profile or transition states.
function looksLikeGithubRepoUrl(url) {
  // Fast URL-only precheck used before waiting for DOM indicators.
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname !== "github.com") return false;
    const parts = pathname.split("/").filter(Boolean);
    return parts.length >= 2;
  } catch {
    return false;
  }
}

function isGithubRepoPageNow() {
  // Prefer signals GitHub itself emits around repository pages. The selectors
  // intentionally overlap so the check survives minor DOM changes.
  // Meta tag check
  if (document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')) return true;

  // AppHeader context label (very reliable)
  if (document.querySelector('.AppHeader-context-item-label')) return true;

  // Tabs bar (Code / Issues / PRs)
  if (document.querySelector('.UnderlineNav')) return true;

  return false;
}

async function waitForGithubRepoIndicators(timeout = 3000) {
  // GitHub often changes the URL before it finishes rendering repository UI.
  // Poll briefly so bootstrap can distinguish "still loading" from "not a repo".
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (isGithubRepoPageNow()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

globalThis.waitForGithubRepoIndicators = waitForGithubRepoIndicators;

function githubRepoPrivateScopes() {
  const selectors = [
    '#repository-container-header',
    '[data-testid="repository-container-header"]',
    '[data-testid="repository-header"]',
    'main h1',
    '.AppHeader-context-full',
    '.AppHeader-context-item',
  ];
  const scopes = selectors
    .map((selector) => document.querySelector(selector))
    .filter(Boolean);
  return scopes.filter((scope, index) => scopes.indexOf(scope) === index);
}

// Best-effort detection of a private GitHub repository from the DOM
function isGithubRepoPrivate() {
  // Private repositories can be detected locally before making a remote status
  // request. Keep this conservative: a false negative falls back to the normal
  // status fetch, while a false positive incorrectly forces the locked banner.
  try {
    const scopes = githubRepoPrivateScopes();
    for (const scope of scopes) {
      const labels = scope.querySelectorAll('span.Label, span.Label--secondary, span[data-view-component="true"].Label');
      for (const el of labels) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'private') return true;
      }

      const lockEl = scope.querySelector('svg[aria-label="Private"]');
      if (lockEl) return true;
    }
  } catch {}
  return false;
}

// Export for Node test environment (jest) if available
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    looksLikeGithubRepoUrl,
    isGithubRepoPageNow,
    waitForGithubRepoIndicators,
    githubRepoPrivateScopes,
    isGithubRepoPrivate,
  };
}
