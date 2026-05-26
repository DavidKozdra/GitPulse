const { isRepoUrl } = require('../content/main.helpers');

// Small smoke suite kept alongside the comprehensive URL tests. It covers the
// highest-risk happy and rejected paths so failures are easy to diagnose quickly.
describe('isRepoUrl', () => {
  test('recognizes github repo URL', () => {
    expect(isRepoUrl('https://github.com/octocat/Hello-World')).toBe(true);
  });

  test('rejects non-repo github paths', () => {
    expect(isRepoUrl('https://github.com/explore')).toBe(false);
  });

  test('recognizes npm package URL', () => {
    expect(isRepoUrl('https://www.npmjs.com/package/express')).toBe(true);
  });
});
