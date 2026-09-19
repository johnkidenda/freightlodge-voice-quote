/**
 * Jev (TypeSafe System One) decision helpers.
 * No API key here. The token-proxy calls TypeSafe; this file only
 * builds candidates, interprets answers, and formats the QA stamp.
 */

import { hasMeasure, hasMinimumLane, isValidEmail, isValidZip } from "./completeness.js";

export const JEV_THRESHOLD = 0.5;
export const JEV_MODEL = "jev-latest";
export const TYPESAFE_SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";

/** Closed slot list. Feed these as candidates. Do not invent new ids. */
export const JEV_SLOT_IDS = Object.freeze([
  "origin_city",
  "origin_zip",
  "dest_city",
  "dest_zip",
  "weight",
  "pieces",
  "commodity",
  "pickup_date",
  "accessorials",
  "email",
]);

export const JEV_SLOT_CRITERIA = Object.freeze({
  origin_city: "This utterance names or corrects the origin city (not a ZIP).",
  origin_zip: "This utterance gives or corrects the origin 5-digit ZIP.",
  dest_city: "This utterance names or corrects the destination city (not a ZIP).",
  dest_zip: "This utterance gives or corrects the destination 5-digit ZIP.",
  weight: "This utterance gives total weight (pounds or kg) or dims/class as the measure.",
  pieces: "This utterance gives piece or pallet count.",
  commodity: "This utterance names the commodity / what is shipping.",
  pickup_date: "This utterance gives a pickup day or YYYY-MM-DD.",
  accessorials: "This utterance lists accessorials (liftgate, residential, inside) or says none.",
  email: "This utterance gives a contact email address.",
});

export const JEV_SLOT_TO_AWAITING = Object.freeze({
  origin_city: "origin_zip",
  origin_zip: "origin_zip",
  dest_city: "dest_zip",
  dest_zip: "dest_zip",
  weight: "measure",
  pieces: "pieces",
  commodity: "commodity",
  pickup_date: "pickup_date",
  accessorials: "accessorials",
  email: "email",
});

/** User-facing clarify scripts. No em dashes. */
export const JEV_CLARIFY_SCRIPTS = Object.freeze({
  origin_zip: "I want to double-check origin. What’s the five-digit origin ZIP?",
  dest_zip: "I want to double-check destination. What’s the five-digit destination ZIP?",
  measure: "I want to double-check the measure. Total weight in pounds, or L×W×H, or a known NMFC class?",
  pieces: "I want to double-check piece count. How many pieces or pallets?",
  commodity: "I want to double-check the commodity. What is shipping?",
  pickup_date: "I want to double-check pickup. Say a day (today, tomorrow, Friday) or YYYY-MM-DD.",
  accessorials: "I want to double-check accessorials. Liftgate, residential, inside, or none?",
  email: "I want to double-check the email. Type the address if voice mangled it.",
  default: "I want to double-check what I heard. Can you repeat the city, ZIP, or date?",
});

export function offDecision(reason = "off") {
  return {
    on: false,
    reason: String(reason || "off"),
    ready: null,
    needsClarify: false,
    lowParse: false,
    touchedSlots: [],
    primarySlot: null,
    focus: null,
    gateOverride: null,
    readyNoul: null,
    clarifyNoul: null,
    parseScore: null,
    parseConfidence: null,
  };
}

