/**
 * Gemini 3.8 Flash TTS (Generative Language API, Interactions).
 *
 * Docs (model id is John's `gemini-3.8-flash-tts`, which matches the guide):
 * https://ai.google.dev/gemini-api/docs/speech-generation
 * https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash-tts
 *
 * Unary requests return WAV (`audio/wav`) by default. Raw PCM (`audio/l16`)
 * is wrapped as 24 kHz 16-bit mono WAV so the browser can play it.
 * GEMINI_API_KEY stays on this process. Never log it.
 *
 * Lower-latency swap (same request shape): set GEMINI_TTS_MODEL to
 * `gemini-3.8-flash-lite-tts`.
 */

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";
export const GEMINI_TTS_LITE_MODEL = "gemini-3.8-flash-lite-tts";
export const GEMINI_TTS_DEFAULT_VOICE = "Kore";
export const GEMINI_TTS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Short delivery style. Goes in speech_metadata, never in the spoken transcript. */
export const GEMINI_TTS_STYLE = "warm, clear, brief customer-service";

const MAX_TEXT = 2000;
const PCM_SAMPLE_RATE = 24000;

export function geminiTtsConfigured(env) {
  return Boolean(String(env?.GEMINI_API_KEY || "").trim());
}

export function resolveGeminiTtsModel(env) {
  const raw = String(env?.GEMINI_TTS_MODEL || "").trim();
  if (raw === GEMINI_TTS_LITE_MODEL || raw === GEMINI_TTS_MODEL) return raw;
  return GEMINI_TTS_MODEL;
}

export function resolveGeminiVoice(voice) {
  const raw = String(voice || "").trim();
  if (!raw) return GEMINI_TTS_DEFAULT_VOICE;
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,32}$/.test(raw)) return GEMINI_TTS_DEFAULT_VOICE;
  return raw;
}

/**
 * Gemini 3.8 TTS speaks `text` verbatim. Drop director prefixes and
 * bracket/paren stage directions so they are not read aloud.
 */
export function stripStageDirections(text) {
  if (typeof text !== "string") return "";
  let s = text.replace(/^\uFEFF/, "");
  s = s.replace(
    /^(?:say|speak|read)\s+(?:this\s+)?(?:cheerfully|warmly|softly|calmly|slowly|excitedly|clearly|briefly|in a [a-z][a-z\s-]{0,40})?\s*:\s*/i,
    "",
  );
  s = s.replace(
    /\[(?:excited|warm(?:ly)?|cheerfully|softly|whisper(?:ing)?|slowly|calmly|friendly|enthusiastic|urgent(?:ly)?|say [^\]]{0,40})\]/gi,
    " ",
  );
  s = s.replace(
    /\((?:excited|warm(?:ly)?|cheerfully|softly|whisper(?:ing)?|slowly|calmly|friendly|say [^)]{0,40})\)/gi,
    " ",
  );
  s = s.replace(/\*(?:excited|warm(?:ly)?|cheerfully|softly|whisper(?:s|ing)?|slowly|calmly)\*/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function buildGeminiTtsRequest(text, { voice, model = GEMINI_TTS_MODEL } = {}) {
  const spoken = stripStageDirections(text);
  return {
    model,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: spoken,
            annotations: [
              {
                type: "speech_metadata",
                style: GEMINI_TTS_STYLE,
              },
            ],
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: {
      speech_config: [{ voice: resolveGeminiVoice(voice) }],
    },
  };
}

export function pcm16leToWav(pcm, sampleRate = PCM_SAMPLE_RATE) {
  const src = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm || []);
  const data = src.length % 2 === 0 ? src : src.subarray(0, src.length - 1);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  const rate = Number.isFinite(sampleRate) && sampleRate >= 8000 && sampleRate <= 96000 ? sampleRate : PCM_SAMPLE_RATE;
  write(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length);
  out.set(new Uint8Array(header), 0);
  out.set(data, 44);
  return out;
}

function sampleRateFromMime(mime) {
  const match = /rate=(\d+)/i.exec(String(mime || ""));
  const n = match ? Number(match[1]) : PCM_SAMPLE_RATE;
  return n >= 8000 && n <= 96000 ? n : PCM_SAMPLE_RATE;
}

