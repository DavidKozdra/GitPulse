// Test cache logic and utility functions from background.js.
//
// background.js is an MV3 service worker, not a CommonJS module. These tests
// evaluate the source in Jest with mocked Chrome APIs so we can exercise the
// real cache, message-handler, URL routing, and validation functions without a
// browser extension runtime.

const fs = require('fs');

// Mock chrome APIs with working storage. The storage object intentionally acts
// like chrome.storage.local: get/set/remove are callback-based, support null
// reads for "all keys", and preserve non-cache keys during clearCache tests.
const storage = {};
const mockChrome = {
  runtime: {
    id: 'test-extension-id',
    onInstalled: { addListener: jest.fn() },
    onMessage: { addListener: jest.fn() },
    onMessageExternal: { addListener: jest.fn() },
    lastError: null,
  },
  storage: {
    local: {
      get: jest.fn((keys, cb) => {
        if (keys === null) {
          cb({ ...storage });
          return;
        }
        const result = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => { if (storage[k] !== undefined) result[k] = storage[k]; });
        cb(result);
      }),
      set: jest.fn((obj, cb) => {
        Object.assign(storage, obj);
        if (cb) cb();
      }),
      remove: jest.fn((keys, cb) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete storage[k]);
        if (cb) cb();
      }),
    },
  },
};

global.chrome = mockChrome;
global.fetch = jest.fn();

// Load background.js. Replacing top-level const/let with var makes declarations
// visible to eval's surrounding scope, which is what lets the tests call helper
// functions such as readCache and fetchRepoStatusByUrl directly.
const bgSource = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const patchedSource = bgSource
  .replace(/^const /gm, 'var ')
  .replace(/^let /gm, 'var ');
eval(patchedSource);

beforeEach(() => {
  githubThrottleUntil = 0;
  githubRequestQueue = Promise.resolve();
});

describe('cache helpers', () => {
  // These tests define the cache contract: versioned entries, normal TTL,
  // shorter rate-limit TTL, and cache-only removal without touching unrelated
  // extension storage.
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
  });

  test('readCache returns null for missing key', async () => {
    const result = await readCache('nonexistent');
    expect(result).toBeNull();
  });

  test('writeCache and readCache round-trip', async () => {
    await writeCache('test-key', { isActive: true, details: { pushOk: true } });
    const result = await readCache('test-key');
    expect(result).not.toBeNull();
    expect(result.isActive).toBe(true);
    expect(result.details.pushOk).toBe(true);
  });

  test('readCache returns null for expired entries', async () => {
    const full = 'repoCache:old-key';
    storage[full] = {
      isActive: true,
      checkedAt: Date.now() - (1000 * 60 * 60 * 25), // 25h ago
      v: CACHE_SCHEMA_VERSION,
    };
    const result = await readCache('old-key');
    expect(result).toBeNull();
  });

  test('rate-limited entries expire after 2h', async () => {
    const full = 'repoCache:rl-key';
    storage[full] = {
      isActive: 'rate_limited',
      checkedAt: Date.now() - (1000 * 60 * 60 * 3), // 3h ago
      v: CACHE_SCHEMA_VERSION,
    };
    const result = await readCache('rl-key');
    expect(result).toBeNull();
  });

  test('rate-limited entries within 2h are returned', async () => {
    const full = 'repoCache:rl-valid';
    storage[full] = {
      isActive: 'rate_limited',
      checkedAt: Date.now() - (1000 * 60 * 60 * 1), // 1h ago
      v: CACHE_SCHEMA_VERSION,
    };
    const result = await readCache('rl-valid');
    expect(result).not.toBeNull();
    expect(result.isActive).toBe('rate_limited');
  });

  test('clearCache removes all cache entries', async () => {
    storage['repoCache:a'] = { isActive: true, checkedAt: Date.now(), v: CACHE_SCHEMA_VERSION };
    storage['repoCache:b'] = { isActive: false, checkedAt: Date.now(), v: CACHE_SCHEMA_VERSION };
    storage['githubPAT'] = 'ghp_test';

    await clearCache();

    expect(storage['repoCache:a']).toBeUndefined();
    expect(storage['repoCache:b']).toBeUndefined();
    expect(storage['githubPAT']).toBe('ghp_test');
  });

  test('readCache returns null for wrong schema version', async () => {
    const full = 'repoCache:v1-key';
    storage[full] = {
      isActive: true,
      checkedAt: Date.now(),
      v: 1,
    };
    const result = await readCache('v1-key');
    expect(result).toBeNull();
  });
});

