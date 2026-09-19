/**
 * Jev (TypeSafe System One) DOM-step Choice for the fake Exfresso pilot.
 * Feed listed candidates only. Do not invent action ids or selectors.
 * TYPESAFE_API_KEY never lives here.
 */

import { JEV_MODEL, JEV_THRESHOLD, choiceAct, noulAct, scoreAct } from "./jev-core.js";

export { JEV_MODEL, JEV_THRESHOLD };

export const JEV_ACTION_META_IDS = Object.freeze(["stop", "clarify"]);

/** Published TypeSafe Jev input price. Output tokens are free. Do not invent other rates. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

export function usageCostUsd(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  if (!Number.isFinite(input) || input <= 0) return 0;
  return (input / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
}

export function offActionDecision(reason = "off") {
  return {
    on: false,
    reason: String(reason || "off"),
    act: false,
    actionId: null,
    choice: null,
    confidence: null,
    needsClarify: false,
    lowScore: false,
    gateBlocked: false,
    candidateIds: [],
    actionScore: null,
    actionScoreConfidence: null,
    clarifyNoul: null,
  };
}

export function normalizeCandidates(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    if (!id || seen.has(id) || JEV_ACTION_META_IDS.includes(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: String(item.kind || item.role || "action").trim() || "action",
      role: String(item.role || "").trim() || null,
      label: String(item.label || item.name || id).trim() || id,
      selector: String(item.selector || "").trim() || `[data-pilot-id="${id}"]`,
      field: item.field ? String(item.field).trim() : null,
      required: Boolean(item.required),
      current: item.current == null ? "" : String(item.current),
      checked: item.checked == null ? null : Boolean(item.checked),
      decoy: Boolean(item.decoy),
    });
  }
  return out;
}

export function describeCandidate(candidate) {
  const c = candidate;
  const bits = [
    `${c.kind} labeled "${c.label}"`,
    c.role ? `role=${c.role}` : null,
    c.field ? `maps to sheet field ${c.field}` : "no sheet field",
    c.required ? "required" : "optional",
    c.current ? `current=${c.current}` : "empty",
    c.checked == null ? null : c.checked ? "checked" : "unchecked",
    c.decoy ? "looks similar to a real control; may be a trap" : null,
    `selector ${c.selector}`,
  ];
  return bits.filter(Boolean).join(". ");
}

export function buildJevActionQuestions(candidates) {
  const list = normalizeCandidates(candidates);
  const criteria = {};
  for (const c of list) {
    criteria[c.id] = describeCandidate(c);
  }
  criteria.stop = "No listed candidate is a safe next step. Pause. Do not invent a new action.";
  criteria.clarify =
    "Two or more listed candidates could be right. Ask a human. Do not guess among similar labels.";
  return {
    next_action: {
      type: "choice",
      instructions:
        "Which listed candidate should the computer-use runner do next to complete the quote sheet without inventing ZIP, weight, pieces, date, accessorials, or email? Use only these candidate ids. Do not invent a new action, label, or selector. Prefer filling the next empty required sheet field. Do not click a sample, draft, or skip control. Do not click Get rates until required sheet fields are present on the form. If the form is on review and fields match the sheet, choose Get rates.",
      criteria,
    },
    needs_clarify: {
      type: "noul",
      instructions:
        "Should the runner stop and ask a human instead of acting? Yes if the next step is ambiguous among listed candidates, a required sheet field has no value to type, or Get rates would submit incomplete or sample data. No if one listed candidate is the clear next fill or click.",
      criteria: {
        true: "Ambiguous candidates, missing sheet value, or unsafe submit.",
        false: "One listed candidate is the clear next step.",
      },
    },
    action_confidence: {
      type: "score",
      instructions: "How sure are you that the chosen listed candidate is the correct next action?",
      criteria: [
        "Guessing among similar buttons or fields.",
        "Mostly clear, but a similar label exists.",
        "The listed candidate uniquely matches the next missing sheet field or the correct submit.",
      ],
    },
  };
}

export function buildJevActionState({
  sheet,
  candidates,
  step = null,
  status = null,
  filled = null,
} = {}) {
  const list = normalizeCandidates(candidates);
  return {
    quote_sheet: sheet && typeof sheet === "object" ? sheet : {},
    form_step: step || null,
    form_status: status || null,
    filled_snapshot: filled && typeof filled === "object" ? filled : {},
    visible_candidates: list,
    candidate_ids: list.map((c) => c.id),
    task: "Fill the fake Exfresso quote form from quote_sheet. Stop at quoted. Never invent field values.",
  };
}

export function interpretJevActionAnswers(answers, candidates, threshold = JEV_THRESHOLD) {
  const list = normalizeCandidates(candidates);
  const ids = list.map((c) => c.id);
  if (!answers || typeof answers !== "object") {
    return { ...offActionDecision("no answers"), candidateIds: ids };
  }
  const primary = choiceAct(answers.next_action, threshold);
  const clarify = noulAct(answers.needs_clarify, threshold);
  const score = scoreAct(answers.action_confidence, threshold);
  const rawChoice = primary.choice;
  const listed = rawChoice && ids.includes(rawChoice);
  const meta = rawChoice && JEV_ACTION_META_IDS.includes(rawChoice);
  const needsClarify = Boolean((clarify.act && clarify.yes) || (primary.act && rawChoice === "clarify"));
  const lowScore = Boolean(score.act && score.score < 1);
  const stopChoice = Boolean(primary.act && rawChoice === "stop");
  const invented = Boolean(rawChoice && !listed && !meta);
  const gateBlocked = Boolean(needsClarify || stopChoice || !primary.act || invented || lowScore);
  const actionId = !gateBlocked && listed ? rawChoice : null;
  return {
    on: true,
    reason: invented ? "invented-choice" : null,
    act: Boolean(actionId),
    actionId,
    choice: rawChoice || null,
    confidence: primary.confidence,
    needsClarify,
    lowScore,
    gateBlocked,
    candidateIds: ids,
    actionScore: score.score,
    actionScoreConfidence: score.confidence,
    clarifyNoul: clarify.noul,
  };
}

export function formatJevActionStamp(decision) {
  if (!decision || decision.on === false) {
    const reason = decision?.reason;
    return reason && reason !== "off" ? `Jev-action: off (${reason})` : "Jev-action: off";
  }
  const bits = ["Jev-action: on"];
  if (decision.actionId) bits.push(`pick=${decision.actionId}`);
  else if (decision.choice) bits.push(`pick=${decision.choice}`);
  if (Number.isFinite(decision.confidence)) {
    bits.push(`conf=${Math.round(decision.confidence * 100) / 100}`);
  }
  if (decision.gateBlocked) bits.push("gate=block");
  else if (decision.act) bits.push("gate=act");
  if (decision.needsClarify) bits.push("clarify");
  return bits.join(" ");
}
