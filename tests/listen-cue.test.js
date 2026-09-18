import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LISTEN_CUE_DEBOUNCE_MS,
  LISTEN_CUE_FREQ_HZ,
  LISTEN_CUE_FREQ_HZ_2,
  LISTEN_CUE_GAIN,
  LISTEN_CUE_MS,
  LISTEN_HAPTIC_PATTERN,
  playListenCue,
  primeListenCue,
  pulseListenHaptic,
  resetListenCue,
} from "../src/lib/listen-cue.js";

function fakeAudioContext() {
  const oscillators = [];
  const ctx = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resumeCalls: 0,
    async resume() {
      this.resumeCalls += 1;
      this.state = "running";
    },
    async close() {
      this.state = "closed";
    },
    createOscillator() {
      const osc = {
        type: "",
        frequency: { value: 0 },
        started: false,
        stoppedAt: null,
        connect() {},
        start() {
          this.started = true;
        },
        stop(at) {
          this.stoppedAt = at;
        },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const times = [];
      return {
        gain: {
          setValueAtTime(v, t) {
            times.push(["set", v, t]);
          },
          exponentialRampToValueAtTime(v, t) {
            times.push(["ramp", v, t]);
          },
        },
        times,
        connect() {},
      };
    },
    oscillators,
  };
  return ctx;
}

describe("listen-start cue", () => {
  it("is a short louder two-tick oscillator and does not throw without Web Audio", () => {
    expect(LISTEN_CUE_MS).toBeGreaterThanOrEqual(120);
    expect(LISTEN_CUE_MS).toBeLessThanOrEqual(180);
    expect(LISTEN_CUE_GAIN).toBeGreaterThanOrEqual(0.12);
    expect(LISTEN_CUE_GAIN).toBeLessThanOrEqual(0.2);
    expect(LISTEN_CUE_FREQ_HZ).toBeGreaterThanOrEqual(800);
    expect(LISTEN_CUE_FREQ_HZ_2).toBeGreaterThan(LISTEN_CUE_FREQ_HZ);
    resetListenCue();
    expect(playListenCue({ AudioContextCtor: null })).toBe(false);
  });

  it("primes on the gesture (resume + silent unlock) and plays two ticks", () => {
    resetListenCue();
    let created = 0;
    const ctx = fakeAudioContext();
    function Ctor() {
      created += 1;
      return ctx;
    }
    expect(primeListenCue({ AudioContextCtor: Ctor })).toBe(ctx);
    expect(created).toBe(1);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(1);
    expect(ctx.oscillators[0].started).toBe(true);

    expect(playListenCue({ AudioContextCtor: Ctor, now: 10_000 })).toBe(true);
    expect(created).toBe(1);
    const audible = ctx.oscillators.filter((o) => o.frequency.value >= 800);
    expect(audible).toHaveLength(2);
    expect(audible[0].type).toBe("sine");
    expect(audible[0].frequency.value).toBe(LISTEN_CUE_FREQ_HZ);
    expect(audible[1].frequency.value).toBe(LISTEN_CUE_FREQ_HZ_2);
    expect(playListenCue({ AudioContextCtor: Ctor, now: 10_000 + LISTEN_CUE_DEBOUNCE_MS - 10 })).toBe(true);
    expect(ctx.oscillators.filter((o) => o.frequency.value >= 800)).toHaveLength(2);
    resetListenCue();
  });

  it("vibrates a single tap on mic-on and is imported from the app gesture + onStart paths", () => {
    resetListenCue();
    const pulses = [];
    const vibrateFn = (p) => {
      pulses.push(p);
      return true;
    };
    expect(pulseListenHaptic({ vibrateFn, now: 1 })).toBe(true);
    expect(pulses).toEqual([LISTEN_HAPTIC_PATTERN]);
    expect(typeof LISTEN_HAPTIC_PATTERN).toBe("number");
    expect(LISTEN_HAPTIC_PATTERN).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(LISTEN_HAPTIC_PATTERN)).toBe(false);
    expect(pulseListenHaptic({ vibrateFn, now: 50 })).toBe(false);

    const app = readFileSync("src/app.js", "utf8");
    expect(app).toMatch(/from "\.\/lib\/listen-cue\.js"/);
    expect(app).toContain("primeListenCue()");
    expect(app).toContain("playListenCue()");
    expect(app).toMatch(/pointerdown/);
    const cue = readFileSync("src/lib/listen-cue.js", "utf8");
    expect(cue).toContain("LISTEN_CUE_GAIN");
    expect(cue).toMatch(/resume/);
    resetListenCue();
  });
});
