import { getSttTokenUrl } from "./stt-providers.js";

/**
 * Default Cartesia TTS voice — sales / customer-service leaning.
 * Skylar · Friendly Guide · approachable American female for customer care.
 * https://play.cartesia.ai/voices
 */
export const CARTESIA_TTS_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";
export const CARTESIA_TTS_VOICE_NAME = "Skylar";
export const CARTESIA_TTS_VOICE_TAGLINE = "Friendly Guide";
export const CARTESIA_TTS_MODEL = "sonic-3";

export const CARTESIA_TTS_BYTES_URL = "https://api.cartesia.ai/tts/bytes";

/** Sibling of the token mint URL so CARTESIA_API_KEY never ships in the Pages bundle. */
export function getTtsProxyUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const tokenUrl = getSttTokenUrl(env);
  if (!tokenUrl) return "";
  const trimmed = tokenUrl.replace(/\/$/, "");
  if (trimmed.endsWith("/stt-token")) return `${trimmed.slice(0, -"/stt-token".length)}/tts`;
  if (trimmed.endsWith("/token")) return `${trimmed.slice(0, -"/token".length)}/tts`;
  return `${trimmed}/tts`;
}

export function buildCartesiaTtsBody(transcript, { voiceId = CARTESIA_TTS_VOICE_ID, modelId = CARTESIA_TTS_MODEL } = {}) {
  return {
    model_id: modelId,
    transcript: String(transcript || ""),
    voice: { id: voiceId },
    language: "en",
    output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
  };
}

/**
 * Fetch spoken audio for an agent reply. Uses the token-proxy `/tts` sibling
 * (key stays server-side). No-ops when the proxy URL is unset.
 */
export async function fetchTtsAudio(transcript, { url, fetchImpl } = {}) {
  const text = String(transcript || "").trim();
  const proxy = url == null ? getTtsProxyUrl() : String(url).trim();
  if (!text || !proxy) return null;
  const fetchFn = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return null;
  const res = await fetchFn(proxy, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ transcript: text, voice_id: CARTESIA_TTS_VOICE_ID }),
  });
  if (!res?.ok) return null;
  if (typeof res.arrayBuffer === "function") return res.arrayBuffer();
  if (typeof res.blob === "function") return res.blob();
  return null;
}

let currentAudio = null;

export function stopAgentSpeech() {
  try {
    currentAudio?.pause?.();
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

export async function speakAgentReply(transcript, { url, fetchImpl, playAudio } = {}) {
  const data = await fetchTtsAudio(transcript, { url, fetchImpl });
  if (!data) return false;
  if (typeof playAudio === "function") {
    await playAudio(data);
    return true;
  }
  if (typeof Audio === "undefined" || typeof URL === "undefined") return false;
  const blob = data instanceof Blob ? data : new Blob([data], { type: "audio/mpeg" });
  const objectUrl = URL.createObjectURL(blob);
  stopAgentSpeech();
  const audio = new Audio(objectUrl);
  currentAudio = audio;
  audio.onended = () => {
    if (currentAudio === audio) currentAudio = null;
    URL.revokeObjectURL(objectUrl);
  };
  try {
    await audio.play();
    return true;
  } catch {
    URL.revokeObjectURL(objectUrl);
    return false;
  }
}
