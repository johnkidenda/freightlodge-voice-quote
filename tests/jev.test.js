import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { presentAgentReply } from "../src/lib/conversational.js";
import {
  JEV_SLOT_IDS,
  JEV_STORAGE_KEY,
  buildJevQuestions,
  buildJevState,
  fetchJevDecision,
  formatJevStamp,
  formatJevTranscriptLine,
  getJevProxyUrl,
  guardJevDecision,
  interpretJevAnswers,
  isJevDisabled,
  normalizeJevDecision,
  offDecision,
} from "../src/lib/jev.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";
import { TYPESAFE_SYSTEMONE_URL } from "../src/lib/jev-core.js";
import { evaluateUtteranceJev } from "../token-proxy/src/jev.js";
import worker from "../token-proxy/src/index.js";
import { PAGES_ORIGIN } from "../token-proxy/src/mint.js";

function readySheet() {
  const session = createSession({ id: "ready-jev" });
  session.sheet.lanes.origin.postal_code = "60601";
  session.sheet.lanes.destination.postal_code = "75201";
  session.sheet.freight.pieces = 3;
  session.sheet.freight.total_weight_lbs = 1200;
  session.sheet.freight.commodity = "auto parts";
  session.sheet.pickup.date = "2026-09-20";
  session.sheet.contact.email = "shipper@example.com";
  session.askedAccessorials = true;
  session.awaiting = null;
  return session;
}

function jevAnswers({
  ready = 0.1,
  clarify = 0.1,
  primary = "dest_zip",
  primaryConf = 0.8,
  parse = 1.8,
  parseConf = 0.8,
  touched = { dest_zip: 0.9 },
} = {}) {
  const answers = {
    sheet_ready_for_exfresso: { type: "noul", noul: ready },
    needs_clarify: { type: "noul", noul: clarify },
    primary_slot: {
      type: "choice",
      choice: primary,
      confidence: primaryConf,
      probabilities: { [primary]: 0.9, none: 0.1 },
    },
    parse_confidence: { type: "score", score: parse, confidence: parseConf },
  };
  for (const id of JEV_SLOT_IDS) {
    answers[`touched_${id}`] = { type: "noul", noul: touched[id] ?? 0.05 };
  }
  return answers;
}

describe("Jev question candidates", () => {
  it("feeds the closed slot list and never invents option ids", () => {
    const q = buildJevQuestions();
    expect(q.sheet_ready_for_exfresso.type).toBe("noul");
    expect(q.needs_clarify.type).toBe("noul");
    expect(q.primary_slot.type).toBe("choice");
    expect(q.parse_confidence.type).toBe("score");
    expect(Object.keys(q.primary_slot.criteria)).toEqual([...JEV_SLOT_IDS, "none", "multiple"]);
    for (const id of JEV_SLOT_IDS) {
      expect(q[`touched_${id}`].type).toBe("noul");
    }
    const state = buildJevState({
      utterance: "78721",
      sheet: { schema_version: "1.0" },
      recentReplies: ["What’s the origin ZIP?"],
      awaiting: "origin_zip",
    });
    expect(state.slot_candidates).toEqual([...JEV_SLOT_IDS]);
    expect(state.utterance).toBe("78721");
    expect(state.recent_replies).toHaveLength(1);
  });
});

describe("Jev answer threshold", () => {
  it("acts on noul >= 0.5 and Choice/Score only when confidence >= 0.5", () => {
    const high = interpretJevAnswers(
      jevAnswers({ ready: 0.82, clarify: 0.11, primary: "dest_zip", primaryConf: 0.7, touched: { dest_zip: 0.91 } }),
    );
    expect(high.on).toBe(true);
    expect(high.ready).toBe(true);
    expect(high.needsClarify).toBe(false);
    expect(high.touchedSlots).toEqual(["dest_zip"]);
    expect(high.focus).toBe("dest_zip");
    expect(high.primarySlot).toBe("dest_zip");

    const lowChoice = interpretJevAnswers(jevAnswers({ primaryConf: 0.4, touched: {} }));
    expect(lowChoice.primarySlot).toBeNull();
    expect(lowChoice.focus).toBeNull();

    const clarify = interpretJevAnswers(jevAnswers({ clarify: 0.77, ready: 0.2 }));
    expect(clarify.needsClarify).toBe(true);
    expect(clarify.ready).toBe(false);

    const lowParse = interpretJevAnswers(jevAnswers({ parse: 0.4, parseConf: 0.7, clarify: 0.2 }));
    expect(lowParse.lowParse).toBe(true);
    expect(lowParse.needsClarify).toBe(true);

    const ignoreParse = interpretJevAnswers(jevAnswers({ parse: 0.2, parseConf: 0.3, clarify: 0.2 }));
    expect(ignoreParse.lowParse).toBe(false);
    expect(ignoreParse.needsClarify).toBe(false);
  });

  it("stamps Jev: on|off without em dashes", () => {
    expect(formatJevStamp(offDecision("no key"))).toBe("Jev: off (no key)");
    const stamp = formatJevStamp(
      interpretJevAnswers(jevAnswers({ ready: 0.12, clarify: 0.7, touched: { origin_zip: 0.8 } })),
    );
    expect(stamp).toMatch(/^Jev: on /);
    expect(stamp).toContain("ready=0.12");
    expect(stamp).toContain("clarify=0.7");
    expect(stamp).toContain("slots=origin_zip");
    expect(stamp).toContain("gate=clarify");
    expect(stamp).not.toMatch(/\u2014/);
  });
});

