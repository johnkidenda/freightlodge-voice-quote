export const CARTESIA_VERSION = "2026-08-14";
export const CARTESIA_TOKEN_URL = "https://api.cartesia.ai/access-token";
export const CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes";
export const DEFAULT_EXPIRES_IN = 90;

/** Skylar — Friendly Guide. Sales / customer-care leaning. Key stays server-side. */
export const CARTESIA_TTS_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
export const CARTESIA_TTS_VOICE_NAME = "Skylar";
export const CARTESIA_TTS_MODEL = "sonic-3";

/**
 * Server-only: mint a short-lived Cartesia access_token.
 * TTS is the live grant (spoken replies). STT stays on the token for
 * compatibility; the Pages client no longer opens Cartesia STT sockets.
 * CARTESIA_API_KEY must never leave this process.
 */
export async function mintCartesiaToken({
  apiKey,
  expiresIn = DEFAULT_EXPIRES_IN,
  fetchImpl,
  grants = { tts: true, stt: true },
} = {}) {
  if (!apiKey) {
    const err = new Error("CARTESIA_API_KEY is not set");
    err.code = "STT_TOKEN_UNCONFIGURED";
    throw err;
  }
  const fetchFn = fetchImpl || fetch;
  const ttl = clampExpires(expiresIn);
  const res = await fetchFn(CARTESIA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grants,
      expires_in: ttl,
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Cartesia token mint failed (${res.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const data = await res.json();
  if (!data?.token) throw new Error("Cartesia token mint returned no token");
  return { token: data.token, expires_in: ttl };
}

/**
 * Server-only: Cartesia TTS bytes. CARTESIA_API_KEY never leaves this process.
 */
export async function synthesizeCartesiaTts({
  apiKey,
  transcript,
  voiceId = CARTESIA_TTS_VOICE_ID,
  fetchImpl,
} = {}) {
  if (!apiKey) {
    const err = new Error("CARTESIA_API_KEY is not set");
    err.code = "STT_TOKEN_UNCONFIGURED";
    throw err;
  }
  const text = String(transcript || "").trim();
  if (!text) {
    const err = new Error("transcript is required");
    err.code = "TTS_EMPTY";
    throw err;
  }
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(CARTESIA_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: CARTESIA_TTS_MODEL,
      transcript: text,
      voice: { id: voiceId },
      language: "en",
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
    }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Cartesia TTS failed (${res.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return res.arrayBuffer();
}

function clampExpires(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRES_IN;
  return Math.min(120, Math.max(60, Math.round(n)));
}

export const PAGES_ORIGIN = "https://johnkidenda.github.io";

export const CORS_ORIGINS = Object.freeze([
  PAGES_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
]);

export function corsHeaders(origin) {
  const allow = CORS_ORIGINS.includes(origin) ? origin : PAGES_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
