const { annotateLink } = require('../content/main.links');

describe('annotateLink emoji toggles', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('does not render an emoji when the config field is inactive', () => {
    global.config = {
      emoji_private: { active: false, value: '🔒' },
      emoji_rate_limited: { active: true, value: '⏳' },
      emoji_active: { active: true, value: '✅' },
      emoji_inactive: { active: false, value: '❌' },
    };

    const link = document.createElement('a');
    annotateLink(link, false);

    expect(link.querySelector('span')).toBeNull();
    expect(link.dataset.repoChecked).toBe('true');
  });

  test('renders the configured emoji when active', () => {
    global.config = {
      emoji_private: { active: true, value: '🔒' },
      emoji_rate_limited: { active: true, value: '⏳' },
      emoji_active: { active: true, value: '✅' },
      emoji_inactive: { active: true, value: '❌' },
    };

    const link = document.createElement('a');
    annotateLink(link, false);

    const mark = link.querySelector('span');
    expect(mark).not.toBeNull();
    expect(mark.textContent.trim()).toBe('❌');
  });
});
