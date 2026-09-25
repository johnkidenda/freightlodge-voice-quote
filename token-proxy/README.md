# Freight Lodge API proxy (Jev + email)

Cloudflare Worker / local Node stub that proxies **Jev** (TypeSafe System One) and **Resend email** so the GitHub Pages SPA never sees `TYPESAFE_API_KEY` or `RESEND_API_KEY`.

Mic → text is **Web Speech only**. Spoken agent replies use browser `speechSynthesis`. This proxy does not mint STT tokens or serve TTS audio.

## What the quote app calls

1. Reads `VITE_API_BASE_URL` (this Worker or the local stub / Vite `/api`)
2. POSTs to `{base}/email/verify/*` and `{base}/email/quote` for email flows

The quote app does not call `/jev`. `POST /jev` and `POST /jev-action` are still on this Worker. The Exfresso pilot uses `/jev-action`.

## Deploy (Cloudflare Worker)

Needs this directory’s `wrangler.toml` plus secrets **`TYPESAFE_API_KEY`** and **`RESEND_API_KEY`** (values from the box, do not commit them). `MAIL_FROM` is optional.

Live Worker: `https://freightlodge-stt-token.johnkidenda.workers.dev`.

Verify domain `freightlodge.com` in Resend before mail will send: DKIM TXT `resend._domainkey`, plus MX and SPF TXT on the `send` subdomain.

```bash
cd token-proxy
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MAIL_FROM    # optional
npx wrangler deploy
```

Worker name is `freightlodge-stt-token`. Live URL:

```bash
VITE_API_BASE_URL=https://freightlodge-stt-token.johnkidenda.workers.dev
```

GitHub Actions: repository secret

- Name: `VITE_API_BASE_URL`
- Value: `https://freightlodge-stt-token.johnkidenda.workers.dev` (no trailing slash). The Pages workflow uses this URL when the secret is unset.

CORS allows `https://johnkidenda.github.io` and any `http://localhost:*` / `http://127.0.0.1:*`. Other origins get no `Access-Control-Allow-Origin`. Logic lives in `src/cors.js`.

## Local stub

```bash
TYPESAFE_API_KEY= RESEND_API_KEY= node token-proxy/local-stub.mjs
```

Set keys in the environment only. Listens on `http://127.0.0.1:8787` (`PORT` / `HOST` override).

- `GET /` — health `{ ok, service, jev, email }`
- `POST /jev` — utterance parse
- `POST /jev-action` — DOM action helper for the Exfresso pilot
- `POST /email/verify/start` / `confirm` / `POST /email/quote` (body may include `html?`)

Email routes need `RESEND_API_KEY` (or `EMAIL_VERIFY_DEV_MODE=1` in local/test). The Worker POSTs to `https://api.resend.com/emails`. Default From is `Freight Lodge <john@freightlodge.com>` unless `MAIL_FROM` is set. Challenge storage is in-memory (per isolate).

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
| `RESEND_API_KEY` | Worker secret / local stub / Vite server env | Resend key. **Never** `VITE_*`. |
| `MAIL_FROM` | Worker secret / stub, optional | From address. Default `Freight Lodge <john@freightlodge.com>`. |
| `VITE_API_BASE_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. Client calls `{base}/jev` and `{base}/email/verify/*`. |
| `EMAIL_VERIFY_DEV_MODE` | Local/test only | Skip sending; log code server-side. |
