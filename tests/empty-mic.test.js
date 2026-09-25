/**
 * @vitest-environment happy-dom
 *
 * Idle, typing, and empty-mic behavior through mountApp on a fake clock.
 * The speech session is the real callback object mountApp registers.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const spoken = [];
const holds = [];

vi.mock("../src/lib/agent-speech.js", async () => {
  const actual = await vi.importActual("../src/lib/agent-speech.js");
  return {
    ...actual,
    speakAgentReply: vi.fn(async (text) => {
      spoken.push(String(text || ""));
      return false;
    }),
    stopAgentSpeech: vi.fn(),
  };
});

vi.mock("../src/lib/speech-session.js", async () => {
  const actual = await vi.importActual("../src/lib/speech-session.js");
  return {
    ...actual,
    createSpeechSession(opts) {
      const hold = {
        supported: true,
        mode: "hold",
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        isActive: () => false,
        isTailing: () => false,
        opts,
      };
      holds.push(hold);
      return hold;
    },
  };
});

vi.mock("../src/lib/listen-cue.js", () => ({
  playListenCue: vi.fn(),
  primeListenCue: vi.fn(),
}));

import { EMPTY_MIC_HINT, mountApp } from "../src/app.js";

const TO_PIECES = ["78721", "30030", "pallets"];
const PIECES_TO_EMAIL = ["2", "500 pounds", "oranges", "October 2", "no"];

function mount() {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app");
  mountApp(root);
  return root;
}

function bubbleCount(root) {
  return root.querySelectorAll("#thread article").length;
}

function threadText(root) {
  return root.querySelector("#thread").textContent || "";
}

async function send(root, text) {
  const input = root.querySelector("#typed");
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  root.querySelector("#composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
}

function typeOnly(root, text) {
  const input = root.querySelector("#typed");
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function enableVoice(root) {
  root.querySelector("#conversational").click();
}

afterEach(() => {
  vi.useRealTimers();
  spoken.length = 0;
  holds.length = 0;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("no silence timer and no auto re-listen", () => {
  it("does not keep a no-input module or a spoken empty-mic line", () => {
    expect(() => readFileSync("src/lib/no-input.js", "utf8")).toThrow();
    const app = readFileSync("src/app.js", "utf8");
    expect(app).not.toMatch(/no-input|createNoInputWatch|rearmListen|quietListen|createMicResultController/);
    expect(app).not.toMatch(/I didn[’']t catch that/);
    const onEmpty = app.match(/onEmpty\(\) \{[\s\S]*?\n      \}/)[0];
    expect(onEmpty).toMatch(/onEmptyMic/);
    expect(onEmpty).not.toMatch(/\.start\(|speakAgentReply|speakOrStop/);
  });

  it("sitting idle for 60s after a question speaks nothing in text and voice mode", async () => {
    vi.useFakeTimers();
    for (const voice of [false, true]) {
      spoken.length = 0;
      holds.length = 0;
      const root = mount();
      if (voice) enableVoice(root);
      const bubbles = bubbleCount(root);
      const said = spoken.length;
      expect(threadText(root)).toMatch(/What’s the origin zip code\?/);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bubbleCount(root)).toBe(bubbles);
      expect(spoken).toHaveLength(said);
      expect(threadText(root)).not.toMatch(/didn[’']t catch|didn[’']t hear/i);
      expect(holds.at(-1).start).not.toHaveBeenCalled();
      expect(root.querySelector("#listen-hint").hidden).toBe(true);
    }
  });

  it("typing during the count and email asks never reprompts", async () => {
    vi.useFakeTimers();
    for (const voice of [false, true]) {
      spoken.length = 0;
      holds.length = 0;
      const root = mount();
      if (voice) enableVoice(root);
      for (const line of TO_PIECES) await send(root, line);
      expect(threadText(root)).toMatch(/How many pallets\?/);

      const atPieces = bubbleCount(root);
      const saidAtPieces = spoken.length;
      typeOnly(root, "2");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bubbleCount(root)).toBe(atPieces);
      expect(spoken).toHaveLength(saidAtPieces);
      expect(threadText(root)).not.toMatch(/didn[’']t catch/i);
      expect(holds.at(-1).start).not.toHaveBeenCalled();

      for (const line of PIECES_TO_EMAIL) await send(root, line);
      expect(threadText(root)).toMatch(/What email should I put on the sheet/);
      const atEmail = bubbleCount(root);
      const saidAtEmail = spoken.length;
      typeOnly(root, "shipper@example.com");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bubbleCount(root)).toBe(atEmail);
      expect(spoken).toHaveLength(saidAtEmail);
      expect(threadText(root)).not.toMatch(/didn[’']t catch/i);
      expect(holds.at(-1).start).not.toHaveBeenCalled();
    }
  });

  it("an empty mic result shows only the inline hint", async () => {
    vi.useFakeTimers();
    for (const voice of [false, true]) {
      spoken.length = 0;
      holds.length = 0;
      const root = mount();
      if (voice) enableVoice(root);
      const hold = holds.at(-1);
      const bubbles = bubbleCount(root);
      hold.opts.onEmpty();
      hold.opts.onEmpty();
      const hint = root.querySelector("#listen-hint");
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toBe(EMPTY_MIC_HINT);
      expect(bubbleCount(root)).toBe(bubbles);
      expect(spoken).toEqual([]);
      expect(hold.start).not.toHaveBeenCalled();
      expect(threadText(root)).not.toMatch(/didn[’']t catch|didn[’']t hear/i);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(bubbleCount(root)).toBe(bubbles);
      expect(spoken).toEqual([]);
      expect(hold.start).not.toHaveBeenCalled();
      expect(hint.textContent).toBe(EMPTY_MIC_HINT);
    }
  });
});
