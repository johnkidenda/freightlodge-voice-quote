# Freight Lodge API proxy (Jev + email)

Cloudflare Worker / local Node stub that proxies **Jev** (TypeSafe System One) and Hostinger **SMTP email** so the GitHub Pages SPA never sees `TYPESAFE_API_KEY` or `SMTP_PASS`.

Mic → text is **Web Speech only**. Spoken agent replies use browser `speechSynthesis`. This proxy does not mint STT tokens or serve TTS audio.

## What the SPA calls

1. Reads `VITE_API_BASE_URL` (this Worker or the local stub / Vite `/api`)
2. POSTs to `{base}/jev` after each utterance
3. POSTs to `{base}/email/verify/*` and `{base}/email/quote` for email flows

## Deploy (Cloudflare Worker)

Needs this directory’s `wrangler.toml` plus secrets **`TYPESAFE_API_KEY`** and SMTP fields (values from the box — do not commit them).

```bash
cd token-proxy
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put SMTP_PASS
npx wrangler secret put SMTP_HOST    # optional
npx wrangler secret put SMTP_PORT    # optional (465)
npx wrangler secret put SMTP_USER
npx wrangler secret put MAIL_FROM
npx wrangler deploy
```

Wrangler prints the URL. Worker name is `freightlodge-stt-token` (`workers_dev = true`).

Point the Pages build at it:

```bash
VITE_API_BASE_URL=https://freightlodge-stt-token.<SUBDOMAIN>.workers.dev
```

GitHub Actions: repository secret

- Name: `VITE_API_BASE_URL`
- Value: the `workers.dev` URL above (no trailing slash)

CORS allows `https://johnkidenda.github.io` and any `http://localhost:*` / `http://127.0.0.1:*`. Other origins get no `Access-Control-Allow-Origin`. Logic lives in `src/cors.js`.

## Local stub

```bash
TYPESAFE_API_KEY= SMTP_PASS= node token-proxy/local-stub.mjs
```

Set keys in the environment only. Listens on `http://127.0.0.1:8787` (`PORT` / `HOST` override).

- `GET /` — health `{ ok, service, jev, email }`
- `POST /jev` — utterance parse
- `POST /jev-action` — DOM action helper for the Exfresso pilot
- `POST /email/verify/start` / `confirm` / `POST /email/quote` (body may include `html?`)

Email routes need `SMTP_PASS` (or `EMAIL_VERIFY_DEV_MODE=1` in local/test). The Worker sends via `cloudflare:sockets` TLS SMTP on port 465. Challenge storage is in-memory (per isolate).

`/jev` and `/jev-action` work when `TYPESAFE_API_KEY` is set. Missing key → `503 { jev: "off" }`; the voice SPA falls back to heuristics.

`npm run dev` also serves `/api/jev`, `/api/jev-action`, `/api/email/verify/start`, `/api/email/verify/confirm`, and `/api/email-quote` from the server env — use `VITE_API_BASE_URL=/api`.

### Smoke

```bash
curl -sS -X POST "${VITE_API_BASE_URL:-http://127.0.0.1:8787}/jev" \
  -H 'content-type: application/json' \
  -H 'origin: https://johnkidenda.github.io' \
  -d '{"utterance":"five pallets from 78721 to 30303","sheet":{}}'
```

```bash
curl -sS -X POST "${VITE_API_BASE_URL:-http://127.0.0.1:8787}/jev-action" \
  -H 'content-type: application/json' \
  -d '{"candidates":[]}'
```

## Env reference

| Name | Where | Notes |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Worker secret / local stub / Vite server env | TypeSafe key. **Never** `VITE_*`. |
| `SMTP_PASS` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `MAIL_FROM` | Worker secrets / stub | Hostinger SMTP. **Never** `VITE_*`. |
| `VITE_API_BASE_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. Client calls `{base}/jev` and `{base}/email/verify/*`. |
| `EMAIL_VERIFY_DEV_MODE` | Local/test only | Skip SMTP; log code server-side. |
