// Improved cross-browser compatibility shim for chrome/browser APIs
// - Promise-safe wrappers for runtime.sendMessage and storage
// - lastError-aware for chrome callbacks
// - normalized onMessage.addListener/removeListener with Promise support
(function () {
  const hasBrowser = typeof browser !== 'undefined' && !!browser.runtime;

  function withChromeCallback(fn) {
    return new Promise((resolve, reject) => {
      try {
        fn((res) => {
          const err = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) ? chrome.runtime.lastError : null;
          if (err) return reject(err);
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function sendMessage(message, { timeoutMs } = {}) {
    if (hasBrowser) {
      if (timeoutMs) {
        return Promise.race([
          browser.runtime.sendMessage(message),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ext.sendMessage timeout')), timeoutMs))
        ]);
      }
      return browser.runtime.sendMessage(message);
    }

    const p = withChromeCallback(cb => chrome.runtime.sendMessage(message, cb));
    if (timeoutMs) {
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('ext.sendMessage timeout')), timeoutMs))]);
    }
    return p;
  }

  function storageGet(keys) {
    if (hasBrowser) return browser.storage.local.get(keys);
    return withChromeCallback(cb => chrome.storage.local.get(keys, cb));
  }

  function storageSet(obj) {
    if (hasBrowser) return browser.storage.local.set(obj);
    return withChromeCallback(cb => chrome.storage.local.set(obj, cb));
  }

  function storageRemove(keys) {
    if (hasBrowser) return browser.storage.local.remove(keys);
    return withChromeCallback(cb => chrome.storage.local.remove(keys, cb));
  }

  function tabsQuery(queryInfo) {
    if (hasBrowser) return browser.tabs.query(queryInfo);
    return withChromeCallback(cb => chrome.tabs.query(queryInfo, cb));
  }

  // Normalize onMessage listeners. Returns an unsubscribe function.
  function addOnMessageListener(handler) {
    if (hasBrowser) {
      browser.runtime.onMessage.addListener(handler);
      return () => browser.runtime.onMessage.removeListener(handler);
    }

    const wrapper = (message, sender, sendResponse) => {
      try {
        const maybePromise = handler(message, sender, (r) => sendResponse(r));
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then((r) => sendResponse(r)).catch((e) => sendResponse({ error: String(e) }));
          return true; // indicate async
        }
      } catch (e) {
        sendResponse({ error: String(e) });
      }
      return false;
    };

    chrome.runtime.onMessage.addListener(wrapper);
    return () => chrome.runtime.onMessage.removeListener(wrapper);
  }

  const ext = {
    sendMessage,
    storage: { local: { get: storageGet, set: storageSet, remove: storageRemove } },
    tabs: { query: tabsQuery },
    runtime: {
      addOnMessageListener: addOnMessageListener,
      // convenience: raw access for advanced usage if needed
      raw: hasBrowser ? browser.runtime : (typeof chrome !== 'undefined' ? chrome.runtime : undefined),
      id: (hasBrowser ? browser.runtime?.id : (typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined))
    }
  };

  // Use a namespaced global to reduce collision risk
  if (!window.__gitpulse_ext) window.__gitpulse_ext = ext;
  window.ext = window.__gitpulse_ext;
})();
