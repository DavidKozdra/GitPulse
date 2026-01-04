# GitPulse CI/CD

This repo uses GitHub Actions to:

- Run lint + tests on every PR (`CI` workflow)
- Build distributable zip artifacts on `main` (`Release` workflow)
- Optionally publish to Chrome Web Store / Firefox AMO when secrets are configured

## Workflows

### 1) CI (`.github/workflows/ci.yml`)

Runs on:

- `pull_request`
- `push` to `main`

What it does:

- `npm run lint` (from `src/`)
- `npm test` (from `src/`)

### 2) Release (`.github/workflows/release.yml`)

Runs on:

- `push` to `main`
- manual run: `workflow_dispatch`

What it does:

1. Lint + test
2. Build extension zips by running `scripts/pack.ps1` (produces `dist/GitPulse-<version>-edge.zip` and `dist/GitPulse-<version>-firefox.zip`)
3. Upload the zips as workflow artifacts
4. **Optionally publish** to stores (Chrome / Firefox)

## When publishing happens

Publishing is attempted only if one of these is true:

- The workflow was started manually (`workflow_dispatch`), or
- The push to `main` changed `manifest.json` or `manifest.firefox.json` (typical version bump)

If the required secrets are missing, publishing is skipped (the build artifacts are still uploaded).

## Required secrets

Configure these in: **GitHub repo → Settings → Secrets and variables → Actions**.

### Chrome Web Store

- `CHROME_EXTENSION_ID` – the extension ID from the Chrome Web Store listing
- `CHROME_CLIENT_ID` – OAuth client ID
- `CHROME_CLIENT_SECRET` – OAuth client secret
- `CHROME_REFRESH_TOKEN` – refresh token for the OAuth client

Notes:

- The release workflow uses `chrome-webstore-upload-cli` via `npx`.
- The OAuth user must have permission to publish the extension.

### Firefox AMO

- `FIREFOX_ADDON_ID` – the add-on UUID (AMO "UUID" / "Addon ID")
- `FIREFOX_JWT_ISSUER` – AMO API key (issuer)
- `FIREFOX_JWT_SECRET` – AMO API secret

Notes:

- The release workflow uses `trmcnvn/firefox-addon@v1`.

## How to generate Chrome OAuth credentials (high level)

1. Create a Google Cloud project.
2. Enable the **Chrome Web Store API**.
3. Create an OAuth Client ID ("Desktop app" or appropriate type) and obtain:
   - Client ID
   - Client secret
4. Generate a refresh token for the OAuth client for an account that can publish the extension.
5. Add the values as GitHub Actions secrets.

(Exact steps can vary depending on Google Cloud UI changes.)

## How to generate Firefox AMO API credentials (high level)

1. In AMO developer hub, generate API credentials.
2. Save the issuer + secret as GitHub Actions secrets.
3. Ensure `FIREFOX_ADDON_ID` matches the add-on UUID.

## Typical release flow

1. Update `manifest.json` (and `manifest.firefox.json` if needed) version.
2. Merge to `main`.
3. The `Release` workflow runs, builds zips, uploads artifacts.
4. If secrets are configured, it also publishes to the stores.

## Manual release

- Go to **Actions → Release → Run workflow**.
- This forces `should_publish=true` regardless of which files changed.
