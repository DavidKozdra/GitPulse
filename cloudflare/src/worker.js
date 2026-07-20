// GitPulse status Worker — hosted GitHub status backend.
//
// Contract:
//   POST /            body: { owner, repo, rules }
//   200               { status, details: {...} }        // normal result
//   200               { status: "rate_limited" }        // GitHub throttled us
//   4xx/5xx           { error }                          // client sees a failure
//
// Why Cloudflare: Workers never auto-pause, have ~0ms cold starts, and give
// 100k requests/day free. The server-side GitHub
// token lives in `env.GITHUB_TOKEN` (a Worker secret) so end users never need a
// PAT and the token is never shipped in the extension.
//
// Abuse control: the extension's token can do 5000 GitHub req/hr, so this Worker
// MUST rate-limit per client or a third party could drain it. We use a
// Cloudflare Rate Limiting binding (env.RATE_LIMITER) keyed by client IP, and
// fail closed to "rate_limited" when the binding trips.

const GITHUB_API = "https://api.github.com";

// Only allow the extension's own origins to call this, so it can't be used as an
// open GitHub proxy. Extension requests send an Origin like chrome-extension://…
// (Chrome) or moz-extension://… (Firefox); non-extension callers are rejected.
const ALLOWED_ORIGIN_SCHEMES = ["chrome-extension://", "moz-extension://"];

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // The service worker fetch is cross-origin; allow it explicitly.
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      ...extraHeaders,
    },
  });
}

// Basic path/segment validation mirrors the extension's validateSegment so the
// Worker never interpolates a traversal or wildcard into a GitHub URL.
function validSegment(s) {
  return typeof s === "string" && /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..";
}

function withinDays(dateStr, maxDays) {
  if (!Number.isFinite(maxDays)) return true;
  if (!dateStr) return false;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return false;
  return (Date.now() - t) / 86400000 <= maxDays;
}

async function githubJson(path, token) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "GitPulse-Worker",
      ...(token ? { Authorization: `token ${token}` } : {}),
    },
  });
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const rateLimited =
    res.status === 429 ||
    res.status === 403 ||
    (Number.isFinite(remaining) && remaining === 0);
  return { res, remaining, rateLimited };
}

// Compute repo status. Kept deliberately close to the extension's
// fetchGithubRepoStatus so `details` line up and the banner text is unchanged.
async function computeStatus(owner, repo, rules, token) {
  const { res, rateLimited } = await githubJson(`/repos/${owner}/${repo}`, token);
  if (rateLimited) return { status: "rate_limited" };
  if (res.status === 404 || res.status === 401) return { status: "private" };
  if (!res.ok) throw new Error(`GitHub repo API failed: ${res.status}`);

  const data = await res.json();
  const isArchived = !!data.archived;
  const pushedAt = data.pushed_at || data.updated_at || null;
  const pushOk = !isArchived && withinDays(pushedAt, rules?.max_repo_update_time);

  const details = {
    host: "github.com",
    isArchived,
    pushedAt,
    updatedAt: data.updated_at || null,
    pushOk,
    openPrCount: Number.isFinite(data.open_issues_count) ? data.open_issues_count : null,
  };

  // Binary status: archived or stale pushes => inactive. Secondary signals (PR
  // counts, releases) are intentionally left to the extension's richer checks or
  // to the user configuring a PAT; the Worker keeps one cheap call to protect
  // the shared rate limit.
  const status = !isArchived && pushOk;
  return { status, details };
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip") || "anon";
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return json({}, 204);
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    // Reject anything that isn't one of our extension builds.
    const origin = request.headers.get("origin") || "";
    const originOk = ALLOWED_ORIGIN_SCHEMES.some((s) => origin.startsWith(s));
    if (!originOk) return json({ error: "origin not allowed" }, 403);

    // Per-IP rate limit so a caller cannot drain the shared GitHub token.
    if (env.RATE_LIMITER?.limit) {
      const { success } = await env.RATE_LIMITER.limit({ key: clientKey(request) });
      if (!success) return json({ status: "rate_limited" }, 200);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const { owner, repo, rules } = payload || {};
    if (!validSegment(owner) || !validSegment(repo)) {
      return json({ error: "invalid owner/repo" }, 400);
    }

    try {
      const result = await computeStatus(owner, repo, rules || {}, env.GITHUB_TOKEN);
      return json(result, 200);
    } catch (err) {
      return json({ error: String(err?.message || err) }, 502);
    }
  },
};
