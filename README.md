# Freight Lodge — Voice to Quote (MVP)

Phone-playable hold-to-talk + typed chat that fills a structured LTL quote sheet, then hands off to Freight Ops’ Exfresso computer-use runner. **Stop at quote — no book/pay.**

Playable URL (GitHub Pages project site):

**https://johnkidenda.github.io/freightlodge-voice-quote/**

- Never invent ZIPs, dims, weights, or freight class — leave `null` and ask
- Out of scope (hard international, ocean/air) → `status=out_of_scope` + honest message, never a fake rate
- Sheet contract: [`docs/QUOTE_SHEET_V1.json`](docs/QUOTE_SHEET_V1.json) (`schema_version: "1.0"`)
- v1.0.1 additives: optional `error_reason`, default `mode: "LTL"`, lowest `total_usd` if multiple rates
- Post-utterance **Jev** (TypeSafe System One) behind the token proxy: slot focus + ready/clarify gate. Missing key or Jev failure falls back to the current heuristics. **Never** put `TYPESAFE_API_KEY` in `VITE_*`.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open the printed localhost URL (Chrome or Safari). Hold the mic button to talk, or type. Mic → text is **Web Speech only** (no Cartesia STT). No API keys required for dictation.

**Conversational mode** (separate toggle) rewrites agent bubbles into short customer-service copy and speaks them with the browser `speechSynthesis` API. Mode off = formal prompts + silent. There is no Cartesia TTS toggle, latency chip, or STT mode badge in the UI. **Never** put `CARTESIA_API_KEY` in `VITE_*` or the Pages bundle.

**App version** is `v0.XX` where XX is `0.01` × (merged change-sets including the current ship). Source of truth: [`VERSION`](VERSION). This ship is **v0.33** (32 merged PRs + this one). Future PRs that do not bump `VERSION` are incremented by CI (`.github/workflows/version-on-pr.yml`).

`npm run preview` serves the production build plus the same local API stubs.

Optional: copy `.env.example` → `.env` if you later wire `OPENAI_API_KEY` into a local enhance endpoint. Conversational speech does not need a Cartesia key. The static app must keep working without secrets (toggle still warms the copy; browser TTS no-ops if `speechSynthesis` is missing).

### Cartesia TTS token / audio proxy (dormant)

The Pages SPA does not call Cartesia TTS. `POST /tts` on the token proxy can stay in place for a later ship. `VITE_STT_TOKEN_URL` is still the public mint URL. **Never** put `CARTESIA_API_KEY` in `VITE_*`.

Default voice: **Skylar** (`db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`, “Friendly Guide” — customer care / sales-leaning). Model: `sonic-3`.

The mint endpoint still returns `{ token, expires_in }` with `{ grants: { tts: true, stt: true } }` so a short-lived token is available; the browser does not embed the API key.

### Jev (TypeSafe System One) post-utterance decisions

