import { afterEach, describe, expect, it } from "vitest";
import { pinThreadToEnd, settleThreadScroll } from "../src/ui/thread.js";

describe("thread scroll settles after layout", () => {
  afterEach(() => {
    delete globalThis.requestAnimationFrame;
    delete globalThis.ResizeObserver;
    delete globalThis.document;
  });

  it("writes scrollTop to the current scrollHeight", () => {
    const thread = { scrollTop: 12, scrollHeight: 400 };
    pinThreadToEnd(thread);
    expect(thread.scrollTop).toBe(400);
  });

  it("pins again after the card height changes the thread", () => {
    const frames = [];
    globalThis.requestAnimationFrame = (fn) => {
      frames.push(fn);
      return frames.length;
    };
    const thread = { scrollTop: 0, scrollHeight: 941, clientHeight: 263 };
    settleThreadScroll(thread);
    expect(thread.scrollTop).toBe(941);

    thread.scrollHeight = 1204;
    thread.clientHeight = 200;
    frames.shift()();
    expect(thread.scrollTop).toBe(1204);
    thread.scrollHeight = 1380;
    frames.shift()();
    expect(thread.scrollTop).toBe(1380);
    expect(thread.scrollTop + thread.clientHeight).toBeGreaterThanOrEqual(thread.scrollHeight - 2);
  });

  it("pins when the quote card resizes, including a hidden-price card", () => {
    let onResize;
    globalThis.ResizeObserver = class {
      constructor(fn) {
        onResize = fn;
      }
      observe() {}
      disconnect() {}
    };
    globalThis.requestAnimationFrame = () => 0;
    const thread = { scrollTop: 1095, scrollHeight: 1095 };
    const quote = {};
    settleThreadScroll(thread, quote);
    thread.scrollHeight = 1380;
    onResize();
    expect(thread.scrollTop).toBe(1380);
    expect(quote._endPinObserved).toBe(true);
  });
});
