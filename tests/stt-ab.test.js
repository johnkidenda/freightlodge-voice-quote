import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import {
  RELEASE_TAIL_MS,
  createHoldToTalk,
} from "../src/lib/speech.js";
import { createSpeechSession } from "../src/lib/speech-session.js";
import {
  createCartesiaHoldToTalk,
  EMPTY_TRANSCRIPT_ERROR,
  NO_AUDIO_ERROR,
} from "../src/lib/cartesia-stt.js";
import {
  STT_PROVIDER_IDS,
  STT_PROVIDERS,
  STT_TOKEN_UNCONFIGURED,
  getSttTokenUrl,
  isCartesiaProvider,
  loadSttProvider,
  saveSttProvider,
} from "../src/lib/stt-providers.js";
import { fetchSttAccessToken, resetSttTokenCache, tokenUnconfiguredError } from "../src/lib/stt-token.js";
import {
  buildCartesiaWsUrl,
  concatManualFinals,
  createAutoTurnAssembler,
  createManualAssembler,
  parseCartesiaMessage,
  previewManualTranscript,
} from "../src/lib/cartesia-transcript.js";
import {
  createPcmChunker,
  floatToPcm16le,
  PCM_CHUNK_SAMPLES,
  toPcmBinaryFrame,
  WORKLET_SRC,
} from "../src/lib/cartesia-pcm.js";
import { mintCartesiaToken, corsHeaders, PAGES_ORIGIN } from "../token-proxy/src/mint.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

describe("STT provider selection", () => {
  it("lists the three A/B providers with clear labels", () => {
    expect(STT_PROVIDERS.map((p) => p.label)).toEqual([
      "Web Speech",
      "Cartesia manual",
      "Cartesia auto",
    ]);
    expect(isCartesiaProvider("web-speech")).toBe(false);
    expect(isCartesiaProvider("cartesia-manual")).toBe(true);
  });

  it("persists a valid selection and falls back on junk", () => {
    const store = memoryStorage();
    expect(loadSttProvider(store)).toBe(STT_PROVIDER_IDS.WEB_SPEECH);
    saveSttProvider("cartesia-auto", store);
    expect(loadSttProvider(store)).toBe("cartesia-auto");
    saveSttProvider("not-a-provider", store);
    expect(loadSttProvider(store)).toBe("cartesia-auto");
    const empty = memoryStorage({ "freightlodge.stt-provider": "nope" });
    expect(loadSttProvider(empty)).toBe("web-speech");
  });

  it("createSpeechSession keeps Web Speech hold-to-talk callbacks", () => {
    const commits = [];
    function Recognition() {
      this.start = () => {};
      this.stop = function stop() {
        this.onend?.();
      };
      this.abort = () => {};
    }
    const talk = createSpeechSession({
      provider: "web-speech",
      Recognition,
      onCommit: (t) => commits.push(t),
    });
    expect(talk.provider).toBe("web-speech");
    expect(talk.supported).toBe(true);
    talk.start();
    talk.abort();
    expect(commits).toEqual([]);
    expect(typeof createHoldToTalk).toBe("function");
  });
});

describe("STT token proxy client", () => {
  beforeEach(() => resetSttTokenCache());

  it("throws a clear error when the token URL is unset — never embeds a key", () => {
    expect(getSttTokenUrl({ VITE_STT_TOKEN_URL: "" })).toBe("");
    expect(getSttTokenUrl({ VITE_STT_TOKEN_URL: "  https://proxy.example/token  " })).toBe(
      "https://proxy.example/token",
    );
    expect(() => {
      throw tokenUnconfiguredError();
    }).toThrow(STT_TOKEN_UNCONFIGURED);
    return expect(fetchSttAccessToken({ url: "" })).rejects.toMatchObject({
      message: STT_TOKEN_UNCONFIGURED,
      code: "STT_TOKEN_UNCONFIGURED",
    });
  });

  it("POSTs the proxy URL and caches until near expiry", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ token: "tok-1", expires_in: 90 }),
      };
    };
    const first = await fetchSttAccessToken({ url: "https://proxy.example/token", fetchImpl });
    const second = await fetchSttAccessToken({ url: "https://proxy.example/token", fetchImpl });
    expect(first.token).toBe("tok-1");
    expect(first.expires_in).toBe(90);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });
});

