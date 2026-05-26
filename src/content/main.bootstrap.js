// main.bootstrap.js
//
// Bootstrap coordinates the content-script modules after they are loaded by the
// manifest: config.js, helpers, banner, links, detection, then this file. It
// decides whether the page needs a top banner or inline link markers.
(async function init() {
  // Reloads should bypass the current-page cache once, because users commonly
  // reload when they expect freshly fetched repository state.
  const bypassInitialRepoStatusCache = isReloadNavigation();
  await safeBootstrap({ bypassCacheForCurrentUrl: bypassInitialRepoStatusCache });

  let lastUrl = location.href;

  new MutationObserver(async () => {
    // GitHub and many registry pages update via client-side navigation. Watch
    // for location changes and rerun bootstrap after the extension APIs settle.
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
  // Small sleep helper used for SPA navigation and retry backoff.
  return new Promise(r => setTimeout(r, ms));
}

async function safeBootstrap(options = {}) {
  // Content scripts can run while the host page is still replacing DOM nodes or
  // while extension APIs are briefly unavailable. Retry once before giving up.
  try {
    await bootstrap(options);
  } catch (err) {
    console.warn("GitPulse bootstrap failed, retrying...", err);
    await delay(100);
    try {
      await bootstrap(options);
    } catch (err2) {
      console.error("GitPulse bootstrap failed:", err2);
    }
  }
}

async function bootstrap(options = {}) {
  // Merge stored user config over defaults while preserving unknown future keys.
  // This mirrors popup.js/config.js behavior for content-side rendering.
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
    // GitHub profiles and repository pages can both look like /owner/name in the
    // URL. Confirm with DOM markers before showing a repository banner.
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
      ToggleBanner("private", true, { host: "github.com" });
    } else {
      const result = typeof getRepoStatus === "function" ? await getRepoStatus(currentUrl, {
        bypassCache: options.bypassCacheForCurrentUrl === true
      }) : { status: await isRepoActive(currentUrl, {
        bypassCache: options.bypassCacheForCurrentUrl === true
      }), details: {}, fromCache: false };

      ToggleBanner(result.status, true, result.details || {}, { fromCache: result.fromCache });
    }
  } else {
    // Mark repo links on search/discovery pages
    await markRepoLinks();

    // Keep updating marks for dynamic pages.
    if (!window.__gitpulseLinkObserver) {
      // Install only one observer per page context; repeated bootstrap runs
      // should reuse it instead of stacking duplicate DOM watchers.
      window.__gitpulseLinkObserver = new MutationObserver(() => {
        try { markRepoLinks(); } catch { /* ignore */ }
      });
      window.__gitpulseLinkObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  window.gitpulseRefreshCurrentRepo = async () => {
    // The banner refresh button calls this function. Force refresh skips cache
    // for the visible repository but still stores the new result afterward.
    const url = window.location.href;
    const result = typeof getRepoStatus === "function"
      ? await getRepoStatus(url, { bypassCache: true })
      : { status: await isRepoActive(url, { bypassCache: true }), details: {}, fromCache: false };
    ToggleBanner(result.status, true, result.details || {}, { fromCache: false });
  };

  // Install config change listener once per page context.
  window.__gp = window.__gp || {};
  if (!window.__gp.configListenerInstalled) {
    let _configDebounceTimer = null;
    const storageOnChanged = ext?.storage?.onChanged;
    if (!storageOnChanged || typeof storageOnChanged.addListener !== "function") {
      console.warn("GitPulse config live updates unavailable: storage.onChanged missing.");
      window.__gp.configListenerInstalled = true;
      return;
    }

    try {
      const removeConfigListener = storageOnChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (!changes.repoCheckerConfig) return;

        clearTimeout(_configDebounceTimer);
        _configDebounceTimer = setTimeout(() => _handleConfigChange(changes, mergeConfig), 300);
      });

      if (typeof removeConfigListener === "function") {
        window.__gp.removeConfigListener = removeConfigListener;
      }
      window.__gp.configListenerInstalled = true;
    } catch (err) {
      console.warn("GitPulse config live updates unavailable.", err);
      window.__gp.configListenerInstalled = true;
    }
  }
}

function _handleConfigChange(changes, mergeConfig) {
      // Recompute the merged config and decide whether the change affects only
      // presentation (emoji) or status rules. Emoji-only changes can repaint
      // existing UI; rule changes need a fresh status check or link rescan.
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
              ToggleBanner("private", true, { host: "github.com" });
            } else {
              const result = typeof getRepoStatus === "function"
                ? await getRepoStatus(url)
                : { status: await isRepoActive(url), details: {}, fromCache: false };
              ToggleBanner(result.status, true, result.details || {}, { fromCache: result.fromCache });
            }
          } catch {
            ToggleBanner(false, true, { error: "Failed to refresh status" });
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
}
