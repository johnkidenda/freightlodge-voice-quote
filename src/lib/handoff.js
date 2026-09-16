import { isReadyForQuote } from "./completeness.js";

export const HANDOFF_PATH = "/api/quote-handoff";

/**
 * Freight Ops contract (replace the stub with the Exfresso runner):
 *
 * POST /api/quote-handoff
 * { "quote_sheet": { ...Quote Sheet v1... } }
 *
 * 200:
 * { "ok": true, "mode": "exfresso"|"stub", "quote_sheet": { ...status quoted, quote_result filled } }
 *
 * Out of scope / runner error (still 200 with honest sheet, or 422):
 * { "ok": false, "quote_sheet": { "status": "out_of_scope"|"error", "out_of_scope_reason"|"error_reason": "..." } }
 *
 * Never return a fake rate when status is out_of_scope.
 * If the UI automation yields multiple rate rows, pick lowest total_usd.
 */
export function buildCandidateRates(sheet) {
  const weight =
    typeof sheet.freight?.total_weight_lbs === "number" && sheet.freight.total_weight_lbs > 0
      ? sheet.freight.total_weight_lbs
      : estimateWeightFromDims(sheet.freight?.dims);
  const safeWeight = weight || 500;
  const acc = (sheet.pickup?.accessorials || []).length;
  const base = 165 + safeWeight * 0.11 + acc * 42;
  const quoted_at = new Date().toISOString();
  return [
    rate("XPO Logistics", "LTL Economy", base * 0.94, 4, 6, quoted_at),
    rate("Estes Express", "LTL Standard", base * 1.05, 3, 5, quoted_at),
    rate("Old Dominion", "LTL Standard", base * 1.16, 2, 4, quoted_at),
  ];
}

function estimateWeightFromDims(dims) {
  if (!dims) return null;
  const { length_in, width_in, height_in } = dims;
  if (![length_in, width_in, height_in].every((n) => typeof n === "number" && n > 0)) return null;
  const cubicFeet = (length_in * width_in * height_in) / 1728;
  return Math.round(cubicFeet * 10);
}

function rate(carrier, service, total, min, max, quoted_at) {
  const total_usd = Math.round(total * 100) / 100;
  return {
    carrier,
    service,
    total_usd,
    transit_days_min: min,
    transit_days_max: max,
    quote_id: null,
    raw_summary: null,
    quoted_at,
  };
}

export function pickLowestRate(rates) {
  if (!Array.isArray(rates) || !rates.length) return null;
  return rates.reduce((best, row) => {
    if (best == null) return row;
    if (typeof row.total_usd !== "number") return best;
    if (typeof best.total_usd !== "number") return row;
    return row.total_usd < best.total_usd ? row : best;
  }, null);
}

export function simulateExfressoRunner(sheet, { now } = {}) {
  if (sheet.status === "out_of_scope") {
    return {
      ok: false,
      mode: "stub",
      quote_sheet: { ...structuredClone(sheet), quote_result: null },
    };
  }
  if (!isReadyForQuote(sheet)) {
    return {
      ok: false,
      mode: "stub",
      quote_sheet: {
        ...structuredClone(sheet),
        status: "error",
        error_reason: "Sheet is not ready_for_quote — missing required fields. No rate invented.",
        quote_result: null,
      },
    };
  }

  const candidates = buildCandidateRates(sheet);
  const best = pickLowestRate(candidates);
  const quoted_at = now ? new Date(now).toISOString() : new Date().toISOString();
  const quote_id = `FL-STUB-${(sheet.quote_request_id || "local").slice(0, 8).toUpperCase()}`;
  const quote_result = {
    ...best,
    quote_id,
    quoted_at,
    raw_summary: `${best.carrier} ${best.service} · $${best.total_usd.toFixed(2)} · ${best.transit_days_min}–${best.transit_days_max} day transit (lowest of ${candidates.length} stub rows; Exfresso will replace this).`,
  };

  return {
    ok: true,
    mode: "stub",
    quote_sheet: {
      ...structuredClone(sheet),
      status: "quoted",
      error_reason: null,
      quote_result,
    },
  };
}

export function handoffUrl(apiBase = "") {
  const override =
    globalThis.FREIGHT_OPS_HANDOFF_URL ||
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_HANDOFF_URL);
  if (override) return override;
  const base = apiBase.replace(/\/$/, "");
  return `${base}${HANDOFF_PATH}`;
}

export async function requestQuote(sheet, { fetchFn, apiBase, delayMs = 700 } = {}) {
  const quoting = {
    ...structuredClone(sheet),
    status: "quoting",
    quote_result: null,
  };

  const url = handoffUrl(apiBase);
  try {
    const res = await (fetchFn || fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ quote_sheet: quoting }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.quote_sheet) return data;
    }
    if (res.status !== 404 && res.status !== 405) {
      const errSheet = {
        ...quoting,
        status: "error",
        error_reason: `Handoff endpoint returned HTTP ${res.status}`,
        quote_result: null,
      };
      return { ok: false, mode: "error", quote_sheet: errSheet };
    }
  } catch {
    // Static GitHub Pages has no API — fall through to in-browser stub.
  }

  if (delayMs) await sleep(delayMs);
  return simulateExfressoRunner(quoting);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
