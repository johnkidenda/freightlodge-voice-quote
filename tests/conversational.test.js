import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance, openingMessage, PROMPTS } from "../src/lib/dialog.js";
import {
  CONVERSATIONAL_GREETING,
  composeConversationalReply,
  loadConversationalMode,
  presentAgentReply,
  saveConversationalMode,
} from "../src/lib/conversational.js";
import { speakAgentReply, DEFAULT_TTS_ENGINE, TTS_ENGINES } from "../src/lib/agent-speech.js";
import { readClientUi } from "./client-ui.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("conversational reply copy", () => {
  it("keeps formal prompts when mode is off", () => {
    const session = createSession({ id: "formal" });
    const result = handleUtterance(session, "hello");
    expect(presentAgentReply(result, false)).toBe(result.reply);
    expect(result.reply).toContain(PROMPTS.origin_zip);
    expect(openingMessage()).toMatch(/What’s the origin zip code/);
    expect(openingMessage()).not.toMatch(/won’t guess|won’t invent|won’t look/i);
  });

  it("rewrites the origin-ZIP ask to a short CS line", () => {
    const result = handleUtterance(createSession({ id: "warm-zip" }), "hello");
    const warm = presentAgentReply(result, true);
    expect(warm).toMatch(/pickup zip code/i);
    expect(warm).not.toContain("City is helpful, but I need the 5-digit zip code");
    expect(warm.length).toBeLessThan(result.reply.length);
  });

  it("says destination / pieces / pounds instead of dest / pcs / lb", () => {
    const dest = handleUtterance(createSession({ id: "warm-dest" }), "destination zip is 78721");
    const destWarm = presentAgentReply(dest, true);
    expect(destWarm).toMatch(/destination ZIP, 78721/);
    expect(destWarm).not.toMatch(/\bdest\b/);
    expect(destWarm).not.toMatch(/Got dest 78721/i);

    const pieces = handleUtterance(createSession({ id: "warm-pcs" }), "3 pallets");
    const piecesWarm = presentAgentReply(pieces, true);
    expect(piecesWarm).toMatch(/3 pallets/);
    expect(piecesWarm).not.toMatch(/\bpcs\b/);

    const weight = handleUtterance(createSession({ id: "warm-lb" }), "1200 pounds");
    const weightWarm = presentAgentReply(weight, true);
    expect(weightWarm).toMatch(/1200 pounds/);
    expect(weightWarm).not.toMatch(/\blb\b/);
  });

  it("dump copy names parked facts and asks for both missing ZIPs", () => {
    const result = handleUtterance(
      createSession({ id: "warm-dump" }),
      "ship a thousand pounds of oranges from Austin to Atlanta",
    );
    const warm = composeConversationalReply({
      formalReply: result.reply,
      extracted: result.extracted,
      sheet: result.session.sheet,
      awaiting: result.session.awaiting,
    });
    expect(warm).toBe(
      "I have Austin and Atlanta and 1000 pounds of oranges. I still need the origin and destination zip codes.",
    );
    expect(warm).not.toMatch(/\bdest\b/);
    expect(warm).not.toMatch(/\bpcs\b/);
    expect(warm).not.toMatch(/\blb\b/);
    expect(warm).not.toMatch(/\d{5}/);
  });

  it("does not invent a rate or ZIP on ready / OOS", () => {
    const ready = composeConversationalReply({
      ready: true,
      formalReply: "Sheet’s complete. Handing this to Freight Ops’ Exfresso runner for a live rate.",
    });
    expect(ready).toMatch(/sheet is complete/i);
    expect(ready).toMatch(/live rate/i);
    expect(ready).not.toMatch(/no booking|book or pay/i);
    expect(ready).not.toMatch(/\$\d/);
    const oos = composeConversationalReply({
      outOfScope: true,
      formalReply: "That’s ocean. I won’t quote a fake rate.",
    });
    expect(oos).toBe("That’s ocean. I won’t quote a fake rate.");
  });

  it("persists the toggle and greeting is warmer when on", () => {
    const store = memoryStorage();
    expect(loadConversationalMode(store)).toBe(false);
    expect(saveConversationalMode(true, store)).toBe(true);
    expect(loadConversationalMode(store)).toBe(true);
    expect(CONVERSATIONAL_GREETING).toMatch(/^Hi\./);
    expect(CONVERSATIONAL_GREETING).toMatch(/origin zip code/);
    expect(CONVERSATIONAL_GREETING).not.toBe(openingMessage());
  });
});

describe("conversational TTS wiring", () => {
  it("uses browser speechSynthesis only (no cloud TTS)", () => {
    expect(DEFAULT_TTS_ENGINE).toBe(TTS_ENGINES.BROWSER);
    expect(typeof speakAgentReply).toBe("function");
    const app = readClientUi();
    expect(app).toContain("Conversational mode");
    expect(app).toContain("presentAgentReply");
    expect(app).toContain("speakAgentReply");
    expect(app).toContain("tts-wave");
    expect(app).toContain("onAgentSpeaking");
    expect(app).toContain("convo-audio");
    expect(app).toContain("speakerIcon");
    expect(app).toMatch(/is-muted/);
    expect(app).toMatch(/Turn conversational mode (on|off)/);
    expect(app).not.toContain("data-tts-engine");
    expect(app).not.toContain("tts-latency");
    expect(app).toContain("toggleConversational");
    expect(app).toContain("agent-speech.js");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/@keyframes tts-wave/);
    expect(css).toMatch(/\.tts-wave\[hidden\]/);
    expect(css).not.toMatch(/\.stt-badge/);
    expect(css).not.toMatch(/\.stt-toggle/);
    expect(css).not.toMatch(/\.stt-opt/);
    expect(app).not.toContain("data-stt-provider");
    expect(app).not.toContain("stt-toggle");
    expect(app).not.toContain("stt-badge");
    expect(app).not.toContain("sttBadge");
    expect(app).not.toContain("sttBadgeText");
    expect(app).not.toContain("STT: Web Speech");
  });

  it("app module parses so Conversational mode can mount", async () => {
    const mod = await import("../src/app.js");
    expect(typeof mod.mountApp).toBe("function");
  });
});