describe("Cartesia transcript assembly", () => {
  it("concatenates is_final transcript deltas without stripping whitespace", () => {
    const events = [
      { type: "transcript", is_final: true, text: "60601 " },
      { type: "transcript", is_final: false, text: "to Dal" },
      { type: "transcript", is_final: true, text: "to Dallas" },
    ];
    expect(concatManualFinals(events)).toBe("60601 to Dallas");
    expect(previewManualTranscript(events)).toBe("60601 to Dallas");
    const buf = createManualAssembler();
    buf.push({ type: "transcript", is_final: true, text: "1200 " });
    buf.push({ type: "transcript", is_final: "true", text: "pounds" });
    expect(buf.finals()).toBe("1200 pounds");
  });

  it("auto turns commit once on turn.end and ignore duplicates", () => {
    const auto = createAutoTurnAssembler();
    expect(auto.apply({ type: "turn.update", transcript: "Chicago" }).commit).toBeNull();
    const first = auto.apply({ type: "turn.end", transcript: "Chicago 60601" });
    expect(first.commit).toBe("Chicago 60601");
    const again = auto.apply({ type: "turn.end", transcript: "Chicago 60601" });
    expect(again.commit).toBeNull();
    auto.apply({ type: "turn.start" });
    const second = auto.apply({ type: "turn.end", transcript: "twelve hundred pounds" });
    expect(second.commit).toBe("twelve hundred pounds");
    const emptyEnd = createAutoTurnAssembler();
    expect(emptyEnd.apply({ type: "turn.end", transcript: "" }).commit).toBeNull();
    expect(emptyEnd.leftover()).toBe("");
  });

  it("builds WS URLs with access_token, version, model, and keyterms — not an API key", () => {
    const url = buildCartesiaWsUrl({ variant: "manual", accessToken: "short-lived" });
    expect(url).toContain("wss://api.cartesia.ai/stt/websocket");
    expect(url).toContain("model=ink-2");
    expect(url).toContain("encoding=pcm_s16le");
    expect(url).toContain("sample_rate=16000");
    expect(url).toContain("cartesia_version=2026-08-14");
    expect(url).toContain("access_token=short-lived");
    expect(url).toContain("language=en");
    expect(url).toContain("keyterm=");
    expect(url).not.toMatch(/CARTESIA_API_KEY|sk_car_/);
    const auto = buildCartesiaWsUrl({ variant: "auto", accessToken: "t2" });
    expect(auto).toContain("/stt/turns/websocket");
    expect(auto).toContain("language=en");
  });

  it("parses JSON text and does not treat a Blob as a transcript event", () => {
    expect(parseCartesiaMessage('{"type":"transcript","is_final":true,"text":"hi"}')).toEqual({
      type: "transcript",
      is_final: true,
      text: "hi",
    });
    const blob = new Blob([JSON.stringify({ type: "transcript", is_final: true, text: "hi" })]);
    const parsed = parseCartesiaMessage(blob);
    expect(parsed.type).toBe("blob");
    expect(typeof parsed.blob?.text).toBe("function");
  });
});

function fakeSocketFactory({ startClosed = false } = {}) {
  const sockets = [];
  function openSocket() {
    const listeners = { open: [], error: [], close: [] };
    const ws = {
      readyState: startClosed ? 0 : 1,
      binaryType: "blob",
      sent: [],
      addEventListener(type, fn) {
        listeners[type]?.push(fn);
      },
      removeEventListener(type, fn) {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
      },
      send(data) {
        this.sent.push(data);
      },
      close() {
        this.readyState = 3;
        listeners.close.forEach((fn) => fn());
        this.onclose?.();
      },
      onmessage: null,
      onerror: null,
      onclose: null,
      open() {
        this.readyState = 1;
        listeners.open.forEach((fn) => fn());
      },
      emit(payload) {
        if (payload instanceof Blob || payload instanceof ArrayBuffer) {
          this.onmessage?.({ data: payload });
          return;
        }
        const data = typeof payload === "string" ? payload : JSON.stringify(payload);
        this.onmessage?.({ data });
      },
    };
    sockets.push(ws);
    return ws;
  }
  return { openSocket, sockets };
}

