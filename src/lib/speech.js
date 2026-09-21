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
      const next = normalizeRecognitionResults(results);
      const hasText = next.some((row) => String(row.transcript || "").trim());
      const kept =
        Boolean(prior) || slots.some((row) => String(row.transcript || "").trim());
      // Mobile stop() sometimes emits an empty final and drops the only
      // hypothesis we had for a short phrase.
      if (!hasText && kept) return snap();
      slots = next;
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
    /**
     * Commit the best hypothesis, including interim text.
     * Web Speech on mobile Safari/Chrome often never sets isFinal for a
     * short answer ("one pallet") before stop()/onend, so finals-only
     * release dropped the utterance and the sheet never advanced.
     */
    release() {
      const { preview } = snap();
      holding = false;
      slots = [];
      prior = "";
      return preview;
    },
    isHolding() {
      return holding;
    },
  };
}

export function createHoldToTalk({
  onPreview,
  onCommit,
  onEmpty,
  onError,
  onStart,
  onEnd,
  onTailStart,
  Recognition,
  tailMs = RELEASE_TAIL_MS,
  endFallbackMs = 500,
  restartDelayMs = 120,
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
  let settleTimer = null;
  let restartTimer = null;
  let settled = false;
  let surfacedError = false;

  function clearNamed(which) {
    if (which === "tail" && tailTimer != null) {
      unschedule(tailTimer);
      tailTimer = null;
    }
    if (which === "settle" && settleTimer != null) {
      unschedule(settleTimer);
      settleTimer = null;
    }
    if (which === "restart" && restartTimer != null) {
      unschedule(restartTimer);
      restartTimer = null;
    }
  }

  function detach(target) {
    if (!target) return;
    try {
      target.onresult = null;
      target.onerror = null;
      target.onend = null;
      target.onspeechend = null;
    } catch {
      /* ignore */
    }
  }

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
      surfacedError = true;
      onError?.(e);
    };
    rec.onend = () => {
      active = false;
      if (phase === "holding" || phase === "tailing") {
        buffer.checkpoint();
        // Keep listening only while the user is still holding. During the
        // release tail, a fresh session can append a second copy of a short
        // phrase. The tail timer commits what we already sealed.
        if (phase !== "holding") return;
        clearNamed("restart");
        restartTimer = schedule(() => {
          restartTimer = null;
          if (phase !== "holding") return;
          tryStart({ automatic: true });
        }, restartDelayMs);
        return;
      }
      commitNow();
    };
  }

  function tryStart({ automatic = false } = {}) {
    rec = new Ctor();
    attachHandlers();
    try {
      rec.start();
      active = true;
    } catch (err) {
      // iOS throws if start() runs inside onend. The delayed restart retries.
      // Don't surface that as a chat error while the user is still holding.
      if (automatic) return;
      surfacedError = true;
      onError?.(err);
    }
  }

  function commitNow() {
    if (settled) return;
    settled = true;
    clearNamed("tail");
    clearNamed("settle");
    clearNamed("restart");
    const text = buffer.release();
    phase = "idle";
    const ending = rec;
    rec = null;
    active = false;
    detach(ending);
    onEnd?.();
    if (text) onCommit?.(text);
    else if (!surfacedError) onEmpty?.();
  }

  function finalizeStop() {
    clearNamed("tail");
    if (phase !== "holding" && phase !== "tailing") return;
    buffer.checkpoint();
    phase = "idle";
    clearNamed("restart");
    if (!rec) {
      commitNow();
      return;
    }
    try {
      rec.stop();
    } catch {
      commitNow();
      return;
    }
    // Mobile Safari often never fires onend after stop().
    if (!settled) {
      clearNamed("settle");
      settleTimer = schedule(() => {
        settleTimer = null;
        commitNow();
      }, endFallbackMs);
    }
  }

  function start() {
    if (phase === "holding") return;
    if (phase === "tailing") {
      clearNamed("tail");
      clearNamed("settle");
      phase = "holding";
      onStart?.();
      return;
    }
    settled = false;
    surfacedError = false;
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
    clearNamed("tail");
    clearNamed("settle");
    clearNamed("restart");
    settled = true;
    phase = "idle";
    buffer.release();
    const ending = rec;
    rec = null;
    active = false;
    detach(ending);
    if (!ending) return;
    try {
      ending.abort();
    } catch {
      /* ignore */
    }
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