export function buildJevQuestions() {
  const questions = {
    sheet_ready_for_exfresso: {
      type: "noul",
      instructions:
        "Is quote_sheet complete enough to run Exfresso Quote without inventing ZIP, weight, dims, class, pieces, commodity, pickup date, or email? Yes only if those required fields are already present and valid on quote_sheet. City without ZIP is not enough. Do not invent missing fields.",
      criteria: {
        true: "Every required Quote field is already on quote_sheet and valid.",
        false: "At least one required field is missing, invalid, or would have to be invented.",
      },
    },
    needs_clarify: {
      type: "noul",
      instructions:
        "Should the agent ask a clarify question instead of advancing? Yes for city/ZIP mismatch, same ZIP both ends, a soft/vague date (ASAP, soon), or garbled/ambiguous STT that could update the wrong empty slot. No if the focused slot already has a value on quote_sheet unless the utterance clearly corrects it. No if origin ZIP, dest ZIP, and weight/measure are already present; ask the next missing field instead.",
      criteria: {
        true: "City/ZIP mismatch, soft date, or ambiguous STT on a still-empty slot.",
        false: "Utterance is clear enough to apply extracted slots, or the sheet already has origin ZIP, dest ZIP, and weight.",
      },
    },
    primary_slot: {
      type: "choice",
      instructions:
        "Which listed quote-sheet slot is this utterance primarily about? Use only these candidate ids. Do not invent a new slot name.",
      criteria: {
        ...JEV_SLOT_CRITERIA,
        none: "No listed slot is being updated (yes/no, already-said, out of scope, or noise).",
        multiple: "More than one listed slot is being updated (hold-and-dump).",
      },
    },
    parse_confidence: {
      type: "score",
      instructions:
        "How reliably can a rule-based parser read slot values from this utterance given the current quote_sheet?",
      criteria: [
        "Garbled or ambiguous STT. Do not trust new slot values.",
        "Partly clear. Some tokens may be wrong.",
        "Clear utterance. Tokens are reliable.",
      ],
    },
  };
  for (const id of JEV_SLOT_IDS) {
    questions[`touched_${id}`] = {
      type: "noul",
      instructions: `Did this utterance mention or intend to update the ${id} slot? ${JEV_SLOT_CRITERIA[id]} Use only this listed slot. Do not invent another field.`,
      criteria: {
        true: `The utterance clearly touches ${id}.`,
        false: `The utterance does not touch ${id}.`,
      },
    };
  }
  return questions;
}

export function buildJevState({
  utterance,
  sheet,
  recentReplies = [],
  awaiting = null,
  askedAccessorials = false,
} = {}) {
  const replies = (Array.isArray(recentReplies) ? recentReplies : [])
    .map((r) => String(r || "").trim())
    .filter(Boolean)
    .slice(-3)
    .map((r) => (r.length > 180 ? `${r.slice(0, 177)}...` : r));
  return {
    quote_sheet: sheet && typeof sheet === "object" ? sheet : {},
    utterance: String(utterance || "").trim(),
    recent_replies: replies,
    awaiting: awaiting || null,
    asked_accessorials: Boolean(askedAccessorials),
    slot_candidates: JEV_SLOT_IDS,
  };
}

export function noulValue(answer) {
  const n = Number(answer?.noul);
  return Number.isFinite(n) ? n : null;
}

export function choiceAct(answer, threshold = JEV_THRESHOLD) {
  const conf = Number(answer?.confidence);
  const choice = answer?.choice;
  if (!choice || !Number.isFinite(conf) || conf < threshold) {
    return { act: false, choice: null, confidence: Number.isFinite(conf) ? conf : null };
  }
  return { act: true, choice: String(choice), confidence: conf };
}

export function scoreAct(answer, threshold = JEV_THRESHOLD) {
  const conf = Number(answer?.confidence);
  const score = Number(answer?.score);
  if (!Number.isFinite(conf) || conf < threshold || !Number.isFinite(score)) {
    return { act: false, score: Number.isFinite(score) ? score : null, confidence: Number.isFinite(conf) ? conf : null };
  }
  return { act: true, score, confidence: conf };
}

/**
 * Noul: act on yes when noul >= threshold, on no when noul < threshold.
 * A missing noul does not act (fall back to heuristics).
 */
export function noulAct(answer, threshold = JEV_THRESHOLD) {
  const noul = noulValue(answer);
  if (noul == null) return { act: false, yes: null, noul: null };
  return { act: true, yes: noul >= threshold, noul };
}

