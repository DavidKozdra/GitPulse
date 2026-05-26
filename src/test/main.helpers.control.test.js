const { isRepoUrl, getActiveConfigMetrics, isReloadNavigation } = require('../content/main.helpers');

// Control tests for helper functions that content modules share. These provide
// focused coverage for URL classification, config flattening, reload detection,
// and background status-message handling.
describe('isRepoUrl control tests', () => {
  test('accepts typical GitHub repo URL', () => {
    expect(isRepoUrl('https://github.com/octocat/Hello-World')).toBe(true);
  });

  test('rejects GitHub explore page', () => {
    expect(isRepoUrl('https://github.com/explore')).toBe(false);
  });

  test('accepts npm package URL', () => {
    expect(isRepoUrl('https://www.npmjs.com/package/express')).toBe(true);
  });

  test('rejects non-repository host', () => {
    expect(isRepoUrl('https://example.com/foo/bar')).toBe(false);
  });
});

describe('getActiveConfigMetrics control tests', () => {
  // Config is stored as form-field metadata, but checks consume plain active
  // metric values. This verifies disabled or value-less fields are ignored.
  beforeEach(() => {
    global.config = {
      emoji_active: { active: true, value: '✅' },
      emoji_inactive: { active: true, value: '❌' },
      max_repo_update_time: { active: false, value: 365 },
      max_open_issue_age: { active: true, value: 180 },
      ignored_field: { active: false, value: 123 },
    };
  });

  test('returns only active fields with their values', () => {
    const metrics = getActiveConfigMetrics();
    expect(metrics).toEqual({
      emoji_active: '✅',
      emoji_inactive: '❌',
      max_open_issue_age: 180,
    });
  });

  test('ignores fields without a value', () => {
    global.config.field_without_value = { active: true };
    const metrics = getActiveConfigMetrics();
    expect(metrics).not.toHaveProperty('field_without_value');
  });
});

describe('isReloadNavigation control tests', () => {
  // Navigation Timing APIs differ by browser age. The helper should use modern
  // entries when available and legacy performance.navigation when needed.
  const originalPerformance = global.performance;

  afterEach(() => {
    Object.defineProperty(global, 'performance', {
      value: originalPerformance,
      configurable: true,
    });
  });

  function setPerformance(value) {
    Object.defineProperty(global, 'performance', {
      value,
      configurable: true,
    });
  }

  test('returns true for reload navigation timing entries', () => {
    setPerformance({
      getEntriesByType: jest.fn(() => [{ type: 'reload' }]),
    });

    expect(isReloadNavigation()).toBe(true);
  });

  test('returns false for non-reload navigation timing entries', () => {
    setPerformance({
      getEntriesByType: jest.fn(() => [{ type: 'navigate' }]),
    });

    expect(isReloadNavigation()).toBe(false);
  });

  test('falls back to legacy performance.navigation reload type', () => {
    setPerformance({
      getEntriesByType: jest.fn(() => []),
      navigation: { type: 1 },
    });

    expect(isReloadNavigation()).toBe(true);
  });
});

describe('isRepoActive control tests', () => {
  // isRepoActive is a thin legacy wrapper around getRepoStatus. These tests
  // verify message shape, cache-bypass propagation, and fail-closed behavior.
  const { isRepoActive } = require('../content/main.helpers');
  let warnSpy;

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = undefined;
  });

  function muteExpectedBackgroundWarning() {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    return warnSpy;
  }

  test('returns status from background when ok=true', async () => {
    const sendMessage = jest.fn(() =>
      Promise.resolve({ ok: true, result: { status: true } })
    );
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World');

    expect(sendMessage).toHaveBeenCalledWith({
      action: 'fetchRepoStatus',
      url: 'https://github.com/octocat/Hello-World',
    });
    expect(result).toBe(true);
  });

  test('asks background to force refresh when cache bypass is requested', async () => {
    const sendMessage = jest.fn(() =>
      Promise.resolve({ ok: true, result: { status: true } })
    );
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World', {
      bypassCache: true,
    });

    expect(sendMessage).toHaveBeenCalledWith({
      action: 'fetchRepoStatus',
      url: 'https://github.com/octocat/Hello-World',
      forceRefresh: true,
    });
    expect(result).toBe(true);
  });

  test('fails closed (false) when background responds with ok=false', async () => {
    const warn = muteExpectedBackgroundWarning();
    const sendMessage = jest.fn(() =>
      Promise.resolve({ ok: false, error: 'something went wrong' })
    );
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World');

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[Repo check] background error',
      'something went wrong'
    );
  });

  test('fails closed (false) when background returns no response object', async () => {
    const warn = muteExpectedBackgroundWarning();
    const sendMessage = jest.fn(() => Promise.resolve(null));
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World');

    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith('[Repo check] background error', undefined);
  });
});
