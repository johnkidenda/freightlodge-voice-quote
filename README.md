# Freight Lodge — Voice to Quote (MVP)

Phone-playable hold-to-talk + typed chat that fills a structured LTL quote sheet, then hands off to Freight Ops’ Exfresso computer-use runner. **Stop at quote — no book/pay.**

Playable URL (GitHub Pages project site):

**https://johnkidenda.github.io/freightlodge-voice-quote/**

- Never invent ZIPs, dims, weights, or freight class — leave `null` and ask
- Out of scope (hard international, ocean/air) → `status=out_of_scope` + honest message, never a fake rate
- Sheet contract: [`docs/QUOTE_SHEET_V1.json`](docs/QUOTE_SHEET_V1.json) (`schema_version: "1.0"`)
- v1.0.1 additives: optional `error_reason`, default `mode: "LTL"`, lowest `total_usd` if multiple rates
- The quote conversation is rule-based. It does not call Jev. **Never** put `TYPESAFE_API_KEY` in `VITE_*`.

## Run locally

```bash
npm install
npm test
npm run dev
```

Open the printed localhost URL (Chrome or Safari). Hold the mic button to talk, or type. Mic → text is **Web Speech only**. No API keys required for dictation.

**Conversational mode** (separate toggle) rewrites agent bubbles into short customer-service copy and speaks them with the browser `speechSynthesis` API. Mode off = formal prompts + silent. There is no cloud TTS toggle, latency chip, or STT mode badge in the UI.

**App version** is `v0.XX` where XX is `0.01` × (merged change-sets including the current ship). Source of truth: [`VERSION`](VERSION). This ship is **v0.36**. Future PRs that do not bump `VERSION` are incremented by CI (`.github/workflows/version-on-pr.yml`).

`npm run preview` serves the production build plus the same local API stubs.

Optional: copy `.env.example` → `.env` if you later wire `OPENAI_API_KEY` into a local enhance endpoint. Conversational speech uses browser `speechSynthesis` only. The static app must keep working without secrets (toggle still warms the copy; browser TTS no-ops if `speechSynthesis` is missing).

### API proxy (email Worker)

Point the SPA at the Cloudflare Worker (or local stub) with `VITE_API_BASE_URL`. Live Worker: `https://freightlodge-stt-token.johnkidenda.workers.dev`. Quote email (Resend) runs there. `RESEND_API_KEY` stays on the Worker, never in `VITE_*`. See [`token-proxy/README.md`](token-proxy/README.md).

The quote app does not call Jev. The Worker still exposes `POST /jev` and `POST /jev-action` for the Exfresso pilot. `TYPESAFE_API_KEY` stays on the Worker. Those routes were not removed in this change.

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

curl -sS -X POST "${VITE_API_BASE_URL:-http://127.0.0.1:8787}/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

Against the Pages-baked proxy origin:

```bash
curl -sS -X POST "${VITE_API_BASE_URL}/jev" \
  -H "Content-Type: application/json" \
  -d '{"utterance":"Chicago 60601 to Dallas 75201, 3 pallets, 1200 pounds","sheet":{"schema_version":"1.0","status":"collecting"},"awaiting":"origin_zip"}'
```

- Worker + local stub: [`token-proxy/README.md`](token-proxy/README.md)
- Local Vite (`npm run dev`) exposes `POST /api/jev` and email routes when keys are in the server env — point `VITE_API_BASE_URL=/api`

Anthony’s production steps (key stays on the box / Worker secret):

```bash
cd token-proxy
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler deploy
```

GitHub Actions secret (the Pages workflow falls back to this URL if the secret is unset):

```
VITE_API_BASE_URL=https://freightlodge-stt-token.johnkidenda.workers.dev
```

Full copy-paste path: [`token-proxy/README.md`](token-proxy/README.md).

## What the app does

1. Slot-fills origin/dest + ZIP, pieces, weight **or** L×W×H **or** NMFC class, commodity, pickup date, accessorials, contact email
2. When the sheet is complete, `status` becomes `ready_for_quote`
3. `POST /api/quote-handoff` (or the in-browser stub on GitHub Pages) simulates the Exfresso runner and returns `quote_result`
4. Quote card + **Email me this quote** (Resend from `john@freightlodge.com`, never mailto)
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

## Email me this quote (Resend, no mailto)

The sheet collects contact email like any other slot (type the address. Voice often mangles it). Completing the sheet runs the quote and shows the **quote card**. There is **no** 6-digit confirmation-code gate on this path.

**Email me this quote** POSTs `{VITE_API_BASE_URL origin}/email/quote` (local Vite: `POST /api/email-quote`) with text + HTML bodies that match the on-screen card. The Worker sends through Resend FROM `Freight Lodge <john@freightlodge.com>` (or `MAIL_FROM`) TO the sheet address. Success is an in-app note. Failure is an in-app error plus an optional clipboard copy of the text quote. This path never assigns `window.location.href` to a mailto.

`POST /email/verify/start` and `/email/verify/confirm` stay on the token-proxy for later use. They are not on the quote happy path.

GitHub Pages calls the same `VITE_API_BASE_URL` origin (the Cloudflare Worker) for quote email. Put `RESEND_API_KEY` on the Worker, not in `VITE_*`.

| Var | Where |
| --- | --- |
| `RESEND_API_KEY` | Worker secret. Domain `freightlodge.com` must be verified in Resend. |
| `MAIL_FROM` | Optional. Default `Freight Lodge <john@freightlodge.com>`. |
| `EMAIL_VERIFY_DEV_MODE` | `1` in local/test only. Logs quote/verify sends server-side and skips sending. |

Production without `RESEND_API_KEY` returns `503`.

Do not put the Resend key in `VITE_*` or in the GitHub Pages bundle.

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
- Visible `VERSION` (`v0.36` this ship) baked into the footer only
- Quote-card email (HTML + text) without mailto; no OTP gate on the quote path
- Completeness rules for `ready_for_quote`
- Never-invent: cities do not become ZIPs; “standard class” / “a few hundred pounds” stay `null`
- Out of scope does not produce `quote_result`
- Multi-rate stub picks lowest `total_usd`

## Out of scope for this MVP

Booking, payment, live Exfresso credentials, and hard international / ocean / air quoting.

The quote conversation does not call Jev. A **fake** Exfresso multi-step form plus `POST /jev-action` DOM Choice lives at [`/exfresso-pilot/`](https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/) for the computer-use A/B. It does not log into real Exfresso. Runbook: [`docs/EXFRESSO_PILOT.md`](docs/EXFRESSO_PILOT.md).
