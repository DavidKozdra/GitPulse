/**
 * @jest-environment jsdom
 */

// Test banner rendering and state management.
//
// The banner module writes DOM directly in a content-script context. jsdom gives
// enough browser surface to verify structure, visible state, colors, data
// attributes, and config-driven repainting without opening a real tab.

// Set up globals. The banner reads config and ext from the page context exactly
// like it does after manifest-injected scripts load in the browser.
global.config = {
  emoji_active: { active: true, value: '✅' },
  emoji_inactive: { active: true, value: '❌' },
  emoji_private: { active: true, value: '🔒' },
  emoji_rate_limited: { active: true, value: '⏳' },
  emoji_unsupported: { active: true, value: '❔' },
  grading_enabled: { active: true, value: false },
  banner_display: { active: true, value: 'emoji' },
};

global.ext = {
  sendMessage: jest.fn(),
};

// Set up __gp namespace. Detail formatting normally comes from main.helpers.js;
// tests install a formatter only when a scenario needs that behavior.
const { createGradeBadge, repoGradeInfo } = require('../content/main.helpers');
global.__gp = { createGradeBadge, repoGradeInfo };

// Load banner module. It immediately calls ensureBannerExists once, so tests
// reset document.body before scenarios that need a clean DOM.
const fs = require('fs');
const bannerSource = fs.readFileSync(require.resolve('../content/main.banner.js'), 'utf8');
eval(bannerSource);

describe('ensureBannerExists', () => {
  // Creation tests define the required DOM contract used later by ToggleBanner
  // and by user actions such as close, refresh, and opening config.
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

  test('banner has refresh button', () => {
    ensureBannerExists();
    const refreshBtn = document.getElementById('banner-refresh');
    expect(refreshBtn).not.toBeNull();
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
  // ToggleBanner maps status values to text, color, visibility, and stored
  // dataset state. These are the user-facing states shown on repo pages.
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

  test('shows unsupported banner with gray-blue color', () => {
    ToggleBanner('unsupported', true);
    const mainText = document.querySelector('.banner-main-text');
    expect(mainText.textContent).toContain('Host Not Supported');
    expect(mainText.style.backgroundColor).toMatch(/(#6a737d|rgb\(106, 115, 125\))/);
  });

  test('hides banner when Toggle is false', () => {
    ToggleBanner(true, false);
    const banner = document.getElementById('my-banner');
    expect(banner.style.display).toBe('none');
  });

  test('recreates the banner if a SPA wiped it from the DOM', () => {
    // SPA frameworks (e.g. Nuxt on frame.work) replace document.body's children
    // on client-side navigation, destroying the injected banner. A subsequent
    // ToggleBanner call (from bootstrap on the URL change) must self-heal rather
    // than error with "#my-banner not found in DOM."
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    document.body.innerHTML = '';
    expect(document.getElementById('my-banner')).toBeNull();

    ToggleBanner(null, false);

    expect(document.getElementById('my-banner')).not.toBeNull();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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

  test('shows details when provided', () => {
    window.__gp = {
      ...window.__gp,
      formatRepoStatusDetails: () => 'Last activity today',
    };
    ToggleBanner(true, true, { updatedAt: new Date().toISOString() });
    const detailsText = document.querySelector('.banner-details-text');
    expect(detailsText.textContent).toContain('Last activity today');
  });

  test('shows GitPulse grade badge with grade color when grading is enabled', () => {
    global.config.grading_enabled.value = true;
    global.config.banner_display.value = 'badge';

    ToggleBanner(true, true, { score: 82, grade: 'B' }, { score: 82, grade: 'B' });

    const badge = document.querySelector('.gitpulse-grade-badge');
    const mainText = document.querySelector('.banner-main-text');
    expect(badge).not.toBeNull();
    expect(badge.iconSrc).toBe('../icon.png');
    expect(badge.querySelector('img')).not.toBeNull();
    expect(badge.textContent).toBe('Grade B');
    expect(badge.style.borderRadius).toBe('5%');
    expect(badge.style.backgroundColor).toMatch(/(#43a047|rgb\(67, 160, 71\))/);
    expect(mainText.style.backgroundColor).toMatch(/(#43a047|rgb\(67, 160, 71\))/);

    global.config.banner_display.value = 'emoji';
    global.config.grading_enabled.value = false;
  });

  test('does not show a grade badge in emoji-only banner mode', () => {
    global.config.grading_enabled.value = true;
    global.config.banner_display.value = 'emoji';

    ToggleBanner(true, true, { score: 82, grade: 'B' }, { score: 82, grade: 'B' });

    expect(document.querySelector('.gitpulse-grade-badge')).toBeNull();
    expect(document.querySelector('.banner-main-text').textContent).toContain('✅');

    global.config.grading_enabled.value = false;
  });
});

describe('__gp.refreshBanner', () => {
  // Emoji-only config changes should repaint from stored data instead of making
  // another status request. refreshBanner is the hook bootstrap calls for that.
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
