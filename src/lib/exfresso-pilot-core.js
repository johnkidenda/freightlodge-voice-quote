/**
 * Fake Exfresso pilot helpers: sheet snapshot, heuristic picker, scorecard.
 * No TypeSafe key. The Playwright runner imports this from Node.
 */

export const PILOT_VERSION = "0.25";
export const PILOT_LABEL = "Exfresso pilot v0.25";

export const DEMO_SHEET_ID = "93ce7a5d";

export const REQUIRED_SCORE_FIELDS = Object.freeze([
  "origin_zip",
  "dest_zip",
  "weight",
  "pieces",
  "pickup_date",
  "accessorials",
  "email",
]);

export const SHEET_FIELD_GETTERS = Object.freeze({
  origin_city: (s) => s?.lanes?.origin?.city,
  origin_state: (s) => s?.lanes?.origin?.state,
  origin_zip: (s) => s?.lanes?.origin?.postal_code,
  dest_city: (s) => s?.lanes?.destination?.city,
  dest_state: (s) => s?.lanes?.destination?.state,
  dest_zip: (s) => s?.lanes?.destination?.postal_code,
  weight: (s) => s?.freight?.total_weight_lbs,
  pieces: (s) => s?.freight?.pieces,
  pickup_date: (s) => s?.pickup?.date,
  email: (s) => s?.contact?.email,
});

export const ACCESSORIAL_IDS = Object.freeze([
  "liftgate_pickup",
  "liftgate_delivery",
  "inside_pickup",
  "inside_delivery",
  "residential_pickup",
  "residential_delivery",
  "protect_from_freeze",
]);

export const DECOY_ACTION_IDS = Object.freeze([
  "continue-no-zip",
  "use-last-origin",
  "same-as-origin",
  "estimate-weight",
  "skip-accessorials",
  "get-rates-sample",
  "billing-zip",
]);

export function demoSheet93ce7a5d() {
  return {
    schema_version: "1.0",
    quote_request_id: DEMO_SHEET_ID,
    status: "ready_for_quote",
    mode: "LTL",
    lanes: {
      origin: { city: "Austin", state: "TX", postal_code: "78721", country: "US" },
      destination: { city: "Atlanta", state: "GA", postal_code: "30030", country: "US" },
    },
    freight: {
      pieces: 3,
      total_weight_lbs: 1000,
      commodity: null,
    },
    pickup: {
      date: "2026-09-22",
      accessorials: ["inside_pickup", "inside_delivery"],
    },
    contact: {
      email: "qa@freightlodge.com",
    },
  };
}

export function sheetValueForField(sheet, field) {
  const get = SHEET_FIELD_GETTERS[field];
  if (!get) return null;
  const v = get(sheet);
  if (v == null || v === "") return null;
  return String(v);
}

export function expectedAccessorials(sheet) {
  const raw = Array.isArray(sheet?.pickup?.accessorials) ? sheet.pickup.accessorials : [];
  return ACCESSORIAL_IDS.filter((id) => raw.includes(id));
}

