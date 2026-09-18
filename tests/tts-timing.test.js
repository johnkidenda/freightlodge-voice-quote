import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  clearLastTtsUtterance,
  formatTtsLatencyReadout,
  formatTtsSnapshotLines,
  getLastTtsUtterance,
  recordLastTtsUtterance,
  ttsEngineLabel,
} from "../src/lib/tts-timing.js";
import { TTS_ENGINES, speakAgentReply } from "../src/lib/agent-speech.js";
import { formatSessionTranscript, sendSessionTranscript } from "../src/lib/transcript.js";
import { createSession } from "../src/lib/dialog.js";
import { STT_PROVIDER_IDS } from "../src/lib/stt-providers.js";

function jsonRes(body, ok = true) {
  return {
    ok,
    text: async () => JSON.stringify(body),
  };
}

describe("TTS timing formatters", () => {
  it("labels engines and dashes missing latency", () => {
    expect(ttsEngineLabel("browser")).toBe("Browser");
    expect(ttsEngineLabel("cartesia")).toBe("Cartesia");
    expect(formatTtsLatencyReadout({ silent: true })).toBe("—");
    expect(formatTtsLatencyReadout({ engine: "browser" })).toBe("—");
    expect(formatTtsLatencyReadout({ engine: "cartesia", firstAudioMs: 820.4 })).toBe("Cartesia 820 ms");
    expect(formatTtsLatencyReadout({ engine: "browser", firstAudioMs: 40 })).toBe("Browser 40 ms");
    expect(formatTtsSnapshotLines({ engine: "cartesia", firstAudioMs: 820, durationMs: 2100 })).toEqual([
      "Voice: Cartesia",
      "TTS first-audio ms: 820",
      "TTS duration ms: 2100",
    ]);
    expect(formatTtsSnapshotLines({})).toEqual([
      "Voice: Browser",
      "TTS first-audio ms: —",
      "TTS duration ms: —",
    ]);
  });
});

describe("speak-request → first-audio", () => {
  beforeEach(() => clearLastTtsUtterance());

  it("Browser stamps utterance-start latency and duration", async () => {
    let t = 0;
    const spoken = [];
    const synth = {
      cancel() {},
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
        this.onstart = null;
        this.onend = null;
      }
    }
    const ok = await speakAgentReply("What’s the origin ZIP?", {
      engine: TTS_ENGINES.BROWSER,
      now: () => t,
      synth,
      utteranceClass: FakeUtterance,
    });
    expect(ok).toBe(true);
    expect(getLastTtsUtterance().firstAudioMs).toBeNull();
    t = 40;
    spoken[0].onstart();
    expect(getLastTtsUtterance()).toMatchObject({ engine: "browser", firstAudioMs: 40 });
    t = 1840;
    spoken[0].onend();
    expect(getLastTtsUtterance().durationMs).toBe(1800);
  });

  it("Cartesia stamps proxy round-trip at playable start", async () => {
    let t = 0;
    const ok = await speakAgentReply("Got the destination ZIP — 78721.", {
      engine: TTS_ENGINES.CARTESIA,
      now: () => t,
      url: "https://proxy.example/tts",
      fetchImpl: async () => {
        t = 820;
        return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
      },
      playAudio: async () => {},
    });
    expect(ok).toBe(true);
    expect(getLastTtsUtterance()).toMatchObject({
      engine: "cartesia",
      firstAudioMs: 820,
    });
  });
});

describe("Send snapshot includes Voice + TTS ms", () => {
  beforeEach(() => clearLastTtsUtterance());

  it("stamps session TTS fields on the sheet snapshot", () => {
    const text = formatSessionTranscript([{ role: "user", text: "hello" }], {
      ...createSession({ id: "tts-snap" }),
      ttsEngine: "cartesia",
      ttsFirstAudioMs: 820,
      ttsDurationMs: 2100,
    });
    expect(text).toContain("Voice: Cartesia");
    expect(text).toContain("TTS first-audio ms: 820");
    expect(text).toContain("TTS duration ms: 2100");
  });

  it("Send falls back to the last spoken utterance when args are omitted", async () => {
    recordLastTtsUtterance({ engine: "cartesia", firstAudioMs: 820, durationMs: 2100 });
    const calls = [];
    await sendSessionTranscript([{ role: "user", text: "hello" }], createSession({ id: "tts-last" }), {
      fetchFn: async (_url, init) => {
        calls.push(init);
        return jsonRes({ success: true });
      },
      webhookUrl: "",
    });
    const body = JSON.parse(calls[0].body);
    expect(body.message).toContain("Voice: Cartesia");
    expect(body.message).toContain("TTS first-audio ms: 820");
  });

  it("FormSubmit body includes Voice and first-audio from the last spoken reply", async () => {
    recordLastTtsUtterance({ engine: "browser", firstAudioMs: 42, durationMs: 900 });
    const calls = [];
    await sendSessionTranscript([{ role: "user", text: "Chicago 60601" }], createSession({ id: "tts-send" }), {
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ success: true, message: "Your form has been submitted" });
      },
      webhookUrl: "",
      sttProvider: STT_PROVIDER_IDS.WEB_SPEECH,
      ttsEngine: "browser",
      ttsFirstAudioMs: 42,
      ttsDurationMs: 900,
    });
    const body = JSON.parse(calls[0].init.body);
    expect(body.message).toContain("Voice: Browser");
    expect(body.message).toContain("TTS first-audio ms: 42");
    expect(body.message).toContain("TTS duration ms: 900");
  });

  it("app shows a latency chip next to the wave", () => {
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain('id="tts-latency"');
    expect(app).toContain("formatTtsLatencyReadout");
    expect(app).toContain("onTtsStats");
    expect(app).toContain("ttsFirstAudioMs");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.tts-latency\[hidden\]/);
  });
});
