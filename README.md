# Freight Lodge — Voice to Quote (MVP)

Phone-playable hold-to-talk + typed chat that fills a structured LTL quote sheet, then hands off to Freight Ops’ Exfresso computer-use runner. **Stop at quote — no book/pay.**

Playable URL (GitHub Pages project site):

**https://johnkidenda.github.io/freightlodge-voice-quote/**

- Never invent ZIPs, dims, weights, or freight class — leave `null` and ask
- Out of scope (hard international, ocean/air) → `status=out_of_scope` + honest message, never a fake rate
- Sheet contract: [`docs/QUOTE_SHEET_V1.json`](docs/QUOTE_SHEET_V1.json) (`schema_version: "1.0"`)
- v1.0.1 additives: optional `error_reason`, default `mode: "LTL"`, lowest `total_usd` if multiple rates

## Run locally

```bash
npm install
npm test
npm run dev
```

Open the printed localhost URL (Chrome or Safari). Hold the mic button to talk, or type. Mic → text is **Web Speech only** (no Cartesia STT). No API keys required for dictation.

**Conversational mode** (separate toggle) rewrites agent bubbles into short customer-service copy and speaks them with the browser `speechSynthesis` API. Mode off = formal prompts + silent. There is no Cartesia TTS toggle, latency chip, or STT mode badge in the UI. **Never** put `CARTESIA_API_KEY` in `VITE_*` or the Pages bundle.

**App version** is `v0.XX` where XX is `0.01` × (merged change-sets including the current ship). Source of truth: [`VERSION`](VERSION). This ship is **v0.21** (20 merged PRs + this one). Future PRs that do not bump `VERSION` are incremented by CI (`.github/workflows/version-on-pr.yml`).

`npm run preview` serves the production build plus the same local API stubs.

Optional: copy `.env.example` → `.env` if you later wire `OPENAI_API_KEY` into a local enhance endpoint. Conversational speech does not need a Cartesia key. The static app must keep working without secrets (toggle still warms the copy; browser TTS no-ops if `speechSynthesis` is missing).

### Cartesia TTS token / audio proxy (dormant)

The Pages SPA does not call Cartesia TTS. `POST /tts` on the token proxy can stay in place for a later ship. `VITE_STT_TOKEN_URL` is still the public mint URL. **Never** put `CARTESIA_API_KEY` in `VITE_*`.

Default voice: **Skylar** (`db6b0ed5-d5d3-463d-ae85-518a07d3c2b4`, “Friendly Guide” — customer care / sales-leaning). Model: `sonic-3`.

The mint endpoint still returns `{ token, expires_in }` with `{ grants: { tts: true, stt: true } }` so a short-lived token is available; the browser does not embed the API key.

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
4. Quote card + **Email me this quote** (mailto fallback + server stub)
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

## Email me this quote

Working MVP path (no secrets):

1. Client `POST /api/email-quote` — local Vite middleware **logs** the payload and returns `{ ok: true, mode: "stub", sent: false, from: "john@freightlodge.com" }`
2. Always also opens a **`mailto:`** to the sheet’s contact email so a phone can send a copy from the user’s mail app

Production (Hostinger or any SMTP): keep `POST /api/email-quote` and swap the stub for nodemailer (or Hostinger’s API) using env vars from `.env.example`:

| Var | Typical Hostinger value |
| --- | --- |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` (SSL) or `587` |
| `SMTP_USER` / `MAIL_FROM` | `john@freightlodge.com` |
| `SMTP_PASS` | mailbox password (server-side only) |

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
- Visible `VERSION` (`v0.21` this ship) baked into the header/footer
- Completeness rules for `ready_for_quote`
- Never-invent: cities do not become ZIPs; “standard class” / “a few hundred pounds” stay `null`
- Out of scope does not produce `quote_result`
- Multi-rate stub picks lowest `total_usd`

## Out of scope for this MVP

Booking, payment, live Exfresso credentials, and hard international / ocean / air quoting.

Jev / TypeSafe System One is **not** in this ship (no key yet). When it lands later it will be TypeSafe’s **direct** API behind the token proxy — not OpenRouter.
