// Standalone Playwright e2e for the GitPulse banner.
//
// This loads the UNPACKED extension into a real Chromium and drives the banner
// on a stubbed github.com repo page. It does NOT hit the live network: every
// request the service worker makes (Cloudflare / api.github.com) is
// intercepted, so the two banner states are deterministic:
//
//   1. Healthy API response      -> banner shows "Active"
//   2. Simulated network failure -> banner shows the exact
//      "Check failed: TypeError: Failed to fetch" text you saw in the wild.
//
// Why navigate to a real github.com URL? The content script only checks a repo
// when isRepoUrl(location.href) is true, and that requires a github.com URL. We
// intercept the page load too, so the URL is real but the HTML is a stub.
//
// Run:
//   cd src && npm i -D @playwright/test && npx playwright install chromium
//   node e2e/banner.e2e.mjs
//
// MV3 service workers need a headed (or new-headless) Chromium; this uses headed
// via a persistent context, which is the reliable configuration.

import { chromium } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '..', '..'); // repo root (manifest.json lives here)
const REPO_URL = 'https://github.com/DavidKozdra/GitPulse';

// Minimal valid HTML for the stubbed repo page. The banner injects into <body>.
// bootstrap() gates the github.com repo banner on isGithubRepoPageNow(), which
// looks for a real GitHub repo DOM marker — the octolytics meta tag is the most
// reliable one — so include it or bootstrap decides "not a repo" and hides.
const STUB_PAGE = `<!doctype html><html><head><title>stub repo</title>` +
  `<meta name="octolytics-dimension-repository_nwo" content="DavidKozdra/GitPulse">` +
  `</head><body><h1>stub repo page</h1></body></html>`;

// A healthy GitHub REST payload shaped like what fetchGithubRepoStatus reads.
const HEALTHY_GITHUB_REPO = {
  archived: false,
  pushed_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  open_issues_count: 1,
};

// Fulfill a route with JSON AND permissive CORS headers. Without these, a
// service-worker fetch to a cross-origin URL rejects the mocked response as
// net::ERR_FAILED (opaque/CORS), which itself looks like "Failed to fetch".
function fulfillJson(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': '*',
    },
    body: JSON.stringify(body),
  });
}

let failed = false;
function check(name, cond, extra = '') {
  const mark = cond ? '✅' : '❌';
  if (!cond) failed = true;
  console.log(`${mark} ${name}${extra ? ' — ' + extra : ''}`);
}

async function getBannerText(page) {
  // The banner element is created on script load, but its text fills in only
  // after bootstrap's async round-trip to the service worker. Poll the rendered
  // state until the main text is non-empty (or time out).
  const banner = page.locator('#my-banner');
  await banner.waitFor({ state: 'attached', timeout: 8000 });

  const deadline = Date.now() + 12000;
  let state = { main: '', details: '', display: '', status: '' };
  while (Date.now() < deadline) {
    state = await page.evaluate(() => {
      const b = document.getElementById('my-banner');
      if (!b) return { main: '', details: '', display: 'no-banner', status: '' };
      const q = (sel) => (b.querySelector(sel)?.textContent || '').trim();
      return {
        main: q('.banner-main-text'),
        details: q('.banner-details-text'),
        display: b.style.display,
        status: b.dataset.gitpulseStatus || '',
      };
    });
    if (state.main) break;
    await page.waitForTimeout(300);
  }
  console.log(`  [banner-state] display=${state.display} status=${state.status}`);
  return state;
}

async function runScenario({ label, routeHandler }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpulse-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 SW needs headed/new-headless
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });

  try {
    // Intercept everything the extension might reach out to. routeHandler decides
    // per-scenario whether a given API call succeeds or "fails to fetch".
    await context.route('**/*', async (route) => {
      const url = route.request().url();

      // Serve the stub HTML for the repo page itself.
      if (url === REPO_URL || url === REPO_URL + '/') {
        return route.fulfill({ contentType: 'text/html', body: STUB_PAGE });
      }

      // API endpoints the SW hits -> defer to the scenario.
      const isApi =
        url.includes('api.github.com') ||
        url.includes('/api/'); // codeberg etc., harmless here
      if (isApi) {
        const method = route.request().method();
        // Answer CORS preflight so the real POST/GET is allowed to proceed.
        if (method === 'OPTIONS') {
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
              'access-control-allow-methods': '*',
            },
          });
        }
        return routeHandler(route, url);
      }

      // Everything else (favicons, etc.) -> just fail quietly, page doesn't need it.
      return route.abort();
    });

    const page = await context.newPage();
    // Uncomment to debug what bootstrap / the service worker decided:
    // context.on('console', (m) => console.log(`  [sw] ${m.text()}`));
    // page.on('console', (m) => console.log(`  [page] ${m.text()}`));
    await page.goto(REPO_URL, { waitUntil: 'domcontentloaded' });
    const text = await getBannerText(page);
    console.log(`\n[${label}] banner main:    "${text.main}"`);
    console.log(`[${label}] banner details: "${text.details}"`);
    return text;
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('=== Scenario 1: healthy API -> expect Active ===');
  const healthy = await runScenario({
    label: 'healthy',
    routeHandler: (route, url) => {
      return fulfillJson(route, HEALTHY_GITHUB_REPO);
    },
  });
  check(
    'healthy page shows an Active banner',
    /active/i.test(healthy.main) && !/InActive/i.test(healthy.main),
    `got "${healthy.main}"`
  );
  check('healthy page has no "Check failed"', !/Check failed/i.test(healthy.details), `details="${healthy.details}"`);

  console.log('\n=== Scenario 2: network failure -> expect "Check failed: Failed to fetch" ===');
  const broken = await runScenario({
    label: 'broken',
    routeHandler: (route) => route.abort('failed'), // -> TypeError: Failed to fetch in the SW
  });
  check(
    'broken network shows InActive banner',
    /InActive/i.test(broken.main),
    `got "${broken.main}"`
  );
  check(
    'broken network surfaces the exact "Check failed: ...Failed to fetch" text',
    /Check failed:.*Failed to fetch/i.test(broken.details),
    `details="${broken.details}"`
  );

  console.log('\n=== Scenario 3: Cloudflare DOWN but GitHub reachable -> expect Active (fallback) ===');
  const fallback = await runScenario({
    label: 'fallback',
    routeHandler: (route, url) => {
      // Simulate the hosted backend being unreachable; GitHub's public API
      // answers, so the fallback path must recover.
      if (url.includes('workers.dev')) return route.abort('failed');
      return fulfillJson(route, HEALTHY_GITHUB_REPO);
    },
  });
  check(
    'Cloudflare-down still shows an Active banner via the GitHub fallback',
    /active/i.test(fallback.main) && !/InActive/i.test(fallback.main),
    `got "${fallback.main}"`
  );
  check(
    'Cloudflare-down does NOT show "Check failed"',
    !/Check failed/i.test(fallback.details),
    `details="${fallback.details}"`
  );

  console.log('\n' + (failed ? '❌ FAIL — one or more checks failed' : '✅ PASS — all checks passed'));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('e2e crashed:', err);
  process.exit(2);
});
