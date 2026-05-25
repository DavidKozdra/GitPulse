const { isRepoUrl, getActiveConfigMetrics } = require('../content/main.helpers');

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

describe('isRepoActive control tests', () => {
  const { isRepoActive } = require('../content/main.helpers');

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

  test('fails closed (false) when background responds with ok=false', async () => {
    const sendMessage = jest.fn(() =>
      Promise.resolve({ ok: false, error: 'something went wrong' })
    );
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World');
    expect(result).toBe(false);
  });

  test('fails closed (false) when background returns no response object', async () => {
    const sendMessage = jest.fn(() => Promise.resolve(null));
    global.ext = { sendMessage };

    const result = await isRepoActive('https://github.com/octocat/Hello-World');
    expect(result).toBe(false);
  });
}
);

