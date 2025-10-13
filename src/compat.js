// Cross-browser compatibility shim for chrome/browser APIs
// Exposes `ext.runtime.sendMessage(msg)` -> Promise and `ext.storage.local` (get/set/remove) with Promise API.
(function () {
  const hasBrowser = typeof browser !== 'undefined' && !!browser.runtime;

  function wrapSendMessage(msg) {
    if (hasBrowser) return browser.runtime.sendMessage(msg);
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function wrapStorageGet(keys) {
    if (hasBrowser) return browser.storage.local.get(keys);
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function wrapStorageSet(obj) {
    if (hasBrowser) return browser.storage.local.set(obj);
    return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
  }

  function wrapStorageRemove(keys) {
    if (hasBrowser) return browser.storage.local.remove(keys);
    return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
  }

  function wrapTabsQuery(query) {
    if (hasBrowser) return browser.tabs.query(query);
    return new Promise((resolve) => chrome.tabs.query(query, resolve));
  }

  const ext = {
    runtime: {
      sendMessage: wrapSendMessage,
      onMessage: (hasBrowser ? browser.runtime.onMessage : chrome.runtime.onMessage)
    },
    sendMessage: wrapSendMessage, // convenience
    storage: {
      local: {
        get: wrapStorageGet,
        set: wrapStorageSet,
        remove: wrapStorageRemove
      }
    },
    tabs: { query: wrapTabsQuery }
  };

  // Expose globally for simple consumption in other scripts
  window.ext = ext;
})();