describe("Jev filled-slot guard", () => {
  it("drops dest_zip focus when that ZIP is already on the sheet", () => {
    const sheet = {
      lanes: {
        origin: { city: "Austin", state: "TX", postal_code: "78721" },
        destination: { city: "Atlanta", state: "GA", postal_code: "30030" },
      },
      freight: { total_weight_lbs: 1000, commodity: "oranges" },
    };
    const raw = interpretJevAnswers(
      jevAnswers({ ready: 0.03, clarify: 0.8, parse: 0.37, parseConf: 0.7, touched: { dest_zip: 0.9 } }),
    );
    expect(raw.focus).toBe("dest_zip");
    expect(raw.needsClarify).toBe(true);
    const guarded = guardJevDecision(raw, { sheet, utterance: "30030" });
    expect(guarded.focus).toBeNull();
    expect(guarded.needsClarify).toBe(false);
    expect(guarded.gateOverride).toBe("min-fields");
    expect(formatJevStamp(guarded)).toContain("gate=advance");
    expect(formatJevStamp(guarded)).not.toContain("focus=dest_zip");
  });
});

describe("dialog uses Jev for slot focus + gates", () => {
  it("focuses extract awaiting when Jev is confident about dest ZIP", () => {
    const session = createSession({ id: "jev-focus" });
    session.sheet.lanes.origin.city = "Atlanta";
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.destination.city = "Dallas";
    session.sheet.lanes.destination.state = "TX";
    session.awaiting = "origin_zip";
    const jev = normalizeJevDecision({
      on: true,
      touchedSlots: ["dest_zip"],
      primarySlot: "dest_zip",
      focus: "dest_zip",
      ready: false,
      needsClarify: false,
    });
    const result = handleUtterance(session, "75201", { jev });
    expect(result.session.sheet.lanes.destination.postal_code).toBe("75201");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.awaiting).not.toBe("origin_zip");
    expect(result.session.jevLog.at(-1)).toMatch(/^Jev: on /);
  });

  it("does not re-focus or re-ask a filled dest ZIP (7c4fd9ff)", () => {
    const session = createSession({ id: "filled-dest" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: "78721" };
    session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: "30030" };
    session.sheet.freight.total_weight_lbs = 1000;
    session.sheet.freight.commodity = "oranges";
    session.awaiting = "dest_zip";
    const jev = normalizeJevDecision({
      on: true,
      ready: false,
      needsClarify: true,
      focus: "dest_zip",
      touchedSlots: ["dest_zip"],
      readyNoul: 0.03,
      clarifyNoul: 0.8,
      parseScore: 0.37,
    });
    const result = handleUtterance(session, "30030", { jev });
    expect(result.session.sheet.lanes.destination.postal_code).toBe("30030");
    expect(result.session.awaiting).toBe("pieces");
    expect(result.jev.focus).toBeNull();
    expect(result.jev.needsClarify).toBe(false);
    expect(result.reply).toMatch(/pieces|pallets/i);
    expect(result.reply).not.toMatch(/destination ZIP/i);
    expect(result.session.jevLog.at(-1)).toContain("gate=advance");
    expect(result.session.jevLog.at(-1)).not.toContain("gate=clarify");
    expect(result.session.jevLog.at(-1)).not.toContain("focus=dest_zip");
  });

  it("ignores clarify gate when origin ZIP, dest ZIP, and weight are filled", () => {
    const session = readySheet();
    const jev = normalizeJevDecision({
      on: true,
      ready: true,
      needsClarify: true,
      focus: "pickup_date",
      readyNoul: 0.8,
      clarifyNoul: 0.86,
    });
    const result = handleUtterance(session, "that date is fine I think", { jev });
    expect(result.ready).toBe(true);
    expect(result.session.sheet.status).toBe("ready_for_quote");
    expect(result.reply).toMatch(/Handing this to Freight Ops/i);
    expect(result.session.jevLog.at(-1)).toContain("gate=advance");
  });

  it("does not block Exfresso ready when heuristics are complete and ready noul is low", () => {
    const session = readySheet();
    const jev = normalizeJevDecision({
      on: true,
      ready: false,
      needsClarify: false,
      readyNoul: 0.03,
      clarifyNoul: 0.1,
    });
    const result = handleUtterance(session, "looks good", { jev });
    expect(result.ready).toBe(true);
    expect(result.session.sheet.status).toBe("ready_for_quote");
    expect(result.reply).toMatch(/Handing this to Freight Ops/i);
  });

  it("still clarifies when dest ZIP is missing and Jev asks dest_zip", () => {
    const session = createSession({ id: "jev-clarify-empty" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: "78721" };
    session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: null };
    session.awaiting = "dest_zip";
    const jev = normalizeJevDecision({
      on: true,
      ready: false,
      needsClarify: true,
      focus: "dest_zip",
      readyNoul: 0.1,
      clarifyNoul: 0.8,
    });
    const result = handleUtterance(session, "I think so", { jev });
    expect(result.ready).toBe(false);
    expect(result.session.awaiting).toBe("dest_zip");
    expect(result.reply).toMatch(/double-check destination/i);
    expect(result.reply).not.toMatch(/\u2014/);
    expect(result.session.jevLog.at(-1)).toContain("gate=clarify");
  });

  it("does not re-ask origin ZIP after it is parked", () => {
    let session = createSession({ id: "origin-once" });
    session = handleUtterance(
      session,
      "want to ship a thousand pounds of oranges from Austin Texas to Atlanta Georgia",
    ).session;
    expect(session.sheet.lanes.origin.postal_code).toBeNull();
    const jev = normalizeJevDecision({
      on: true,
      ready: false,
      needsClarify: true,
      focus: "origin_zip",
      touchedSlots: ["origin_zip"],
      readyNoul: 0.1,
      clarifyNoul: 0.7,
    });
    const result = handleUtterance(session, "78721", { jev });
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.awaiting).toBe("dest_zip");
    expect(result.jev.focus).toBeNull();
    expect(result.jev.needsClarify).toBe(false);
    const warm = presentAgentReply(result, true);
    expect(warm).not.toMatch(/origin ZIP for Austin/i);
    expect(warm).toMatch(/destination ZIP/i);
  });

  it("falls back to heuristics when Jev is off", () => {
    const session = readySheet();
    const result = handleUtterance(session, "go ahead", { jev: offDecision("no key") });
    expect(result.ready).toBe(true);
    expect(result.session.jevLog.at(-1)).toBe("Jev: off (no key)");
  });
});

