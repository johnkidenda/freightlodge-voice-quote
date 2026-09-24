import { describe, expect, it } from "vitest";
import { PAGES_ORIGIN } from "../token-proxy/src/cors.js";
import {
  GEMINI_TTS_DEFAULT_VOICE,
  GEMINI_TTS_ENDPOINT,
  GEMINI_TTS_LITE_MODEL,
  GEMINI_TTS_MODEL,
  GEMINI_TTS_STYLE,
  audioFromGeminiPayload,
  buildGeminiTtsRequest,
  pcm16leToWav,
  synthesizeGeminiTts,
} from "../token-proxy/src/gemini-tts.js";
import worker from "../token-proxy/src/index.js";

const API_KEY = "test-gemini-key";

function wavBytes() {
  return pcm16leToWav(new Uint8Array([0, 1, 2, 3]));
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function jsonAudioResponse(bytes, mime = "audio/wav") {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      output_audio: { data: b64(bytes), mime_type: mime },
    }),
  };
}

describe("Gemini TTS helper", () => {
  it("happy path posts gemini-3.8-flash-tts and returns playable wav", async () => {
    const wav = wavBytes();
    const calls = [];
    const started = performance.now();
    const audio = await synthesizeGeminiTts({
      apiKey: API_KEY,
      text: "What's the origin ZIP?",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonAudioResponse(wav, "audio/wav");
      },
    });
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(audio.contentType).toBe("audio/wav");
    expect(Buffer.from(audio.bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    expect(Buffer.from(audio.bytes)).toEqual(Buffer.from(wav));
    expect(calls[0].url).toBe(GEMINI_TTS_ENDPOINT);
    expect(calls[0].init.headers["x-goog-api-key"]).toBe(API_KEY);
    expect(calls[0].init.body).not.toContain(API_KEY);
    const body = JSON.parse(calls[0].init.body);
    expect(body.model).toBe(GEMINI_TTS_MODEL);
    expect(body.response_format).toEqual({ type: "audio" });
    expect(body.generation_config.speech_config).toEqual([{ voice: GEMINI_TTS_DEFAULT_VOICE }]);
    expect(body.input[0].content[0].annotations[0]).toEqual({
      type: "speech_metadata",
      style: GEMINI_TTS_STYLE,
    });
    expect(body.input[0].content[0].text).toBe("What's the origin ZIP?");
  });

  it("missing key does not call fetch", async () => {
    let called = false;
    await expect(
      synthesizeGeminiTts({
        text: "Hello",
        fetchImpl: async () => {
          called = true;
          return jsonAudioResponse(wavBytes());
        },
      }),
    ).rejects.toMatchObject({ code: "TTS_UNCONFIGURED" });
    expect(called).toBe(false);
  });

  it("rejects empty text", async () => {
    const fetchImpl = async () => {
      throw new Error("fetch should not run");
    };
    await expect(synthesizeGeminiTts({ apiKey: API_KEY, text: "   ", fetchImpl })).rejects.toMatchObject({
      code: "TTS_EMPTY",
    });
    await expect(synthesizeGeminiTts({ apiKey: API_KEY, text: "", fetchImpl })).rejects.toMatchObject({
      code: "TTS_EMPTY",
    });
    await expect(synthesizeGeminiTts({ apiKey: API_KEY, fetchImpl })).rejects.toMatchObject({
      code: "TTS_EMPTY",
    });
  });

  it("chooses Kore by default", () => {
    const body = buildGeminiTtsRequest("Got it.", {});
    expect(body.generation_config.speech_config[0].voice).toBe("Kore");
    const named = buildGeminiTtsRequest("Got it.", { voice: "Puck" });
    expect(named.generation_config.speech_config[0].voice).toBe("Puck");
  });

  it("omits spoken stage directions from the user text", () => {
    const body = buildGeminiTtsRequest("Say cheerfully: [warmly] What's the origin ZIP?", {});
    const spoken = body.input[0].content[0].text;
    expect(spoken).toBe("What's the origin ZIP?");
    expect(spoken).not.toMatch(/say cheerfully/i);
    expect(spoken).not.toMatch(/warmly/i);
    expect(spoken).not.toMatch(/\[|\]/);
    expect(body.input[0].content[0].annotations[0].style).toBe(GEMINI_TTS_STYLE);
    expect(JSON.stringify(body.input[0].content[0])).not.toMatch(/Say cheerfully/);
  });

  it("wraps raw PCM as wav and can swap to the lite model", async () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    const calls = [];
    const audio = await synthesizeGeminiTts({
      apiKey: API_KEY,
      text: "Hello",
      env: { GEMINI_TTS_MODEL: GEMINI_TTS_LITE_MODEL },
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(init.body));
        return jsonAudioResponse(pcm, "audio/l16;rate=24000");
      },
    });
    expect(calls[0].model).toBe(GEMINI_TTS_LITE_MODEL);
    expect(audio.contentType).toBe("audio/wav");
    expect(Buffer.from(audio.bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    expect(audio.bytes.length).toBe(44 + pcm.length);
  });

  it("redacts the API key from upstream errors", async () => {
    const secret = "super-secret-gemini-key";
    await expect(
      synthesizeGeminiTts({
        apiKey: secret,
        text: "Hello",
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => `unauthorized ${secret}`,
        }),
      }),
    ).rejects.toThrow(/\[redacted\]/);
    try {
      await synthesizeGeminiTts({
        apiKey: secret,
        text: "Hello",
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          text: async () => `unauthorized ${secret}`,
        }),
      });
    } catch (err) {
      expect(err.message).not.toContain(secret);
    }
  });
});

