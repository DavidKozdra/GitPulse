// main.links.js
// Per-page in-memory cache to avoid duplicate lookups during the same session
const __linkStatusCache = new Map(); // key -> status

// Simple concurrency pool for promises
async function runWithConcurrency(tasks, concurrency = 6) {
  const results = [];
  const pool = [];
  for (const task of tasks) {
    const p = Promise.resolve().then(task);
    results.push(p);
    pool.push(p);
    const onFinish = () => pool.splice(pool.indexOf(p), 1);
    p.then(onFinish, onFinish);
    if (pool.length >= concurrency) await Promise.race(pool);
  }
  return Promise.all(results);
}

function dedupeLinks(links) {
  const map = new Map(); // key -> array of elements
  for (const el of links) {
    const href = el.href;
    if (!href) continue;
    if (!isRepoUrl(href)) continue;
    try {
      const u = new URL(href);
      const key = u.hostname + u.pathname;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(el);
    } catch {
      // ignore
    }
  }
  return map;
}

async function processUniqueUrls(map) {
  const tasks = [];
  for (const [key, elements] of map.entries()) {
    if (__linkStatusCache.has(key)) {
      // apply cached status to all elements
      const status = __linkStatusCache.get(key);
      elements.forEach(el => annotateLink(el, status));
      continue;
    }

    tasks.push(async () => {
      const url = elements[0].href;
      let status;
      try {
        const res = await isRepoActive(url);
        status = res;
      } catch (e) {
        console.warn('[link-check] error', e);
        status = false; // fail-closed
      }
      __linkStatusCache.set(key, status);
      elements.forEach(el => annotateLink(el, status));
    });
  }
  await runWithConcurrency(tasks, 6);
}

function annotateLink(link, status) {
  if (link.dataset.repoChecked) return;
  link.dataset.repoChecked = 'true';
  const mark = document.createElement('span');
  mark.textContent =
    status === 'private' ? '🔒 ' :
    status === 'rate_limited' ? '⏳ ' :
    status === true ? (config.emoji_active.active ? `${config.emoji_active.value} ` : '') :
    status === false ? (config.emoji_inactive.active ? `${config.emoji_inactive.value} ` : '') :
    '';
  mark.style.color =
    status === 'private' ? '#555' :
    status === 'rate_limited' ? '#f57c00' :
    status === true ? 'green' :
    'red';
  try { link.prepend(mark); } catch (e) { /* ignore prepend failures */ }
}

// Debounced observer-based entry point
let __debounceTimer = null;
const DEBOUNCE_MS = 250;

async function markRepoLinks() {
  if (__debounceTimer) clearTimeout(__debounceTimer);
  __debounceTimer = setTimeout(async () => {
    __debounceTimer = null;
    // collect links in document and same-origin iframes
    const allLinks = Array.from(document.querySelectorAll('a'));
    // include same-origin iframe links
    const iframes = Array.from(document.querySelectorAll('iframe'));
    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (iframeDoc) allLinks.push(...Array.from(iframeDoc.querySelectorAll('a')));
      } catch {
        // cross-origin
      }
    }

    const map = dedupeLinks(allLinks);
    if (!map.size) return;
    await processUniqueUrls(map);
  }, DEBOUNCE_MS);
}