describe("client Jev proxy helper", () => {
  it("derives /jev from the token mint URL like /tts", () => {
    expect(getJevProxyUrl({ VITE_STT_TOKEN_URL: "/api/stt-token" })).toBe("/api/jev");
    expect(getJevProxyUrl({ VITE_STT_TOKEN_URL: "https://opens-trio-tune-disciplines.trycloudflare.com" })).toBe(
      "https://opens-trio-tune-disciplines.trycloudflare.com/jev",
    );
    expect(getJevProxyUrl({ VITE_STT_TOKEN_URL: "https://proxy.example/token" })).toBe("https://proxy.example/jev");
    expect(getJevProxyUrl({ VITE_STT_TOKEN_URL: "" })).toBe("");
  });

  it("?jev=0 skips Jev and never calls the proxy", async () => {
    const storage = new Map();
    const mem = {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
    };
    expect(isJevDisabled({ search: "?jev=0", storage: mem })).toBe(true);
    expect(mem.getItem(JEV_STORAGE_KEY)).toBe("0");
    const decision = await fetchJevDecision({
      utterance: "78721",
      url: "https://proxy.example/jev",
      search: "?jev=0",
      storage: mem,
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    expect(decision).toEqual(offDecision("disabled"));
    expect(isJevDisabled({ search: "", storage: mem })).toBe(true);
    expect(isJevDisabled({ search: "?jev=1", storage: mem })).toBe(false);
    expect(
      await fetchJevDecision({
        utterance: "78721",
        url: "https://proxy.example/jev",
        search: "?jev=1",
        storage: mem,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ ok: true, jev: "on", answers: jevAnswers() }),
        }),
      }),
    ).toMatchObject({ on: true });
  });

  it("returns off on 503 / timeout and never throws", async () => {
    const none = await fetchJevDecision({ utterance: "hi", url: "" });
    expect(none.on).toBe(false);
    const noKey = await fetchJevDecision({
      utterance: "hi",
      url: "https://proxy.example/jev",
      fetchImpl: async () => ({ status: 503, ok: false }),
    });
    expect(noKey).toEqual(offDecision("no key"));
    const failed = await fetchJevDecision({
      utterance: "hi",
      url: "https://proxy.example/jev",
      fetchImpl: async () => {
        throw new Error("network");
      },
    });
    expect(failed.reason).toBe("proxy failed");
  });

  it("maps a successful proxy body to a decision", async () => {
    const decision = await fetchJevDecision({
      utterance: "75201",
      sheet: { schema_version: "1.0" },
      url: "https://proxy.example/jev",
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://proxy.example/jev");
        const body = JSON.parse(init.body);
        expect(body.utterance).toBe("75201");
        expect(body.sheet.schema_version).toBe("1.0");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            jev: "on",
            answers: jevAnswers({ touched: { dest_zip: 0.95 } }),
          }),
        };
      },
    });
    expect(decision.on).toBe(true);
    expect(decision.touchedSlots).toContain("dest_zip");
  });
});

