/** Listen-start ding. Short, no audio asset. Louder than a soft ping so phones hear it. */

export const LISTEN_CUE_FREQ_HZ = 880;
export const LISTEN_CUE_FREQ_HZ_2 = 1175;
export const LISTEN_CUE_TICK_MS = 70;
export const LISTEN_CUE_GAP_MS = 35;
export const LISTEN_CUE_MS = LISTEN_CUE_TICK_MS * 2 + LISTEN_CUE_GAP_MS;
export const LISTEN_CUE_GAIN = 0.16;
/** Single tap on mic-on. Not a multi-pulse [on, off, on] pattern. */
export const LISTEN_HAPTIC_MS = 20;
export const LISTEN_HAPTIC_PATTERN = LISTEN_HAPTIC_MS;
export const LISTEN_CUE_DEBOUNCE_MS = 800;
export const LISTEN_HAPTIC_DEBOUNCE_MS = 800;

let primed = null;
let lastPlayAt = 0;
let lastHapticAt = 0;

function audioCtor(explicit) {
  if (explicit) return explicit;
  if (typeof AudioContext !== "undefined") return AudioContext;
  if (typeof webkitAudioContext !== "undefined") return webkitAudioContext;
  return null;
}

function startSilentUnlock(ctx) {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 40;
    gain.gain.setValueAtTime(0.00002, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.025);
  } catch {
    /* unlock is best-effort */
  }
}

/**
 * Create / resume a shared AudioContext on the hold/tap gesture so the later
 * ding can play after the mic session starts (gesture may already be gone).
 * Starts a near-silent tick during the gesture — iOS often ignores resume()
 * alone. Does not take an exclusive audio session / fight the silent switch.
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
    startSilentUnlock(primed);
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
  lastPlayAt = 0;
  lastHapticAt = 0;
}

export function pulseListenHaptic({ vibrateFn, now } = {}) {
  const t = now ?? Date.now();
  if (lastHapticAt && t - lastHapticAt < LISTEN_HAPTIC_DEBOUNCE_MS) return false;
  const fn =
    vibrateFn ||
    (typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
      ? navigator.vibrate.bind(navigator)
      : null);
  if (!fn) return false;
  try {
    const ok = fn(LISTEN_HAPTIC_PATTERN);
    if (ok === false) return false;
    lastHapticAt = t;
    return true;
  } catch {
    return false;
  }
}

function playTick(ctx, { freq, gainValue, startAt, duration }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/**
 * Two short ticks. Call on the pointerdown/tap gesture (iOS unlock) and again
 * when listening is armed (`onStart`). Debounced so Web Speech does not ding twice.
 */
export function playListenCue({ AudioContextCtor, now } = {}) {
  const ctx = primeListenCue({ AudioContextCtor });
  pulseListenHaptic({ now });
  if (!ctx) return false;
  const t = now ?? Date.now();
  if (lastPlayAt && t - lastPlayAt < LISTEN_CUE_DEBOUNCE_MS) return true;
  try {
    const t0 = ctx.currentTime;
    const tick = LISTEN_CUE_TICK_MS / 1000;
    const gap = LISTEN_CUE_GAP_MS / 1000;
    playTick(ctx, {
      freq: LISTEN_CUE_FREQ_HZ,
      gainValue: LISTEN_CUE_GAIN,
      startAt: t0,
      duration: tick,
    });
    playTick(ctx, {
      freq: LISTEN_CUE_FREQ_HZ_2,
      gainValue: LISTEN_CUE_GAIN * 0.9,
      startAt: t0 + tick + gap,
      duration: tick,
    });
    lastPlayAt = t;
    return true;
  } catch {
    return false;
  }
}
