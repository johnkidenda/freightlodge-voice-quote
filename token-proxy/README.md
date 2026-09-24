# Freight Lodge API proxy (Jev + email)

Cloudflare Worker / local Node stub that proxies **Jev** (TypeSafe System One) and **Resend email** so the GitHub Pages SPA never sees `TYPESAFE_API_KEY` or `RESEND_API_KEY`.

Mic → text is **Web Speech only**. Spoken agent replies prefer `POST /tts` (Gemini 3.8 Flash TTS). If that call fails, the browser falls back to `speechSynthesis`.

## What the SPA calls

1. Reads `VITE_API_BASE_URL` (this Worker or the local stub / Vite `/api`)
2. POSTs to `{base}/jev` after each utterance
3. POSTs `{ text, voice? }` to `{base}/tts` when conversational mode is speaking
4. POSTs to `{base}/email/verify/*` and `{base}/email/quote` for email flows

## Deploy (Cloudflare Worker)

Needs this directory’s `wrangler.toml` plus secrets **`TYPESAFE_API_KEY`**, **`RESEND_API_KEY`**, and **`GEMINI_API_KEY`** (values from the box, do not commit them). `MAIL_FROM` is optional.

Live Worker: `https://freightlodge-stt-token.johnkidenda.workers.dev`.

Verify domain `freightlodge.com` in Resend before mail will send: DKIM TXT `resend._domainkey`, plus MX and SPF TXT on the `send` subdomain.

```bash
cd token-proxy
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put GEMINI_API_KEY
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

- `GET /` — health `{ ok, service, tts, jev, email }` (`tts` is true when `GEMINI_API_KEY` is set; the key is not returned)
- `POST /jev` — utterance parse
- `POST /jev-action` — DOM action helper for the Exfresso pilot
- `POST /tts` — Gemini speech. Body `{ "text": "What is the origin ZIP?" }` with optional `"voice"` (default `Kore`)
- `POST /email/verify/start` / `confirm` / `POST /email/quote` (body may include `html?`)

Email routes need `RESEND_API_KEY` (or `EMAIL_VERIFY_DEV_MODE=1` in local/test). The Worker POSTs to `https://api.resend.com/emails`. Default From is `Freight Lodge <john@freightlodge.com>` unless `MAIL_FROM` is set. Challenge storage is in-memory (per isolate).

`/jev` and `/jev-action` work when `TYPESAFE_API_KEY` is set. Missing key → `503 { jev: "off" }`; the voice SPA falls back to heuristics.

`npm run dev` also serves `/api/jev`, `/api/jev-action`, `/api/tts`, `/api/email/verify/start`, `/api/email/verify/confirm`, and `/api/email-quote` from the server env — use `VITE_API_BASE_URL=/api`.

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

### TTS (`POST /tts`)

Model id: **`gemini-3.8-flash-tts`**. Default voice: **`Kore`**. The key is `GEMINI_API_KEY` on the Worker (never `VITE_*`, never logged).

Request shape follows the Gemini 3.8 TTS Interactions API ([speech generation](https://ai.google.dev/gemini-api/docs/speech-generation), [model card](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts)): verbatim transcript in `text`, delivery style in `speech_metadata.style` (`warm, clear, brief customer-service`). Stage directions are not copied into the spoken text. Unary audio comes back as `audio/wav` (RIFF). If Gemini returns raw PCM (`audio/l16`), this route wraps a 24 kHz 16-bit mono WAV header.

One-line latency swap: set `GEMINI_TTS_MODEL=gemini-3.8-flash-lite-tts` (same `/tts` body and voice). Leave it unset to stay on Flash.

Smoke (writes a wav; do not put a real key in the repo — set `GEMINI_API_KEY` on the process):

```bash
curl -sS -D - -o /tmp/fl-tts.wav -X POST "${VITE_API_BASE_URL:-http://127.0.0.1:8787}/tts" \
  -H 'content-type: application/json' \
  -H 'origin: https://johnkidenda.github.io' \
  -d '{"text":"What is the origin ZIP?"}'
```

Expect `HTTP/1.1 200` and `content-type: audio/wav`. Missing key: `503` `{"error":"Gemini TTS is not configured"}`. Empty text: `400`. Preflight: `OPTIONS /tts` → `204` with the same CORS as other routes (`https://johnkidenda.github.io`).

## Env reference

| Name | Where | Notes |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | Worker secret / local stub / Vite server env | TypeSafe key. **Never** `VITE_*`. |
| `RESEND_API_KEY` | Worker secret / local stub / Vite server env | Resend key. **Never** `VITE_*`. |
| `MAIL_FROM` | Worker secret / stub, optional | From address. Default `Freight Lodge <john@freightlodge.com>`. |
| `GEMINI_API_KEY` | Worker secret / local stub / Vite server env | Gemini TTS. **Never** `VITE_*` and never log it. |
| `GEMINI_TTS_MODEL` | Worker / stub, optional | Default `gemini-3.8-flash-tts`. Set `gemini-3.8-flash-lite-tts` for lower latency. |
| `VITE_API_BASE_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. Client calls `{base}/jev`, `{base}/tts`, and `{base}/email/verify/*`. |
| `EMAIL_VERIFY_DEV_MODE` | Local/test only | Skip sending; log code server-side. |