After each completed utterance (hold release, turn end, or typed submit) the client POSTs once to `{VITE_STT_TOKEN_URL}/jev` with the current quote sheet JSON, the raw transcript, and a short recent-reply tail. The proxy calls TypeSafe (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest`) with:

1. **Noul** `sheet_ready_for_exfresso` (enough to run Quote without inventing fields)
2. **Choice** `primary_slot` plus per-slot **Nouls** `touched_*` (origin city/ZIP, dest city/ZIP, weight, pieces, commodity, pickup date, accessorials, email). Candidates only. No invented options.
3. **Noul** `needs_clarify` (city/ZIP mismatch, soft date, ambiguous STT)
4. **Score** `parse_confidence`

Act only when confidence is about `>= 0.5`. Otherwise the existing rule-based parse / clarify stays in charge. Opus/Grok are not on this path. Reply copy stays as today.

Send transcript stamps a quiet QA line: `Jev: on|off` plus a short decision summary.

Hard rules on top of Jev: never re-ask or focus a slot that already has a value unless the user explicitly corrects it; if origin ZIP, dest ZIP, and weight are present, ignore a clarify / ready-low gate and ask the next missing field. ZIP-state checks compare a ZIP only to its own city/state (not origin vs dest).

Kill switch: `?jev=0` (also `off` / `false`) skips Jev and persists in `localStorage`. `?jev=1` turns it back on.

If `TYPESAFE_API_KEY` is unset, Jev fails, or the kill switch is on, the app uses heuristics only.

### Fake Exfresso computer-use pilot (v0.26)

Public form (does not touch the voice app):

**https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/**

The CU runner is **hybrid** (v0.26): it script-fills mapped sheet fields and calls `POST /jev-action` only as a low-confidence gate on ambiguous DOM forks. Confidence below 0.5 or `stop`/`clarify` pauses only then. Key stays on the stub/Worker.

```bash
set -a && source /home/box/.secrets/typesafe.env && set +a
TYPESAFE_API_KEY=$TYPESAFE_API_KEY node token-proxy/local-stub.mjs
npx playwright install chromium
node scripts/exfresso-pilot-runner.mjs \
  --url https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/ \
  --jev-url http://127.0.0.1:8787/jev-action \
  --arm compare --runs 1
```

Full A/B scorecard and Anthony steps: [`docs/EXFRESSO_PILOT.md`](docs/EXFRESSO_PILOT.md).

**Smoke when the key is on the local stub or tunnel** (Anthony persists it at `/home/box/.secrets/typesafe.env` and refreshes the stub):

```bash
# Local stub
set -a && source /home/box/.secrets/typesafe.env && set +a
TYPESAFE_API_KEY=$TYPESAFE_API_KEY node token-proxy/local-stub.mjs

curl -sS -X POST "${VITE_STT_TOKEN_URL:-http://127.0.0.1:8787}/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

Against the Pages-baked proxy origin:

```bash
curl -sS -X POST "https://opens-trio-tune-disciplines.trycloudflare.com/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

- Worker + local stub: [`token-proxy/README.md`](token-proxy/README.md)
- Local Vite (`npm run dev`) exposes `POST /api/stt-token` and `POST /api/tts` when `CARTESIA_API_KEY` is in the server env — point `VITE_STT_TOKEN_URL=/api/stt-token`

Anthony’s production steps (key stays on the box / Worker secret):

```bash
cd token-proxy
npx wrangler secret put CARTESIA_API_KEY
npx wrangler deploy
```

Placeholder to set as the GitHub Actions secret, then rebuild Pages:

```
VITE_STT_TOKEN_URL=https://freightlodge-stt-token.<ACCOUNT>.workers.dev
```

Use the URL `wrangler deploy` prints. Full copy-paste path: [`token-proxy/README.md`](token-proxy/README.md).

## What the app does

1. Slot-fills origin/dest + ZIP, pieces, weight **or** L×W×H **or** NMFC class, commodity, pickup date, accessorials, contact email
2. When the sheet is complete, `status` becomes `ready_for_quote`
3. `POST /api/quote-handoff` (or the in-browser stub on GitHub Pages) simulates the Exfresso runner and returns `quote_result`
4. Quote card + **Email me this quote** (server SMTP from `john@freightlodge.com` — never mailto)
5. **Send transcript** silently POSTs via FormSubmit AJAX to `john@freightlodge.com` (or `VITE_TRANSCRIPT_WEBHOOK_URL` if set). Activate-style replies are treated as failure. Mailto is last-resort only.

## Handoff contract (Freight Ops / Exfresso)

Day-one is **UI automation elsewhere**. There is no private Exfresso API in this MVP. Replace the stub with your runner behind the same HTTP contract.

```http
POST /api/quote-handoff
Content-Type: application/json

{ "quote_sheet": { /* Quote Sheet v1, status quoting|ready_for_quote */ } }
```

Success:

```json
{
  "ok": true,
  "mode": "exfresso",
  "quote_sheet": {
    "status": "quoted",
    "quote_result": {
      "carrier": "…",
      "service": "…",
      "total_usd": 0,
      "transit_days_min": 2,
      "transit_days_max": 5,
      "quote_id": "…",
      "raw_summary": "…",
      "quoted_at": "2026-09-16T00:00:00.000Z"
    }
  }
}
```

Rules for the runner:

- If the lane is not domestic LTL, return `status: "out_of_scope"`, set `out_of_scope_reason`, and **`quote_result: null`**
- Runner/login/timeout/no-rates → `status: "error"` + `error_reason`, still no invented rate
- If the UI scrape yields **multiple rate rows, pick the lowest `total_usd`**
- Do not book or pay

Local stub: `server/vite-plugin-api.js` + `src/lib/handoff.js` (`simulateExfressoRunner`).

On GitHub Pages (static), the client calls the same path, gets 404, and runs the in-browser stub so demo still works. Point the app at a real runner with:

```js
window.FREIGHT_OPS_HANDOFF_URL = "https://ops.example.com/api/quote-handoff";
```

or build-time `VITE_HANDOFF_URL`.

## Email me this quote (SMTP, no mailto)

The sheet collects contact email like any other slot (type the address — voice often mangles it). Completing the sheet runs the quote and shows the **quote card**. There is **no** 6-digit confirmation-code gate on this path.

**Email me this quote** POSTs `{VITE_STT_TOKEN_URL origin}/email/quote` (local Vite: `POST /api/email-quote`) with text + HTML bodies that match the on-screen card. SMTP sends FROM `john@freightlodge.com` TO the sheet address. Success is an in-app note. Failure is an in-app error plus an optional clipboard copy of the text quote. This path never assigns `window.location.href` to a mailto.

`POST /email/verify/start` and `/email/verify/confirm` stay on the token-proxy for later use. They are not on the quote happy path.

GitHub Pages calls the same `VITE_STT_TOKEN_URL` origin as Jev (today a cloudflared tunnel to the Node stub). Put SMTP secrets on that process, not in `VITE_*`.

| Var | Typical Hostinger value |
| --- | --- |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` (SSL) |
| `SMTP_USER` / `MAIL_FROM` | `john@freightlodge.com` |
| `SMTP_PASS` | mailbox password (server-side only) |
| `EMAIL_VERIFY_DEV_MODE` | `1` in local/test only — logs quote/verify sends server-side and skips SMTP |

Production without `SMTP_PASS` → `503`. Cloudflare Worker source has the same routes but cannot open SMTP; use the Node stub for live send.

Do not put SMTP secrets in `VITE_*` or in the GitHub Pages bundle.

## Deploy (GitHub Pages)

This is a Vite static build. Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml). Every push to `main` builds, tests, and publishes `dist` to the `gh-pages` branch.