export function normalizeAccessorials(list) {
  const raw = Array.isArray(list) ? list : [];
  return ACCESSORIAL_IDS.filter((id) => raw.includes(id));
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

export function fieldAccuracy(filled, sheet) {
  const expectedAcc = expectedAccessorials(sheet);
  const gotAcc = normalizeAccessorials(filled?.accessorials);
  const checks = {
    origin_zip: String(filled?.origin_zip || "") === String(sheet?.lanes?.origin?.postal_code || ""),
    dest_zip: String(filled?.dest_zip || "") === String(sheet?.lanes?.destination?.postal_code || ""),
    weight: String(filled?.weight || "") === String(sheet?.freight?.total_weight_lbs || ""),
    pieces: String(filled?.pieces || "") === String(sheet?.freight?.pieces || ""),
    pickup_date: String(filled?.pickup_date || "") === String(sheet?.pickup?.date || ""),
    accessorials: sameSet(gotAcc, expectedAcc),
    email: String(filled?.email || "").toLowerCase() === String(sheet?.contact?.email || "").toLowerCase(),
  };
  const correct = REQUIRED_SCORE_FIELDS.filter((k) => checks[k]).length;
  return {
    checks,
    correct,
    total: REQUIRED_SCORE_FIELDS.length,
    pct: Math.round((correct / REQUIRED_SCORE_FIELDS.length) * 1000) / 10,
  };
}

export function isQuotedSuccess(snapshot, sheet) {
  const status = String(snapshot?.status || "").toLowerCase();
  if (status !== "quoted") return false;
  const acc = fieldAccuracy(snapshot?.values || snapshot?.filled || {}, sheet);
  return acc.correct === acc.total;
}

export function isOffTargetAction(candidate, sheet) {
  if (!candidate) return true;
  if (candidate.decoy || DECOY_ACTION_IDS.includes(candidate.id)) return true;
  if (candidate.field && SHEET_FIELD_GETTERS[candidate.field]) {
    const want = sheetValueForField(sheet, candidate.field);
    if (want == null) return true;
  }
  if (ACCESSORIAL_IDS.includes(candidate.id) || ACCESSORIAL_IDS.includes(candidate.field)) {
    const id = ACCESSORIAL_IDS.includes(candidate.id) ? candidate.id : candidate.field;
    const want = expectedAccessorials(sheet);
    if (candidate.kind === "check" || candidate.kind === "uncheck" || candidate.kind === "click") {
      if (candidate.checked) return want.includes(id);
      return !want.includes(id);
    }
  }
  return false;
}

export function pickHeuristicAction(candidates, sheet, snapshot = {}) {
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && c.id) : [];
  if (!list.length) {
    return { actionId: null, reason: "no-candidates", candidate: null };
  }
  const filled = snapshot.values || snapshot.filled || {};
  const status = String(snapshot.status || "").toLowerCase();
  if (status === "quoted") {
    return { actionId: null, reason: "already-quoted", candidate: null };
  }

  const fillable = list.filter((c) => {
    if (c.kind !== "fill" && c.role !== "textbox" && c.role !== "input") return false;
    if (!c.field || !SHEET_FIELD_GETTERS[c.field]) return false;
    if (c.decoy || DECOY_ACTION_IDS.includes(c.id)) return false;
    const want = sheetValueForField(sheet, c.field);
    if (want == null) return false;
    const current = String(c.current ?? filled[c.field] ?? "").trim();
    return current !== want;
  });
  if (fillable.length) {
    return { actionId: fillable[0].id, reason: "fill-missing", candidate: fillable[0] };
  }

  const wantAcc = expectedAccessorials(sheet);
  const currentAcc = normalizeAccessorials(filled.accessorials);
  const toggle = list.find((c) => {
    const id = ACCESSORIAL_IDS.includes(c.id) ? c.id : c.field;
    if (!ACCESSORIAL_IDS.includes(id)) return false;
    const shouldOn = wantAcc.includes(id);
    const isOn = c.checked == null ? currentAcc.includes(id) : Boolean(c.checked);
    return shouldOn !== isOn;
  });
  if (toggle) {
    return { actionId: toggle.id, reason: "toggle-accessorial", candidate: toggle };
  }

  const byId = (id) => list.find((c) => c.id === id);
  if (status === "review" && byId("get-rates")) {
    return { actionId: "get-rates", reason: "submit-review", candidate: byId("get-rates") };
  }
  if (byId("continue")) {
    return { actionId: "continue", reason: "advance", candidate: byId("continue") };
  }
  if (byId("get-rates") && fieldAccuracy(filled, sheet).correct === REQUIRED_SCORE_FIELDS.length) {
    return { actionId: "get-rates", reason: "submit-complete", candidate: byId("get-rates") };
  }

  return { actionId: null, reason: "stuck", candidate: null };
}

export function emptyScorecard() {
  return {
    success: false,
    wall_s: null,
    cost_usd: 0,
    steps: 0,
    wrong: 0,
    clarifies: 0,
    field_acc: 0,
    notes: "",
    jev_calls: 0,
    jev_confidences: [],
    jev_gate_blocks: 0,
    cu_steps: 0,
    stop_reason: null,
    filled: {},
  };
}

export function average(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) return null;
  return Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 1000) / 1000;
}

export function formatScorecardRow(arm, card) {
  const wall = Number.isFinite(card.wall_s) ? card.wall_s : "";
  const cost = Number.isFinite(card.cost_usd) ? card.cost_usd.toFixed(6) : "";
  const acc = Number.isFinite(card.field_acc) ? `${card.field_acc}%` : "";
  return `| ${arm} | ${card.success ? "yes" : "no"} | ${wall} | ${cost} | ${card.steps} | ${card.wrong} | ${card.clarifies} | ${acc} | ${card.notes || ""} |`;
}
