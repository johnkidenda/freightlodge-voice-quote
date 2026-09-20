# Cartesia token + TTS proxy

Mints short-lived Cartesia `access_token`s with `{ grants: { tts: true, stt: true } }`, proxies TTS audio, and proxies **Jev** (TypeSafe System One) so the GitHub Pages SPA never sees `CARTESIA_API_KEY` or `TYPESAFE_API_KEY`.

Mic → text is **Web Speech only**. Cartesia is used for **spoken agent replies** when Conversational mode is on.

The Pages client:

1. Reads `VITE_STT_TOKEN_URL` (this Worker or the local stub)
2. POSTs the agent reply to `{origin}/tts` (or `/api/tts` next to `/api/stt-token`)
3. Plays the returned `audio/mpeg`
4. After each completed utterance, POSTs `{origin}/jev` with the current quote sheet + raw transcript. Jev answers ready / slot / clarify questions. If the key is missing or Jev fails, the client keeps the rule-based parse.

Default voice: **Skylar** (`db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`, Friendly Guide). Model `sonic-3`.

Mint (`POST /` or `POST /api/stt-token`) still returns `{ token, expires_in }` for a short-lived access token. Do not put the long-lived key in `VITE_*`.

## Anthony — production Worker (workers.dev)

Needs this directory’s `wrangler.toml` plus secrets **`CARTESIA_API_KEY`** and **`TYPESAFE_API_KEY`** (values from the box — do not commit them).

```bash
cd token-proxy
npx wrangler login          # once per machine, if needed
npx wrangler secret put CARTESIA_API_KEY
npx wrangler secret put TYPESAFE_API_KEY
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

Redeploy this Worker after pulling TTS (`POST /tts`) and Jev (`POST /jev`) so spoken replies and post-utterance decisions work on Pages.

## Local Node stub

```bash
# Cartesia TTS mint + Jev. Source Anthony's box file when the key lands:
#   set -a && source /home/box/.secrets/typesafe.env && set +a
CARTESIA_API_KEY= TYPESAFE_API_KEY= node token-proxy/local-stub.mjs
```

Set keys in the environment only. Listens on `http://127.0.0.1:8787` (`PORT` / `HOST` override).

- `POST /` — mint `{ token, expires_in }`
- `POST /tts` — mp3 for `{ transcript }`
- `POST /jev` — TypeSafe System One (Jev) for one utterance. Body: `{ utterance, sheet, recent_replies?, awaiting? }`
- `GET /jev` — `{ jev: "on"|"off" }` without calling TypeSafe
- `POST /jev-action` — TypeSafe Choice for one fake-Exfresso DOM step. Body: `{ sheet, candidates, step?, status?, filled? }`. Candidates only; do not invent ids.
- `GET /jev-action` — `{ jev: "on"|"off", action: true }`
- `POST /email/verify/start` — body `{ email }`. Sends a 6-digit code FROM `john@freightlodge.com`. Returns `{ ok, challenge_id, expires_in }` — never the code.
- `POST /email/verify/confirm` — body `{ email, challenge_id, code }`. Success `{ ok, verified, email }`.
- `POST /email/quote` — body `{ to, subject, body, html?, quote_sheet? }`. SMTP send of the quote (multipart text + HTML). Quote send does not require a prior verify challenge.

Email routes do **not** need `CARTESIA_API_KEY`. They need `SMTP_PASS` (or `EMAIL_VERIFY_DEV_MODE=1` in local/test). In-memory challenge store is per process; a Worker needs a durable store later and cannot open `smtp.hostinger.com` (use this Node stub / tunnel for Pages).

`/jev` and `/jev-action` work when `TYPESAFE_API_KEY` is set even if Cartesia is unset. Missing key → `503 { jev: "off" }`; the voice SPA falls back to heuristics. The computer-use runner pauses.

`npm run dev` also serves `/api/stt-token`, `/api/tts`, `/api/jev`, `/api/jev-action`, `/api/email/verify/start`, `/api/email/verify/confirm`, and `/api/email-quote` from the server env — use `VITE_STT_TOKEN_URL=/api/stt-token`.

### Smoke (when the TypeSafe key is in the stub env)

```bash
curl -sS -X POST "${VITE_STT_TOKEN_URL:-http://127.0.0.1:8787}/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

Against the Pages-baked tunnel origin:

```bash
curl -sS -X POST "https://opens-trio-tune-disciplines.trycloudflare.com/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

Expect `{ "ok": true, "jev": "on", "decision": { ... } }`. `503` + `"Jev proxy not configured"` means the key is not on that process yet; the app still quotes via heuristics.

DOM-step Choice for the fake Exfresso pilot:

```bash
curl -sS -X POST "${VITE_STT_TOKEN_URL:-http://127.0.0.1:8787}/jev-action" \
  -H "Content-Type: application/json" \
  -d '{"step":"origin","candidates":[{"id":"origin-zip","kind":"fill","label":"Origin ZIP","field":"origin_zip"},{"id":"continue","kind":"click","label":"Continue"}],"sheet":{"lanes":{"origin":{"postal_code":"78721"}}}}'
```

Web Speech does **not** need this proxy. Conversational mode still rewrites reply copy if the URL is unset; TTS stays silent.

## Env

| Var | Where | Purpose |
| --- | --- | --- |
| `CARTESIA_API_KEY` | Worker secret / local stub / Vite server env | Long-lived Cartesia key. **Never** `VITE_*`. |
| `TYPESAFE_API_KEY` | Worker secret / local stub / Vite server env | TypeSafe Jev key. **Never** `VITE_*`. |
| `VITE_STT_TOKEN_URL` | Pages build / `.env` for local | Public URL of this proxy. Safe to bake into the SPA. Client calls `{origin}/jev` and `{origin}/email/verify/*`. |
| `SMTP_HOST` | Node stub / Vite server env | Default `smtp.hostinger.com`. **Never** `VITE_*`. |
| `SMTP_PORT` | Node stub / Vite server env | Default `465`. |
| `SMTP_USER` / `MAIL_FROM` | Node stub / Vite server env | Default `john@freightlodge.com`. |
| `SMTP_PASS` | Node stub / Vite server env | Mailbox password. Required to send. **Never** `VITE_*`. |
| `EMAIL_VERIFY_DEV_MODE` | Node stub / Vite server env | `1` logs the code server-side and skips SMTP. Tests read it via `peekDevChallenge`. Do not enable in production. |

Token TTL is ~90s (clamped 60–120).
