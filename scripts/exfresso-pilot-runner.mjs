#!/usr/bin/env node
/**
 * Computer-use runner for the fake Exfresso pilot form.
 *
 *   node scripts/exfresso-pilot-runner.mjs --arm compare --runs 3
 *
 * Against live Pages + local Jev stub (Anthony):
 *   set -a && source /home/box/.secrets/typesafe.env && set +a
 *   node token-proxy/local-stub.mjs
 *   npx playwright install chromium
 *   node scripts/exfresso-pilot-runner.mjs \
 *     --url https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/ \
 *     --jev-url http://127.0.0.1:8787/jev-action \
 *     --arm compare --runs 1
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_SHEET_ID,
  average,
  demoSheet93ce7a5d,
  emptyScorecard,
  fieldAccuracy,
  formatScorecardRow,
  isOffTargetAction,
  isQuotedSuccess,
  mapVoiceJevToDomAction,
  pickHeuristicAction,
  pickHybridAction,
  sheetValueForField,
} from "../src/lib/exfresso-pilot-core.js";
import { evaluateDomAction } from "../token-proxy/src/jev-action.js";
import { usageCostUsd } from "../src/lib/jev-action-core.js";

const LIVE_VOICE_JEV =
  process.env.JEV_VOICE_URL || "https://freightlodge-stt-token.example.workers.dev/jev";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_PAGES = "https://johnkidenda.github.io/freightlodge-voice-quote/exfresso-pilot/";
const MAX_STEPS = 40;

function parseArgs(argv) {
  const out = {
    url: "",
    arm: "compare",
    runs: 3,
    jevUrl: process.env.JEV_ACTION_URL || "http://127.0.0.1:8787/jev-action",
    sheet: join(root, "scripts/fixtures/sheet-93ce7a5d.json"),
    headed: false,
    out: join(root, "docs/exfresso-pilot-ab.json"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--url" && next) {
      out.url = next;
      i += 1;
    } else if (a === "--arm" && next) {
      out.arm = next;
      i += 1;
    } else if (a === "--runs" && next) {
      out.runs = Math.max(1, Number(next) || 1);
      i += 1;
    } else if (a === "--jev-url" && next) {
      out.jevUrl = next;
      i += 1;
    } else if (a === "--sheet" && next) {
      out.sheet = next;
      i += 1;
    } else if (a === "--out" && next) {
      out.out = next;
      i += 1;
    } else if (a === "--headed") {
      out.headed = true;
    } else if (a === "--help" || a === "-h") {
      out.help = true;
    }
  }
  return out;
}

function loadSheet(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return demoSheet93ce7a5d();
  }
}

function serveLocalForm() {
  const html = readFileSync(join(root, "public/exfresso-pilot/index.html"));
  const server = createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

async function callJevAction(jevUrl, payload) {
  const key = process.env.TYPESAFE_API_KEY;
  if (key) {
    return evaluateDomAction({
      apiKey: key,
      sheet: payload.sheet,
      candidates: payload.candidates,
      step: payload.step,
      status: payload.status,
      filled: payload.filled,
    });
  }
  try {
    const res = await fetch(jevUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (res.ok && data?.decision && ("gateBlocked" in data.decision || "actionId" in data.decision) && !data.token) {
      return data;
    }
  } catch {
    /* live stub may not have /jev-action yet */
  }
  return callVoiceJevMapped(jevUrl, payload);
}

