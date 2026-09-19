# Fake Exfresso Jev + computer-use pilot

Practice Browser Use on a public multi-step form. This is **not** live Exfresso. Voice-to-quote is unchanged at `/`.

Live form (after this change is on `main` / GitHub Pages):

**https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/**

Local copy: `public/exfresso-pilot/index.html` (also served from `npm run preview` at `/exfresso-pilot/`).

Pilot UI label: **Exfresso pilot v0.25**. Shared app `VERSION` is **0.25**.

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
  --arm both \
  --runs 3 \
  --sheet scripts/fixtures/sheet-93ce7a5d.json
```

Omit `--url` to serve `public/exfresso-pilot/index.html` on a local port (same form version).

`--arm jev` uses TypeSafe Choice. `--arm heuristic` is a script step picker (no TypeSafe, $0). Same sheet both arms.

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

## A/B scorecard

See the runner stdout table and `docs/exfresso-pilot-ab.json` after a run.

Cost: TypeSafe published input price $0.042 per million tokens (output free). Heuristic arm is $0. Computer-use/box compute is reported as `cu_steps`, not a dollar rate.
