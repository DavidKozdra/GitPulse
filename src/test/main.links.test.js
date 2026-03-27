/**
 * @jest-environment jsdom
 */

// Test link deduplication, marking, and concurrency pool

// Set up globals that main.links.js expects
global.config = {
  emoji_active: { active: true, value: '✅' },
  emoji_inactive: { active: true, value: '❌' },
  emoji_private: { active: true, value: '🔒' },
  emoji_rate_limited: { active: true, value: '⏳' },
};

global.ext = {
  sendMessage: jest.fn(),
};

// Set up __gp namespace (normally created by main.helpers.js)
global.__gp = {};

// Load helpers first (provides isRepoUrl)
const { isRepoUrl } = require('../content/main.helpers');
global.isRepoUrl = isRepoUrl;

// Load links module by evaluating it
const fs = require('fs');
const linksSource = fs.readFileSync(require.resolve('../content/main.links.js'), 'utf8');
eval(linksSource);

describe('normalizeStatus', () => {
  test('converts true to "true"', () => {
    expect(normalizeStatus(true)).toBe('true');
  });

  test('converts false to "false"', () => {
    expect(normalizeStatus(false)).toBe('false');
  });

  test('passes through "private"', () => {
    expect(normalizeStatus('private')).toBe('private');
  });

  test('passes through "rate_limited"', () => {
    expect(normalizeStatus('rate_limited')).toBe('rate_limited');
  });

  test('returns empty string for unknown values', () => {
    expect(normalizeStatus(null)).toBe('');
    expect(normalizeStatus(undefined)).toBe('');
  });
});

describe('parseStatus', () => {
  test('parses "true" back to boolean true', () => {
    expect(parseStatus('true')).toBe(true);
  });

  test('parses "false" back to boolean false', () => {
    expect(parseStatus('false')).toBe(false);
  });

  test('parses "private" and "rate_limited"', () => {
    expect(parseStatus('private')).toBe('private');
    expect(parseStatus('rate_limited')).toBe('rate_limited');
  });

  test('returns null for unknown values', () => {
    expect(parseStatus('')).toBeNull();
    expect(parseStatus('unknown')).toBeNull();
  });
});

describe('emojiForStatus', () => {
  test('returns active emoji for true', () => {
    const result = emojiForStatus(true);
    expect(result).not.toBeNull();
    expect(result.icon).toBe('✅');
    expect(result.color).toBe('green');
  });

  test('returns inactive emoji for false', () => {
    const result = emojiForStatus(false);
    expect(result).not.toBeNull();
    expect(result.icon).toBe('❌');
    expect(result.color).toBe('red');
  });

  test('returns private emoji', () => {
    const result = emojiForStatus('private');
    expect(result.icon).toBe('🔒');
  });

  test('returns rate_limited emoji', () => {
    const result = emojiForStatus('rate_limited');
    expect(result.icon).toBe('⏳');
  });

  test('returns null for unknown status', () => {
    expect(emojiForStatus(null)).toBeNull();
    expect(emojiForStatus('unknown')).toBeNull();
  });

  test('returns null when emoji config is disabled', () => {
    const origActive = global.config.emoji_active;
    global.config.emoji_active = { active: false, value: '✅' };
    expect(emojiForStatus(true)).toBeNull();
    global.config.emoji_active = origActive;
  });
});

describe('dedupeLinks', () => {
  test('groups links by hostname+pathname', () => {
    const link1 = document.createElement('a');
    link1.href = 'https://github.com/octocat/Hello-World';
    const link2 = document.createElement('a');
    link2.href = 'https://github.com/octocat/Hello-World';
    const link3 = document.createElement('a');
    link3.href = 'https://github.com/other/repo';

    const map = dedupeLinks([link1, link2, link3]);
    expect(map.size).toBe(2);
    expect(map.get('github.com/octocat/Hello-World').length).toBe(2);
    expect(map.get('github.com/other/repo').length).toBe(1);
  });

  test('skips non-repo URLs', () => {
    const link = document.createElement('a');
    link.href = 'https://example.com/not/a/repo';
    const map = dedupeLinks([link]);
    expect(map.size).toBe(0);
  });

  test('skips links without href', () => {
    const link = document.createElement('a');
    const map = dedupeLinks([link]);
    expect(map.size).toBe(0);
  });
});

describe('runWithConcurrency', () => {
  test('runs all tasks and returns results', async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];
    const results = await runWithConcurrency(tasks, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  test('respects concurrency limit', async () => {
    let running = 0;
    let maxRunning = 0;

    const makeTask = () => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
      return true;
    };

    const tasks = Array.from({ length: 10 }, makeTask);
    await runWithConcurrency(tasks, 3);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });
});

describe('setOrRemoveLinkMark', () => {
  test('adds emoji mark to a link', () => {
    const link = document.createElement('a');
    link.textContent = 'Hello World';
    setOrRemoveLinkMark(link, true);
    const mark = link.querySelector('.repo-checker-mark');
    expect(mark).not.toBeNull();
    expect(mark.textContent).toContain('✅');
  });

  test('removes mark when emoji is disabled', () => {
    const link = document.createElement('a');
    link.textContent = 'Hello World';
    setOrRemoveLinkMark(link, true);
    expect(link.querySelector('.repo-checker-mark')).not.toBeNull();

    const origActive = global.config.emoji_active;
    global.config.emoji_active = { active: false, value: '✅' };
    setOrRemoveLinkMark(link, true);
    expect(link.querySelector('.repo-checker-mark')).toBeNull();
    global.config.emoji_active = origActive;
  });

  test('updates existing mark instead of duplicating', () => {
    const link = document.createElement('a');
    link.textContent = 'Hello World';
    setOrRemoveLinkMark(link, true);
    setOrRemoveLinkMark(link, false);
    const marks = link.querySelectorAll('.repo-checker-mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toContain('❌');
  });
});
