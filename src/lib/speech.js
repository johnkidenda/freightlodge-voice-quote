/** Extra listen time after release / tap-to-stop so the last words are not clipped. */
export const RELEASE_TAIL_MS = 1000;

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

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `next` is the same utterance as `prev`, grown or repeated. */
export function isProgressiveDuplicate(prev, next) {
  const a = norm(prev);
  const b = norm(next);
  if (!a || !b) return false;
  if (b === a) return true;
  if (b.startsWith(`${a} `)) return true;
  if (a.endsWith(" ") && b.startsWith(a.trim())) return true;
  return false;
}

/**
 * Join final segments. Cumulative copies of the same phrase replace;
 * non-overlapping segments ("hello " + "world") concatenate.
 */
export function collapseProgressiveFinals(segments) {
  const out = [];
  for (const raw of segments) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!out.length) {
      out.push(text);
      continue;
    }
    const prev = out[out.length - 1];
    if (isProgressiveDuplicate(prev, text)) {
      out[out.length - 1] = text;
    } else if (isProgressiveDuplicate(text, prev)) {
      /* shorter prefix of what we already have — keep prev */
    } else {
      out.push(text);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export function normalizeRecognitionResults(results) {
  const list = [];
  const length = results?.length ?? 0;
  for (let i = 0; i < length; i += 1) {
    const row = results[i];
    const transcript = row?.transcript ?? row?.[0]?.transcript ?? "";
    list.push({
      transcript: String(transcript),
      isFinal: Boolean(row?.isFinal),
    });
  }
  return list;
}

/** Rebuild one transcript from the current results list (each index once). */
export function rebuildFromResults(results) {
  const rows = normalizeRecognitionResults(results);
  const finalBits = [];
  const interimBits = [];
  for (const row of rows) {
    const text = row.transcript.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (row.isFinal) finalBits.push(text);
    else interimBits.push(text);
  }
  const finals = collapseProgressiveFinals(finalBits);
  const interim = collapseProgressiveFinals(interimBits);
  let preview = finals;
  if (interim) {
    preview = isProgressiveDuplicate(finals, interim)
      ? interim
      : collapseProgressiveFinals([finals, interim]);
  }
  return { finals, interim, preview };
}

/**
 * One running transcript for a hold session. Replace progressive
 * duplicates; never join a history of growing finals.
 */
export function createTranscriptBuffer() {
  let holding = false;
  let slots = [];
  let prior = "";

  function snap() {
    const rebuilt = rebuildFromResults(slots);
    const finals = collapseProgressiveFinals([prior, rebuilt.finals]);
    let preview = finals;
    if (rebuilt.interim) {
      preview = isProgressiveDuplicate(finals, rebuilt.interim)
        ? rebuilt.interim
        : collapseProgressiveFinals([finals, rebuilt.interim]);
    } else if (rebuilt.preview) {
      preview = collapseProgressiveFinals([prior, rebuilt.preview]);
    }
    return { preview, finals, commit: null };
  }

  return {
    start() {
      holding = true;
      slots = [];
      prior = "";
    },
    applyResults(results) {
      if (!holding) return { preview: "", commit: null };
      slots = normalizeRecognitionResults(results);
      return snap();
    },
    onSpeechResult({ interim = "", finalText = "", results } = {}) {
      if (results) return this.applyResults(results);
      if (!holding) return { preview: "", commit: null };
      const next = slots.filter((s) => s.isFinal);
      if (finalText) {
        const last = next[next.length - 1];
        if (last && isProgressiveDuplicate(last.transcript, finalText)) {
          next[next.length - 1] = { transcript: finalText, isFinal: true };
        } else {
          next.push({ transcript: finalText, isFinal: true });
        }
      }
      if (interim) next.push({ transcript: interim, isFinal: false });
      slots = next;
      return snap();
    },
    /** Fold current slots into prior when the recognizer restarts mid-hold. */
    checkpoint() {
      const rebuilt = rebuildFromResults(slots);
      prior = collapseProgressiveFinals([prior, rebuilt.finals, rebuilt.interim]);
      slots = [];
    },
    release() {
      const { finals } = snap();
      holding = false;
      slots = [];
      prior = "";
      return finals;
    },
    isHolding() {
      return holding;
    },
  };
}

export function createHoldToTalk({
  onPreview,
  onCommit,
  onError,
  onStart,
  onEnd,
  onTailStart,
  Recognition,
  tailMs = RELEASE_TAIL_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = (id) => clearTimeout(id),
} = {}) {
  const Ctor = Recognition || getSpeechRecognitionCtor();
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
      isActive: () => false,
      isTailing: () => false,
    };
  }

  let rec = null;
  let active = false;
  let phase = "idle";
  let tailTimer = null;

  function attachHandlers() {
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (event) => {
      const rows = [];
      for (let i = 0; i < event.results.length; i += 1) {
        rows.push({
          transcript: event.results[i][0].transcript,
          isFinal: event.results[i].isFinal,
        });
      }
      const { preview } = buffer.applyResults(rows);
      onPreview?.(preview);
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      onError?.(e);
    };
    rec.onend = () => {
      active = false;
      if (phase === "holding" || phase === "tailing") {
        buffer.checkpoint();
        tryStart();
        return;
      }
      commitNow();
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

  function clearTail() {
    if (tailTimer != null) {
      unschedule(tailTimer);
      tailTimer = null;
    }
  }

  function commitNow() {
    const text = buffer.release();
    phase = "idle";
    rec = null;
    active = false;
    onEnd?.();
    if (text) onCommit?.(text);
  }

  function finalizeStop() {
    clearTail();
    if (phase !== "holding" && phase !== "tailing") return;
    phase = "idle";
    if (!rec) {
      commitNow();
      return;
    }
    try {
      rec.stop();
    } catch {
      commitNow();
    }
  }

  function start() {
    if (phase === "holding") return;
    if (phase === "tailing") {
      clearTail();
      phase = "holding";
      onStart?.();
      return;
    }
    phase = "holding";
    buffer.start();
    onStart?.();
    tryStart();
  }

  function stop() {
    if (phase !== "holding") return;
    phase = "tailing";
    onTailStart?.();
    tailTimer = schedule(() => {
      tailTimer = null;
      finalizeStop();
    }, tailMs);
  }

  function abort() {
    clearTail();
    phase = "idle";
    buffer.release();
    if (!rec) return;
    try {
      rec.abort();
    } catch {
      /* ignore */
    }
    rec = null;
    active = false;
  }

  return {
    supported: true,
    mode,
    start,
    stop,
    abort,
    isActive: () => phase === "holding" || phase === "tailing" || active,
    isTailing: () => phase === "tailing",
  };
}
