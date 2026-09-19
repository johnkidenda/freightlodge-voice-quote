import { getSttTokenUrl } from "./stt-providers.js";
import {
  buildJevState,
  formatJevStamp,
  normalizeJevDecision,
  offDecision,
} from "./jev-core.js";

export {
  JEV_THRESHOLD,
  JEV_SLOT_IDS,
  JEV_SLOT_TO_AWAITING,
  JEV_CLARIFY_SCRIPTS,
  appendJevLog,
  awaitingSlotIsFilled,
  buildJevQuestions,
  buildJevState,
  formatJevStamp,
  formatJevTranscriptLine,
  guardJevDecision,
  interpretJevAnswers,
  jevClarifyScript,
  normalizeJevDecision,
  offDecision,
  utteranceCorrectsSlot,
} from "./jev-core.js";

export const JEV_STORAGE_KEY = "freightlodge.jev";

/** `?jev=0` / `off` / `false` disables; `?jev=1` re-enables. */
export function readJevQueryFlag(search) {
  const raw = String(search ?? "");
  const qs = raw.startsWith("?") ? raw.slice(1) : raw;
  const params = new URLSearchParams(qs);
  if (!params.has("jev")) return null;
  const v = String(params.get("jev") || "").trim().toLowerCase();
  if (v === "0" || v === "off" || v === "false" || v === "no") return false;
  if (v === "1" || v === "on" || v === "true" || v === "yes") return true;
  return null;
}

export function isJevDisabled({ search, storage } = {}) {
  const querySearch = search ?? (typeof location !== "undefined" ? location.search : "");
  const store = storage === undefined
    ? typeof localStorage !== "undefined" ? localStorage : null
    : storage;
  const fromQuery = readJevQueryFlag(querySearch);
  if (fromQuery === false) {
    try {
      store?.setItem?.(JEV_STORAGE_KEY, "0");
    } catch {
      /* quota / private mode */
    }
    return true;
  }
  if (fromQuery === true) {
    try {
      store?.setItem?.(JEV_STORAGE_KEY, "1");
    } catch {
      /* quota / private mode */
    }
    return false;
  }
  try {
    return store?.getItem?.(JEV_STORAGE_KEY) === "0";
  } catch {
    return false;
  }
}

const JEV_TIMEOUT_MS = 2500;

/** Sibling of the token mint URL. TYPESAFE_API_KEY stays on the proxy. */
export function getJevProxyUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const tokenUrl = getSttTokenUrl(env);
  if (!tokenUrl) return "";
  const trimmed = tokenUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/stt-token")) return `${trimmed.slice(0, -"/stt-token".length)}/jev`;
  if (trimmed.endsWith("/token")) return `${trimmed.slice(0, -"/token".length)}/jev`;
  return `${trimmed}/jev`;
}

export function recentAssistantReplies(messages, limit = 3) {
  return (messages || [])
    .filter((m) => m?.role === "assistant" && m?.text)
    .map((m) => String(m.text))
    .slice(-limit);
}

/**
 * One post-utterance Jev call via the server proxy.
 * Never throws. Missing URL / no key / timeout → off (heuristics only).
 */
export async function fetchJevDecision({
  utterance,
  sheet,
  recentReplies = [],
  awaiting = null,
  askedAccessorials = false,
  url,
  fetchImpl,
  timeoutMs = JEV_TIMEOUT_MS,
  search,
  storage,
} = {}) {
  if (isJevDisabled({ search, storage })) return offDecision("disabled");
  const text = String(utterance || "").trim();
  const proxy = url == null ? getJevProxyUrl() : String(url).trim();
  if (!text || !proxy) return offDecision(proxy ? "empty utterance" : "no proxy");

  const fetchFn = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return offDecision("no fetch");

  const body = {
    utterance: text,
    sheet: sheet && typeof sheet === "object" ? sheet : {},
    recent_replies: recentReplies,
    awaiting: awaiting || null,
    asked_accessorials: Boolean(askedAccessorials),
  };

  let res;
  try {
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    res = await fetchFn(proxy, init);
  } catch (err) {
    const msg = String(err?.name || err?.message || err);
    if (/abort|timeout/i.test(msg)) return offDecision("timeout");
    return offDecision("proxy failed");
  }

  if (!res || res.status === 503) return offDecision("no key");
  if (!res.ok) return offDecision("proxy failed");

  let data = {};
  try {
    data = typeof res.json === "function" ? await res.json() : {};
  } catch {
    return offDecision("bad response");
  }

  if (data?.jev === "off" || data?.ok === false) {
    return offDecision(data?.error === "Jev proxy not configured" ? "no key" : data?.error || "off");
  }
  if (data?.decision) return normalizeJevDecision({ on: true, ...data.decision, answers: data.answers });
  if (data?.answers) return normalizeJevDecision({ on: true, answers: data.answers });
  return offDecision("empty answers");
}

export function jevClientState(payload) {
  return buildJevState(payload);
}

export function jevQaLine(decision) {
  return formatJevStamp(decision);
}
