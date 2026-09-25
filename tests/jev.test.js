import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createSession } from "../src/lib/dialog.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";
import {
  JEV_SLOT_IDS,
  buildJevQuestions,
  buildJevState,
  formatJevStamp,
  guardJevDecision,
  interpretJevAnswers,
  offDecision,
  TYPESAFE_SYSTEMONE_URL,
} from "../src/lib/jev-core.js";
import { evaluateUtteranceJev } from "../token-proxy/src/jev.js";
import worker from "../token-proxy/src/index.js";
import { PAGES_ORIGIN } from "../token-proxy/src/cors.js";

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
        {},
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

describe("quote app no longer calls Jev", () => {
  it("leaves Jev mode and Jev stamps off the Send transcript", () => {
    const text = formatSessionTranscript(
      [
        { role: "user", text: "78721" },
        { role: "assistant", text: "Where is this going?" },
      ],
      createSession({ id: "no-jev" }),
    );
    expect(text).toContain("STT: Web Speech");
    expect(text).not.toMatch(/Jev mode:/);
    expect(text).not.toMatch(/^Jev:/m);
  });

  it("keeps TYPESAFE_API_KEY off the Pages client and out of VITE_*", () => {
    const files = [
      "src/app.js",
      "src/ui/layout.js",
      "src/ui/chrome.js",
      "src/ui/mic.js",
      "src/ui/quote-card.js",
      "src/lib/quote-email-html.js",
      "src/lib/dialog.js",
      "src/lib/transcript.js",
      "src/lib/jev-core.js",
      "src/lib/jev-action-core.js",
      "token-proxy/src/jev-action.js",
      "src/lib/stt-providers.js",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/VITE_TYPESAFE/);
      expect(src, file).not.toMatch(/TYPESAFE_API_KEY\s*=/);
    }
    expect(existsSync("src/lib/jev.js")).toBe(false);
    const app = readFileSync("src/app.js", "utf8");
    expect(app).not.toContain("fetchJevDecision");
    expect(app).not.toContain("isJevDisabled");
    expect(app).not.toContain("saveJevSessionEnabled");
    expect(app).not.toContain("freightlodge.jev");
    expect(app).not.toContain("sessionStorage");
    const layout = readFileSync("src/ui/layout.js", "utf8");
    expect(layout).not.toContain('id="jev-mode"');
    expect(layout).not.toContain("Jev on");
    expect(layout).not.toContain("Jev off");
    const dialog = readFileSync("src/lib/dialog.js", "utf8");
    expect(dialog).not.toContain("jev-core");
    expect(dialog).not.toContain("guardJevDecision");
    const chrome = readFileSync("src/ui/chrome.js", "utf8");
    expect(chrome).toContain("is-count-ask");
    expect(chrome).toContain("Type the number…");
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.composer\.is-count-ask/);
    expect(css).not.toContain("#jev-mode");
    expect(app).not.toMatch(/openrouter/i);
    expect(app).not.toMatch(/api\.anthropic|api\.x\.ai|openai\.com\/v1\/chat/i);
  });
});