describe("token-proxy POST /jev", () => {
  it("returns jev off without TYPESAFE_API_KEY and does not call TypeSafe", async () => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("should not fetch");
    };
    try {
      const res = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/jev", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ utterance: "Chicago 60601" }),
        }),
        { CARTESIA_API_KEY: "sk_car_test" },
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.jev).toBe("off");
      expect(body.error).toMatch(/not configured/i);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("forwards one System One call with candidates and the TypeSafe key", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe(TYPESAFE_SYSTEMONE_URL);
      expect(init.headers.Authorization).toBe("Bearer sk_ts_test");
      const body = JSON.parse(init.body);
      expect(body.model).toBe("jev-latest");
      expect(body.state.utterance).toBe("Chicago 60601 to Dallas");
      expect(body.questions.sheet_ready_for_exfresso.type).toBe("noul");
      expect(body.questions.primary_slot.criteria.dest_zip).toBeTruthy();
      expect(JSON.stringify(body)).not.toMatch(/sk_ts_/);
      return {
        ok: true,
        json: async () => ({ model: "jev-latest", answers: jevAnswers({ touched: { origin_zip: 0.88, dest_city: 0.8 } }) }),
      };
    };
    try {
      const res = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/jev", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ utterance: "Chicago 60601 to Dallas", awaiting: "origin_zip" }),
        }),
        { TYPESAFE_API_KEY: "sk_ts_test" },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.jev).toBe("on");
      expect(body.decision.touchedSlots).toEqual(["origin_zip", "dest_city"]);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("evaluateUtteranceJev throws unconfigured without leaking a key path into the client", async () => {
    await expect(evaluateUtteranceJev({ utterance: "hi" })).rejects.toMatchObject({ code: "JEV_UNCONFIGURED" });
  });
});

describe("transcript + source guards", () => {
  it("stamps Jev on the Send transcript snapshot", () => {
    const session = createSession({ id: "jev-tx" });
    const result = handleUtterance(session, "78721", {
      jev: normalizeJevDecision({
        on: true,
        touchedSlots: ["dest_zip"],
        focus: "dest_zip",
        readyNoul: 0.08,
        clarifyNoul: 0.2,
      }),
    });
    const text = formatSessionTranscript(
      [
        { role: "user", text: "78721" },
        { role: "assistant", text: result.reply },
      ],
      result.session,
    );
    expect(text).toContain("STT: Web Speech");
    expect(text).toMatch(/Jev: on /);
    expect(text).toContain("slots=dest_zip");
    expect(formatJevTranscriptLine(createSession({ id: "empty" }))).toBe("Jev: off");
  });

  it("keeps TYPESAFE_API_KEY off the Pages client and out of VITE_*", () => {
    const files = [
      "src/app.js",
      "src/lib/jev.js",
      "src/lib/jev-core.js",
      "src/lib/jev-action-core.js",
      "token-proxy/src/jev-action.js",
      "src/lib/transcript.js",
      "src/lib/stt-providers.js",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/VITE_TYPESAFE/);
      expect(src, file).not.toMatch(/TYPESAFE_API_KEY\s*=/);
    }
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain("fetchJevDecision");
    expect(app).toContain("isJevDisabled");
    expect(app).toContain("handleUtterance(state.session, text, { jev })");
    expect(app).not.toMatch(/openrouter/i);
    expect(app).not.toMatch(/api\.anthropic|api\.x\.ai|openai\.com\/v1\/chat/i);
  });
});
