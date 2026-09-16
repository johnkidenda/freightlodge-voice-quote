export function getSpeechRecognitionCtor() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function speechSupported() {
  return Boolean(getSpeechRecognitionCtor());
}

export function createHoldToTalk({ onResult, onError, onStart, onEnd } = {}) {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    return {
      supported: false,
      start() {
        onError?.(new Error("Speech recognition is not available in this browser."));
      },
      stop() {},
      abort() {},
    };
  }

  let rec = null;
  let active = false;

  function start() {
    if (active) return;
    rec = new Ctor();
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
      onResult?.({ interim, finalText });
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      onError?.(e);
    };
    rec.onend = () => {
      active = false;
      onEnd?.();
    };
    try {
      rec.start();
      active = true;
      onStart?.();
    } catch (err) {
      onError?.(err);
    }
  }

  function stop() {
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* already stopped */
    }
  }

  function abort() {
    if (!rec) return;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
    active = false;
  }

  return { supported: true, start, stop, abort };
}
