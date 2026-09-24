import { describe, expect, it } from "vitest";
import {
  GEMINI_TTS_TIMEOUT_MS,
  fetchGeminiTtsAudio,
  getGeminiTtsUrl,
  onAgentSpeaking,
  speakAgentReply,
} from "../src/lib/agent-speech.js";

function fakeSynth() {
  const spoken = [];
  const synth = {
    cancelCalls: 0,
    cancel() {
      this.cancelCalls += 1;
    },
    speak(u) {
      spoken.push(u);
    },
    getVoices() {
      return [{ name: "Samantha", lang: "en-US", localService: true }];
    },
  };
  class FakeUtterance {
    constructor(text) {
      this.text = text;
      this.lang = "";
      this.voice = null;
      this.onstart = null;
      this.onend = null;
      this.onerror = null;
    }
  }
  return { synth, spoken, FakeUtterance };
}

function okAudio() {
  const bytes = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
  return {
    ok: true,
    headers: { get: () => "audio/wav" },
    arrayBuffer: async () => bytes.buffer,
  };
}

describe("Gemini TTS client", () => {
  it("builds {VITE_API_BASE_URL}/tts", () => {
    expect(getGeminiTtsUrl({ VITE_API_BASE_URL: "https://freightlodge-stt-token.johnkidenda.workers.dev" })).toBe(
      "https://freightlodge-stt-token.johnkidenda.workers.dev/tts",
    );
    expect(getGeminiTtsUrl({ VITE_API_BASE_URL: "/api" })).toBe("/api/tts");
    expect(getGeminiTtsUrl({ VITE_API_BASE_URL: "" })).toBe("");
    expect(GEMINI_TTS_TIMEOUT_MS).toBeGreaterThanOrEqual(4000);
    expect(GEMINI_TTS_TIMEOUT_MS).toBeLessThanOrEqual(6000);
  });

  it("prefers the Worker, plays audio, and keeps the speaking wave", async () => {
    const { synth, spoken, FakeUtterance } = fakeSynth();
    const flags = [];
    const posts = [];
    onAgentSpeaking((on) => flags.push(on));
    const started = performance.now();
    const ok = await speakAgentReply("What's the origin ZIP?", {
      url: "https://proxy.example/tts",
      fetchImpl: async (url, init) => {
        posts.push({ url, body: JSON.parse(init.body) });
        await new Promise((r) => setTimeout(r, 30));
        return okAudio();
      },
      playAudio: async () => {},
      synth,
      utteranceClass: FakeUtterance,
    });
    const elapsed = performance.now() - started;
    expect(ok).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(elapsed).toBeLessThan(GEMINI_TTS_TIMEOUT_MS);
    expect(posts).toEqual([{ url: "https://proxy.example/tts", body: { text: "What's the origin ZIP?" } }]);
    expect(spoken).toEqual([]);
    expect(flags).toContain(true);
    expect(flags.at(-1)).toBe(false);
    onAgentSpeaking(null);
  });

  it("falls back to speechSynthesis on non-OK, throw, and timeout", async () => {
    const cases = [
      {
        name: "non-ok",
        fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: "nope" }) }),
      },
      {
        name: "throw",
        fetchImpl: async () => {
          throw new Error("network");
        },
      },
      {
        name: "timeout",
        timeoutMs: 40,
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener?.("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      },
    ];

    for (const item of cases) {
      const { synth, spoken, FakeUtterance } = fakeSynth();
      const flags = [];
      onAgentSpeaking((on) => flags.push(on));
      const ok = await speakAgentReply("Got it.", {
        url: "https://proxy.example/tts",
        timeoutMs: item.timeoutMs,
        fetchImpl: item.fetchImpl,
        playAudio: async () => {
          throw new Error("should not play");
        },
        synth,
        utteranceClass: FakeUtterance,
      });
      expect(ok, item.name).toBe(true);
      expect(spoken, item.name).toHaveLength(1);
      expect(spoken[0].text).toBe("Got it.");
      expect(flags, item.name).toContain(true);
      spoken[0].onend?.();
      expect(flags.at(-1), item.name).toBe(false);
      onAgentSpeaking(null);
    }
  });

  it("uses the browser when the Worker URL is unset", async () => {
    const { synth, spoken, FakeUtterance } = fakeSynth();
    let called = false;
    const ok = await speakAgentReply("Hello", {
      url: "",
      env: { VITE_API_BASE_URL: "" },
      fetchImpl: async () => {
        called = true;
        return okAudio();
      },
      synth,
      utteranceClass: FakeUtterance,
    });
    expect(ok).toBe(true);
    expect(called).toBe(false);
    expect(spoken[0].text).toBe("Hello");
  });

  it("fetchGeminiTtsAudio returns null on timeout under 6s", async () => {
    const started = performance.now();
    const audio = await fetchGeminiTtsAudio("Hi", {
      url: "https://proxy.example/tts",
      timeoutMs: 50,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    const elapsed = performance.now() - started;
    expect(audio).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(1000);
  });
});
