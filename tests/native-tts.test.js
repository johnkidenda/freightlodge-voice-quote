import { describe, expect, it } from "vitest";
import { readClientUi } from "./client-ui.js";
import {
  DEFAULT_TTS_ENGINE,
  TTS_ENGINES,
  loadTtsEngine,
  saveTtsEngine,
  speakAgentReply,
  stopAgentSpeech,
} from "../src/lib/agent-speech.js";
import { cancelBrowserSpeech, pickBrowserVoice, speakBrowserReply } from "../src/lib/native-tts.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("browser voice picker", () => {
  it("prefers a female en-US CS-leaning voice when listed", () => {
    const voices = [
      { name: "Google UK English Male", lang: "en-GB", localService: true },
      { name: "Microsoft David", lang: "en-US", localService: true },
      { name: "Samantha", lang: "en-US", localService: true },
    ];
    expect(pickBrowserVoice(voices).name).toBe("Samantha");
  });

  it("falls back to en-US when no female hint exists", () => {
    const voices = [
      { name: "Fred", lang: "en-US", localService: true },
      { name: "Thomas", lang: "fr-FR", localService: true },
    ];
    expect(pickBrowserVoice(voices).lang).toBe("en-US");
  });
});

describe("TTS engine — browser only", () => {
  it("always uses browser speechSynthesis", () => {
    expect(DEFAULT_TTS_ENGINE).toBe(TTS_ENGINES.BROWSER);
    const store = memoryStorage();
    expect(loadTtsEngine(store)).toBe(TTS_ENGINES.BROWSER);
    expect(saveTtsEngine("browser", store)).toBe(TTS_ENGINES.BROWSER);
    expect(loadTtsEngine(store)).toBe(TTS_ENGINES.BROWSER);
  });
});

describe("native speak / cancel", () => {
  it("cancels in-flight speech and speaks a new utterance", () => {
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
    expect(speakBrowserReply("What’s the origin ZIP?", { synth, utteranceClass: FakeUtterance })).toBe(true);
    expect(synth.cancelCalls).toBe(1);
    expect(spoken[0].text).toMatch(/origin ZIP/);
    expect(spoken[0].lang).toBe("en-US");
    expect(spoken[0].voice.name).toBe("Samantha");
    cancelBrowserSpeech(synth);
    expect(synth.cancelCalls).toBe(2);
  });

  it("router default is browser; stop cancels native speech", async () => {
    const synth = {
      cancelCalls: 0,
      cancel() {
        this.cancelCalls += 1;
      },
      speak() {},
      getVoices() {
        return [];
      },
    };
    class FakeUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    const ok = await speakAgentReply("Got it.", {
      engine: TTS_ENGINES.BROWSER,
      synth,
      utteranceClass: FakeUtterance,
    });
    expect(ok).toBe(true);
    stopAgentSpeech();
    expect(synth.cancelCalls).toBeGreaterThanOrEqual(1);
  });
});

describe("speaker toggle + voice control in the app", () => {
  it("speaker button toggles conversational mode; no cloud Voice toggle", () => {
    const app = readClientUi();
    expect(app).toContain('id="convo-audio"');
    expect(app).toContain("toggleConversational");
    expect(app).toMatch(/els\.convoAudio\?\.addEventListener\("click", toggleConversational\)/);
    expect(app).toMatch(/els\.conversational\?\.addEventListener\("click", toggleConversational\)/);
    expect(app).toContain("saveConversationalMode");
    expect(app).toContain("tts-wave");
    expect(app).not.toContain("data-tts-engine");
    expect(app).not.toContain("voice-engine");
    expect(app).not.toContain("tts-latency");
  });
});
