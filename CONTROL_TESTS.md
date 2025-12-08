# GitPulse Control Tests & Cheat Sheet

This file is a quick testing guide for GitPulse. It covers:

- The automated “control tests” (Jest unit tests) that exercise key functions.
- Manual control checks you can run in Chrome/Edge/Firefox to verify end‑to‑end behavior.

---

## 1. Running the automated control tests

All source and tests live under `src/`. From the project root:

```bash
cd src
npm install        # one time
npm test           # run the full Jest suite
```

You can also run in watch mode:

```bash
cd src
npm test -- --watch
```

Jest is configured by `src/jest.config.cjs` and currently discovers tests in `src/test/**/*.test.js`.

---

## 2. What the control tests cover

Current automated tests live in `src/test/`:

- `isRepoUrl.test.js`  
  - Baseline coverage for `isRepoUrl` URL classification.

- `main.helpers.control.test.js`  
  - Verifies that `isRepoUrl` accepts/rejects key URLs (GitHub, npm, non‑repo).
  - Verifies `getActiveConfigMetrics` only returns active config entries and their values.
  - Verifies `isRepoActive`:
    - Calls the background script via `ext.sendMessage({ action: "fetchRepoStatus", url })`.
    - Returns the `status` when the background responds with `ok: true`.
    - “Fails closed” (returns `false`) when the background sends `ok: false` or no response.

- `main.detect.control.test.js`  
  - Verifies `looksLikeGithubRepoUrl` only accepts GitHub URLs with `owner/repo`.
  - Verifies `isGithubRepoPageNow` detects:
    - The GitHub repo meta tag.
    - The `AppHeader-context-item-label` repo label.
  - Verifies `isGithubRepoPrivate` detects:
    - A “Private” label near the title.
    - The “Private” lock icon.

Use `npm test` after changes to quickly sanity‑check these core behaviors.

---

## 3. Manual control tests (browser checklist)

These checks exercise the full extension in a real browser environment.

### 3.1 Install / reload

- Load the unpacked extension from the GitPulse folder (`chrome://extensions` → **Load unpacked**).
- Confirm the extension icon appears and the background script logs show “GitPulse SW started”.
- Make a simple code change, reload the extension, and confirm nothing breaks.

### 3.2 Popup & configuration

- Click the GitPulse icon to open the popup.
- In the popup:
  - Confirm all config fields render as expected (labels, checkboxes, numeric/text inputs).
  - Toggle a few `active` switches and change values; close the popup.
  - Re‑open the popup and confirm your changes persist (stored in `repoCheckerConfig`).

### 3.3 Personal Access Token (PAT) flow

- In the popup, set a fake PAT.
- Confirm:
  - The value is saved and re‑loaded when you reopen the popup.
  - The background script sees the value (no console errors when checking repos).
- Clear/blank the PAT:
  - Confirm the extension falls back to the Supabase endpoint (no crashes, banner still works).

### 3.4 GitHub repo banner

- Navigate to a known **active** GitHub repository.
  - Confirm the banner appears at the top of the page.
  - Confirm the banner message and emoji match your “active” configuration.
  - Click the “According to your Configuration” link and confirm it opens the popup/settings.

- Navigate to a known **archived or inactive** repository.
  - Confirm the banner appears with the inactive styling and emoji.
  - Confirm any “Inactive” copy matches your expectations.

### 3.5 Private and rate‑limited states

- Private repo:
  - Open a private repo (if you have one available).
  - Confirm the banner shows the “Private Repository” message and appropriate emoji.

- Rate‑limited:
  - Temporarily remove your PAT (or use an account likely to hit rate limits).
  - Visit a lot of repositories quickly.
  - Confirm the banner shows the “Rate limit hit / add PAT” message when rate‑limited.

### 3.6 Link markers on lists/search pages

- On GitHub:
  - Open a search results page or a list of repositories.
  - Confirm each repo link gets a small emoji marker prepended.
    - Active repos get the “active” emoji and green color.
    - Inactive repos get the “inactive” emoji and red color.
    - Private/rate‑limited cases use the private / rate‑limited emojis and colors.
  - Hover over an icon and confirm the tooltip (“Active repository”, “Inactive repository”, etc.) is correct.

- Confirm performance:
  - On a page with many links, scroll around and ensure the UI remains responsive.

### 3.7 Multi‑host behavior

- Open a repo on **Codeberg**.
  - Confirm banner/link behavior works (repo considered active/inactive based on `updated_at`).
- Optionally check other hosts that `isRepoUrl` recognizes (npm, Docker Hub, PyPI, etc.):
  - Confirm links are marked only when they represent actual packages/repos.

### 3.8 Cache behavior

- Visit a repo page once.
  - Refresh the page and confirm subsequent checks are fast (cache hits in background logs).
- Change configuration thresholds in the popup.
  - Use the “clear cache” control if available.
  - Refresh the repo page and confirm the banner/markers update according to the new rules.

---

## 4. Quick reference (cheat sheet)

- **Run all control tests (automated)**  
  - `cd src && npm test`

- **Files with key behaviors**  
  - URL & config helpers: `src/content/main.helpers.js`  
  - Repo page detection: `src/content/main.detect.js`  
  - Link markers: `src/content/main.links.js`  
  - Banner rendering: `src/content/main.banner.js`  
  - Background logic & caching: `src/background.js`  
  - Popup UI & storage: `src/popup.js`

- **When adding new rules/hosts**  
  - Update helpers/logic in `src/content/main.helpers.js` and `src/background.js`.
  - Add or extend tests under `src/test/` to cover:
    - URL detection.
    - New config fields in `getActiveConfigMetrics`.
    - Any new status values (e.g., additional host‑specific states).

Use this document as a quick checklist whenever you change behavior or add new hosts/metrics.

