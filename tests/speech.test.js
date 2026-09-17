import { describe, expect, it } from "vitest";
import { createTranscriptBuffer, preferTapToTalk } from "../src/lib/speech.js";

describe("hold-to-talk commits only on release", () => {
  it("does not commit while still holding, even if STT marks a phrase final", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    const mid = buf.onSpeechResult({ finalText: "I'd like to ship", interim: "" });
    expect(mid.commit).toBeNull();
    expect(buf.isHolding()).toBe(true);
    const more = buf.onSpeechResult({ finalText: "a thousand pounds of peaches", interim: "from" });
    expect(more.commit).toBeNull();
    expect(more.preview.toLowerCase()).toMatch(/peaches/);
    const sent = buf.release();
    expect(sent.toLowerCase()).toMatch(/ship/);
    expect(sent.toLowerCase()).toMatch(/peaches/);
    expect(buf.isHolding()).toBe(false);
  });

  it("release with no speech returns empty — nothing sent to the agent", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    expect(buf.release()).toBe("");
  });

  it("prefers tap-to-talk on iOS / iPhone Safari", () => {
    expect(preferTapToTalk("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(preferTapToTalk("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).toBe(false);
  });
});
