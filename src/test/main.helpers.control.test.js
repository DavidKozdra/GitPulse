const {
  isRepoUrl,
  getActiveConfigMetrics,
  isReloadNavigation,
  formatRepoStatusDetails,
} = require('../content/main.helpers');

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

describe('formatRepoStatusDetails error handling', () => {
  // When the background service worker's fetch throws (offline, blocked host,
  // CORS), it returns { status: false, details: { error } } and the banner shows
  // this text. This is the source of the "Check failed: TypeError: Failed to
  // fetch" banner. These tests pin that message so the network-failure surface
  // stays readable.
  test('surfaces a network fetch failure as a "Check failed" message', () => {
    const text = formatRepoStatusDetails(false, {
      error: 'TypeError: Failed to fetch',
    });
    expect(text).toBe('Check failed: TypeError: Failed to fetch');
  });

  test('strips a leading "Error:" prefix from the reported error', () => {
    const text = formatRepoStatusDetails(false, {
      error: 'Error: network request timed out',
    });
    expect(text).toBe('Check failed: network request timed out');
  });

  test('coerces a non-string Error object into text without throwing', () => {
    // String(new TypeError('Failed to fetch')) === 'TypeError: Failed to fetch'.
    // Only a leading "Error:" is stripped, so the "TypeError:" name is preserved
    // — this is exactly what the user sees in the failing banner.
    const text = formatRepoStatusDetails(false, {
      error: new TypeError('Failed to fetch'),
    });
    expect(text).toBe('Check failed: TypeError: Failed to fetch');
  });

  test('reports the error for a plain false status from a failed fetch', () => {
    // The background wraps fetch failures as { status: false, details: { error } },
    // so status false + an error is exactly the "Failed to fetch" banner case.
    const text = formatRepoStatusDetails(false, {
      error: 'TypeError: Failed to fetch',
      host: 'github.com',
    });
    expect(text).toBe('Check failed: TypeError: Failed to fetch');
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
