# STT token proxy (Cartesia)

Mints short-lived Cartesia `access_token`s with `{ grants: { stt: true } }` so the GitHub Pages SPA never sees `CARTESIA_API_KEY`.

The Pages client calls `VITE_STT_TOKEN_URL` (this Worker or the local stub), then opens:

- `wss://api.cartesia.ai/stt/websocket` (manual finalize)
- `wss://api.cartesia.ai/stt/turns/websocket` (auto turns)

with query params `access_token` + `cartesia_version=2026-08-14`.

## Cloudflare Worker (preferred)

From this directory, with [Wrangler](https://developers.cloudflare.com/workers/wrangler/) installed and authenticated:

```bash
cd token-proxy
npx wrangler secret put CARTESIA_API_KEY
npx wrangler deploy
```

Note the deployed URL, e.g. `https://freightlodge-stt-token.<account>.workers.dev`.

CORS allows `https://johnkidenda.github.io` (and localhost Vite ports). If you serve the app from another origin, add it in `src/mint.js` (`CORS_ORIGINS`).

## Local Node stub

```bash
CARTESIA_API_KEY=sk_car_… node token-proxy/local-stub.mjs
```

Listens on `http://127.0.0.1:8787` by default (`PORT` / `HOST` override).

`npm run dev` can also mint at `/api/stt-token` when `CARTESIA_API_KEY` is in the environment (see repo root `.env`).

## Wire the Pages app

1. Put the Worker URL in the GitHub Actions secret `VITE_STT_TOKEN_URL` (no trailing path required).
2. Redeploy Pages (`main` push or workflow dispatch) so Vite bakes the URL into the bundle.
3. Confirm **Cartesia manual** / **Cartesia auto** no longer show “STT token proxy not configured”.

Web Speech does **not** need this proxy.

## Env (server only)

| Var | Where | Purpose |
| --- | --- | --- |
| `CARTESIA_API_KEY` | Worker secret / local stub / Vite server env | Long-lived Cartesia key. **Never** `VITE_*`. |
| `VITE_STT_TOKEN_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. |

Token TTL is ~90s (clamped 60–120).