describe('smartClearCache', () => {
  // smartClearCache protects users from stale status results after rule changes
  // while keeping the cache warm for emoji-only presentation changes.
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
  });

  test('clears cache when rule values change', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: CACHE_SCHEMA_VERSION };
    const oldCfg = { max_repo_update_time: { active: true, value: 365 } };
    const newCfg = { max_repo_update_time: { active: true, value: 180 } };
    await smartClearCache(oldCfg, newCfg);
    expect(storage['repoCache:x']).toBeUndefined();
  });

  test('does NOT clear cache for emoji-only changes', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: CACHE_SCHEMA_VERSION };
    const oldCfg = { emoji_active: { value: '✅' }, max_repo_update_time: { active: true, value: 365 } };
    const newCfg = { emoji_active: { value: '🚀' }, max_repo_update_time: { active: true, value: 365 } };
    const result = await smartClearCache(oldCfg, newCfg);
    expect(result.skipped).toBe(true);
    expect(storage['repoCache:x']).toBeDefined();
  });

  test('falls back to full clear when oldConfig is null', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: CACHE_SCHEMA_VERSION };
    await smartClearCache(null, {});
    expect(storage['repoCache:x']).toBeUndefined();
  });
});

describe('fetchRepoStatus cache behavior', () => {
  // The message handler is the real entrypoint used by content scripts. These
  // tests verify cache hits, forced refresh, and a few representative host
  // adapters through handleMessage rather than calling adapters in isolation.
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    fetch.mockReset();
  });

  test('returns cached repo status by default', async () => {
    storage['repoCache:codeberg.org/owner/repo'] = {
      isActive: false,
      details: { source: 'cache' },
      checkedAt: Date.now(),
      v: CACHE_SCHEMA_VERSION,
    };
    const sendResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://codeberg.org/owner/repo' },
      {},
      sendResponse
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: { status: false, details: { source: 'cache' } },
      fromCache: true,
    });
  });

  test('returns cached score and grade when present', async () => {
    storage['repoCache:codeberg.org/owner/repo'] = {
      isActive: true,
      details: { source: 'cache', score: 87, grade: 'B' },
      score: 87,
      grade: 'B',
      checkedAt: Date.now(),
      v: CACHE_SCHEMA_VERSION,
    };
    const sendResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://codeberg.org/owner/repo' },
      {},
      sendResponse
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      result: {
        status: true,
        details: { source: 'cache', score: 87, grade: 'B' },
        score: 87,
        grade: 'B',
      },
      fromCache: true,
    });
  });

  test('ignores cached repo status when forceRefresh is true', async () => {
    storage['repoCache:codeberg.org/owner/repo'] = {
      isActive: false,
      details: { source: 'cache' },
      checkedAt: Date.now(),
      v: CACHE_SCHEMA_VERSION,
    };
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: false,
        updated_at: new Date().toISOString(),
      }),
    });
    const sendResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://codeberg.org/owner/repo', forceRefresh: true },
      {},
      sendResponse
    );

    expect(fetch).toHaveBeenCalledWith('https://codeberg.org/api/v1/repos/owner/repo');
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      fromCache: false,
      result: expect.objectContaining({ status: true }),
    }));
    expect(storage['repoCache:codeberg.org/owner/repo'].isActive).toBe(true);
  });

  test('checks GitLab projects with the public API', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: false,
        last_activity_at: new Date().toISOString(),
      }),
    });
    const sendResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://gitlab.com/group/project' },
      {},
      sendResponse
    );

    expect(fetch).toHaveBeenCalledWith('https://gitlab.com/api/v4/projects/group%2Fproject');
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      result: expect.objectContaining({
        status: true,
        details: expect.objectContaining({ host: 'gitlab.com', projectPath: 'group/project' }),
      }),
    }));
  });

  test('checks npm packages with the registry API', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        time: { modified: new Date().toISOString() },
        'dist-tags': { latest: '1.2.3' },
      }),
    });
    const sendResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://www.npmjs.com/package/express' },
      {},
      sendResponse
    );

    expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/express');
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      result: expect.objectContaining({
        status: true,
        details: expect.objectContaining({ host: 'npmjs.com', packageName: 'express', latestVersion: '1.2.3' }),
      }),
    }));
  });

  test('caches rate-limited results and reuses them on the next request', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    });
    const firstResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://gitlab.com/group/project' },
      {},
      firstResponse
    );

    expect(storage['repoCache:gitlab.com/group/project']).toEqual(expect.objectContaining({
      isActive: 'rate_limited',
      details: expect.objectContaining({ host: 'gitlab.com' }),
      v: CACHE_SCHEMA_VERSION,
    }));
    expect(firstResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      fromCache: false,
      result: expect.objectContaining({
        status: 'rate_limited',
        details: expect.objectContaining({ host: 'gitlab.com' }),
      }),
    }));

    fetch.mockClear();
    const secondResponse = jest.fn();

    await handleMessage(
      { action: 'fetchRepoStatus', url: 'https://gitlab.com/group/project' },
      {},
      secondResponse
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(secondResponse).toHaveBeenCalledWith({
      ok: true,
      result: { status: 'rate_limited', details: { host: 'gitlab.com' } },
      fromCache: true,
    });
  });

  test('coalesces concurrent requests for the same repo while a fetch is in flight', async () => {
    let releaseFetch;
    let markFetchStarted;
    const fetchStarted = new Promise((resolve) => {
      markFetchStarted = resolve;
    });
    fetch.mockImplementation(() => new Promise((resolve) => {
      markFetchStarted();
      releaseFetch = () => resolve({
        ok: true,
        status: 200,
        json: async () => ({
          archived: false,
          updated_at: new Date().toISOString(),
        }),
      });
    }));

    const firstResponse = jest.fn();
    const secondResponse = jest.fn();

    const firstRequest = handleMessage(
      { action: 'fetchRepoStatus', url: 'https://codeberg.org/owner/repo' },
      {},
      firstResponse
    );
    const secondRequest = handleMessage(
      { action: 'fetchRepoStatus', url: 'https://codeberg.org/owner/repo' },
      {},
      secondResponse
    );

    await fetchStarted;
    expect(fetch).toHaveBeenCalledTimes(1);

    releaseFetch();
    await Promise.all([firstRequest, secondRequest]);

    expect(firstResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      fromCache: false,
      result: expect.objectContaining({ status: true }),
    }));
    expect(secondResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      fromCache: false,
      result: expect.objectContaining({ status: true }),
    }));
  });

  test('returns unsupported instead of active for unknown fetch hosts', async () => {
    const result = await fetchRepoStatusByUrl('https://example.test/owner/repo', {});
    expect(result.status).toBe('unsupported');
  });
});