function voiceJevUrl(jevUrl) {
  try {
    const u = new URL(jevUrl);
    if (u.pathname.endsWith("/jev-action")) {
      u.pathname = u.pathname.replace(/\/jev-action$/, "/jev");
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return LIVE_VOICE_JEV;
}

async function callVoiceJevMapped(jevUrl, payload) {
  const url = voiceJevUrl(jevUrl);
  const ids = (payload.candidates || []).map((c) => c.id).join(", ");
  const utterance = [
    `Computer-use form step ${payload.step || "unknown"}.`,
    `Visible candidate ids: ${ids}.`,
    `Filled snapshot: ${JSON.stringify(payload.filled || {})}.`,
    "Update the next missing quote-sheet field from the sheet. Do not invent ZIP, weight, pieces, date, or email.",
  ].join(" ");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      utterance,
      sheet: payload.sheet || {},
      awaiting: payload.step || null,
    }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok || data?.jev !== "on") {
    const err = new Error(data.error || `voice jev ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  const mapped = mapVoiceJevToDomAction(data.decision, payload.candidates, payload.sheet, {
    status: payload.status,
    values: payload.filled,
  });
  return {
    ok: true,
    jev: "on",
    model: data.model || "jev-latest",
    decision: mapped,
    usage: data.usage || null,
    cost_usd: usageCostUsd(data.usage),
    via: "voice-jev-map",
  };
}

async function runOnce({ page, url, arm, sheet, jevUrl }) {
  const card = emptyScorecard();
  const log = [];
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__EXFRESSO_PILOT__), { timeout: 15000 });
  const t0 = Date.now();
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const snap = await page.evaluate(() => window.__EXFRESSO_PILOT__.snapshot());
    card.filled = snap.values || {};
    if (String(snap.status).toLowerCase() === "quoted") {
      card.stop_reason = "quoted";
      break;
    }
    const candidates = snap.candidates || [];
    let actionId = null;
    let candidate = null;
    const hybrid = arm === "hybrid" ? pickHybridAction(candidates, sheet, snap) : null;
    const useJev = arm === "jev" || (arm === "hybrid" && hybrid?.askJev);
    if (useJev) {
      const jevCandidates = arm === "hybrid" && hybrid.jevCandidates?.length ? hybrid.jevCandidates : candidates;
      let result;
      try {
        result = await callJevAction(jevUrl, {
          sheet,
          candidates: jevCandidates,
          step: snap.step,
          status: snap.status,
          filled: snap.values,
        });
      } catch (err) {
        if (arm === "hybrid" && hybrid?.actionId) {
          log.push({ step: snap.step, hybrid, jev_error: String(err.message || err), fallback: "heuristic" });
          actionId = hybrid.actionId;
          candidate = hybrid.candidate || candidates.find((c) => c.id === actionId) || null;
        } else {
          card.clarifies += 1;
          card.stop_reason = `jev-error:${err.status || err.message}`;
          log.push({ step: snap.step, error: String(err.message || err) });
          break;
        }
      }
      if (!actionId) {
        card.jev_calls += 1;
        card.cost_usd += Number(result.cost_usd) || 0;
        const decision = result.decision || {};
        const conf = Number(decision.confidence ?? result.answers?.next_action?.confidence ?? result.answers?.primary_slot?.confidence);
        if (Number.isFinite(conf) && conf > 0) {
          card.jev_confidences.push(conf);
        }
        log.push({
          step: snap.step,
          arm,
          hybrid: hybrid || undefined,
          jev: decision,
          usage: result.usage || null,
          cost_usd: result.cost_usd || 0,
        });
        if (decision.gateBlocked || !decision.act || !decision.actionId) {
          card.jev_gate_blocks += 1;
          card.clarifies += 1;
          card.stop_reason = `jev-gate:${decision.choice || decision.reason || "block"}`;
          break;
        }
        actionId = decision.actionId;
        candidate = candidates.find((c) => c.id === actionId) || jevCandidates.find((c) => c.id === actionId) || null;
      }
    } else {
      const pick = hybrid || pickHeuristicAction(candidates, sheet, snap);
      log.push({ step: snap.step, arm, pick });
      if (!pick.actionId) {
        card.clarifies += 1;
        card.stop_reason = `${arm}:${pick.reason}`;
        break;
      }
      actionId = pick.actionId;
      candidate = pick.candidate || candidates.find((c) => c.id === actionId) || null;
    }

    if (!candidate) {
      card.wrong += 1;
      card.clarifies += 1;
      card.stop_reason = "unknown-candidate";
      break;
    }
    if (isOffTargetAction(candidate, sheet)) card.wrong += 1;

    let value;
    if (candidate.kind === "fill") {
      value = sheetValueForField(sheet, candidate.field);
      if (value == null) {
        card.wrong += 1;
        card.clarifies += 1;
        card.stop_reason = `no-sheet-value:${candidate.field || candidate.id}`;
        break;
      }
    }

    await page.evaluate(
      ({ id, nextValue }) => window.__EXFRESSO_PILOT__.applyAction(id, nextValue),
      { id: actionId, nextValue: value },
    );
    card.steps += 1;
    card.cu_steps += 1;
  }

  const snap = await page.evaluate(() => window.__EXFRESSO_PILOT__.snapshot());
  card.filled = snap.values || {};
  card.wall_s = Math.round(((Date.now() - t0) / 1000) * 1000) / 1000;
  const acc = fieldAccuracy(card.filled, sheet);
  card.field_acc = acc.pct;
  card.success = isQuotedSuccess(snap, sheet);
  if (!card.stop_reason) card.stop_reason = card.success ? "quoted" : "max-steps";
  const avgConf = average(card.jev_confidences);
  const bits = [
    `sheet=${sheet.quote_request_id || DEMO_SHEET_ID}`,
    `stop=${card.stop_reason}`,
    `cu_steps=${card.cu_steps}`,
  ];
  if (arm === "jev" || arm === "hybrid") {
    bits.push(`jev_calls=${card.jev_calls}`);
    bits.push(`avg_conf=${avgConf == null ? "n/a" : avgConf}`);
    bits.push(`gate_blocks=${card.jev_gate_blocks}`);
  }
  card.notes = bits.join("; ");
  card.log = log;
  return card;
}

function meanCard(cards) {
  const out = emptyScorecard();
  if (!cards.length) return out;
  out.success = cards.every((c) => c.success);
  out.wall_s = average(cards.map((c) => c.wall_s));
  out.cost_usd = cards.reduce((a, c) => a + (Number(c.cost_usd) || 0), 0) / cards.length;
  out.steps = average(cards.map((c) => c.steps));
  out.wrong = average(cards.map((c) => c.wrong));
  out.clarifies = average(cards.map((c) => c.clarifies));
  out.field_acc = average(cards.map((c) => c.field_acc));
  out.jev_calls = average(cards.map((c) => c.jev_calls));
  out.jev_gate_blocks = average(cards.map((c) => c.jev_gate_blocks));
  out.cu_steps = average(cards.map((c) => c.cu_steps));
  const confs = cards.flatMap((c) => c.jev_confidences || []);
  const n = cards.length;
  const ok = cards.filter((c) => c.success).length;
  const bits = [`n=${n}`, `successes=${ok}/${n}`];
  if (confs.length) bits.push(`avg_conf=${average(confs)}`);
  if (out.jev_calls) bits.push(`jev_calls=${out.jev_calls}`, `gate_blocks=${out.jev_gate_blocks}`);
  bits.push(`cu_steps=${out.cu_steps}`);
  out.notes = bits.join("; ");
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/exfresso-pilot-runner.mjs [--url URL] [--arm hybrid|jev|heuristic|compare] [--runs N] [--jev-url URL]`);
    process.exit(0);
  }

  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
    process.exit(1);
  }

  const sheet = loadSheet(args.sheet);
  let local = null;
  let url = args.url;
  if (!url) {
    local = await serveLocalForm();
    url = local.url;
    console.log(`Serving local fake form at ${url}`);
  }

  const arms =
    args.arm === "compare" || args.arm === "both"
      ? ["hybrid", "jev", "heuristic"]
      : [args.arm];
  const browser = await playwright.chromium.launch({ headless: !args.headed });
  const results = { url, sheet_id: sheet.quote_request_id || DEMO_SHEET_ID, arms: {} };

  try {
    for (const arm of arms) {
      const runs = [];
      for (let i = 0; i < args.runs; i += 1) {
        const page = await browser.newPage();
        try {
          const card = await runOnce({ page, url, arm, sheet, jevUrl: args.jevUrl });
          runs.push(card);
          console.log(`${arm} run ${i + 1}: success=${card.success} wall_s=${card.wall_s} steps=${card.steps} wrong=${card.wrong} ${card.notes}`);
        } finally {
          await page.close();
        }
      }
      results.arms[arm] = { runs, summary: meanCard(runs) };
    }
  } finally {
    await browser.close();
    if (local) local.server.close();
  }

  console.log("");
  console.log("Arm | success | wall_s | cost_usd | steps | wrong | clarifies | field_acc | notes");
  console.log("--- | --- | --- | --- | --- | --- | --- | --- | ---");
  for (const arm of Object.keys(results.arms)) {
    console.log(formatScorecardRow(arm, results.arms[arm].summary));
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nWrote ${args.out}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { runOnce, meanCard, parseArgs, LIVE_PAGES };