describe("Worker POST /tts", () => {
  it("returns wav with Pages CORS when Gemini is configured", async () => {
    const wav = wavBytes();
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe(GEMINI_TTS_ENDPOINT);
      expect(init.headers["x-goog-api-key"]).toBe(API_KEY);
      expect(init.body).not.toContain(API_KEY);
      return jsonAudioResponse(wav);
    };
    try {
      const res = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/tts", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Got the destination ZIP.", voice: "Kore" }),
        }),
        { GEMINI_API_KEY: API_KEY },
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/wav");
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PAGES_ORIGIN);
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(buf.subarray(0, 4)).toString("ascii")).toBe("RIFF");
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("503 when GEMINI_API_KEY is missing and 400 for empty text", async () => {
    const missing = await worker.fetch(
      new Request("https://freightlodge-stt-token.example/tts", {
        method: "POST",
        headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello" }),
      }),
      {},
    );
    expect(missing.status).toBe(503);
    expect(await missing.json()).toEqual({ error: "Gemini TTS is not configured" });

    const empty = await worker.fetch(
      new Request("https://freightlodge-stt-token.example/tts", {
        method: "POST",
        headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "   " }),
      }),
      { GEMINI_API_KEY: API_KEY },
    );
    expect(empty.status).toBe(400);
    const body = await empty.json();
    expect(body.error).toMatch(/text is required/i);
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });

  it("OPTIONS /tts is 204 with CORS, and health reports tts without secrets", async () => {
    const opt = await worker.fetch(
      new Request("https://freightlodge-stt-token.example/tts", {
        method: "OPTIONS",
        headers: { Origin: PAGES_ORIGIN },
      }),
      { GEMINI_API_KEY: API_KEY },
    );
    expect(opt.status).toBe(204);
    expect(opt.headers.get("Access-Control-Allow-Origin")).toBe(PAGES_ORIGIN);
    expect(await opt.text()).toBe("");

    const on = await worker.fetch(new Request("https://freightlodge-stt-token.example/"), { GEMINI_API_KEY: API_KEY });
    const onBody = await on.json();
    expect(onBody.tts).toBe(true);
    expect(JSON.stringify(onBody)).not.toContain(API_KEY);

    const off = await worker.fetch(new Request("https://freightlodge-stt-token.example/"), {});
    expect((await off.json()).tts).toBe(false);
  });
});

describe("PCM decode", () => {
  it("reads output_audio base64", () => {
    const pcm = new Uint8Array([8, 0]);
    const audio = audioFromGeminiPayload({
      output_audio: { data: b64(pcm), mime_type: "audio/l16" },
    });
    expect(audio.contentType).toBe("audio/wav");
    expect(Buffer.from(audio.bytes.subarray(0, 4)).toString("ascii")).toBe("RIFF");
  });
});
