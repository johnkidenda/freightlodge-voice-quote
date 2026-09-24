import { getApiBaseUrl } from "./api-base.js";
import { cancelBrowserSpeech, speakBrowserReply } from "./native-tts.js";

export const TTS_ENGINE_STORAGE_KEY = "freightlodge.ttsEngine";
export const TTS_ENGINES = {
  BROWSER: "browser",
};

/** Fallback engine when the Worker TTS route is unset or fails. */
export const DEFAULT_TTS_ENGINE = TTS_ENGINES.BROWSER;

/** Prefer Worker Gemini TTS, then browser speechSynthesis. About 5s. */
export const GEMINI_TTS_TIMEOUT_MS = 5000;

export function loadTtsEngine() {
  return DEFAULT_TTS_ENGINE;
}

export function saveTtsEngine(_engine, _storage) {
  return DEFAULT_TTS_ENGINE;
}

export function getGeminiTtsUrl(env) {
  const base = getApiBaseUrl(env);
  if (!base) return "";
  if (base.endsWith("/tts")) return base;
  return `${base}/tts`;
}

let speakingListener = null;
let speakingGeneration = 0;
let currentAudio = null;
let activeController = null;

/** UI hook for the gold speaking wave — Gemini playback and browser fallback. */
export function onAgentSpeaking(listener) {
  speakingListener = typeof listener === "function" ? listener : null;
}

function emitSpeaking(on) {
  try {
    speakingListener?.(Boolean(on));
  } catch {
    /* UI hook */
  }
}

function haltAudio() {
  try {
    currentAudio?.pause?.();
  } catch {
    /* ignore */
  }
  currentAudio = null;
}

export function stopAgentSpeech() {
  speakingGeneration += 1;
  try {
    activeController?.abort();
  } catch {
    /* ignore */
  }
  activeController = null;
  haltAudio();
  cancelBrowserSpeech();
  emitSpeaking(false);
}

function readEnv(env) {
  if (env) return env;
  try {
    if (typeof import.meta !== "undefined" && import.meta.env) return import.meta.env;
  } catch {
    /* node tests */
  }
  return undefined;
}

/**
 * POST `{ text }` to `{VITE_API_BASE_URL}/tts`. Returns null on miss, non-OK, or timeout.
 */
export async function fetchGeminiTtsAudio(
  text,
  { url, voice, fetchImpl, timeoutMs = GEMINI_TTS_TIMEOUT_MS, signal, env } = {},
) {
  const spoken = String(text || "").trim();
  const endpoint = url == null ? getGeminiTtsUrl(readEnv(env)) : String(url).trim();
  if (!spoken || !endpoint) return null;
  const fetchFn = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!fetchFn) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort);
  try {
    const body = { text: spoken };
    if (voice) body.voice = voice;
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav, audio/mpeg, audio/ogg, audio/*",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res?.ok) return null;
    const headerType = res.headers?.get?.("Content-Type") || "audio/wav";
    let bytes = null;
    if (typeof res.arrayBuffer === "function") bytes = new Uint8Array(await res.arrayBuffer());
    else if (typeof res.blob === "function") {
      const blob = await res.blob();
      bytes = new Uint8Array(await blob.arrayBuffer());
    }
    if (!bytes?.byteLength) return null;
    return { bytes, contentType: String(headerType).split(";")[0].trim() || "audio/wav" };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

function playWithAudioElement(bytes, contentType, gen, hooks) {
  if (typeof Audio === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const blob = new Blob([bytes], { type: contentType || "audio/wav" });
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    currentAudio = audio;
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
      if (currentAudio === audio) currentAudio = null;
      resolve(ok);
    };
    audio.onended = () => {
      try {
        hooks.onEnd?.();
      } catch {
        /* UI hook */
      }
    };
    audio.onerror = () => finish(false);
    audio.addEventListener("pause", () => {
      if (gen !== speakingGeneration) finish(false);
    });
    audio
      .play()
      .then(() => {
        try {
          hooks.onStart?.();
        } catch {
          /* UI hook */
        }
        finish(true);
      })
      .catch(() => finish(false));
  });
}

async function playGeminiAudio(audio, gen, { playAudio, onStart, onEnd }) {
  const hooks = { onStart, onEnd };
  if (typeof playAudio === "function") {
    try {
      hooks.onStart?.();
      await playAudio(audio.bytes, audio.contentType);
      hooks.onEnd?.();
      return true;
    } catch {
      return false;
    }
  }
  return playWithAudioElement(audio.bytes, audio.contentType, gen, hooks);
}

/**
 * When conversational mode is on, speak via the Worker `/tts` route (Gemini).
 * Timeout, non-OK, or playback failure falls back to speechSynthesis.
 */
export async function speakAgentReply(transcript, opts = {}) {
  stopAgentSpeech();
  const gen = speakingGeneration;
  emitSpeaking(true);
  const text = String(transcript || "").trim();
  if (!text) {
    if (gen === speakingGeneration) emitSpeaking(false);
    return false;
  }

  const controller = new AbortController();
  activeController = controller;
  const audio = await fetchGeminiTtsAudio(text, {
    url: opts.url,
    voice: opts.voice,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    signal: controller.signal,
    env: opts.env,
  });
  if (gen !== speakingGeneration) return false;

  if (audio) {
    const played = await playGeminiAudio(audio, gen, {
      playAudio: opts.playAudio,
      onStart: () => {
        try {
          opts.onStart?.();
        } catch {
          /* UI hook */
        }
      },
      onEnd: () => {
        if (gen !== speakingGeneration) return;
        emitSpeaking(false);
        try {
          opts.onEnd?.();
        } catch {
          /* UI hook */
        }
      },
    });
    if (gen !== speakingGeneration) return false;
    if (played) return true;
  }

  if (gen !== speakingGeneration) return false;
  const started = speakBrowserReply(text, {
    synth: opts.synth,
    voices: opts.voices,
    pickVoice: opts.pickVoice,
    utteranceClass: opts.utteranceClass,
    onStart: () => {
      emitSpeaking(true);
      try {
        opts.onStart?.();
      } catch {
        /* UI hook */
      }
    },
    onEnd: () => {
      if (gen !== speakingGeneration) return;
      emitSpeaking(false);
      try {
        opts.onEnd?.();
      } catch {
        /* UI hook */
      }
    },
  });
  if (!started && gen === speakingGeneration) emitSpeaking(false);
  return started;
}