**One-time enable** (the Actions token cannot create the Pages site):

1. Open https://github.com/johnkidenda/freightlodge-voice-quote/settings/pages
2. **Build and deployment → Source:** Deploy from a branch
3. Branch: `gh-pages` / `/ (root)` → Save  
   *or* Source: GitHub Actions, if you prefer the official Pages environment

Site: `https://johnkidenda.github.io/freightlodge-voice-quote/`

`public/.nojekyll` is copied into `dist` so GitHub does not process the build as Jekyll.

Local production-base check:

```bash
GITHUB_ACTIONS=1 npm run build
GITHUB_ACTIONS=1 npm run preview
```

## Tests

```bash
npm test
```

- Hold-and-dump: one utterance parks weight + commodity + cities while awaiting origin ZIP
- Conversational copy + browser `speechSynthesis`; Web Speech only for STT
- Visible `VERSION` (`v0.33` this ship) baked into the footer only
- Quote-card SMTP email (HTML + text) without mailto; no OTP gate on the quote path
- Post-utterance Jev via `POST /jev` (fallback when the TypeSafe key is absent; `?jev=0` disables)
- Completeness rules for `ready_for_quote`
- Never-invent: cities do not become ZIPs; “standard class” / “a few hundred pounds” stay `null`
- Out of scope does not produce `quote_result`
- Multi-rate stub picks lowest `total_usd`

## Out of scope for this MVP

Booking, payment, live Exfresso credentials, and hard international / ocean / air quoting.

Voice Jev is still the post-utterance slot / ready / clarify gate. A **fake** Exfresso multi-step form plus `POST /jev-action` DOM Choice lives at [`/exfresso-pilot/`](https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/) for the computer-use A/B. It does not log into real Exfresso. Runbook: [`docs/EXFRESSO_PILOT.md`](docs/EXFRESSO_PILOT.md).
