## Copilot instructions for GitPulse (concise)

Keep edits minimal and preserve existing runtime behavior unless a change is explicitly requested.

- Project type: Chrome extension (Manifest V3). Key files:
  - `src/manifest.json` (permissions, content_scripts order), `src/background.js` (MV3 service worker), `src/main.js` (content script), `src/config.js` + `src/popup.js`/`src/popup.html` (settings UI).

- Core flow (high level):
  - `main.js` runs in pages (injected after `config.js`). It detects repo pages vs link lists. For repo pages it injects a banner; otherwise it scans links and prefixes emoji.
  - `main.js` queries `background.js` via chrome.runtime.sendMessage(action: `fetchRepoStatus`, url) for status.
  - `background.js` loads active rules from `repoCheckerConfig`, reads/writes cache keys prefixed with `repoCache:`, calls provider APIs (GitHub) and returns status: `true | false | "rate_limited" | "private`.

- Project conventions to follow:
  - Messaging actions supported: `fetchRepoStatus`, `getConfig`, `setConfig`, `setPAT`, `clearCache`, `getCache`, `setCache`, `ping` (see `background.js` switch).
  - Storage keys: use `repoCheckerConfig` for rules and `githubPAT` for the GitHub token. Cache entries are stored with `repoCache:` prefix.
  - Fail-closed: `main.js` treats missing/errored background responses as inactive (`false`). Preserve this behavior unless UX is updated.
  - Rate-limited responses use the string `"rate_limited"` and are cached with a shorter TTL (`RATE_TTL_MS`).

- How to add a new host (example):
  - Add a case in `fetchRepoStatusByUrl()` inside `src/background.js` that parses the URL and delegates to a `fetchXRepoStatus` function mirroring `fetchGithubRepoStatus`.
  - Return shape: `{ status: true|false|"rate_limited"|"private", details? }` and write via `writeCache(key, value)`.

- Quick dev/debug steps:
  1. Load unpacked extension: chrome://extensions -> Developer mode -> Load unpacked -> choose repo root.
  2. Inspect the background service worker (click "service worker" on the extension card) and look for: "GitPulse SW started".
  3. Test from page console:
     - chrome.runtime.sendMessage({action:'fetchRepoStatus', url:'https://github.com/octocat/Hello-World'}, r => console.log(r));

- Files to edit for common tasks:
  - UI/config: `src/popup.js`, `src/popup.html`, `src/style.css` (forms are generated from `defaultConfig` in `src/config.js`).
  - Rules/metrics: edit `defaultConfig` in `src/config.js` and update `loadActiveRules()` in `src/background.js` if keys change.

If you want this shortened further, or expanded with concrete code snippets (e.g., a GitLab fetcher scaffold), tell me which and I will add it.
  - UI / config: `src/popup.js`, `src/popup.html`, `src/style.css` (popup form keys are generated dynamically from the `defaultConfig` shape in `src/config.js`).
