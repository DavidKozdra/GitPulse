// main.links.js
// Per-page in-memory cache to avoid duplicate lookups during the same session
const __linkStatusCache = new Map(); // key -> status
let __configChangeListenerAttached = false;

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
  // Allow re-annotation after config toggle changes: clear any prior marks
  link.dataset.repoChecked = 'true';

  // Remove prior marks (new class plus legacy spans that used emoji text)
  const knownEmojis = new Set([
    config?.emoji_private?.value,
    config?.emoji_rate_limited?.value,
    config?.emoji_active?.value,
    config?.emoji_inactive?.value,
    'dY"\'', 'ƒ?3', 'ƒo.', 'ƒ?O'
  ].filter(Boolean));
  link.querySelectorAll('span').forEach(node => {
    const text = (node.textContent || '').trim();
    if (node.classList.contains('repo-checker-mark') || knownEmojis.has(text)) {
      node.remove();
    }
  });

  const getEmoji = (field, fallback) => {
    const disabled = !field || field.active === false || field.active === 'false';
    if (disabled) return '';
    return field.value || fallback;
  };

  const emojiPrivate = getEmoji(config.emoji_private, '🔒');
  const emojiRate = getEmoji(config.emoji_rate_limited, '⏳');
  const emojiActive = getEmoji(config.emoji_active, '✅');
  const emojiInactive = getEmoji(config.emoji_inactive, '❌');

  const icon =
    status === 'private' ? emojiPrivate :
    status === 'rate_limited' ? emojiRate :
    status === true ? emojiActive :
    status === false ? emojiInactive : '';

  if (!icon) return;

  const mark = document.createElement('span');
  mark.className = 'repo-checker-mark';
  mark.textContent = icon ? `${icon} ` : '';
  mark.style.color =
    status === 'private' ? '#555' :
    status === 'rate_limited' ? '#f57c00' :
    status === true ? 'green' :
    'red';
  mark.style.marginRight = '4px';
  mark.setAttribute('aria-hidden', 'true');
  if (status === true) mark.title = 'Active repository';
  else if (status === false) mark.title = 'Inactive repository';
  else if (status === 'private') mark.title = 'Private repository';
  else if (status === 'rate_limited') mark.title = 'Rate limited';
  try { link.prepend(mark); } catch (e) { /* ignore prepend failures */ }
}

// Debounced observer-based entry point
let __debounceTimer = null;
const DEBOUNCE_MS = 250;

async function markRepoLinks() {
  // One-time attach storage listener to refresh annotations when config changes
  if (!__configChangeListenerAttached && ext?.storage?.onChanged) {
    try {
      ext.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes?.repoCheckerConfig) {
          __linkStatusCache.clear(); // force fresh statuses
          markRepoLinks();           // re-run with new emoji toggles
        }
      });
      __configChangeListenerAttached = true;
    } catch (_) {
      // best-effort; continue without listener
    }
  }

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

// Export helpers for tests (ignored in the browser)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    annotateLink,
    dedupeLinks,
    processUniqueUrls,
    runWithConcurrency,
    markRepoLinks,
  };
}
