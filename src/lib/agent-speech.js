import { cancelBrowserSpeech, speakBrowserReply } from "./native-tts.js";

export const TTS_ENGINE_STORAGE_KEY = "freightlodge.ttsEngine";
export const TTS_ENGINES = {
  BROWSER: "browser",
};

/** Conversational mode speaks with browser speechSynthesis only. */
export const DEFAULT_TTS_ENGINE = TTS_ENGINES.BROWSER;

export function loadTtsEngine() {
  return DEFAULT_TTS_ENGINE;
}

export function saveTtsEngine(_engine, _storage) {
  return DEFAULT_TTS_ENGINE;
}

let speakingListener = null;

/** UI hook for the gold speaking wave — browser speechSynthesis only. */
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

export function stopAgentSpeech() {
  cancelBrowserSpeech();
  emitSpeaking(false);
}

/**
 * Speak an agent reply with browser speechSynthesis.
 * Cartesia TTS stays on the dormant /tts proxy — the UI does not call it.
 */
export async function speakAgentReply(transcript, opts = {}) {
  stopAgentSpeech();
  emitSpeaking(true);
  const started = speakBrowserReply(transcript, {
    ...opts,
    onStart: () => {
      emitSpeaking(true);
      try {
        opts.onStart?.();
      } catch {
        /* UI hook */
      }
    },
    onEnd: () => {
      emitSpeaking(false);
      try {
        opts.onEnd?.();
      } catch {
        /* UI hook */
      }
    },
  });
  if (!started) emitSpeaking(false);
  return started;
}
