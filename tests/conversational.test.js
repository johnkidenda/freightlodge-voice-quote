import { describe, expect, it } from "vitest";
import { createSession, handleUtterance, openingMessage, PROMPTS } from "../src/lib/dialog.js";
import {
  CONVERSATIONAL_GREETING,
  composeConversationalReply,
  loadConversationalMode,
  presentAgentReply,
  saveConversationalMode,
} from "../src/lib/conversational.js";
import { CARTESIA_TTS_VOICE_ID, CARTESIA_TTS_VOICE_NAME, getTtsProxyUrl } from "../src/lib/cartesia-tts.js";
import { readFileSync } from "node:fs";

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
    expect(openingMessage()).toMatch(/I won’t guess it/);
  });

  it("rewrites the origin-ZIP ask to a short CS line", () => {
    const result = handleUtterance(createSession({ id: "warm-zip" }), "hello");
    const warm = presentAgentReply(result, true);
    expect(warm).toMatch(/pickup ZIP/i);
    expect(warm).not.toContain("City is helpful, but I need the five-digit ZIP");
    expect(warm.length).toBeLessThan(result.reply.length);
  });

  it("says destination / pieces / pounds instead of dest / pcs / lb", () => {
    const dest = handleUtterance(createSession({ id: "warm-dest" }), "destination zip is 78721");
    const destWarm = presentAgentReply(dest, true);
    expect(destWarm).toMatch(/destination ZIP — 78721/);
    expect(destWarm).not.toMatch(/\bdest\b/);
    expect(destWarm).not.toMatch(/Got dest 78721/i);

    const pieces = handleUtterance(createSession({ id: "warm-pcs" }), "3 pallets");
    const piecesWarm = presentAgentReply(pieces, true);
    expect(piecesWarm).toMatch(/3 pieces/);
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
    expect(warm).toBe("I have Austin and Atlanta and 1000 pounds of oranges. I still need the origin and destination ZIPs.");
    expect(warm).not.toMatch(/\bdest\b/);
    expect(warm).not.toMatch(/\bpcs\b/);
    expect(warm).not.toMatch(/\blb\b/);
    expect(warm).not.toMatch(/\d{5}/);
  });

  it("does not invent a rate or ZIP on ready / OOS", () => {
    const ready = composeConversationalReply({
      ready: true,
      formalReply: "Sheet’s complete. Handing this to Freight Ops’ Exfresso runner for a live rate — no booking from here.",
    });
    expect(ready).toMatch(/no booking/i);
    expect(ready).not.toMatch(/\$\d/);
    const oos = composeConversationalReply({
      outOfScope: true,
      formalReply: "That’s ocean — I won’t quote a fake rate.",
    });
    expect(oos).toBe("That’s ocean — I won’t quote a fake rate.");
  });

  it("persists the toggle and greeting is warmer when on", () => {
    const store = memoryStorage();
    expect(loadConversationalMode(store)).toBe(false);
    expect(saveConversationalMode(true, store)).toBe(true);
    expect(loadConversationalMode(store)).toBe(true);
    expect(CONVERSATIONAL_GREETING).toMatch(/Hi —/);
    expect(CONVERSATIONAL_GREETING).toMatch(/origin ZIP/);
    expect(CONVERSATIONAL_GREETING).not.toBe(openingMessage());
  });
});

describe("conversational TTS wiring", () => {
  it("uses Skylar and derives /tts from the token mint URL", () => {
    expect(CARTESIA_TTS_VOICE_NAME).toBe("Skylar");
    expect(CARTESIA_TTS_VOICE_ID).toBe("db6b0ed5-d5d3-463d-ae85-518a07d3c2b4");
    expect(getTtsProxyUrl({ VITE_STT_TOKEN_URL: "/api/stt-token" })).toBe("/api/tts");
    expect(getTtsProxyUrl({ VITE_STT_TOKEN_URL: "https://freightlodge-stt-token.example.workers.dev" })).toBe(
      "https://freightlodge-stt-token.example.workers.dev/tts",
    );
    expect(getTtsProxyUrl({ VITE_STT_TOKEN_URL: "" })).toBe("");
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain("Conversational mode");
    expect(app).toContain("presentAgentReply");
    expect(app).toContain("speakAgentReply");
    expect(app).toContain("tts-wave");
    expect(app).toContain("onAgentSpeaking");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/@keyframes tts-wave/);
    expect(css).toMatch(/\.tts-wave\[hidden\]/);
    expect(app).not.toContain("data-stt-provider");
    expect(app).not.toContain("stt-toggle");
    expect(app).not.toMatch(/CARTESIA_API_KEY\s*=/);
  });
});
