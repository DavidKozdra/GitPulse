const fs = require('fs');

const bootstrapSource = fs.readFileSync(require.resolve('../content/main.bootstrap.js'), 'utf8');

describe('main bootstrap reload behavior', () => {
  const originalMutationObserver = global.MutationObserver;

  beforeEach(() => {
    document.body.innerHTML = '<main></main>';
    delete window.__gp;
    delete window.__gitpulseLinkObserver;

    global.defaultConfig = {};
    global.config = {};
    global.ext = {
      storage: {
        local: { get: jest.fn(() => Promise.resolve({})) },
        onChanged: { addListener: jest.fn() },
      },
    };
    global.isRepoUrl = jest.fn(() => true);
    global.looksLikeGithubRepoUrl = jest.fn(() => false);
    global.isGithubRepoPrivate = jest.fn(() => false);
    global.isRepoActive = jest.fn(() => Promise.resolve(true));
    global.ToggleBanner = jest.fn();
    global.markRepoLinks = jest.fn(() => Promise.resolve());
    global.MutationObserver = class {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {}
    };
  });

  afterEach(() => {
    global.MutationObserver = originalMutationObserver;
    delete global.defaultConfig;
    delete global.config;
    delete global.ext;
    delete global.isReloadNavigation;
    delete global.isRepoUrl;
    delete global.looksLikeGithubRepoUrl;
    delete global.isGithubRepoPrivate;
    delete global.isRepoActive;
    delete global.ToggleBanner;
    delete global.markRepoLinks;
    delete window.__gp;
    delete window.__gitpulseLinkObserver;
  });

  async function runBootstrap() {
    eval(bootstrapSource);
    await Promise.resolve();
    await Promise.resolve();
  }

  test('bypasses repo status cache on initial reload navigation', async () => {
    global.isReloadNavigation = jest.fn(() => true);

    await runBootstrap();

    expect(global.isRepoActive).toHaveBeenCalledWith(window.location.href, {
      bypassCache: true,
    });
  });

  test('uses repo status cache on initial non-reload navigation', async () => {
    global.isReloadNavigation = jest.fn(() => false);

    await runBootstrap();

    expect(global.isRepoActive).toHaveBeenCalledWith(window.location.href, {
      bypassCache: false,
    });
  });
});
