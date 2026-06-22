/**
 * @jest-environment jsdom
 */

// Test link deduplication, marking, and concurrency pool.
//
// main.links.js is loaded as a browser content script, so this suite evaluates
// it in jsdom after installing the globals it normally receives from helpers,
// config, and compat.js. The tests focus on DOM mutations and request fan-out.

// Set up globals that main.links.js expects. Emoji config mirrors the default
// user-visible states so renderer tests cover every supported status value.
global.config = {
  emoji_active: { active: true, value: '✅' },
  emoji_inactive: { active: true, value: '❌' },
  emoji_private: { active: true, value: '🔒' },
  emoji_rate_limited: { active: true, value: '⏳' },
  emoji_unsupported: { active: true, value: '❔' },
  grading_enabled: { active: true, value: false },
  marker_display: { active: true, value: 'emoji' },
};

global.ext = {
  sendMessage: jest.fn(),
};

// Set up __gp namespace (normally created by main.helpers.js). Individual tests
// can attach formatter functions here when tooltip details are relevant.
global.__gp = {};

// Load helpers first because dedupeLinks calls isRepoUrl to decide which anchors
// are repository/package links worth annotating.
const { isRepoUrl } = require('../content/main.helpers');
global.isRepoUrl = isRepoUrl;

// Load links module by evaluating it
const fs = require('fs');
const linksSource = fs.readFileSync(require.resolve('../content/main.links.js'), 'utf8');
eval(linksSource);

describe('normalizeStatus', () => {
  // Status values are a mixed union in JS but must be strings in DOM attributes.
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

  test('passes through "unsupported"', () => {
    expect(normalizeStatus('unsupported')).toBe('unsupported');
  });

  test('returns empty string for unknown values', () => {
    expect(normalizeStatus(null)).toBe('');
    expect(normalizeStatus(undefined)).toBe('');
  });
});

describe('parseStatus', () => {
  // parseStatus is the inverse used when config changes repaint existing marks
  // without another background fetch.
  test('parses "true" back to boolean true', () => {
    expect(parseStatus('true')).toBe(true);
  });

  test('parses "false" back to boolean false', () => {
    expect(parseStatus('false')).toBe(false);
  });

  test('parses "private" and "rate_limited"', () => {
    expect(parseStatus('private')).toBe('private');
    expect(parseStatus('rate_limited')).toBe('rate_limited');
    expect(parseStatus('unsupported')).toBe('unsupported');
  });

  test('returns null for unknown values', () => {
    expect(parseStatus('')).toBeNull();
    expect(parseStatus('unknown')).toBeNull();
  });
});

