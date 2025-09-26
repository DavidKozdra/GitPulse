chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension Installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "open-url") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs.length || !tabs[0].url) {
        alert("Cannot access the current tab URL. Make sure you're on a regular webpage.");
        return;
      }

    });
  }
});


// Simple cache object; persists via chrome.storage.local
const CACHE_PREFIX = "repoCache:";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 1 day TTL

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getCache") {
    const key = CACHE_PREFIX + message.key;
    chrome.storage.local.get([key], (result) => {
      const cached = result[key];
      const now = Date.now();

      if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
        console.log(`[Cache] HIT for ${key}`);
        sendResponse({ isActive: cached.isActive, fromCache: true });
      } else {
        console.log(`[Cache] MISS or STALE for ${key}`);
        sendResponse({ isActive: null, fromCache: false });
      }
    });
    return true; // async
  }

  if (message.action === "setCache") {
    const key = CACHE_PREFIX + message.key;
    const value = { ...message.value, checkedAt: Date.now() };
    chrome.storage.local.set({ [key]: value }, () => {
      console.log(`[Cache] Stored ${key}`, value);
      sendResponse({ success: true });
    });
    return true; // async
  }

  if (message.action === "get_pat") {
    chrome.storage.local.get(["githubPAT"], ({ githubPAT }) => {
      sendResponse({ pat: githubPAT });
    });
    return true; // async
  }

  if (message.action === "setConfig") {
    chrome.storage.local.set({ config: message.config }, () => {
      console.log("[Config] Updated", message.config);
      sendResponse({ success: true });
    });
    return true; // async
  }

  if (message.action === "getConfig") {
    chrome.storage.local.get(["config"], (result) => {
      sendResponse({ config: result.config || {} });
    });
    return true; // async
  }
});
