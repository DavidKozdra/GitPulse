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
