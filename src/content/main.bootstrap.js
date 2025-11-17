// main.bootstrap.js
(async function init() {
  await bootstrap();

  // Detect GitHub SPA navigations (back/forward, repo <-> search, etc.)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      bootstrap();
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

async function bootstrap() {
  const stored = await ext.storage.local.get(["repoCheckerConfig"]);
  config = (stored && stored.repoCheckerConfig) ? stored.repoCheckerConfig : defaultConfig;

  const currentUrl = window.location.href;
  let onRepoPage = isRepoUrl(currentUrl);

  if (looksLikeGithubRepoUrl(currentUrl)) {
    const confirmed = await waitForGithubRepoIndicators();
    if (confirmed) {
      onRepoPage = true;
    } else {
      onRepoPage = false;
    }
  }

  // Cleanup any previous injected marks or banners before re-injecting
  document.querySelectorAll(".repo-checker-banner, .repo-checker-mark").forEach(el => el.remove());

  if (onRepoPage) {
    // Show banner for repo pages
    if (isGithubRepoPrivate()) {
      createBanner("private");
    } else {
      const status = await isRepoActive(currentUrl);
      createBanner(status);
    }
  } else {
    // Mark repo links on search/discovery pages
    await markRepoLinks();
  }
}