describe('GitHub throttling guard', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    fetch.mockReset();
  });

  test('records GitHub reset headers and skips the next request until reset', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 60;
    fetch.mockResolvedValue({
      ok: false,
      status: 403,
      headers: {
        get: (name) => name.toLowerCase() === 'x-ratelimit-reset' ? String(resetAt) : null,
      },
    });

    const first = await fetchGithubRepoStatus({ owner: 'owner', repo: 'repo' }, 'ghp_test', {});
    expect(first.status).toBe('rate_limited');
    expect(githubThrottleUntil).toBeGreaterThan(Date.now());

    fetch.mockClear();
    const second = await fetchGithubRepoStatus({ owner: 'owner', repo: 'repo' }, 'ghp_test', {});

    expect(second.status).toBe('rate_limited');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('serializes concurrent GitHub requests through a shared queue', async () => {
    let releaseFirst;
    let markFirstStarted;
    const firstStarted = new Promise((resolve) => {
      markFirstStarted = resolve;
    });
    const repoPayload = () => ({
      archived: false,
      pushed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    let callCount = 0;

    fetch.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        markFirstStarted();
        return new Promise((resolve) => {
          releaseFirst = () => resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            json: async () => repoPayload(),
          });
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => repoPayload(),
      });
    });

    const first = fetchGithubRepoStatus({ owner: 'owner-one', repo: 'repo-one' }, 'ghp_test', {});
    const second = fetchGithubRepoStatus({ owner: 'owner-two', repo: 'repo-two' }, 'ghp_test', {});

    await firstStarted;
    expect(fetch).toHaveBeenCalledTimes(1);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.status).toBe(true);
    expect(secondResult.status).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('skips the Supabase GitHub fallback while a local throttle window is active', async () => {
    githubThrottleUntil = Date.now() + 60 * 1000;

    const result = await fetchGithubRepoStatusViaSupabase({ owner: 'owner', repo: 'repo' }, {});

    expect(result.status).toBe('rate_limited');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('score grading', () => {
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
    fetch.mockReset();
  });

  test('maps scores to grades', () => {
    expect(gradeForScore(95)).toBe('A');
    expect(gradeForScore(84)).toBe('B');
    expect(gradeForScore(73)).toBe('C');
    expect(gradeForScore(62)).toBe('D');
    expect(gradeForScore(10)).toBe('F');
  });

  test('scores API-style snake_case activity dates', () => {
    const result = attachScore({
      status: true,
      details: {
        host: 'github.com',
        updated_at: new Date().toISOString(),
      },
    }, { max_repo_update_time: 365 });

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });

  test('derives grade from provided string score instead of trusting adapter grade', () => {
    const result = attachScore({
      status: true,
      score: '82',
      grade: 'f',
      details: {
        host: 'github.com',
      },
    }, {});

    expect(result.score).toBe(82);
    expect(result.grade).toBe('B');
  });

  test('does not let score mode override status when no score signals are available', () => {
    const result = attachScore({
      status: true,
      details: {
        host: 'github.com',
      },
    }, {
      score_decides_status: true,
      min_active_score: 70,
    });

    expect(result.status).toBe(true);
    expect(result.score).toBeUndefined();
    expect(result.details.scoreAvailable).toBe(false);
  });

  test('archives hard-fail even when adapter provides a high score', () => {
    const result = attachScore({
      status: true,
      score: 95,
      details: {
        host: 'github.com',
        isArchived: true,
      },
    }, {
      score_decides_status: true,
      min_active_score: 70,
    });

    expect(result.status).toBe(false);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
  });

  test('normalizes isActive adapter result shape', () => {
    const result = attachScore({
      isActive: true,
      details: {
        host: 'github.com',
        pushOk: true,
      },
    }, {});

    expect(result.status).toBe(true);
    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
  });

  test('keeps strict binary status unless score_decides_status is enabled', async () => {
    const justPastThreshold = new Date(Date.now() - (400 * 24 * 60 * 60 * 1000)).toISOString();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: false,
        updated_at: justPastThreshold,
      }),
    });

    const result = await fetchRepoStatusByUrl('https://codeberg.org/owner/repo', {
      max_repo_update_time: 365,
    });

    expect(result.status).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toMatch(/[AB]/);
  });

  test('can use score to decide active status', async () => {
    const justPastThreshold = new Date(Date.now() - (400 * 24 * 60 * 60 * 1000)).toISOString();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: false,
        updated_at: justPastThreshold,
      }),
    });

    const result = await fetchRepoStatusByUrl('https://codeberg.org/owner/repo', {
      max_repo_update_time: 365,
      score_decides_status: true,
      min_active_score: 70,
    });

    expect(result.status).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.details.scoreDecidesStatus).toBe(true);
  });

  test('short-circuits extra GitHub calls for stale repos when scoring is off', async () => {
    const stale = new Date(Date.now() - (400 * 24 * 60 * 60 * 1000)).toISOString();
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: false,
        pushed_at: stale,
        updated_at: stale,
      }),
    });

    const result = await fetchGithubRepoStatus({ owner: 'owner', repo: 'repo' }, 'ghp_test', {
      max_repo_update_time: 180,
      open_prs_max: 20,
      last_closed_pr_max_days: 90,
      max_issues_update_time: 180,
      max_days_since_last_release: 365,
      max_open_issue_age: 365,
      grading_enabled: false,
      score_decides_status: false,
    });

    expect(result.status).toBe(false);
    expect(result.details.pushOk).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/owner/repo');
  });

  test('counts GitHub open PRs from pulls pagination instead of search', async () => {
    const now = new Date().toISOString();
    fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          archived: false,
          pushed_at: now,
          updated_at: now,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'link'
            ? '<https://api.github.com/repos/owner/repo/pulls?state=open&per_page=1&page=21>; rel="last"'
            : null,
        },
        json: async () => ([{}]),
      });

    const result = await fetchGithubRepoStatus({ owner: 'owner', repo: 'repo' }, 'ghp_test', {
      max_repo_update_time: 365,
      open_prs_max: 20,
    });

    expect(result.status).toBe(false);
    expect(result.details.openPrCount).toBe(21);
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/owner/repo/pulls?state=open&per_page=1');
  });

  test('archives are always an F and inactive even in score mode', async () => {
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        archived: true,
        updated_at: new Date().toISOString(),
      }),
    });

    const result = await fetchRepoStatusByUrl('https://codeberg.org/owner/repo', {
      score_decides_status: true,
      min_active_score: 70,
    });

    expect(result.status).toBe(false);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
  });
});

