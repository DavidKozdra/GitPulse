// Test config validation logic

// Mock ext before loading config.js
global.ext = {
  sendMessage: jest.fn(),
  storage: { local: { get: jest.fn(), set: jest.fn() }, onChanged: { addListener: jest.fn() } },
};

// Load config.js — it defines globals via function declarations and const/var
// We need to eval it so the functions land on globalThis
const fs = require('fs');
const source = fs.readFileSync(require.resolve('../config.js'), 'utf8');
// Replace const/let with var so they become global in eval
const patchedSource = source
  .replace(/^const /gm, 'var ')
  .replace(/^let /gm, 'var ');
eval(patchedSource);

describe('validateConfig', () => {
  test('returns defaultConfig when given null', () => {
    const result = validateConfig(null);
    expect(result.max_repo_update_time.value).toBe(365);
    expect(result.emoji_active.value).toBe('✅');
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
