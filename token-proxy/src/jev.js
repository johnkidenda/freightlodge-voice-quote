/**
 * Server-only TypeSafe System One (Jev) call.
 * TYPESAFE_API_KEY must never leave this process or appear in VITE_*.
 */
import {
  JEV_MODEL,
  TYPESAFE_SYSTEMONE_URL,
  buildJevQuestions,
  buildJevState,
  interpretJevAnswers,
  offDecision,
} from "../../src/lib/jev-core.js";

export { buildJevQuestions, buildJevState, interpretJevAnswers, offDecision };

export async function callTypesafeSystemOne({ apiKey, state, questions, fetchImpl } = {}) {
  if (!apiKey) {
    const err = new Error("TYPESAFE_API_KEY is not set");
    err.code = "JEV_UNCONFIGURED";
    throw err;
  }
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(TYPESAFE_SYSTEMONE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: JEV_MODEL,
      state,
      questions: questions || buildJevQuestions(),
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    const err = new Error(`TypeSafe Jev failed (${res.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
    err.code = res.status === 401 ? "JEV_UNAUTHORIZED" : "JEV_UPSTREAM";
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function evaluateUtteranceJev({
  apiKey,
  utterance,
  sheet,
  recentReplies = [],
  awaiting = null,
  askedAccessorials = false,
  fetchImpl,
} = {}) {
  const text = String(utterance || "").trim();
  if (!text) {
    const err = new Error("utterance is required");
    err.code = "JEV_EMPTY";
    throw err;
  }
  if (!apiKey) {
    const err = new Error("Jev proxy not configured");
    err.code = "JEV_UNCONFIGURED";
    throw err;
  }
  const state = buildJevState({
    utterance: text,
    sheet,
    recentReplies,
    awaiting,
    askedAccessorials,
  });
  const questions = buildJevQuestions();
  const raw = await callTypesafeSystemOne({ apiKey, state, questions, fetchImpl });
  const answers = raw?.answers || {};
  const decision = interpretJevAnswers(answers);
  return {
    ok: true,
    jev: "on",
    model: raw?.model || JEV_MODEL,
    answers,
    decision,
    usage: raw?.usage || null,
  };
}
