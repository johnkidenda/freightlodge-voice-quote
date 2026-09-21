import { describe, expect, it } from "vitest";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import {
  RELEASE_TAIL_MS,
  collapseProgressiveFinals,
  createHoldToTalk,
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

function fakeRecognition() {
  const instances = [];
  function Recognition() {
    this.onresult = null;
    this.onend = null;
    this.onerror = null;
    this.lang = "";
    this.interimResults = false;
    this.continuous = false;
    this.started = false;
    this.stopped = false;
    instances.push(this);
  }
  Recognition.prototype.start = function start() {
    this.started = true;
  };
  Recognition.prototype.stop = function stop() {
    this.stopped = true;
    if (this.suppressEnd) return;
    this.onend?.();
  };
  Recognition.prototype.abort = function abort() {
    this.stopped = true;
  };
  Recognition.prototype.emit = function emit(rows) {
    this.onresult?.({
      results: rows.map((row) => {
        const item = [{ transcript: row.transcript }];
        item.transcript = row.transcript;
        item.isFinal = row.isFinal;
        return item;
      }),
    });
  };
  return { Recognition, instances };
}

describe("release tail keeps listening before commit", () => {
  it("exports a 1000ms tail constant", () => {
    expect(RELEASE_TAIL_MS).toBe(1000);
  });

  it("does not commit on stop; includes tail speech after RELEASE_TAIL_MS", () => {
    const { Recognition, instances } = fakeRecognition();
    const timers = [];
    const commits = [];
    const tails = [];
    const talk = createHoldToTalk({
      Recognition,
      onCommit: (text) => commits.push(text),
      onTailStart: () => tails.push("tail"),
      schedule: (fn, ms) => {
        const id = timers.length + 1;
        timers.push({ id, fn, ms });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });

    talk.start();
    expect(talk.isTailing()).toBe(false);
    instances[0].emit([{ transcript: "I'd like to ship a thousand pounds from", isFinal: false }]);
    talk.stop();
    expect(talk.isTailing()).toBe(true);
    expect(tails).toEqual(["tail"]);
    expect(commits).toEqual([]);
    expect(instances[0].stopped).toBe(false);

    instances[0].emit([
      { transcript: "I'd like to ship a thousand pounds from Atlanta Austin", isFinal: true },
    ]);
    expect(commits).toEqual([]);

    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(RELEASE_TAIL_MS);
    timers[0].fn();

    expect(instances[0].stopped).toBe(true);
    expect(talk.isTailing()).toBe(false);
    expect(commits).toEqual(["I'd like to ship a thousand pounds from Atlanta Austin"]);
  });

  it("does not send to the agent mid-tail even if STT marks a phrase final", () => {
    const { Recognition, instances } = fakeRecognition();
    const timers = [];
    const commits = [];
    const talk = createHoldToTalk({
      Recognition,
      onCommit: (text) => commits.push(text),
      schedule: (fn) => {
        const id = timers.length + 1;
        timers.push({ id, fn });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    talk.start();
    talk.stop();
    instances[0].emit([{ transcript: "three pieces", isFinal: true }]);
    expect(commits).toEqual([]);
    timers[0].fn();
    expect(commits).toEqual(["three pieces"]);
  });
});

/**
 * Smoke (phone, after the pieces prompt "How many pieces or pallets?"):
 * 1. Tap or hold, say "one pallet", release. User bubble shows that text.
 *    Pieces on the sheet becomes 1 and the agent asks the next missing field.
 * 2. Repeat with "1 pallet" (new sheet or a fresh pieces ask). Same result.
 * 3. If the mic hears nothing, the agent says to say it again or type it.
 */
describe("short mobile answers are not dropped", () => {
  it("releases an interim-only phrase instead of discarding it", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    buf.applyResults([{ transcript: "one pallet", isFinal: false }]);
    expect(buf.release()).toBe("one pallet");
  });

  it("keeps the phrase when a later result is an empty final", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    buf.applyResults([{ transcript: "one pallet", isFinal: false }]);
    buf.applyResults([{ transcript: "", isFinal: true }]);
    expect(buf.release()).toBe("one pallet");
  });

  it("commits one pallet when stop ends the recognizer without a final", () => {
    const { Recognition, instances } = fakeRecognition();
    const timers = [];
    const commits = [];
    const talk = createHoldToTalk({
      Recognition,
      onCommit: (text) => commits.push(text),
      schedule: (fn, ms) => {
        const id = timers.length + 1;
        timers.push({ id, fn, ms });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    talk.start();
    instances[0].emit([{ transcript: "one pallet", isFinal: false }]);
    talk.stop();
    expect(commits).toEqual([]);
    timers[0].fn();
    expect(commits).toEqual(["one pallet"]);
  });

  it("commits the sealed phrase when stop never fires onend", () => {
    const { Recognition, instances } = fakeRecognition();
    const timers = [];
    const commits = [];
    const talk = createHoldToTalk({
      Recognition,
      endFallbackMs: 500,
      onCommit: (text) => commits.push(text),
      schedule: (fn, ms) => {
        const id = timers.length + 1;
        timers.push({ id, fn, ms });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    talk.start();
    instances[0].emit([{ transcript: "1 pallet", isFinal: false }]);
    instances[0].suppressEnd = true;
    talk.stop();
    timers[0].fn();
    expect(commits).toEqual([]);
    const fallback = timers.find((t) => t.ms === 500);
    expect(fallback).toBeTruthy();
    fallback.fn();
    expect(commits).toEqual(["1 pallet"]);
  });

  it("asks for a retry when the listen ends with no words", () => {
    const { Recognition } = fakeRecognition();
    const timers = [];
    const empties = [];
    const commits = [];
    const talk = createHoldToTalk({
      Recognition,
      onCommit: (text) => commits.push(text),
      onEmpty: () => empties.push("empty"),
      schedule: (fn, ms) => {
        const id = timers.length + 1;
        timers.push({ id, fn, ms });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    });
    talk.start();
    talk.stop();
    timers[0].fn();
    expect(commits).toEqual([]);
    expect(empties).toEqual(["empty"]);
  });
});

describe("pieces prompt accepts a short pallet count", () => {
  function piecesSession() {
    const session = createSession({ id: "one-pallet" });
    session.sheet.lanes.origin.postal_code = "78731";
    session.sheet.lanes.origin.state = "TX";
    session.sheet.lanes.destination.postal_code = "60101";
    session.sheet.lanes.destination.state = "IL";
    session.sheet.freight.total_weight_lbs = 100;
    session.sheet.freight.commodity = "clay pots";
    session.awaiting = "pieces";
    return session;
  }

  it.each(["one pallet", "1 pallet", "a pallet"])("parks 1 piece from %s and advances", (text) => {
    const result = handleUtterance(piecesSession(), text);
    expect(result.session.sheet.freight.pieces).toBe(1);
    expect(result.session.awaiting).not.toBe("pieces");
    expect(result.session.sheet.freight.commodity).toBe("clay pots");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(100);
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78731");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("60101");
  });

  it("still advances when Jev marks the short answer low-parse", () => {
    const result = handleUtterance(piecesSession(), "one pallet", {
      jev: {
        on: true,
        needsClarify: true,
        lowParse: true,
        parseScore: 0.2,
        clarifyNoul: 0.9,
        ready: false,
        readyNoul: 0.1,
        touchedSlots: ["pieces"],
        primarySlot: "pieces",
        focus: "pieces",
      },
    });
    expect(result.session.sheet.freight.pieces).toBe(1);
    expect(result.session.awaiting).not.toBe("pieces");
    expect(result.jev.needsClarify).toBe(false);
    expect(result.jev.gateOverride).toBe("min-fields");
  });
});

