import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { readClientUi } from "./client-ui.js";
import {
  buildCartesiaTtsBody,
  CARTESIA_TTS_MODEL,
  CARTESIA_TTS_VOICE_ID,
  CARTESIA_TTS_VOICE_NAME,
  fetchTtsAudio,
  getTtsProxyUrl,
  onAgentSpeaking,
  speakAgentReply,
  stopAgentSpeech,
} from "../src/lib/cartesia-tts.js";
import { fetchSttAccessToken, resetSttTokenCache, tokenUnconfiguredError } from "../src/lib/stt-token.js";
import { STT_TOKEN_UNCONFIGURED, getSttTokenUrl, loadSttProvider, STT_PROVIDERS } from "../src/lib/stt-providers.js";
import {
  CARTESIA_TTS_URL,
  corsHeaders,
  mintCartesiaToken,
  PAGES_ORIGIN,
  synthesizeCartesiaTts,
} from "../token-proxy/src/mint.js";
import worker from "../token-proxy/src/index.js";

describe("token mint now grants TTS", () => {
  it("POSTs Cartesia access-token with tts + stt grants", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ token: "access-xyz" }) };
    };
    const minted = await mintCartesiaToken({ apiKey: "sk_car_test", fetchImpl, expiresIn: 90 });
    expect(minted).toEqual({ token: "access-xyz", expires_in: 90 });
    expect(JSON.parse(calls[0].init.body)).toEqual({
      grants: { tts: true, stt: true },
      expires_in: 90,
    });
    expect(calls[0].init.headers.Authorization).toBe("Bearer sk_car_test");
  });

  it("synthesizes TTS bytes with Skylar and never returns the API key", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    };
    const audio = await synthesizeCartesiaTts({
      apiKey: "sk_car_test",
      transcript: "What’s the origin ZIP?",
      fetchImpl,
    });
    expect(audio.byteLength).toBe(3);
    expect(calls[0].url).toBe(CARTESIA_TTS_URL);
    const body = JSON.parse(calls[0].init.body);
    expect(body.voice.id).toBe(CARTESIA_TTS_VOICE_ID);
    expect(body.model_id).toBe(CARTESIA_TTS_MODEL);
    expect(body.transcript).toMatch(/origin ZIP/);
    expect(JSON.stringify(body)).not.toMatch(/sk_car_/);
  });

  it("Worker /tts proxies audio; mint path still returns a token", async () => {
    const env = { CARTESIA_API_KEY: "sk_car_test" };
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (String(url).includes("access-token")) {
        return { ok: true, json: async () => ({ token: "tok" }) };
      }
      expect(String(url)).toContain("/tts/bytes");
      expect(init.headers.Authorization).toBe("Bearer sk_car_test");
      return { ok: true, arrayBuffer: async () => new Uint8Array([9, 8]).buffer };
    };
    try {
      const tts = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/tts", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: "Got it — what’s the pickup ZIP?" }),
        }),
        env,
      );
      expect(tts.status).toBe(200);
      expect(tts.headers.get("Content-Type")).toContain("audio/mpeg");
      const mint = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN },
        }),
        env,
      );
      expect(mint.status).toBe(200);
      expect(await mint.json()).toEqual({ token: "tok", expires_in: 90 });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("client TTS helper", () => {
  beforeEach(() => resetSttTokenCache());

  it("lists only Web Speech and keeps the token URL helper", () => {
    expect(STT_PROVIDERS.map((p) => p.label)).toEqual(["Web Speech"]);
    expect(loadSttProvider()).toBe("web-speech");
    expect(getSttTokenUrl({ VITE_STT_TOKEN_URL: "  https://proxy.example  " })).toBe("https://proxy.example");
    expect(() => {
      throw tokenUnconfiguredError();
    }).toThrow(STT_TOKEN_UNCONFIGURED);
  });

  it("POSTs the proxy and caches mint tokens", async () => {
    const first = await fetchSttAccessToken({
      url: "https://proxy.example/token",
      fetchImpl: async () => ({ ok: true, json: async () => ({ token: "tok-1", expires_in: 90 }) }),
    });
    expect(first.token).toBe("tok-1");
    const audio = await fetchTtsAudio("What’s the origin ZIP?", {
      url: getTtsProxyUrl({ VITE_STT_TOKEN_URL: "https://proxy.example/token" }),
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://proxy.example/tts");
        expect(JSON.parse(init.body).transcript).toMatch(/origin ZIP/);
        return { ok: true, arrayBuffer: async () => new Uint8Array([4]).buffer };
      },
    });
    expect(audio.byteLength).toBe(1);
    expect(buildCartesiaTtsBody("hi").voice.id).toBe(CARTESIA_TTS_VOICE_ID);
    expect(CARTESIA_TTS_VOICE_NAME).toBe("Skylar");
  });

  it("client sources omit CARTESIA_API_KEY and Cartesia STT sockets", () => {
    const app = readClientUi();
    const tts = readFileSync("src/lib/cartesia-tts.js", "utf8");
    expect(app).not.toMatch(/CARTESIA_API_KEY\s*=/);
    expect(tts).not.toMatch(/CARTESIA_API_KEY\s*=/);
    expect(tts).not.toMatch(/sk_car_/);
    expect(app).not.toContain("wss://api.cartesia.ai/stt");
    expect(corsHeaders(PAGES_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PAGES_ORIGIN);
  });

  it("speaking hook turns on while generating and off when idle", async () => {
    const flags = [];
    onAgentSpeaking((on) => flags.push(on));
    await speakAgentReply("Got the destination ZIP — 78721.", {
      url: "https://proxy.example/tts",
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }),
      playAudio: async () => {},
    });
    expect(flags[0]).toBe(true);
    expect(flags.at(-1)).toBe(false);
    flags.length = 0;
    stopAgentSpeech();
    expect(flags.at(-1)).toBe(false);
    onAgentSpeaking(null);
  });
});
