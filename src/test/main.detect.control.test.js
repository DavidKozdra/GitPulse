const { looksLikeGithubRepoUrl, isGithubRepoPageNow, isGithubRepoPrivate } =
  require('../content/main.detect');

describe('looksLikeGithubRepoUrl control tests', () => {
  test('detects GitHub repo URLs with owner and repo', () => {
    expect(looksLikeGithubRepoUrl('https://github.com/octocat/Hello-World')).toBe(true);
  });

  test('rejects GitHub URLs without a repo segment', () => {
    expect(looksLikeGithubRepoUrl('https://github.com/octocat')).toBe(false);
  });

  test('rejects non-GitHub hosts', () => {
    expect(looksLikeGithubRepoUrl('https://gitlab.com/group/project')).toBe(false);
  });
});

describe('isGithubRepoPageNow control tests', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns true when meta repository tag exists', () => {
    document.body.innerHTML =
      '<meta name="octolytics-dimension-repository_nwo" content="octocat/Hello-World">';
    expect(isGithubRepoPageNow()).toBe(true);
  });

  test('returns true when AppHeader context label exists', () => {
    document.body.innerHTML = '<div class="AppHeader-context-item-label">octocat/Hello-World</div>';
    expect(isGithubRepoPageNow()).toBe(true);
  });

  test('returns false when no repo indicators are present', () => {
    document.body.innerHTML = '<div>Just some content</div>';
    expect(isGithubRepoPageNow()).toBe(false);
  });
});

describe('isGithubRepoPrivate control tests', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('detects private label near the repo title', () => {
    document.body.innerHTML = '<span class="Label">Private</span>';
    expect(isGithubRepoPrivate()).toBe(true);
  });

  test('detects private lock icon via aria-label', () => {
    document.body.innerHTML =
      '<svg aria-label="Private"><title>Private</title></svg>';
    expect(isGithubRepoPrivate()).toBe(true);
  });

  test('returns false when no private indicators present', () => {
    document.body.innerHTML = '<span class="Label">Public</span>';
    expect(isGithubRepoPrivate()).toBe(false);
  });
});

