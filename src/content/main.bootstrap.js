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
  const mergeConfig = (storedCfg) => {
    const merged = { ...defaultConfig };
    if (storedCfg) {
      Object.keys(storedCfg).forEach((key) => {
        if (merged[key]) merged[key] = { ...merged[key], ...storedCfg[key] };
        else merged[key] = storedCfg[key];
      });
    }
    return merged;
  };

  const stored = await ext.storage.local.get(["repoCheckerConfig"]);
  config = mergeConfig(stored?.repoCheckerConfig);
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

    // Keep updating marks for dynamic pages.
    if (!window.__gitpulseLinkObserver) {
      window.__gitpulseLinkObserver = new MutationObserver(() => {
        try { markRepoLinks(); } catch { /* ignore */ }
      });
      window.__gitpulseLinkObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Install config change listener once per page context.
  if (!window.__gitpulseConfigListenerInstalled) {
    window.__gitpulseConfigListenerInstalled = true;

    ext.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (!changes.repoCheckerConfig) return;

      const prev = config;
      config = mergeConfig(changes.repoCheckerConfig.newValue);

      const keys = new Set([
        ...Object.keys(prev || {}),
        ...Object.keys(config || {}),
      ]);

      const changedKeys = [];
      for (const k of keys) {
        const a = prev?.[k];
        const b = config?.[k];
        const aActive = a?.active;
        const bActive = b?.active;
        const aValue = a?.value;
        const bValue = b?.value;
        if (aActive !== bActive || aValue !== bValue) changedKeys.push(k);
      }

      const emojiOnly = changedKeys.length > 0 && changedKeys.every((k) => k.startsWith("emoji_"));

      // If the banner is currently visible, refresh it.
      const banner = document.getElementById("my-banner");
      const bannerVisible = !!banner && banner.style.display !== "none";

      if (bannerVisible) {
        if (emojiOnly && typeof window.gitpulseRefreshBanner === "function") {
          window.gitpulseRefreshBanner();
          return;
        }

        // Rules changed: recompute status and update banner.
        (async () => {
          try {
            const url = window.location.href;
            if (looksLikeGithubRepoUrl(url)) {
              const confirmed = await waitForGithubRepoIndicators();
              if (!confirmed) {
                ToggleBanner(null, false);
                return;
              }
            }
            if (isGithubRepoPrivate()) {
              ToggleBanner("private", true);
            } else {
              const status = await isRepoActive(url);
              ToggleBanner(status, true);
            }
          } catch {
            ToggleBanner(false, true);
          }
        })();

        return;
      }

      // Link pages
      if (emojiOnly && typeof window.gitpulseRefreshAllLinkMarks === "function") {
        window.gitpulseRefreshAllLinkMarks();
        return;
      }

      try { __linkStatusCache.clear(); } catch { /* ignore */ }
      try { markRepoLinks(); } catch { /* ignore */ }
    });
  }
}