function fakeCaptureFactory() {
  const captures = [];
  async function openCapture({ onChunk }) {
    const cap = {
      chunks: [],
      stopped: false,
      onChunk,
      push(buf) {
        this.chunks.push(buf);
        onChunk?.(buf);
      },
      flush() {
        this.flushed = true;
      },
      stop() {
        this.stopped = true;
      },
    };
    captures.push(cap);
    return cap;
  }
  return { openCapture, captures };
}

async function settle(n = 12) {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

async function waitFor(fn, tries = 12) {
  for (let i = 0; i < tries; i += 1) {
    if (fn()) return;
    await Promise.resolve();
  }
  throw new Error("timed out waiting for Cartesia session");
}

function fakeTimers() {
  const timers = [];
  return {
    timers,
    schedule(fn, ms) {
      const id = timers.length + 1;
      timers.push({ id, fn, ms });
      return id;
    },
    unschedule(id) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    flush(id) {
      const i = timers.findIndex((t) => t.id === id);
      const t = i >= 0 ? timers.splice(i, 1)[0] : timers.shift();
      t?.fn();
    },
  };
}

describe("Cartesia manual finalize + release tail", () => {
  it("keeps streaming for RELEASE_TAIL_MS, then sends finalize and commits concatenated finals", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture, captures } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const tails = [];
    const previews = [];
    const starts = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onStart: () => starts.push("start"),
      onCommit: (t) => commits.push(t),
      onPreview: (t) => previews.push(t),
      onTailStart: () => tails.push("tail"),
    });

    talk.start();
    expect(talk.isActive()).toBe(true);
    expect(starts).toEqual([]);
    await waitFor(() => sockets[0] && captures[0]);
    await settle();
    expect(starts).toEqual(["start"]);

    captures[0].push(new ArrayBuffer(8));
    sockets[0].emit({ type: "transcript", is_final: true, text: "60601 " });
    expect(previews.at(-1)).toBe("60601 ");
    talk.stop();
    expect(talk.isTailing()).toBe(true);
    expect(tails).toEqual(["tail"]);
    expect(commits).toEqual([]);
    expect(sockets[0].sent.some((m) => m === "finalize")).toBe(false);

    captures[0].push(new ArrayBuffer(8));
    sockets[0].emit({ type: "transcript", is_final: true, text: "to Dallas 1200 lb" });
    expect(previews.at(-1)).toBe("60601 to Dallas 1200 lb");
    expect(clock.timers[0].ms).toBe(RELEASE_TAIL_MS);
    clock.flush();

    expect(sockets[0].sent).toContain("finalize");
    expect(sockets[0].sent.some((m) => m instanceof ArrayBuffer && m.byteLength === 8)).toBe(true);
    expect(commits).toEqual([]);
    sockets[0].emit({ type: "flush_done" });
    expect(commits).toEqual(["60601 to Dallas 1200 lb"]);
    expect(talk.isTailing()).toBe(false);
  });
});

describe("Cartesia auto turn-end commits", () => {
  it("emits a final on turn.end once and sends close after the tail", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const talk = createCartesiaHoldToTalk({
      variant: "auto",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onCommit: (t) => commits.push(t),
    });

    talk.start();
    await waitFor(() => sockets[0]);
    await settle();
    sockets[0].emit({ type: "turn.update", transcript: "three pallets" });
    sockets[0].emit({ type: "turn.end", transcript: "three pallets" });
    expect(commits).toEqual(["three pallets"]);
    sockets[0].emit({ type: "turn.end", transcript: "three pallets" });
    expect(commits).toEqual(["three pallets"]);

    talk.stop();
    clock.flush();
    const close = sockets[0].sent.find((m) => typeof m === "string" && m.includes("close"));
    expect(close).toBeTruthy();
    expect(JSON.parse(close)).toEqual({ type: "close" });
  });
});