describe('withinDays', () => {
  // withinDays is intentionally permissive for absent dates and disabled rules;
  // host adapters only fail a rule when a finite threshold and concrete old date
  // are both present.
  test('returns true for recent dates', () => {
    const recent = new Date().toISOString();
    expect(withinDays(recent, 30)).toBe(true);
  });

  test('returns false for old dates', () => {
    const old = new Date('2020-01-01').toISOString();
    expect(withinDays(old, 30)).toBe(false);
  });

  test('returns true for null dateStr', () => {
    expect(withinDays(null, 30)).toBe(true);
  });

  test('returns true for non-finite maxDays', () => {
    expect(withinDays('2020-01-01', Infinity)).toBe(true);
  });
});

describe('validateSegment', () => {
  // Segment validation is security-sensitive because accepted values are later
  // interpolated into remote API paths.
  test('accepts valid owner/repo names', () => {
    expect(() => validateSegment('octocat')).not.toThrow();
    expect(() => validateSegment('Hello-World')).not.toThrow();
    expect(() => validateSegment('my_repo.js')).not.toThrow();
  });

  test('rejects path traversal attempts', () => {
    expect(() => validateSegment('../etc')).toThrow();
    expect(() => validateSegment('foo/bar')).toThrow();
    expect(() => validateSegment('')).toThrow();
  });

  test('rejects non-string input', () => {
    expect(() => validateSegment(null)).toThrow();
    expect(() => validateSegment(42)).toThrow();
  });
});
