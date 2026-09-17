/** Freight vocab to boost via Cartesia `keyterm` (ink-2). Keep well under 1200 chars. */
export const FREIGHT_KEYTERMS = Object.freeze([
  "ZIP",
  "zip code",
  "pounds",
  "lb",
  "lbs",
  "pallet",
  "pallets",
  "liftgate",
  "LTL",
  "NMFC",
  "Freight Lodge",
  "pickup",
  "delivery",
  "residential",
  "appointment",
  "skid",
  "carton",
  "crate",
  "class",
  "hundredweight",
]);

export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA_MODEL = "ink-2";
export const CARTESIA_SAMPLE_RATE = 16000;
export const CARTESIA_ENCODING = "pcm_s16le";
export const CARTESIA_MANUAL_WS = "wss://api.cartesia.ai/stt/websocket";
export const CARTESIA_AUTO_WS = "wss://api.cartesia.ai/stt/turns/websocket";

export function buildCartesiaWsUrl({
  variant = "manual",
  accessToken,
  version = CARTESIA_VERSION,
  model = CARTESIA_MODEL,
  encoding = CARTESIA_ENCODING,
  sampleRate = CARTESIA_SAMPLE_RATE,
  keyterms = FREIGHT_KEYTERMS,
} = {}) {
  if (!accessToken) throw new Error("access_token is required");
  const base = variant === "auto" ? CARTESIA_AUTO_WS : CARTESIA_MANUAL_WS;
  const url = new URL(base);
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", encoding);
  url.searchParams.set("sample_rate", String(sampleRate));
  url.searchParams.set("cartesia_version", version);
  url.searchParams.set("access_token", accessToken);
  if (variant !== "auto") url.searchParams.set("language", "en");
  for (const term of keyterms || []) {
    if (term) url.searchParams.append("keyterm", term);
  }
  return url.toString();
}

/**
 * Concatenate manual-finalize deltas. Do not strip or insert whitespace —
 * Cartesia already includes the spaces that belong between chunks.
 */
export function concatManualFinals(events) {
  let out = "";
  for (const ev of events || []) {
    if (ev?.type === "transcript" && ev.is_final === true && typeof ev.text === "string") {
      out += ev.text;
    }
  }
  return out;
}

export function latestManualInterim(events) {
  const list = events || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const ev = list[i];
    if (ev?.type !== "transcript") continue;
    if (ev.is_final === true) return "";
    if (typeof ev.text === "string") return ev.text;
  }
  return "";
}

export function previewManualTranscript(events) {
  return concatManualFinals(events) + latestManualInterim(events);
}

export function createManualAssembler() {
  const events = [];
  return {
    push(ev) {
      if (!ev || ev.type !== "transcript") return previewManualTranscript(events);
      events.push(ev);
      return previewManualTranscript(events);
    },
    finals() {
      return concatManualFinals(events);
    },
    preview() {
      return previewManualTranscript(events);
    },
    reset() {
      events.length = 0;
    },
  };
}

/**
 * Auto-turn assembler. Preview from cumulative turn.update / eager_end.
 * Commit only on turn.end, once per turn, so the dialog does not double-submit.
 */
export function createAutoTurnAssembler() {
  let current = "";
  let committed = false;
  const seen = new Set();

  function preview() {
    return current;
  }

  return {
    apply(ev) {
      if (!ev || typeof ev !== "object") return { preview: preview(), commit: null };
      const type = ev.type;
      if (type === "turn.start") {
        current = "";
        committed = false;
        return { preview: "", commit: null };
      }
      if (type === "turn.update" || type === "turn.eager_end") {
        if (typeof ev.transcript === "string") current = ev.transcript;
        return { preview: preview(), commit: null };
      }
      if (type === "turn.resume") {
        committed = false;
        return { preview: preview(), commit: null };
      }
      if (type === "turn.end") {
        if (typeof ev.transcript === "string") current = ev.transcript;
        const text = current;
        const key = text;
        if (!text || committed || seen.has(key)) {
          committed = true;
          return { preview: text, commit: null };
        }
        committed = true;
        seen.add(key);
        return { preview: text, commit: text };
      }
      return { preview: preview(), commit: null };
    },
    leftover() {
      if (committed || !current || seen.has(current)) return "";
      seen.add(current);
      committed = true;
      return current;
    },
    preview,
    reset() {
      current = "";
      committed = false;
      seen.clear();
    },
  };
}

export function parseCartesiaMessage(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  const text = String(raw);
  if (text === "finalize" || text === "close") return { type: text };
  try {
    return JSON.parse(text);
  } catch {
    return { type: "text", text };
  }
}
