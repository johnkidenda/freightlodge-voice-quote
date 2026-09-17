export function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

export function preferTapToTalk(
  ua = typeof navigator !== "undefined" ? navigator.userAgent : "",
  extras = {},
) {
  const isiOS =
    extras.iOS === true ||
    /iPad|iPhone|iPod/i.test(ua) ||
    (typeof navigator !== "undefined" &&
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1);
  const isSafari = /safari/i.test(ua) && !/chrome|chromium|android|crios|fxios/i.test(ua);
  return Boolean(isiOS || extras.forceToggle || (isSafari && extras.touch));
}

/**
 * Buffer STT text while the mic is held. Never commit a transcript until
 * release() — Web Speech often marks phrases final mid-utterance.
 */
export function createTranscriptBuffer() {
  let holding = false;
  const finals = [];
  let interim = "";

  return {
    start() {
      holding = true;
      finals.length = 0;
      interim = "";
    },
    onSpeechResult({ interim: nextInterim = "", finalText = "" } = {}) {
      if (!holding) return { preview: "", commit: null };
      if (finalText && finalText.trim()) finals.push(finalText.trim());
      interim = nextInterim || "";
      return {
        preview: [...finals, interim].filter(Boolean).join(" ").trim(),
        commit: null,
      };
    },
    release() {
      const commit = [...finals, interim].filter(Boolean).join(" ").trim();
      holding = false;
      finals.length = 0;
      interim = "";
      return commit;
    },
    isHolding() {
      return holding;
    },
  };
}

export function createHoldToTalk({ onPreview, onCommit, onError, onStart, onEnd } = {}) {
  const Ctor = getSpeechRecognitionCtor();
  const mode = preferTapToTalk() ? "toggle" : "hold";
  const buffer = createTranscriptBuffer();

  if (!Ctor) {
    return {
      supported: false,
      mode,
      start() {
        onError?.(new Error("Speech recognition is not available in this browser."));
      },
      stop() {},
      abort() {},
    };
  }

  let rec = null;
  let active = false;
  let wantHold = false;

  function attachHandlers() {
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece;
        else interim += piece;
      }
      const { preview } = buffer.onSpeechResult({ interim, finalText });
      onPreview?.(preview);
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      onError?.(e);
    };
    rec.onend = () => {
      active = false;
      if (wantHold) {
        tryStart();
        return;
      }
      const text = buffer.release();
      onEnd?.();
      if (text) onCommit?.(text);
    };
  }

  function tryStart() {
    rec = new Ctor();
    attachHandlers();
    try {
      rec.start();
      active = true;
    } catch (err) {
      onError?.(err);
    }
  }

  function start() {
    if (wantHold) return;
    wantHold = true;
    buffer.start();
    onStart?.();
    tryStart();
  }

  function stop() {
    if (!wantHold) return;
    wantHold = false;
    if (!rec) {
      const text = buffer.release();
      onEnd?.();
      if (text) onCommit?.(text);
      return;
    }
    try {
      rec.stop();
    } catch {
      const text = buffer.release();
      onEnd?.();
      if (text) onCommit?.(text);
    }
  }

  function abort() {
    wantHold = false;
    buffer.release();
    if (!rec) return;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
    active = false;
  }

  return { supported: true, mode, start, stop, abort, isActive: () => active || wantHold };
}