describe('emojiForStatus', () => {
  // Emoji selection covers defaults, user overrides, and disabled states. A null
  // return means "remove the marker".
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

  test('returns unsupported emoji', () => {
    const result = emojiForStatus('unsupported');
    expect(result.icon).toBe('❔');
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
  // Dedupe protects background.js and host APIs from duplicate checks when a page
  // repeats the same repository URL in several anchors.
  test('groups links by hostname+pathname', () => {
    const link1 = document.createElement('a');
    link1.href = 'https://github.com/octocat/Hello-World';
    const link2 = document.createElement('a');
    link2.href = 'https://github.com/octocat/Hello-World';
    const link3 = document.createElement('a');
    link3.href = 'https://github.com/other/repo';

    const map = dedupeLinks([link1, link2, link3]);
    expect(map.size).toBe(2);
    // Only one element per root key — same-href duplicates are collapsed
    expect(map.get('github.com/octocat/Hello-World').length).toBe(1);
    expect(map.get('github.com/other/repo').length).toBe(1);
  });

  test('dedupes sub-page links to one badge per repo root', () => {
    // GitHub profile pages have /stargazers and /forks links alongside the repo name link.
    // All share the same root key and should only produce one badge.
    const nameLink = document.createElement('a');
    nameLink.href = 'https://github.com/octocat/Hello-World';
    nameLink.textContent = 'Hello-World';
    const starsLink = document.createElement('a');
    starsLink.href = 'https://github.com/octocat/Hello-World/stargazers';
    starsLink.textContent = '42';
    const forksLink = document.createElement('a');
    forksLink.href = 'https://github.com/octocat/Hello-World/forks';
    forksLink.textContent = '7';

    const map = dedupeLinks([nameLink, starsLink, forksLink]);
    expect(map.size).toBe(1);
    expect(map.get('github.com/octocat/Hello-World').length).toBe(1);
    // The element with the most text (nameLink) should be chosen
    expect(map.get('github.com/octocat/Hello-World')[0].textContent).toBe('Hello-World');
  });

  test('keeps npm package canonical URLs valid for background routing', () => {
    const link = document.createElement('a');
    link.href = 'https://www.npmjs.com/package/express';

    const map = dedupeLinks([link]);

    expect(map.has('www.npmjs.com/package/express')).toBe(true);
  });

  test('keeps nested GitLab project paths before the subpage marker', () => {
    const link = document.createElement('a');
    link.href = 'https://gitlab.com/group/subgroup/project/-/issues';

    const map = dedupeLinks([link]);

    expect(map.has('gitlab.com/group/subgroup/project')).toBe(true);
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
  // Dynamic pages can contain many repository links. The pool should finish all
  // tasks while respecting the maximum number of simultaneous checks.
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
  // setOrRemoveLinkMark owns the actual DOM write. These tests make sure it
  // creates, removes, and updates a single marker instead of duplicating spans.
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

  test('renders GitPulse grade badge inside the marker when grading is enabled', () => {
    global.config.grading_enabled.value = true;
    global.config.marker_display.value = 'badge';
    const link = document.createElement('a');
    link.textContent = 'Hello World';

    setOrRemoveLinkMark(link, true, { score: 95, grade: 'A' }, { score: 95, grade: 'A' });

    const badge = link.querySelector('.gitpulse-grade-badge');
    expect(badge).not.toBeNull();
    expect(badge.iconSrc).toBe('../icon.png');
    expect(badge.querySelector('img')).not.toBeNull();
    expect(badge.textContent).toBe('Grade A');
    expect(badge.style.borderRadius).toBe('5%');
    expect(badge.style.backgroundColor).toMatch(/(#1a8917|rgb\(26, 137, 23\))/);

    global.config.marker_display.value = 'emoji';
    global.config.grading_enabled.value = false;
  });

  test('does not render a grade badge in emoji-only marker mode', () => {
    global.config.grading_enabled.value = true;
    global.config.marker_display.value = 'emoji';
    const link = document.createElement('a');
    link.textContent = 'Hello World';

    setOrRemoveLinkMark(link, true, { score: 95, grade: 'A' }, { score: 95, grade: 'A' });

    expect(link.querySelector('.gitpulse-grade-badge')).toBeNull();
    expect(link.querySelector('.repo-checker-mark').textContent).toContain('✅');

    global.config.grading_enabled.value = false;
  });

  test('keeps grade badge when status emoji is disabled', () => {
    global.config.grading_enabled.value = true;
    global.config.marker_display.value = 'badge';
    const origActive = global.config.emoji_active;
    global.config.emoji_active = { active: false, value: '✅' };
    const link = document.createElement('a');
    link.textContent = 'Hello World';

    setOrRemoveLinkMark(link, true, { score: 95, grade: 'A' }, { score: 95, grade: 'A' });

    const mark = link.querySelector('.repo-checker-mark');
    const badge = link.querySelector('.gitpulse-grade-badge');
    expect(mark).not.toBeNull();
    expect(mark.textContent).toContain('Grade A');
    expect(mark.textContent).not.toContain('✅');
    expect(badge).not.toBeNull();

    global.config.emoji_active = origActive;
    global.config.marker_display.value = 'emoji';
    global.config.grading_enabled.value = false;
  });

  test('refreshAllLinkMarks preserves score and grade stored outside details', () => {
    global.config.grading_enabled.value = true;
    global.config.marker_display.value = 'badge';
    const link = document.createElement('a');
    link.textContent = 'Hello World';
    document.body.appendChild(link);

    setOrRemoveLinkMark(link, true, {}, { score: 95, grade: 'A' });
    link.querySelector('.gitpulse-grade-badge').remove();

    refreshAllLinkMarks();

    const badge = link.querySelector('.gitpulse-grade-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Grade A');

    global.config.marker_display.value = 'emoji';
    global.config.grading_enabled.value = false;
  });
});