describe("Cartesia failure surfaces", () => {
  it("empty finalize emits onError and never onCommit", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture, captures } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const errors = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onCommit: (t) => commits.push(t),
      onError: (e) => errors.push(e.message),
    });

    talk.start();
    await waitFor(() => sockets[0] && captures[0]);
    await settle();
    captures[0].push(new ArrayBuffer(8));
    talk.stop();
    clock.flush();
    expect(sockets[0].sent).toContain("finalize");
    sockets[0].emit({ type: "flush_done" });
    expect(commits).toEqual([]);
    expect(errors).toEqual([EMPTY_TRANSCRIPT_ERROR]);
  });

  it("finalize wait with no transcript also errors instead of going silent", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture, captures } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const errors = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onCommit: (t) => commits.push(t),
      onError: (e) => errors.push(e.message),
    });

    talk.start();
    await waitFor(() => sockets[0] && captures[0]);
    await settle();
    captures[0].push(new ArrayBuffer(16));
    talk.stop();
    clock.flush();
    expect(clock.timers[0].ms).toBe(2500);
    clock.flush();
    expect(commits).toEqual([]);
    expect(errors).toEqual([EMPTY_TRANSCRIPT_ERROR]);
  });

  it("release before the socket is open waits, then errors if no audio arrived", async () => {
    const { openSocket, sockets } = fakeSocketFactory({ startClosed: true });
    const { openCapture } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const errors = [];
    const starts = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onStart: () => starts.push("start"),
      onCommit: (t) => commits.push(t),
      onError: (e) => errors.push(e.message),
    });

    talk.start();
    await waitFor(() => sockets[0]);
    expect(starts).toEqual([]);
    talk.stop();
    expect(talk.isTailing()).toBe(true);
    expect(errors).toEqual([]);
    sockets[0].open();
    await settle();
    expect(starts).toEqual(["start"]);
    clock.flush();
    expect(commits).toEqual([]);
    expect(errors).toEqual([NO_AUDIO_ERROR]);
  });

  it("token mint failure surfaces onError", async () => {
    const { openSocket } = fakeSocketFactory();
    const { openCapture } = fakeCaptureFactory();
    const errors = [];
    const starts = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => {
        throw new Error("STT token proxy failed (502)");
      },
      openSocket,
      openCapture,
      onStart: () => starts.push("start"),
      onError: (e) => errors.push(e.message),
    });
    talk.start();
    await settle(20);
    expect(starts).toEqual([]);
    expect(errors[0]).toMatch(/token proxy failed/);
  });

  it("socket open failure surfaces onError", async () => {
    const { openSocket, sockets } = fakeSocketFactory({ startClosed: true });
    const { openCapture } = fakeCaptureFactory();
    const errors = [];
    const talk = createCartesiaHoldToTalk({
      variant: "auto",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      onError: (e) => errors.push(e.message),
    });
    talk.start();
    await waitFor(() => sockets[0]);
    sockets[0].close();
    await settle(20);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toMatch(/failed to open|closed unexpectedly|socket error/i);
  });

  it("Cartesia WS error event surfaces the server message", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture } = fakeCaptureFactory();
    const errors = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      onError: (e) => errors.push(e.message),
    });
    talk.start();
    await waitFor(() => sockets[0]);
    await settle();
    sockets[0].emit({ type: "error", message: "invalid encoding" });
    expect(errors).toEqual(["invalid encoding"]);
  });

  it("auto session with no turn.end errors instead of silent leftover", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture, captures } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const errors = [];
    const talk = createCartesiaHoldToTalk({
      variant: "auto",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onCommit: (t) => commits.push(t),
      onError: (e) => errors.push(e.message),
    });
    talk.start();
    await waitFor(() => sockets[0] && captures[0]);
    await settle();
    captures[0].push(new ArrayBuffer(8));
    talk.stop();
    clock.flush();
    clock.flush();
    expect(commits).toEqual([]);
    expect(errors).toEqual([EMPTY_TRANSCRIPT_ERROR]);
  });

  it("decodes Blob transcript frames into the assembler", async () => {
    const { openSocket, sockets } = fakeSocketFactory();
    const { openCapture, captures } = fakeCaptureFactory();
    const clock = fakeTimers();
    const commits = [];
    const previews = [];
    const talk = createCartesiaHoldToTalk({
      variant: "manual",
      fetchToken: async () => ({ token: "tok", expires_in: 90 }),
      openSocket,
      openCapture,
      schedule: clock.schedule,
      unschedule: clock.unschedule,
      onPreview: (t) => previews.push(t),
      onCommit: (t) => commits.push(t),
    });
    talk.start();
    await waitFor(() => sockets[0] && captures[0]);
    await settle();
    captures[0].push(new ArrayBuffer(8));
    sockets[0].emit(
      new Blob([JSON.stringify({ type: "transcript", is_final: true, text: "liftgate " })]),
    );
    await waitFor(() => previews.at(-1) === "liftgate ", 40);
    talk.stop();
    clock.flush();
    sockets[0].emit({ type: "flush_done" });
    expect(commits).toEqual(["liftgate "]);
  });
});

