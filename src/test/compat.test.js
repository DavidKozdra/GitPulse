const fs = require('fs');

const compatSource = fs.readFileSync(require.resolve('../compat.js'), 'utf8');

function resetExtensionApis() {
  delete global.browser;
  delete global.chrome;
  delete global.ext;
  delete window.browser;
  delete window.chrome;
  delete window.ext;
  delete window.__gitpulse_ext;
}

function loadCompat({ browserApi, chromeApi } = {}) {
  resetExtensionApis();

  if (browserApi) {
    global.browser = browserApi;
    window.browser = browserApi;
  }

  if (chromeApi) {
    global.chrome = chromeApi;
    window.chrome = chromeApi;
  }

  eval(compatSource);
  return window.ext;
}

afterEach(() => {
  resetExtensionApis();
});

describe('compat shim', () => {
  test('falls back to chrome.storage.onChanged when browser event is missing', () => {
    const chromeAddListener = jest.fn();
    const chromeRemoveListener = jest.fn();
    const ext = loadCompat({
      browserApi: {
        runtime: { id: 'browser-runtime' },
        storage: { local: { get: jest.fn() } },
      },
      chromeApi: {
        runtime: { id: 'chrome-runtime' },
        storage: {
          local: {},
          onChanged: {
            addListener: chromeAddListener,
            removeListener: chromeRemoveListener,
          },
        },
      },
    });

    const listener = jest.fn();
    const unsubscribe = ext.storage.onChanged.addListener(listener);

    expect(chromeAddListener).toHaveBeenCalledTimes(1);

    const registeredListener = chromeAddListener.mock.calls[0][0];
    const changes = { repoCheckerConfig: { newValue: {} } };
    registeredListener(changes, 'local');

    expect(listener).toHaveBeenCalledWith(changes, 'local');

    unsubscribe();
    expect(chromeRemoveListener).toHaveBeenCalledWith(registeredListener);
  });

  test('falls back to chrome.storage.local methods independently of browser.runtime', async () => {
    const chromeGet = jest.fn((keys, callback) => callback({ a: 1 }));
    const chromeSet = jest.fn((obj, callback) => callback());
    const chromeRemove = jest.fn((keys, callback) => callback());
    const ext = loadCompat({
      browserApi: {
        runtime: { id: 'browser-runtime' },
      },
      chromeApi: {
        runtime: { id: 'chrome-runtime' },
        storage: {
          local: {
            get: chromeGet,
            set: chromeSet,
            remove: chromeRemove,
          },
          onChanged: { addListener: jest.fn() },
        },
      },
    });

    await expect(ext.storage.local.get(['a'])).resolves.toEqual({ a: 1 });
    await expect(ext.storage.local.set({ a: 2 })).resolves.toBeUndefined();
    await expect(ext.storage.local.remove(['a'])).resolves.toBeUndefined();

    expect(chromeGet).toHaveBeenCalledWith(['a'], expect.any(Function));
    expect(chromeSet).toHaveBeenCalledWith({ a: 2 }, expect.any(Function));
    expect(chromeRemove).toHaveBeenCalledWith(['a'], expect.any(Function));
  });
});
