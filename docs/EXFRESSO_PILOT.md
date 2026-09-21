# Fake Exfresso Jev + computer-use pilot

Practice Browser Use on a public multi-step form. This is **not** live Exfresso. Voice-to-quote is unchanged at `/`.

Live form (after this change is on `main` / GitHub Pages):

**https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/**

Local copy: `public/exfresso-pilot/index.html` (also served from `npm run preview` at `/exfresso-pilot/`).

Pilot UI label: **Exfresso pilot v0.26**. Shared app `VERSION` is **0.30**.

The default runner arm is **hybrid**: script-fill mapped sheet fields (ZIP, weight, pieces, date, email). Jev Choice runs only when visible controls are an ambiguous fork (Continue vs Get rates, similar labels, optional decoys). Gate blocks only on those forks. `--arm jev` is the old every-step Choice. `--arm heuristic` never calls TypeSafe.

## What the form does

Steps: origin → dest → freight → pickup/accessorials → contact → review → quoted.

Ambiguous controls (on purpose):

- Continue vs Continue without ZIP vs Use last origin
- Destination ZIP vs unused Billing ZIP
- Inside vs Inside pickup vs Inside delivery
- Continue vs Get rates vs Get rates (sample) on the contact step

Required sheet fields: origin ZIP, dest ZIP, weight, pieces, pickup date, accessorials, email.

The runner scrapes `[data-pilot-id]` candidates (or `window.__EXFRESSO_PILOT__.snapshot()`). It never invents a field value; fills come from the quote sheet JSON.

## Jev Choice (`POST /jev-action`)

Same token proxy as voice `POST /jev`. `TYPESAFE_API_KEY` stays on the Worker / local stub. Never `VITE_*`.

Body:

```json
{
  "sheet": { "quote_request_id": "93ce7a5d" },
  "candidates": [{ "id": "origin-zip", "kind": "fill", "label": "Origin ZIP", "field": "origin_zip" }],
  "step": "origin",
  "status": "collecting",
  "filled": {}
}
```

System One questions: Choice `next_action` (listed candidate ids + `stop` + `clarify`), Noul `needs_clarify`, Score `action_confidence`. Confidence below 0.5, `stop`/`clarify`, or an invented id → runner pauses (no click).

## Anthony: run against live Pages + local stub

```bash
# 1. TypeSafe key on the box (do not commit)
set -a && source /home/box/.secrets/typesafe.env && set +a

# 2. Local stub (Jev + jev-action). Optional: tunnel this process if you want a public proxy.
TYPESAFE_API_KEY=$TYPESAFE_API_KEY node token-proxy/local-stub.mjs

# 3. Browser for the runner (once per machine)
npx playwright install chromium

# 4. Computer-use A/B against the live fake form
node scripts/exfresso-pilot-runner.mjs \
  --url https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/ \
  --jev-url http://127.0.0.1:8787/jev-action \
  --arm compare \
  --runs 1 \
  --sheet scripts/fixtures/sheet-93ce7a5d.json
```

Omit `--url` to serve `public/exfresso-pilot/index.html` on a local port (same form version).

`--arm hybrid` (default in `compare`) script-fills, then Jev-gates forks only. `--arm jev` is every-step Choice. `--arm heuristic` is script only ($0).

Smoke the proxy:

```bash
curl -sS -X POST "http://127.0.0.1:8787/jev-action" \
  -H "Content-Type: application/json" \
  -d '{"step":"origin","candidates":[{"id":"origin-zip","kind":"fill","label":"Origin ZIP","field":"origin_zip"},{"id":"continue","kind":"click","label":"Continue"}],"sheet":{"lanes":{"origin":{"postal_code":"78721"}}}}'
```

Worker path after deploy: `{VITE_STT_TOKEN_URL}/jev-action` (same origin as `/jev`). Redeploy the Worker so `/jev-action` exists in production.

## Locked demo sheet (transcript 93ce7a5d)

- Origin Austin TX 78721
- Dest Atlanta GA 30030
- Weight 1000, pieces 3
- Inside pickup + inside delivery
- Pickup date 2026-09-22 (sheet placeholder; transcript was awaiting email)
- Email `qa@freightlodge.com`

## A/B scorecard (sheet 93ce7a5d, form v0.26, n=1 smoke)

Same local form HTML. TypeSafe via the live `/jev` tunnel when `/jev-action` is not on the stub.

Arm | success | wall_s | cost_usd | steps | wrong | clarifies | field_acc | notes
--- | --- | --- | --- | --- | --- | --- | --- | ---
hybrid | yes | 3.265 | 0.000656 | 18 | 0 | 0 | 100% | n=1; jev_calls=7; gate_blocks=0
jev | yes | 7.963 | 0.001692 | 18 | 0 | 0 | 100% | n=1; every-step; jev_calls=18
heuristic | yes | 0.055 | 0.000000 | 18 | 0 | 0 | 100% | n=1; script only

Raw JSON: [`docs/exfresso-pilot-ab.json`](exfresso-pilot-ab.json).

Cost: TypeSafe published input price $0.042 per million tokens (output free). CU compute is `cu_steps` (18), not a dollar rate.

### Read

Hybrid kept 100% success and cut Jev from 18 calls / ~8s / $0.0017 to 7 calls / ~3.3s / $0.0007 by script-filling mapped fields. Jev still gated Continue vs Get rates and similar labels. For real Exfresso, ship hybrid: fill from the sheet, Choice only on ambiguous forks.
