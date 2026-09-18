import {
  onAgentSpeaking as onCartesiaSpeaking,
  speakAgentReply as speakCartesiaReply,
  stopAgentSpeech as stopCartesiaSpeech,
} from "./cartesia-tts.js";
import { cancelBrowserSpeech, speakBrowserReply } from "./native-tts.js";
import {
  elapsedMs,
  getLastTtsUtterance,
  nowMs,
  recordLastTtsUtterance,
} from "./tts-timing.js";

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
 * first-audio ms is speak-request → first audible/playable start
 * (Cartesia includes the full proxy round-trip).
 */
export async function speakAgentReply(transcript, opts = {}) {
  stopAgentSpeech();
  const engine = opts.engine || loadTtsEngine(opts.storage);
  const startedAt = nowMs(opts.now);
  recordLastTtsUtterance({ engine, firstAudioMs: null, durationMs: null });
  const notify = () => {
    try {
      opts.onTtsStats?.(getLastTtsUtterance());
    } catch {
      /* UI hook */
    }
  };
  notify();
  const stampFirst = () => {
    recordLastTtsUtterance({ engine, firstAudioMs: elapsedMs(startedAt, opts.now) });
    notify();
  };
  const stampDuration = (durationMs) => {
    recordLastTtsUtterance({ engine, durationMs: durationMs ?? null });
    notify();
  };

  if (engine === TTS_ENGINES.CARTESIA) {
    return speakCartesiaReply(transcript, {
      ...opts,
      onFirstAudio: stampFirst,
      onEnded: (durationMs) => stampDuration(durationMs),
    });
  }

  emitSpeaking(true);
  let firstAt = null;
  const started = speakBrowserReply(transcript, {
    ...opts,
    onStart: () => {
      firstAt = nowMs(opts.now);
      stampFirst();
      emitSpeaking(true);
      try {
        opts.onStart?.();
      } catch {
        /* UI hook */
      }
    },
    onEnd: () => {
      if (firstAt != null) stampDuration(elapsedMs(firstAt, opts.now));
      emitSpeaking(false);
      try {
        opts.onEnd?.();
      } catch {
        /* UI hook */
      }
    },
  });
  if (!started) {
    emitSpeaking(false);
    recordLastTtsUtterance({ engine, firstAudioMs: null, durationMs: null });
    notify();
  }
  return started;
}
