// main.bootstrap.js
(async function init() {
  await safeBootstrap();

  let lastUrl = location.href;

  new MutationObserver(async () => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;

      // Wait for Chrome to restore extension API context
      await delay(75);

      safeBootstrap();
    }
  }).observe(document.body, { childList: true, subtree: true });
})();

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function safeBootstrap() {
  try {
    await bootstrap();
  } catch (err) {
    console.warn("Bootstrap failed due to context loss, retrying...", err);
    await delay(100);
    try {
      await bootstrap();
    } catch (err2) {
      console.error("Bootstrap permanently failed:", err2);
    }
  }
}

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
      ToggleBanner(null, false);  // hide
    }
  }

  // Cleanup any previous injected marks or banners before re-injecting
  document.querySelectorAll(".repo-checker-banner, .repo-checker-mark").forEach(el => el.remove());

  if (onRepoPage) {
    // Show banner for repo pages
    if (isGithubRepoPrivate()) {
      ToggleBanner("private",true);
    } else {
      const status = await isRepoActive(currentUrl);
     
      ToggleBanner(status,true);
    }
  } else {
    // Mark repo links on search/discovery pages
    await markRepoLinks();
  }
}
