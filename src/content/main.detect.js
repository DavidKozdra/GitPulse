// main.detect.js
function looksLikeGithubRepoUrl(url) {
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
  // Meta tag check
  if (document.querySelector('meta[name="octolytics-dimension-repository_nwo"]')) return true;

  // AppHeader context label (very reliable)
  if (document.querySelector('.AppHeader-context-item-label')) return true;

  // Tabs bar (Code / Issues / PRs)
  if (document.querySelector('.UnderlineNav')) return true;

  return false;
}

async function waitForGithubRepoIndicators(timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (isGithubRepoPageNow()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

// Best-effort detection of a private GitHub repository from the DOM
function isGithubRepoPrivate() {
  try {
    // Look for a label with text "Private" near the repo title
    const labels = document.querySelectorAll('span.Label, span.Label--secondary, span[data-view-component="true"].Label');
    for (const el of labels) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'private') return true;
    }
    // Fallback: lock icon with accessible label
    const lockEl = document.querySelector('svg[aria-label="Private"]');
    if (lockEl) return true;
  } catch {}
  return false;
}
