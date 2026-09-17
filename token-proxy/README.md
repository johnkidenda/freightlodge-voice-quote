# STT token proxy (Cartesia)

Mints short-lived Cartesia `access_token`s with `{ grants: { stt: true } }` so the GitHub Pages SPA never sees `CARTESIA_API_KEY`.

The Pages client calls `VITE_STT_TOKEN_URL` (this Worker or the local stub), then opens:

- `wss://api.cartesia.ai/stt/websocket` (manual finalize)
- `wss://api.cartesia.ai/stt/turns/websocket` (auto turns)

with query params `access_token` + `cartesia_version=2026-08-14`.

## Anthony — production Worker (workers.dev)

Needs only this directory’s `wrangler.toml` plus the secret name **`CARTESIA_API_KEY`** (value from the box — do not commit it).

```bash
cd token-proxy
npx wrangler login          # once per machine, if needed
npx wrangler secret put CARTESIA_API_KEY
npx wrangler deploy
```

Wrangler prints the URL. Worker name is `freightlodge-stt-token` (`workers_dev = true`).

**Exact Pages build placeholder** (replace `<ACCOUNT>` with the subdomain wrangler printed):

```
VITE_STT_TOKEN_URL=https://freightlodge-stt-token.<ACCOUNT>.workers.dev
```

Then:

1. GitHub → Settings → Secrets and variables → Actions → New repository secret
   - Name: `VITE_STT_TOKEN_URL`
   - Value: the workers.dev URL (no path suffix)
2. After this PR is on `main`, redeploy Pages (push or Actions → **Deploy to GitHub Pages** → Run workflow). The workflow already passes the secret into `npm run build`.

CORS allows `https://johnkidenda.github.io` (and localhost Vite ports). Add other origins in `src/mint.js` (`CORS_ORIGINS`).

## Local Node stub

```bash
CARTESIA_API_KEY= node token-proxy/local-stub.mjs
```

Set the key in the environment only. Listens on `http://127.0.0.1:8787` (`PORT` / `HOST` override).

`npm run dev` also mints at `/api/stt-token` when `CARTESIA_API_KEY` is in the server env — use `VITE_STT_TOKEN_URL=/api/stt-token`.

Web Speech does **not** need this proxy. Cartesia modes fail-soft with “STT token proxy not configured” until the URL is set and Pages is rebuilt.

## Env

| Var | Where | Purpose |
| --- | --- | --- |
| `CARTESIA_API_KEY` | Worker secret / local stub / Vite server env | Long-lived Cartesia key. **Never** `VITE_*`. |
| `VITE_STT_TOKEN_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. |

Token TTL is ~90s (clamped 60–120).
