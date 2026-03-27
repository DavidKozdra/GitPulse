/**
 * @jest-environment jsdom
 */

// Test banner rendering and state management

// Set up globals
global.config = {
  emoji_active: { active: true, value: '✅' },
  emoji_inactive: { active: true, value: '❌' },
  emoji_private: { active: true, value: '🔒' },
  emoji_rate_limited: { active: true, value: '⏳' },
};

global.ext = {
  sendMessage: jest.fn(),
};

// Set up __gp namespace
global.__gp = {};

// Load banner module
const fs = require('fs');
const bannerSource = fs.readFileSync(require.resolve('../content/main.banner.js'), 'utf8');
eval(bannerSource);

describe('ensureBannerExists', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('creates banner element in the DOM', () => {
    const banner = ensureBannerExists();
    expect(banner).not.toBeNull();
    expect(banner.id).toBe('my-banner');
    expect(document.getElementById('my-banner')).toBe(banner);
  });

  test('returns existing banner if already created', () => {
    const first = ensureBannerExists();
    const second = ensureBannerExists();
    expect(first).toBe(second);
  });

  test('banner has close button', () => {
    ensureBannerExists();
    const closeBtn = document.getElementById('banner-close');
    expect(closeBtn).not.toBeNull();
  });

  test('banner has text container', () => {
    const banner = ensureBannerExists();
    const textContainer = banner.querySelector('.text-container');
    expect(textContainer).not.toBeNull();
  });

  test('banner has config link', () => {
    const banner = ensureBannerExists();
    const configLink = banner.querySelector('.banner-config-link');
    expect(configLink).not.toBeNull();
  });
});

describe('ToggleBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    ensureBannerExists();
  });

  test('shows active banner with green color', () => {
    ToggleBanner(true, true);
    const banner = document.getElementById('my-banner');
    expect(banner.style.display).toBe('flex');
    const mainText = banner.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('Active');
    expect(mainText.style.backgroundColor).toMatch(/(#1a8917|rgb\(26, 137, 23\))/);
  });

  test('shows inactive banner with red color', () => {
    ToggleBanner(false, true);
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('InActive');
    expect(mainText.style.backgroundColor).toMatch(/(#d32f2f|rgb\(211, 47, 47\))/);
  });

  test('shows rate limited banner with orange color', () => {
    ToggleBanner('rate_limited', true);
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('Rate limit');
    expect(mainText.style.backgroundColor).toMatch(/(#f57c00|rgb\(245, 124, 0\))/);
  });

  test('shows private banner with gray color', () => {
    ToggleBanner('private', true);
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('Private');
    expect(mainText.style.backgroundColor).toMatch(/(#555|rgb\(85, 85, 85\))/);
  });

  test('hides banner when Toggle is false', () => {
    ToggleBanner(true, false);
    const banner = document.getElementById('my-banner');
    expect(banner.style.display).toBe('none');
  });

  test('stores status in dataset for refresh', () => {
    ToggleBanner(true, true);
    const banner = document.getElementById('my-banner');
    expect(banner.dataset.gitpulseStatus).toBe('true');
  });

  test('config link shows PAT message when rate limited', () => {
    ToggleBanner('rate_limited', true);
    const configLink = document.querySelector('.banner-config-link');
    expect(configLink.textContent).toContain('Personal Access Token');
  });

  test('uses configured emojis', () => {
    global.config.emoji_active.value = '🚀';
    ToggleBanner(true, true);
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('🚀');
    global.config.emoji_active.value = '✅'; // restore
  });
});

describe('__gp.refreshBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    ensureBannerExists();
  });

  test('refreshes banner from stored dataset status', () => {
    ToggleBanner(true, true);
    global.config.emoji_active.value = '🎉';
    __gp.refreshBanner();
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('🎉');
    global.config.emoji_active.value = '✅';
  });
});
