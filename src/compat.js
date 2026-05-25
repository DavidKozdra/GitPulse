// Improved cross-browser compatibility shim for chrome/browser APIs
// - Promise-safe wrappers for runtime.sendMessage and storage
// - lastError-aware for chrome callbacks
// - normalized onMessage.addListener/removeListener with Promise support
(function () {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const getBrowser = () => root.browser;
  const getChrome = () => root.chrome;
  const isFn = (value) => typeof value === 'function';

  function withChromeCallback(fn, runtime) {
    return new Promise((resolve, reject) => {
      try {
        fn((res) => {
          const err = runtime?.lastError || null;
          if (err) return reject(err);
          resolve(res);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  async function sendMessage(message, { timeoutMs } = {}) {
    const browserRuntime = getBrowser()?.runtime;
    if (isFn(browserRuntime?.sendMessage)) {
      if (timeoutMs) {
        return Promise.race([
          browserRuntime.sendMessage(message),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ext.sendMessage timeout')), timeoutMs))
        ]);
      }
      return browserRuntime.sendMessage(message);
    }

    const chromeRuntime = getChrome()?.runtime;
    if (!isFn(chromeRuntime?.sendMessage)) {
      throw new Error('runtime.sendMessage unavailable');
    }

    const p = withChromeCallback(cb => chromeRuntime.sendMessage(message, cb), chromeRuntime);
    if (timeoutMs) {
      return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('ext.sendMessage timeout')), timeoutMs))]);
    }
    return p;
  }

  function storageGet(keys) {
    const browserLocal = getBrowser()?.storage?.local;
    if (isFn(browserLocal?.get)) return browserLocal.get(keys);

    const chromeStorage = getChrome()?.storage;
    if (!isFn(chromeStorage?.local?.get)) {
      throw new Error('storage.local.get unavailable');
    }
    return withChromeCallback(cb => chromeStorage.local.get(keys, cb), getChrome()?.runtime);
  }

  function storageSet(obj) {
    const browserLocal = getBrowser()?.storage?.local;
    if (isFn(browserLocal?.set)) return browserLocal.set(obj);

    const chromeStorage = getChrome()?.storage;
    if (!isFn(chromeStorage?.local?.set)) {
      throw new Error('storage.local.set unavailable');
    }
    return withChromeCallback(cb => chromeStorage.local.set(obj, cb), getChrome()?.runtime);
  }

  function storageRemove(keys) {
    const browserLocal = getBrowser()?.storage?.local;
    if (isFn(browserLocal?.remove)) return browserLocal.remove(keys);

    const chromeStorage = getChrome()?.storage;
    if (!isFn(chromeStorage?.local?.remove)) {
      throw new Error('storage.local.remove unavailable');
    }
    return withChromeCallback(cb => chromeStorage.local.remove(keys, cb), getChrome()?.runtime);
  }

  function tabsQuery(queryInfo) {
    const browserTabs = getBrowser()?.tabs;
    if (isFn(browserTabs?.query)) return browserTabs.query(queryInfo);

    const chromeApi = getChrome();
    if (!isFn(chromeApi?.tabs?.query)) {
      throw new Error('tabs.query unavailable');
    }
    return withChromeCallback(cb => chromeApi.tabs.query(queryInfo, cb), chromeApi.runtime);
  }

  // Normalize onMessage listeners. Returns an unsubscribe function.
  function addOnMessageListener(handler) {
    const browserOnMessage = getBrowser()?.runtime?.onMessage;
    if (isFn(browserOnMessage?.addListener)) {
      browserOnMessage.addListener(handler);
      return () => {
        if (isFn(browserOnMessage.removeListener)) browserOnMessage.removeListener(handler);
      };
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

    const chromeOnMessage = getChrome()?.runtime?.onMessage;
    if (!isFn(chromeOnMessage?.addListener)) {
      throw new Error('runtime.onMessage unavailable');
    }

    chromeOnMessage.addListener(wrapper);
    return () => {
      if (isFn(chromeOnMessage.removeListener)) chromeOnMessage.removeListener(wrapper);
    };
  }

  // storage.onChanged shim
  const onChanged = {
    addListener(fn) {
      const handler = (changes, area) => fn(changes, area);
      const browserOnChanged = getBrowser()?.storage?.onChanged;
      if (isFn(browserOnChanged?.addListener)) {
        browserOnChanged.addListener(handler);
        return () => {
          if (isFn(browserOnChanged.removeListener)) browserOnChanged.removeListener(handler);
        };
      }

      const chromeOnChanged = getChrome()?.storage?.onChanged;
      if (isFn(chromeOnChanged?.addListener)) {
        chromeOnChanged.addListener(handler);
        return () => {
          if (isFn(chromeOnChanged.removeListener)) chromeOnChanged.removeListener(handler);
        };
      }

      throw new Error('storage.onChanged unavailable');
    }
  };

  const runtimeApi = getBrowser()?.runtime || getChrome()?.runtime;
  const ext = {
    sendMessage,
    storage: { local: { get: storageGet, set: storageSet, remove: storageRemove }, onChanged },
    tabs: { query: tabsQuery },
    runtime: {
      addOnMessageListener: addOnMessageListener,
      // convenience: raw access for advanced usage if needed
      raw: runtimeApi,
      id: runtimeApi?.id
    }
  };

  // Use a namespaced global to reduce collision risk
  window.__gitpulse_ext = ext;
  window.ext = window.__gitpulse_ext;
})();
