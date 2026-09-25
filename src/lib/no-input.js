/**
 * No-input reprompt ("I didn't catch that").
 * The window starts when the agent finishes speaking, or when the ask is
 * shown if this turn is not spoken. A timer that began before TTS, or that
 * belonged to the previous ask, cannot fire.
 */

export const NO_INPUT_WINDOW_MS = 6000;

export function createNoInputWatch({
  windowMs = NO_INPUT_WINDOW_MS,
  schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = (id) => clearTimeout(id),
  now = () => Date.now(),
  onReprompt,
} = {}) {
  let timer = null;
  let timerToken = 0;
  let speaking = false;
  let generation = 0;
  let pendingGen = null;
  let speechEndedAt = null;
  let askAt = null;

  function clearTimer() {
    timerToken += 1;
    if (timer != null) unschedule(timer);
    timer = null;
  }

  function windowStart() {
    if (speechEndedAt != null) return speechEndedAt;
    return askAt;
  }

  function arm(gen) {
    clearTimer();
    pendingGen = gen;
    if (speaking) return;
    const start = windowStart() ?? now();
    if (askAt == null) askAt = start;
    const wait = Math.max(0, windowMs - (now() - start));
    const token = timerToken;
    timer = schedule(() => {
      timer = null;
      if (token !== timerToken || pendingGen !== generation || speaking) return;
      pendingGen = null;
      onReprompt?.();
    }, wait);
  }

  return {
    /** New agent ask. Drop any timer from the previous question. */
    onNewAsk() {
      generation += 1;
      clearTimer();
      pendingGen = null;
      speechEndedAt = null;
      askAt = now();
    },
    onSpeakingChange(isSpeaking) {
      const next = Boolean(isSpeaking);
      if (next) {
        speaking = true;
        speechEndedAt = null;
        clearTimer();
        return;
      }
      const wasSpeaking = speaking;
      speaking = false;
      if (!wasSpeaking) return;
      speechEndedAt = now();
      if (pendingGen === generation) arm(generation);
    },
    /**
     * Mic ended with no words. Reprompt only after the full post-speech window.
     * An empty result during TTS waits until speech ends, then the full window.
     */
    onEmptyListen() {
      if (speaking || speechEndedAt == null) {
        arm(generation);
        return;
      }
      arm(generation);
    },
    onUserActivity() {
      clearTimer();
      pendingGen = null;
    },
  };
}
