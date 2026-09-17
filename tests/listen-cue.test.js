import { describe, expect, it } from "vitest";
import {
  LISTEN_CUE_GAIN,
  LISTEN_CUE_MS,
  playListenCue,
  primeListenCue,
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
  it("is a short quiet oscillator and does not throw without Web Audio", () => {
    expect(LISTEN_CUE_MS).toBeLessThanOrEqual(120);
    expect(LISTEN_CUE_GAIN).toBeLessThanOrEqual(0.08);
    resetListenCue();
    expect(playListenCue({ AudioContextCtor: null })).toBe(false);
  });

  it("primes on the gesture and plays once when listening starts", () => {
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
    expect(playListenCue({ AudioContextCtor: Ctor })).toBe(true);
    expect(created).toBe(1);
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].started).toBe(true);
    expect(ctx.oscillators[0].type).toBe("sine");
    resetListenCue();
  });
});
