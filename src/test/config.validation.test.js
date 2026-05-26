// Test config validation logic.
//
// The popup and content scripts trust validateConfig to defend against corrupted
// storage and older config shapes. These tests cover defaulting, type coercion,
// bounds, and forward compatibility.

// Mock ext before loading config.js because loadConfig/saveConfig/resetConfig
// reference the extension API at module evaluation/runtime.
global.ext = {
  sendMessage: jest.fn(),
  storage: { local: { get: jest.fn(), set: jest.fn() }, onChanged: { addListener: jest.fn() } },
};

// Load config.js. It is written for browser globals rather than CommonJS, so the
// eval path mirrors how the extension loads it. Rewriting const/let to var makes
// the declarations reachable in this Jest scope.
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../config.js'), 'utf8');
// Replace const/let with var so they become global in eval
const patchedSource = source
  .replace(/^const /gm, 'var ')
  .replace(/^let /gm, 'var ');
eval(patchedSource);

describe('validateConfig', () => {
  // Each scenario asserts that invalid user-editable values are replaced with
  // safe defaults while valid stored values and unknown future keys survive.
  test('returns defaultConfig when given null', () => {
    const result = validateConfig(null);
    expect(result.max_repo_update_time.value).toBe(365);
    expect(result.emoji_active.value).toBe('✅');
    expect(result.grading_enabled.value).toBe(false);
    expect(result.min_active_score.value).toBe(70);
    expect(result.marker_display.value).toBe('emoji');
  });

  test('returns defaultConfig when given non-object', () => {
    const result = validateConfig('not an object');
    expect(result.max_repo_update_time.value).toBe(365);
  });

  test('merges stored config with defaults', () => {
    const stored = {
      max_repo_update_time: { value: 180, active: true },
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.value).toBe(180);
    expect(result.max_repo_update_time.active).toBe(true);
    expect(result.emoji_active.value).toBe('✅');
  });

  test('rejects negative numbers', () => {
    const stored = {
      max_repo_update_time: { value: -50, active: true },
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.value).toBe(365);
  });

  test('rejects NaN values for number fields', () => {
    const stored = {
      max_repo_update_time: { value: NaN, active: true },
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.value).toBe(365);
  });

  test('truncates text values to 8 chars', () => {
    const stored = {
      emoji_active: { value: '🎉🎉🎉🎉🎉🎉🎉🎉🎉', active: true },
    };
    const result = validateConfig(stored);
    expect(result.emoji_active.value.length).toBeLessThanOrEqual(8);
  });

  test('ensures active is always boolean', () => {
    const stored = {
      max_repo_update_time: { value: 100, active: 'yes' },
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.active).toBe(true);
  });

  test('ensures active=false is preserved', () => {
    const stored = {
      max_repo_update_time: { value: 100, active: false },
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.active).toBe(false);
  });

  test('preserves valid boolean values', () => {
    const stored = {
      grading_enabled: { value: true, active: true },
      score_decides_status: { value: true, active: true },
    };
    const result = validateConfig(stored);
    expect(result.grading_enabled.value).toBe(true);
    expect(result.score_decides_status.value).toBe(true);
  });

  test('rejects invalid boolean values', () => {
    const stored = {
      grading_enabled: { value: 'yes', active: true },
    };
    const result = validateConfig(stored);
    expect(result.grading_enabled.value).toBe(false);
  });

  test('preserves valid select values', () => {
    const stored = {
      marker_display: { value: 'badge', active: true },
      banner_display: { value: 'both', active: true },
    };
    const result = validateConfig(stored);
    expect(result.marker_display.value).toBe('badge');
    expect(result.banner_display.value).toBe('both');
  });

  test('rejects invalid select values', () => {
    const stored = {
      marker_display: { value: 'anything', active: true },
    };
    const result = validateConfig(stored);
    expect(result.marker_display.value).toBe('emoji');
  });

  test('preserves extra keys for forward compatibility', () => {
    const stored = {
      future_feature: { value: 42, active: true, name: 'Future', type: 'number' },
    };
    const result = validateConfig(stored);
    expect(result.future_feature).toBeDefined();
    expect(result.future_feature.value).toBe(42);
  });

  test('handles missing field gracefully', () => {
    const stored = {
      max_repo_update_time: null,
    };
    const result = validateConfig(stored);
    expect(result.max_repo_update_time.value).toBe(365);
  });
});
