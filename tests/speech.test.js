import { describe, expect, it } from "vitest";
import {
  collapseProgressiveFinals,
  createTranscriptBuffer,
  preferTapToTalk,
} from "../src/lib/speech.js";

describe("hold-to-talk commits only on release", () => {
  it("does not commit while still holding, even if STT marks a phrase final", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    const mid = buf.applyResults([{ transcript: "I'd like to ship", isFinal: true }]);
    expect(mid.commit).toBeNull();
    expect(buf.isHolding()).toBe(true);
    const more = buf.applyResults([
      { transcript: "I'd like to ship", isFinal: true },
      { transcript: "a thousand pounds of peaches", isFinal: true },
      { transcript: "from", isFinal: false },
    ]);
    expect(more.commit).toBeNull();
    expect(more.preview.toLowerCase()).toMatch(/peaches/);
    const sent = buf.release();
    expect(sent.toLowerCase()).toMatch(/ship/);
    expect(sent.toLowerCase()).toMatch(/peaches/);
    expect(sent.toLowerCase()).not.toMatch(/from georgia/);
    expect(buf.isHolding()).toBe(false);
  });

  it("release with no speech returns empty — nothing sent to the agent", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    expect(buf.release()).toBe("");
  });

  it("prefers tap-to-talk on iOS / iPhone Safari", () => {
    expect(
      preferTapToTalk(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      preferTapToTalk(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("STT stutter — replace progressive finals, do not concatenate", () => {
  const JOHN = [
    "I'd",
    "I'd like",
    "I'd like to ship",
    "I'd like to ship a thousand pounds of oranges from Georgia to Austin Texas",
  ];

  it("successive cumulative finals commit the last utterance once", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    for (const text of JOHN) {
      const step = buf.applyResults([{ transcript: text, isFinal: true }]);
      expect(step.commit).toBeNull();
    }
    const sent = buf.release();
    expect(sent).toBe(JOHN[JOHN.length - 1]);
    expect(sent.match(/I'd like/gi)?.length).toBe(1);
    expect(sent).not.toMatch(/I'd I'd/);
  });

  it("one event with cumulative result slots still collapses to the last phrase", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    buf.applyResults(JOHN.map((transcript) => ({ transcript, isFinal: true })));
    const sent = buf.release();
    expect(sent).toBe(JOHN[JOHN.length - 1]);
    expect(collapseProgressiveFinals(JOHN)).toBe(JOHN[JOHN.length - 1]);
  });

  it("non-overlapping final segments still combine (hello + world)", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    buf.applyResults([
      { transcript: "hello ", isFinal: true },
      { transcript: "world", isFinal: true },
    ]);
    expect(buf.release()).toBe("hello world");
  });

  it("preview may include interim; release is final-only without stutter", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    buf.applyResults([
      { transcript: "I'd like to ship", isFinal: true },
      { transcript: "I'd like to ship a thousand pounds", isFinal: false },
    ]);
    const mid = buf.applyResults([
      { transcript: "I'd like to ship a thousand pounds of oranges from Georgia to Austin Texas", isFinal: true },
    ]);
    expect(mid.preview).toBe(JOHN[JOHN.length - 1]);
    expect(buf.release()).toBe(JOHN[JOHN.length - 1]);
  });
});
