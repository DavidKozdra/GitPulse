// Test cache logic and utility functions from background.js

const fs = require('fs');

// Mock chrome APIs with working storage
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

// Load background.js — replace const/let with var so functions become global
const bgSource = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const patchedSource = bgSource
  .replace(/^const /gm, 'var ')
  .replace(/^let /gm, 'var ');
eval(patchedSource);

describe('cache helpers', () => {
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
      v: 2,
    };
    const result = await readCache('old-key');
    expect(result).toBeNull();
  });

  test('rate-limited entries expire after 2h', async () => {
    const full = 'repoCache:rl-key';
    storage[full] = {
      isActive: 'rate_limited',
      checkedAt: Date.now() - (1000 * 60 * 60 * 3), // 3h ago
      v: 2,
    };
    const result = await readCache('rl-key');
    expect(result).toBeNull();
  });

  test('rate-limited entries within 2h are returned', async () => {
    const full = 'repoCache:rl-valid';
    storage[full] = {
      isActive: 'rate_limited',
      checkedAt: Date.now() - (1000 * 60 * 60 * 1), // 1h ago
      v: 2,
    };
    const result = await readCache('rl-valid');
    expect(result).not.toBeNull();
    expect(result.isActive).toBe('rate_limited');
  });

  test('clearCache removes all cache entries', async () => {
    storage['repoCache:a'] = { isActive: true, checkedAt: Date.now(), v: 2 };
    storage['repoCache:b'] = { isActive: false, checkedAt: Date.now(), v: 2 };
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
  beforeEach(() => {
    Object.keys(storage).forEach(k => delete storage[k]);
  });

  test('clears cache when rule values change', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: 2 };
    const oldCfg = { max_repo_update_time: { active: true, value: 365 } };
    const newCfg = { max_repo_update_time: { active: true, value: 180 } };
    await smartClearCache(oldCfg, newCfg);
    expect(storage['repoCache:x']).toBeUndefined();
  });

  test('does NOT clear cache for emoji-only changes', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: 2 };
    const oldCfg = { emoji_active: { value: '✅' }, max_repo_update_time: { active: true, value: 365 } };
    const newCfg = { emoji_active: { value: '🚀' }, max_repo_update_time: { active: true, value: 365 } };
    const result = await smartClearCache(oldCfg, newCfg);
    expect(result.skipped).toBe(true);
    expect(storage['repoCache:x']).toBeDefined();
  });

  test('falls back to full clear when oldConfig is null', async () => {
    storage['repoCache:x'] = { isActive: true, checkedAt: Date.now(), v: 2 };
    await smartClearCache(null, {});
    expect(storage['repoCache:x']).toBeUndefined();
  });
});

describe('withinDays', () => {
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
