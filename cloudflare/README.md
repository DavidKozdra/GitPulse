# GitPulse status Worker (Cloudflare)

Replaces the Supabase `quick-responder` edge function. Same request/response
contract, but Cloudflare Workers never auto-pause (the free-tier Supabase pause
was the source of the intermittent `Check failed: Failed to fetch` banner).

## What it does

`POST /` with `{ owner, repo, rules }` → `{ status, details }` for a public
GitHub repo, using a server-side GitHub token so end users don't need a PAT.

## Deploy

```sh
cd cloudflare
npm i -g wrangler            # or: npx wrangler ...
wrangler login

# Provision the server-side GitHub token (fine-grained PAT, public repos, read-only).
wrangler secret put GITHUB_TOKEN

wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://gitpulse-status.<your-subdomain>.workers.dev`.

## Point the extension at it

In `src/background.js`, set:

```js
const CLOUDFLARE_GITHUB_STATUS_URL = "https://gitpulse-status.<your-subdomain>.workers.dev";
```

The extension tries Cloudflare first, then falls back to Supabase, then to the
public unauthenticated GitHub API — so nothing breaks during cutover.

## Rate limiting

`wrangler.toml` configures a per-IP rate limit (30 req / 60s) via Cloudflare's
Rate Limiting binding, so the shared GitHub token can't be drained. When it
trips, the Worker returns `{ status: "rate_limited" }` and the extension shows
its normal rate-limit banner.

## Local test

```sh
wrangler dev
# then, from another shell:
curl -s -X POST http://localhost:8787 \
  -H 'content-type: application/json' \
  -H 'origin: chrome-extension://test' \
  -d '{"owner":"DavidKozdra","repo":"GitPulse","rules":{"max_repo_update_time":365}}'
```
