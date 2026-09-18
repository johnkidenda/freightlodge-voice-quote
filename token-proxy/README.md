# Cartesia token + TTS proxy

Mints short-lived Cartesia `access_token`s with `{ grants: { tts: true, stt: true } }` and proxies TTS audio so the GitHub Pages SPA never sees `CARTESIA_API_KEY`.

Mic → text is **Web Speech only**. Cartesia is used for **spoken agent replies** when Conversational mode is on.

The Pages client:

1. Reads `VITE_STT_TOKEN_URL` (this Worker or the local stub)
2. POSTs the agent reply to `{origin}/tts` (or `/api/tts` next to `/api/stt-token`)
3. Plays the returned `audio/mpeg`

Default voice: **Skylar** (`db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`, Friendly Guide). Model `sonic-3`.

Mint (`POST /` or `POST /api/stt-token`) still returns `{ token, expires_in }` for a short-lived access token. Do not put the long-lived key in `VITE_*`.

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

Redeploy this Worker after pulling TTS (`POST /tts`) so spoken replies work on Pages.

## Local Node stub

```bash
CARTESIA_API_KEY= node token-proxy/local-stub.mjs
```

Set the key in the environment only. Listens on `http://127.0.0.1:8787` (`PORT` / `HOST` override).

- `POST /` — mint `{ token, expires_in }`
- `POST /tts` — mp3 for `{ transcript }`

`npm run dev` also serves `/api/stt-token` and `/api/tts` when `CARTESIA_API_KEY` is in the server env — use `VITE_STT_TOKEN_URL=/api/stt-token`.

Web Speech does **not** need this proxy. Conversational mode still rewrites reply copy if the URL is unset; TTS stays silent.

## Env

| Var | Where | Purpose |
| --- | --- | --- |
| `CARTESIA_API_KEY` | Worker secret / local stub / Vite server env | Long-lived Cartesia key. **Never** `VITE_*`. |
| `VITE_STT_TOKEN_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. |

Token TTL is ~90s (clamped 60–120).
