import {
  onAgentSpeaking as onCartesiaSpeaking,
  speakAgentReply as speakCartesiaReply,
  stopAgentSpeech as stopCartesiaSpeech,
} from "./cartesia-tts.js";
import { cancelBrowserSpeech, speakBrowserReply } from "./native-tts.js";

export const TTS_ENGINE_STORAGE_KEY = "freightlodge.ttsEngine";
export const TTS_ENGINES = {
  BROWSER: "browser",
  CARTESIA: "cartesia",
};

/** Default: native speechSynthesis so John can A/B without a Cartesia key. */
export const DEFAULT_TTS_ENGINE = TTS_ENGINES.BROWSER;

export function loadTtsEngine(storage) {
  try {
    const raw = storage?.getItem?.(TTS_ENGINE_STORAGE_KEY);
    if (raw === TTS_ENGINES.CARTESIA) return TTS_ENGINES.CARTESIA;
    if (raw === TTS_ENGINES.BROWSER) return TTS_ENGINES.BROWSER;
  } catch {
    /* quota / private mode */
  }
  return DEFAULT_TTS_ENGINE;
}

export function saveTtsEngine(engine, storage) {
  const next = engine === TTS_ENGINES.CARTESIA ? TTS_ENGINES.CARTESIA : TTS_ENGINES.BROWSER;
  try {
    storage?.setItem?.(TTS_ENGINE_STORAGE_KEY, next);
  } catch {
    /* quota / private mode */
  }
  return next;
}

let speakingListener = null;

/** UI hook for the gold speaking wave — fires for Browser or Cartesia. */
export function onAgentSpeaking(listener) {
  speakingListener = typeof listener === "function" ? listener : null;
  onCartesiaSpeaking((on) => {
    try {
      speakingListener?.(Boolean(on));
    } catch {
      /* UI hook */
    }
  });
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
  stopCartesiaSpeech();
  emitSpeaking(false);
}

/**
 * Speak an agent reply with the selected engine.
 * Cancels any in-flight utterance first.
 */
export async function speakAgentReply(transcript, opts = {}) {
  stopAgentSpeech();
  const engine = opts.engine || loadTtsEngine(opts.storage);
  if (engine === TTS_ENGINES.CARTESIA) {
    return speakCartesiaReply(transcript, opts);
  }
  emitSpeaking(true);
  const started = speakBrowserReply(transcript, {
    ...opts,
    onStart: () => emitSpeaking(true),
    onEnd: () => emitSpeaking(false),
  });
  if (!started) emitSpeaking(false);
  return started;
}
