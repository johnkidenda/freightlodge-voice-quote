import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  JEV_ACTION_META_IDS,
  buildJevActionQuestions,
  buildJevActionState,
  interpretJevActionAnswers,
  normalizeCandidates,
  offActionDecision,
  usageCostUsd,
} from "../src/lib/jev-action-core.js";
import { evaluateDomAction } from "../token-proxy/src/jev-action.js";
import worker from "../token-proxy/src/index.js";
import { TYPESAFE_SYSTEMONE_URL } from "../src/lib/jev-core.js";
import { PAGES_ORIGIN } from "../token-proxy/src/mint.js";

const CANDIDATES = [
  {
    id: "origin-zip",
    kind: "fill",
    role: "textbox",
    label: "Origin ZIP (required)",
    selector: '[data-pilot-id="origin-zip"]',
    field: "origin_zip",
    required: true,
    current: "",
  },
  {
    id: "continue-no-zip",
    kind: "click",
    role: "button",
    label: "Continue without ZIP",
    selector: '[data-pilot-id="continue-no-zip"]',
    decoy: true,
  },
  {
    id: "continue",
    kind: "click",
    role: "button",
    label: "Continue",
    selector: '[data-pilot-id="continue"]',
  },
];

function actionAnswers({
  choice = "origin-zip",
  conf = 0.82,
  clarify = 0.08,
  score = 1.8,
  scoreConf = 0.8,
} = {}) {
  return {
    next_action: { type: "choice", choice, confidence: conf, probabilities: { [choice]: 0.9 } },
    needs_clarify: { type: "noul", noul: clarify },
    action_confidence: { type: "score", score, confidence: scoreConf },
  };
}

describe("Jev DOM-step Choice", () => {
  it("feeds only listed candidate ids plus stop/clarify", () => {
    const q = buildJevActionQuestions(CANDIDATES);
    expect(q.next_action.type).toBe("choice");
    expect(Object.keys(q.next_action.criteria)).toEqual([
      "origin-zip",
      "continue-no-zip",
      "continue",
      "stop",
      "clarify",
    ]);
    expect(q.next_action.criteria.invent).toBeUndefined();
    const state = buildJevActionState({
      sheet: { lanes: { origin: { postal_code: "78721" } } },
      candidates: CANDIDATES,
      step: "origin",
    });
    expect(state.candidate_ids).toEqual(["origin-zip", "continue-no-zip", "continue"]);
    expect(state.visible_candidates.map((c) => c.id)).toEqual(state.candidate_ids);
  });

  it("drops blank and reserved meta ids from the candidate list", () => {
    const list = normalizeCandidates([
      { id: "stop", label: "fake" },
      { id: "", label: "empty" },
      { id: "continue", label: "Continue" },
      { id: "continue", label: "dup" },
    ]);
    expect(list.map((c) => c.id)).toEqual(["continue"]);
    expect(JEV_ACTION_META_IDS).toEqual(["stop", "clarify"]);
  });

  it("acts only when confidence is at least 0.5 and the choice is listed", () => {
    const high = interpretJevActionAnswers(actionAnswers(), CANDIDATES);
    expect(high.act).toBe(true);
    expect(high.actionId).toBe("origin-zip");
    expect(high.gateBlocked).toBe(false);

    const low = interpretJevActionAnswers(actionAnswers({ conf: 0.4 }), CANDIDATES);
    expect(low.act).toBe(false);
    expect(low.actionId).toBeNull();
    expect(low.gateBlocked).toBe(true);

    const invented = interpretJevActionAnswers(actionAnswers({ choice: "click-login" }), CANDIDATES);
    expect(invented.act).toBe(false);
    expect(invented.reason).toBe("invented-choice");
    expect(invented.gateBlocked).toBe(true);

    const clarify = interpretJevActionAnswers(actionAnswers({ clarify: 0.8 }), CANDIDATES);
    expect(clarify.needsClarify).toBe(true);
    expect(clarify.gateBlocked).toBe(true);
    expect(clarify.act).toBe(false);
  });

  it("prices TypeSafe usage from the published input rate only", () => {
    expect(usageCostUsd({ input_tokens: 1_000_000 })).toBe(0.042);
    expect(usageCostUsd({ input_tokens: 250000 })).toBe(0.0105);
    expect(usageCostUsd(null)).toBe(0);
  });

  it("off decision does not invent an action", () => {
    expect(offActionDecision("no key").act).toBe(false);
    expect(offActionDecision("no key").actionId).toBeNull();
  });
});

describe("token-proxy POST /jev-action", () => {
  it("returns jev off without TYPESAFE_API_KEY and does not call TypeSafe", async () => {
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("should not fetch");
    };
    try {
      const res = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/jev-action", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({ candidates: CANDIDATES }),
        }),
        { CARTESIA_API_KEY: "sk_car_test" },
      );
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.jev).toBe("off");
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("forwards listed candidates only and keeps the TypeSafe key on the server", async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      expect(String(url)).toBe(TYPESAFE_SYSTEMONE_URL);
      expect(init.headers.Authorization).toBe("Bearer sk_ts_test");
      const body = JSON.parse(init.body);
      expect(body.model).toBe("jev-latest");
      expect(body.state.candidate_ids).toEqual(["origin-zip", "continue-no-zip", "continue"]);
      expect(Object.keys(body.questions.next_action.criteria)).not.toContain("click-login");
      expect(JSON.stringify(body)).not.toMatch(/sk_ts_/);
      return {
        ok: true,
        json: async () => ({
          model: "jev-latest",
          answers: actionAnswers(),
          usage: { input_tokens: 400, output_tokens: 20 },
        }),
      };
    };
    try {
      const res = await worker.fetch(
        new Request("https://freightlodge-stt-token.example/jev-action", {
          method: "POST",
          headers: { Origin: PAGES_ORIGIN, "Content-Type": "application/json" },
          body: JSON.stringify({
            sheet: { lanes: { origin: { postal_code: "78721" } } },
            candidates: CANDIDATES,
            step: "origin",
          }),
        }),
        { TYPESAFE_API_KEY: "sk_ts_test" },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.jev).toBe("on");
      expect(body.decision.actionId).toBe("origin-zip");
      expect(body.cost_usd).toBeCloseTo(0.0000168, 8);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it("evaluateDomAction throws unconfigured without a client key path", async () => {
    await expect(evaluateDomAction({ candidates: CANDIDATES })).rejects.toMatchObject({
      code: "JEV_UNCONFIGURED",
    });
  });

  it("keeps TYPESAFE_API_KEY off the Pages client and out of VITE_*", () => {
    const files = [
      "src/lib/jev-action-core.js",
      "src/lib/exfresso-pilot-core.js",
      "token-proxy/src/jev-action.js",
      "scripts/exfresso-pilot-runner.mjs",
      "public/exfresso-pilot/index.html",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/VITE_TYPESAFE/);
      expect(src, file).not.toMatch(/TYPESAFE_API_KEY\s*=/);
    }
  });
});