describe("PCM chunking", () => {
  it("downsamples to s16le and emits ~100ms standalone ArrayBuffers", () => {
    const ones = new Float32Array(1600).fill(0.5);
    const pcm = floatToPcm16le(ones, 16000, 16000);
    expect(pcm.length).toBe(1600);
    expect(pcm[0]).toBe(Math.round(0.5 * 0x7fff));

    const frames = [];
    const chunker = createPcmChunker({
      inputRate: 16000,
      onChunk: (buf) => frames.push(buf),
    });
    chunker.pushFloat(new Float32Array(PCM_CHUNK_SAMPLES), 16000);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeInstanceOf(ArrayBuffer);
    expect(frames[0].byteLength).toBe(PCM_CHUNK_SAMPLES * 2);
    expect(toPcmBinaryFrame(new Int16Array([1, 2])).byteLength).toBe(4);
    expect(WORKLET_SRC).toContain("copy.set(ch)");
    expect(WORKLET_SRC).toContain("postMessage(copy, [copy.buffer])");
  });
});

describe("token-proxy mint + CORS", () => {
  it("POSTs Cartesia access-token with STT grant and version header", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ token: "access-xyz" }) };
    };
    const minted = await mintCartesiaToken({ apiKey: "sk_car_test", fetchImpl, expiresIn: 90 });
    expect(minted).toEqual({ token: "access-xyz", expires_in: 90 });
    expect(calls[0].url).toBe("https://api.cartesia.ai/access-token");
    expect(calls[0].init.headers.Authorization).toBe("Bearer sk_car_test");
    expect(calls[0].init.headers["Cartesia-Version"]).toBe("2026-08-14");
    expect(JSON.parse(calls[0].init.body)).toEqual({ grants: { stt: true }, expires_in: 90 });
  });

  it("refuses to mint without a server-side key", async () => {
    await expect(mintCartesiaToken({ apiKey: "" })).rejects.toMatchObject({
      code: "STT_TOKEN_UNCONFIGURED",
    });
  });

  it("allows the Pages origin for CORS", () => {
    expect(corsHeaders(PAGES_ORIGIN)["Access-Control-Allow-Origin"]).toBe(PAGES_ORIGIN);
    expect(corsHeaders("https://evil.example")["Access-Control-Allow-Origin"]).toBe(PAGES_ORIGIN);
  });
});

describe("client bundle never embeds the Cartesia API key", () => {
  it("app toggle markup and src/ omit CARTESIA_API_KEY", () => {
    const app = readFileSync("src/app.js", "utf8");
    const providers = readFileSync("src/lib/stt-providers.js", "utf8");
    expect(app).toContain("stt-toggle");
    expect(app).toContain("data-stt-provider");
    expect(app).toContain("STT_TOKEN_UNCONFIGURED");
    expect(app).toMatch(/empty transcript/i);
    expect(providers).toContain("Web Speech");
    expect(providers).toContain("Cartesia manual");
    expect(providers).toContain("Cartesia auto");
    expect(providers).toContain(STT_TOKEN_UNCONFIGURED);
    const srcFiles = [
      "src/app.js",
      "src/lib/stt-token.js",
      "src/lib/cartesia-stt.js",
      "src/lib/speech-session.js",
    ];
    for (const file of srcFiles) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/CARTESIA_API_KEY\s*=/);
      expect(text).not.toMatch(/sk_car_/);
    }
  });
});
