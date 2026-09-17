/** Soft listen-start ding. Short, quiet, no audio asset. */

export const LISTEN_CUE_FREQ_HZ = 784;
export const LISTEN_CUE_MS = 90;
export const LISTEN_CUE_GAIN = 0.055;

let primed = null;

function audioCtor(explicit) {
  if (explicit) return explicit;
  if (typeof AudioContext !== "undefined") return AudioContext;
  if (typeof webkitAudioContext !== "undefined") return webkitAudioContext;
  return null;
}

/**
 * Create / resume a shared AudioContext on the hold/tap gesture so the later
 * ding can play after Cartesia finishes connecting (gesture may already be gone).
 * Does not unlock iOS silent switch — we never take an exclusive audio session.
 */
export function primeListenCue({ AudioContextCtor } = {}) {
  const Ctor = audioCtor(AudioContextCtor);
  if (!Ctor) return null;
  try {
    if (!primed || primed.state === "closed") {
      primed = new Ctor();
    }
    if (primed.state === "suspended") {
      primed.resume?.().catch?.(() => {});
    }
    return primed;
  } catch {
    return null;
  }
}

export function resetListenCue() {
  try {
    primed?.close?.();
  } catch {
    /* ignore */
  }
  primed = null;
}

/**
 * One quiet sine ping. Call when listening is actually armed (`onStart`).
 */
export function playListenCue({ AudioContextCtor } = {}) {
  const ctx = primeListenCue({ AudioContextCtor });
  if (!ctx) return false;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = LISTEN_CUE_FREQ_HZ;
    const t0 = ctx.currentTime;
    const dur = LISTEN_CUE_MS / 1000;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(LISTEN_CUE_GAIN, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    return true;
  } catch {
    return false;
  }
}
