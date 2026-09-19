import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatSessionTranscript, sendSessionTranscript } from "../src/lib/transcript.js";
import { createSession } from "../src/lib/dialog.js";
import { STT_PROVIDER_IDS } from "../src/lib/stt-providers.js";

function jsonRes(body, ok = true) {
  return {
    ok,
    text: async () => JSON.stringify(body),
  };
}

describe("TTS timing removed from UI and Send transcript", () => {
  it("app has no latency chip or Voice: Browser/Cartesia toggle", () => {
    const app = readFileSync("src/app.js", "utf8");
    expect(app).not.toContain('id="tts-latency"');
    expect(app).not.toContain("formatTtsLatencyReadout");
    expect(app).not.toContain("onTtsStats");
    expect(app).not.toContain("ttsFirstAudioMs");
    expect(app).not.toContain("data-tts-engine");
    expect(app).not.toContain("voice-engine");
    expect(app).toContain("tts-wave");
    expect(app).toContain("Conversational mode");
    expect(app).not.toContain("stt-badge");
    expect(app).not.toContain("STT: Web Speech");
    expect(app).not.toContain("STT: Cartesia");
  });

  it("Send snapshot does not stamp Voice or TTS first-audio ms", () => {
    const text = formatSessionTranscript([{ role: "user", text: "hello" }], {
      ...createSession({ id: "tts-snap" }),
      ttsEngine: "cartesia",
      ttsFirstAudioMs: 820,
      ttsDurationMs: 2100,
    });
    expect(text).not.toContain("Voice: Cartesia");
    expect(text).not.toContain("TTS first-audio ms:");
    expect(text).not.toContain("TTS duration ms:");
    expect(text).toContain("STT: Web Speech");
  });

  it("FormSubmit body omits Voice and first-audio even if last utterance was timed", async () => {
    const calls = [];
    await sendSessionTranscript([{ role: "user", text: "Chicago 60601" }], createSession({ id: "tts-send" }), {
      fetchFn: async (url, init) => {
        calls.push({ url, init });
        return jsonRes({ success: true, message: "Your form has been submitted" });
      },
      webhookUrl: "",
      sttProvider: STT_PROVIDER_IDS.WEB_SPEECH,
    });
    const body = JSON.parse(calls[0].init.body);
    expect(body.message).not.toContain("Voice:");
    expect(body.message).not.toContain("TTS first-audio ms:");
    expect(body.message).not.toContain("TTS duration ms:");
  });
});
