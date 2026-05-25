const { isRepoUrl } = require('../content/main.helpers');

describe('isRepoUrl comprehensive tests', () => {
  describe('GitHub', () => {
    test('recognizes standard repo URL', () => {
      expect(isRepoUrl('https://github.com/octocat/Hello-World')).toBe(true);
    });

    test('recognizes repo with subpaths', () => {
      expect(isRepoUrl('https://github.com/octocat/Hello-World/tree/main')).toBe(true);
    });

    test('rejects user profile page', () => {
      expect(isRepoUrl('https://github.com/octocat')).toBe(false);
    });

    test('rejects reserved paths', () => {
      const reserved = [
        'explore', 'features', 'issues', 'pulls', 'marketplace',
        'settings', 'login', 'signup', 'notifications', 'trending',
      ];
      reserved.forEach(path => {
        expect(isRepoUrl(`https://github.com/${path}/something`)).toBe(false);
      });
    });

    test('rejects github.com root', () => {
      expect(isRepoUrl('https://github.com')).toBe(false);
      expect(isRepoUrl('https://github.com/')).toBe(false);
    });
  });

  describe('GitLab', () => {
    test('recognizes standard repo URL', () => {
      expect(isRepoUrl('https://gitlab.com/group/project')).toBe(true);
    });

    test('rejects reserved paths', () => {
      expect(isRepoUrl('https://gitlab.com/explore/projects')).toBe(false);
    });
  });

  describe('Codeberg', () => {
    test('recognizes standard repo URL', () => {
      expect(isRepoUrl('https://codeberg.org/owner/repo')).toBe(true);
    });
  });

  describe('Bitbucket', () => {
    test('recognizes standard repo URL', () => {
      expect(isRepoUrl('https://bitbucket.org/workspace/repo')).toBe(true);
    });
  });

  describe('Sourcehut', () => {
    test('recognizes tilde-prefixed user repos', () => {
      expect(isRepoUrl('https://git.sr.ht/~user/repo')).toBe(true);
    });
  });

  describe('Package registries', () => {
    test('npm: recognizes package URL', () => {
      expect(isRepoUrl('https://www.npmjs.com/package/express')).toBe(true);
    });

    test('npm: rejects non-package pages', () => {
      expect(isRepoUrl('https://www.npmjs.com/search?q=test')).toBe(false);
    });

    test('Docker Hub: recognizes image URL', () => {
      expect(isRepoUrl('https://hub.docker.com/r/library/nginx')).toBe(true);
    });

    test('PyPI: recognizes project URL', () => {
      expect(isRepoUrl('https://pypi.org/project/requests')).toBe(true);
    });

    test('Crates.io: recognizes crate URL', () => {
      expect(isRepoUrl('https://crates.io/crates/serde')).toBe(true);
    });

    test('Packagist: recognizes package URL', () => {
      expect(isRepoUrl('https://packagist.org/packages/laravel/framework')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('returns false for invalid URLs', () => {
      expect(isRepoUrl('not a url')).toBe(false);
      expect(isRepoUrl('')).toBe(false);
    });

    test('returns false for unknown hosts', () => {
      expect(isRepoUrl('https://example.com/foo/bar')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isRepoUrl(null)).toBe(false);
      expect(isRepoUrl(undefined)).toBe(false);
    });
  });
});
