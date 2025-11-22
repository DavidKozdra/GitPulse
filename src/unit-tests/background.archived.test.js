const makeResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
});

describe('fetchGithubRepoStatus', () => {
  let fetchGithubRepoStatus;

  beforeEach(() => {
    // Minimal chrome stub to satisfy background.js when required in Node
    global.chrome = {
      runtime: {
        id: 'test-id',
        onInstalled: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() },
        onMessageExternal: { addListener: jest.fn() },
        lastError: null,
        getManifest: jest.fn(() => ({})),
        getURL: jest.fn((p) => p),
      },
      tabs: { query: jest.fn(), create: jest.fn() },
      storage: {
        local: {
          get: jest.fn((keys, cb) => (typeof cb === 'function' ? cb({}) : Promise.resolve({}))),
          set: jest.fn((obj, cb) => (typeof cb === 'function' ? cb() : Promise.resolve())),
          remove: jest.fn((keys, cb) => (typeof cb === 'function' ? cb() : Promise.resolve())),
        },
      },
    };

    jest.resetModules();
    fetchGithubRepoStatus = require('../background').fetchGithubRepoStatus;
  });

  afterEach(() => {
    delete global.chrome;
    delete global.fetch;
  });

  test('marks archived repos inactive immediately without further API calls', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(makeResponse({ archived: true }));

    const rules = { open_prs_max: 5 }; // would normally trigger extra fetches
    const result = await fetchGithubRepoStatus(
      { owner: 'octocat', repo: 'Hello-World' },
      'token123',
      rules
    );

    expect(result).toEqual({ status: false, details: { isArchived: true } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/octocat/Hello-World',
      { headers: { Accept: 'application/vnd.github.v3+json', Authorization: 'token token123' } }
    );
  });
});