export function decodeBase64(b64) {
  const clean = String(b64 || "").replace(/\s/g, "");
  if (!clean) return new Uint8Array();
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function ascii4(bytes) {
  if (!bytes || bytes.length < 4) return "";
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

/** Return browser-playable bytes. WAV passes through; PCM is wrapped. */
export function toPlayableAudio(bytes, mime) {
  const type = String(mime || "").toLowerCase();
  const head = ascii4(bytes);
  if (head === "RIFF" || (type.includes("wav") && head === "RIFF")) {
    return { bytes, contentType: "audio/wav" };
  }
  if (type.includes("wav")) {
    return { bytes: pcm16leToWav(bytes, sampleRateFromMime(type)), contentType: "audio/wav" };
  }
  if (head === "OggS" || type.includes("ogg")) {
    return { bytes, contentType: "audio/ogg" };
  }
  if (
    head === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
    type.includes("mpeg") ||
    type.includes("mp3")
  ) {
    return { bytes, contentType: "audio/mpeg" };
  }
  return { bytes: pcm16leToWav(bytes, sampleRateFromMime(type)), contentType: "audio/wav" };
}

function pushAudio(out, data, mime) {
  if (!data || out.length) return;
  out.push({ data, mime: mime || "" });
}

function collectAudio(node, out, depth) {
  if (!node || depth > 8 || out.length) return;
  if (Array.isArray(node)) {
    for (const item of node) collectAudio(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  const inline = node.inlineData || node.inline_data;
  if (inline?.data) {
    pushAudio(out, inline.data, inline.mimeType || inline.mime_type);
    return;
  }
  if (typeof node.data === "string" && (node.mime_type || node.mimeType || node.type === "audio")) {
    pushAudio(out, node.data, node.mime_type || node.mimeType);
    return;
  }
  for (const key of ["output_audio", "outputAudio", "content", "parts", "candidates", "steps", "delta"]) {
    if (node[key]) collectAudio(node[key], out, depth + 1);
  }
}

export function audioFromGeminiPayload(payload) {
  const found = [];
  collectAudio(payload, found, 0);
  if (!found.length) return null;
  const raw = decodeBase64(found[0].data);
  if (!raw.length) return null;
  return toPlayableAudio(raw, found[0].mime || "audio/wav");
}

function redact(detail, apiKey) {
  let s = String(detail || "");
  if (apiKey) s = s.split(String(apiKey)).join("[redacted]");
  return s.replace(/AIza[0-9A-Za-z\-_]{10,}/g, "[redacted]");
}

function ttsError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Call Gemini TTS. Returns `{ bytes, contentType }`.
 * Throws coded errors: TTS_UNCONFIGURED, TTS_EMPTY, TTS_UPSTREAM.
 */
export async function synthesizeGeminiTts({ apiKey, text, voice, fetchImpl, env } = {}) {
  const key = String(apiKey || "").trim();
  if (!key) throw ttsError("GEMINI_API_KEY is not set", "TTS_UNCONFIGURED");
  if (typeof text !== "string") throw ttsError("text is required", "TTS_EMPTY");
  if (text.length > MAX_TEXT) throw ttsError("text is too long", "TTS_EMPTY");
  const spoken = stripStageDirections(text);
  if (!spoken) throw ttsError("text is required", "TTS_EMPTY");

  const fetchFn = fetchImpl || fetch;
  const payload = buildGeminiTtsRequest(spoken, {
    voice,
    model: resolveGeminiTtsModel(env),
  });
  let res;
  try {
    res = await fetchFn(GEMINI_TTS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw ttsError("Gemini TTS request failed", "TTS_UPSTREAM");
  }
  if (!res?.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    const safe = redact(detail, key).slice(0, 180);
    throw ttsError(`Gemini TTS failed (${res.status})${safe ? `: ${safe}` : ""}`, "TTS_UPSTREAM");
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw ttsError("Gemini TTS returned no audio", "TTS_UPSTREAM");
  }
  const audio = audioFromGeminiPayload(json);
  if (!audio?.bytes?.length) throw ttsError("Gemini TTS returned no audio", "TTS_UPSTREAM");
  return audio;
}