export function interpretJevAnswers(answers, { reason } = {}) {
  if (!answers || typeof answers !== "object") return offDecision(reason || "no answers");
  const ready = noulAct(answers.sheet_ready_for_exfresso);
  const clarify = noulAct(answers.needs_clarify);
  const parse = scoreAct(answers.parse_confidence);
  const primary = choiceAct(answers.primary_slot);

  const touchedSlots = [];
  for (const id of JEV_SLOT_IDS) {
    const hit = noulAct(answers[`touched_${id}`]);
    if (hit.act && hit.yes) touchedSlots.push(id);
  }

  let primarySlot = null;
  if (primary.act && JEV_SLOT_IDS.includes(primary.choice)) {
    primarySlot = primary.choice;
  } else if (primary.act && (primary.choice === "none" || primary.choice === "multiple")) {
    primarySlot = primary.choice;
  }

  const focus = resolveSlotFocus({ primarySlot, touchedSlots });
  const lowParse = Boolean(parse.act && parse.score < 1);
  const needsClarify = Boolean((clarify.act && clarify.yes) || lowParse);

  return {
    on: true,
    reason: reason || null,
    ready: ready.act ? ready.yes : null,
    needsClarify,
    lowParse,
    touchedSlots,
    primarySlot,
    focus,
    gateOverride: null,
    readyNoul: ready.noul,
    clarifyNoul: clarify.noul,
    parseScore: parse.score,
    parseConfidence: parse.confidence,
  };
}

export function resolveSlotFocus({ primarySlot, touchedSlots = [] } = {}) {
  if (primarySlot && JEV_SLOT_TO_AWAITING[primarySlot]) {
    return JEV_SLOT_TO_AWAITING[primarySlot];
  }
  const awaitingHits = [];
  for (const id of touchedSlots) {
    const mapped = JEV_SLOT_TO_AWAITING[id];
    if (mapped && !awaitingHits.includes(mapped)) awaitingHits.push(mapped);
  }
  if (awaitingHits.length === 1) return awaitingHits[0];
  const zipHits = awaitingHits.filter((s) => s === "origin_zip" || s === "dest_zip");
  if (zipHits.length === 1) return zipHits[0];
  return null;
}

export function awaitingSlotIsFilled(sheet, slot, { askedAccessorials = false } = {}) {
  if (slot === "origin_zip") return isValidZip(sheet?.lanes?.origin?.postal_code);
  if (slot === "dest_zip") return isValidZip(sheet?.lanes?.destination?.postal_code);
  if (slot === "measure") return hasMeasure(sheet?.freight);
  if (slot === "pieces") return Number.isInteger(sheet?.freight?.pieces) && sheet.freight.pieces >= 1;
  if (slot === "commodity") {
    return typeof sheet?.freight?.commodity === "string" && Boolean(sheet.freight.commodity.trim());
  }
  if (slot === "pickup_date") return /^\d{4}-\d{2}-\d{2}$/.test(String(sheet?.pickup?.date || ""));
  if (slot === "accessorials") {
    return Boolean(askedAccessorials || (sheet?.pickup?.accessorials || []).length);
  }
  if (slot === "email") return isValidEmail(sheet?.contact?.email);
  return false;
}

/** Explicit correction, not a restatement of a value already on the sheet. */
export function utteranceCorrectsSlot(text) {
  return /\b(actually|correction|correct( that| the)?|change (the )?(origin|dest|destination|pickup)?\s*(zip|city|date)?|instead|wait,? no|not \d{5}|new (origin|dest|destination) zip)\b/i.test(
    String(text || ""),
  );
}

/**
 * Hard rules on top of raw Jev answers:
 * never focus a filled slot unless the user corrects it;
 * never hold clarify / ready-low when origin+dest ZIPs and weight are present.
 */
export function guardJevDecision(decision, { sheet, utterance, askedAccessorials = false } = {}) {
  const d = normalizeJevDecision(decision);
  if (!d.on) return d;
  const corrects = utteranceCorrectsSlot(utterance);
  const ctx = { askedAccessorials };
  let focus = d.focus;
  if (focus && awaitingSlotIsFilled(sheet, focus, ctx) && !corrects) {
    focus = null;
  }
  let needsClarify = d.needsClarify;
  let ready = d.ready;
  let gateOverride = null;
  if (hasMinimumLane(sheet)) {
    if (needsClarify) {
      needsClarify = false;
      gateOverride = "min-fields";
    }
    if (ready === false) {
      ready = null;
      gateOverride = gateOverride || "min-fields";
    }
  } else if (needsClarify) {
    const clarifySlot = focus || d.focus;
    if (clarifySlot && awaitingSlotIsFilled(sheet, clarifySlot, ctx) && !corrects) {
      needsClarify = false;
      gateOverride = "filled-slot";
    }
  }
  return { ...d, focus, needsClarify, ready, gateOverride };
}

