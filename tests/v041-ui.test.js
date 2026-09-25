/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/agent-speech.js", async () => {
  const actual = await vi.importActual("../src/lib/agent-speech.js");
  return {
    ...actual,
    speakAgentReply: vi.fn(async () => false),
    stopAgentSpeech: vi.fn(),
  };
});

vi.mock("../src/lib/speech-session.js", async () => {
  const actual = await vi.importActual("../src/lib/speech-session.js");
  return {
    ...actual,
    createSpeechSession() {
      return {
        supported: true,
        mode: "hold",
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        isActive: () => false,
        isTailing: () => false,
      };
    },
  };
});

vi.mock("../src/lib/listen-cue.js", () => ({
  playListenCue: vi.fn(),
  primeListenCue: vi.fn(),
}));

vi.mock("../src/lib/handoff.js", async () => {
  const actual = await vi.importActual("../src/lib/handoff.js");
  return {
    ...actual,
    requestQuote: vi.fn(async (sheet) => actual.simulateExfressoRunner(sheet)),
  };
});

vi.mock("../src/lib/transcript.js", async () => {
  const actual = await vi.importActual("../src/lib/transcript.js");
  return {
    ...actual,
    sendSessionTranscript: vi.fn(async (messages, session, opts) => {
      const transcript = actual.formatSessionTranscript(messages, {
        ...session,
        sttProvider: opts?.sttProvider ?? session?.sttProvider,
      });
      return { ok: true, mode: "formsubmit", transcript };
    }),
  };
});

import { mountApp } from "../src/app.js";

const NOW = new Date(2026, 8, 25, 15, 0, 0);

function mount() {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app");
  mountApp(root, { now: NOW });
  return root;
}

function assistants(root) {
  return [...root.querySelectorAll("#thread article.assistant")];
}

function bubbleText(article) {
  return article.querySelector("p")?.textContent || "";
}

function lastAssistant(root) {
  return assistants(root).at(-1);
}

function openButtons(root) {
  return [...root.querySelectorAll("#thread .quick-reply")].filter((button) => !button.disabled);
}

async function send(root, text) {
  const input = root.querySelector("#typed");
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  root.querySelector("#composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
}

async function drive(root, lines) {
  for (const line of lines) await send(root, line);
}

function clickLabel(root, label) {
  const button = openButtons(root).find((el) => el.textContent === label);
  expect(button, label).toBeTruthy();
  button.click();
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("v0.41 quick replies and spoken quote", () => {
  it("shows Yes, 65 and No, fix it, then leaves them inert", async () => {
    const root = mount();
    await drive(root, ["78721", "30030", "pallets", "65", "1000 pounds"]);
    const ask = lastAssistant(root);
    expect(bubbleText(ask)).toMatch(/Quote 65 pallets anyway\?/);
    expect(openButtons(root).map((button) => button.textContent)).toEqual(["Yes, 65", "No, fix it"]);
    expect(openButtons(root).every((button) => button.getAttribute("type") === "button")).toBe(true);

    clickLabel(root, "No, fix it");
    await Promise.resolve();
    expect(openButtons(root)).toHaveLength(0);
    expect([...root.querySelectorAll("#thread .quick-reply")].every((button) => button.disabled)).toBe(true);
    expect(bubbleText(lastAssistant(root))).toMatch(/What’s the pallet count\?/);

    await send(root, "5");
    expect(bubbleText(lastAssistant(root))).not.toMatch(/anyway\?/);
  });

  it("says the quote amount and writes version plus the tap into the transcript", async () => {
    const root = mount();
    await drive(root, ["78721", "30030"]);
    clickLabel(root, "Pallets");
    await Promise.resolve();
    await drive(root, ["5", "1000 pounds", "oranges", "October 2", "none", "shipper@example.com"]);
    await vi.waitFor(() => {
      expect(bubbleText(lastAssistant(root))).toContain("Your quote is $258.50");
    });
    expect(bubbleText(lastAssistant(root))).toContain("Tap 'Email me this quote'");
    expect(root.querySelector("[data-email-quote]").textContent).toBe("Email me this quote");

    root.querySelector("#send-transcript").click();
    const note = root.querySelector("#send-note");
    await vi.waitFor(() => expect(note.hidden).toBe(false));
    expect(note.textContent).toContain("Version: v0.41");
    expect(note.textContent).toContain("User [tap]: Pallets");
    expect(note.textContent).toContain("Your quote is $258.50");
  });
});
