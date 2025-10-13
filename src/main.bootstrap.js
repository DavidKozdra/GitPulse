// main.bootstrap.js
(async () => {
  const stored = await ext.storage.local.get(["repoCheckerConfig"]);
  config = (stored && stored.repoCheckerConfig) ? stored.repoCheckerConfig : defaultConfig;

  const currentUrl = window.location.href;
  let onRepoPage = isRepoUrl(currentUrl);

  if (looksLikeGithubRepoUrl(currentUrl)) {
    const confirmed = await waitForGithubRepoIndicators();
    if (confirmed) {
      console.log("[Repo detection] Confirmed GitHub repo page");
      onRepoPage = true;
    } else {
      console.log("[Repo detection] No repo indicators found, not a repo page");
      onRepoPage = false;
    }
  }

  if (onRepoPage) {
    const status = await isRepoActive(currentUrl);
    createBanner(status);
  } else {
    markRepoLinks();
    const observer = new MutationObserver(markRepoLinks);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