export function normalizeJevDecision(input) {
  if (!input) return offDecision("unused");
  if (input.on === false || input.jev === "off") {
    return offDecision(input.reason || input.error || "off");
  }
  if (input.answers && typeof input.answers === "object") {
    return interpretJevAnswers(input.answers, { reason: input.reason || null });
  }
  if (input.on === true || Array.isArray(input.touchedSlots) || input.primarySlot != null || input.ready != null) {
    const touchedSlots = Array.isArray(input.touchedSlots) ? input.touchedSlots.filter((id) => JEV_SLOT_IDS.includes(id)) : [];
    const primarySlot = JEV_SLOT_IDS.includes(input.primarySlot) || input.primarySlot === "none" || input.primarySlot === "multiple"
      ? input.primarySlot
      : null;
    const focus = Object.prototype.hasOwnProperty.call(input, "focus")
      ? input.focus || null
      : resolveSlotFocus({ primarySlot, touchedSlots });
    return {
      ...offDecision(),
      on: true,
      reason: input.reason || null,
      ready: input.ready === true ? true : input.ready === false ? false : null,
      needsClarify: Boolean(input.needsClarify),
      lowParse: Boolean(input.lowParse),
      touchedSlots,
      primarySlot,
      focus,
      gateOverride: input.gateOverride || null,
      readyNoul: Number.isFinite(Number(input.readyNoul)) ? Number(input.readyNoul) : null,
      clarifyNoul: Number.isFinite(Number(input.clarifyNoul)) ? Number(input.clarifyNoul) : null,
      parseScore: Number.isFinite(Number(input.parseScore)) ? Number(input.parseScore) : null,
      parseConfidence: Number.isFinite(Number(input.parseConfidence)) ? Number(input.parseConfidence) : null,
    };
  }
  return interpretJevAnswers(input);
}

function fmtNum(n) {
  if (!Number.isFinite(n)) return null;
  return String(Math.round(n * 100) / 100);
}

export function formatJevStamp(decision) {
  const d = normalizeJevDecision(decision);
  if (!d.on) {
    return d.reason && d.reason !== "off" && d.reason !== "unused" ? `Jev: off (${d.reason})` : "Jev: off";
  }
  const bits = ["Jev: on"];
  const ready = fmtNum(d.readyNoul);
  if (ready != null) bits.push(`ready=${ready}`);
  const clarify = fmtNum(d.clarifyNoul);
  if (clarify != null) bits.push(`clarify=${clarify}`);
  bits.push(`slots=${d.touchedSlots.length ? d.touchedSlots.join(",") : "none"}`);
  const parse = fmtNum(d.parseScore);
  if (parse != null) bits.push(`parse=${parse}`);
  if (d.focus) bits.push(`focus=${d.focus}`);
  if (d.needsClarify) bits.push("gate=clarify");
  else if (d.gateOverride) bits.push("gate=advance");
  else if (d.ready === false) bits.push("gate=not-ready");
  else if (d.ready === true) bits.push("gate=ready");
  return bits.join(" ");
}

export function formatJevTranscriptLine(session) {
  const log = session?.jevLog;
  if (!Array.isArray(log) || !log.length) return "Jev: off";
  const last = String(log[log.length - 1] || "").trim();
  return last || "Jev: off";
}

export function jevClarifyScript(decision, awaiting) {
  const d = normalizeJevDecision(decision);
  const slot = d.focus || awaiting;
  return JEV_CLARIFY_SCRIPTS[slot] || JEV_CLARIFY_SCRIPTS.default;
}

export function appendJevLog(session, decision) {
  if (!decision) return session?.jevLog || [];
  const stamp = formatJevStamp(decision);
  return [...(session?.jevLog || []), stamp];
}
