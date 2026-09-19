/**
 * Server-only TypeSafe System One Choice for one fake-Exfresso DOM step.
 * TYPESAFE_API_KEY must never leave this process or appear in VITE_*.
 */
import { callTypesafeSystemOne } from "./jev.js";
import {
  JEV_MODEL,
  buildJevActionQuestions,
  buildJevActionState,
  interpretJevActionAnswers,
  normalizeCandidates,
  offActionDecision,
  usageCostUsd,
} from "../../src/lib/jev-action-core.js";

export {
  buildJevActionQuestions,
  buildJevActionState,
  interpretJevActionAnswers,
  normalizeCandidates,
  offActionDecision,
  usageCostUsd,
};

export async function evaluateDomAction({
  apiKey,
  sheet,
  candidates,
  step = null,
  status = null,
  filled = null,
  fetchImpl,
} = {}) {
  if (!apiKey) {
    const err = new Error("Jev proxy not configured");
    err.code = "JEV_UNCONFIGURED";
    throw err;
  }
  const list = normalizeCandidates(candidates);
  if (!list.length) {
    const err = new Error("candidates are required");
    err.code = "JEV_EMPTY";
    throw err;
  }
  const state = buildJevActionState({ sheet, candidates: list, step, status, filled });
  const questions = buildJevActionQuestions(list);
  const raw = await callTypesafeSystemOne({ apiKey, state, questions, fetchImpl });
  const answers = raw?.answers || {};
  const decision = interpretJevActionAnswers(answers, list);
  const usage = raw?.usage || null;
  return {
    ok: true,
    jev: "on",
    model: raw?.model || JEV_MODEL,
    answers,
    decision,
    usage,
    cost_usd: usageCostUsd(usage),
    candidates: list.map((c) => c.id),
  };
}
