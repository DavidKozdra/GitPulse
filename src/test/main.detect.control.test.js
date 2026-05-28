const { looksLikeGithubRepoUrl, isGithubRepoPageNow, isGithubRepoPrivate } =
  require('../content/main.detect');

// Detection control tests for GitHub's SPA pages. The bootstrap flow combines
// URL shape with DOM indicators so GitPulse does not show a repository banner
// before GitHub has actually rendered repository UI.
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
  // DOM indicators are redundant on purpose; if GitHub changes one selector, the
  // others can still identify a loaded repository page.
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
  // Private repo detection lets the content script show a local private status
  // instead of making a remote request that would likely fail or be ambiguous.
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('detects private label near the repo title', () => {
    document.body.innerHTML = '<main><h1><span class="Label">Private</span></h1></main>';
    expect(isGithubRepoPrivate()).toBe(true);
  });

  test('detects private lock icon via aria-label', () => {
    document.body.innerHTML =
      '<main><h1><svg aria-label="Private"><title>Private</title></svg></h1></main>';
    expect(isGithubRepoPrivate()).toBe(true);
  });

  test('ignores unrelated private labels outside the repo header', () => {
    document.body.innerHTML =
      '<aside><span class="Label">Private</span></aside><main><div>Repo content</div></main>';
    expect(isGithubRepoPrivate()).toBe(false);
  });

  test('returns false when no private indicators present', () => {
    document.body.innerHTML = '<main><h1><span class="Label">Public</span></h1></main>';
    expect(isGithubRepoPrivate()).toBe(false);
  });
});
