import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readClientUi } from "./client-ui.js";
import {
  PILOT_LABEL,
  demoSheet93ce7a5d,
  fieldAccuracy,
  isQuotedSuccess,
  mapVoiceJevToDomAction,
  pickHeuristicAction,
  pickHybridAction,
  sheetValueForField,
} from "../src/lib/exfresso-pilot-core.js";

const form = readFileSync("public/exfresso-pilot/index.html", "utf8");

describe("fake Exfresso multi-step form", () => {
  it("is a standalone public path with its own version chip", () => {
    expect(form).toContain("Exfresso Quote (pilot form)");
    expect(form).toContain(PILOT_LABEL);
    expect(form).toContain('data-pilot-step="origin"');
    expect(form).toContain("window.__EXFRESSO_PILOT__");
    expect(form).not.toMatch(/\u2014/);
  });

  it("walks origin, dest, freight, pickup, contact, review, quoted", () => {
    for (const step of ["origin", "dest", "freight", "pickup", "contact", "review", "quoted"]) {
      expect(form).toContain(`id="step-${step}"`);
    }
  });

  it("has a Continue vs Get rates fork and similar decoy buttons", () => {
    expect(form).toContain('data-pilot-id="continue-origin"');
    expect(form).toContain('data-pilot-id="continue-contact"');
    expect(form).toContain('data-pilot-id="get-rates-contact"');
    expect(form).toContain('data-pilot-id="get-rates-review"');
    expect(form).toContain("Continue without ZIP");
    expect(form).toContain("Get rates (sample)");
    expect(form).toContain("Use last origin");
    expect(form).toContain("Estimate weight");
    expect(form).toContain('data-pilot-id="inside"');
    expect(form).toContain("Inside pickup");
    expect(form).toContain("Inside delivery");
    expect(form).toMatch(/optional/);
    expect(form).toMatch(/required/);
  });

  it("covers the VTQ sheet fields including accessorials and email", () => {
    for (const id of [
      "origin-zip",
      "dest-zip",
      "weight",
      "pieces",
      "pickup-date",
      "inside_pickup",
      "inside_delivery",
      "liftgate_pickup",
      "residential_pickup",
      "protect_from_freeze",
      "email",
    ]) {
      expect(form).toContain(`data-pilot-id="${id}"`);
    }
  });
});

describe("heuristic picker (no TypeSafe)", () => {
  const sheet = demoSheet93ce7a5d();

  it("fills origin ZIP before clicking a Continue decoy", () => {
    const pick = pickHeuristicAction(
      [
        { id: "continue-no-zip", kind: "click", role: "button", label: "Continue without ZIP", decoy: true },
        {
          id: "origin-zip",
          kind: "fill",
          role: "textbox",
          field: "origin_zip",
          current: "",
          required: true,
        },
        { id: "continue", kind: "click", role: "button", label: "Continue" },
      ],
      sheet,
      { status: "collecting", values: {} },
    );
    expect(pick.actionId).toBe("origin-zip");
    expect(sheetValueForField(sheet, "origin_zip")).toBe("78721");
  });

  it("toggles inside accessorials from the sheet and ignores the Inside decoy", () => {
    const pick = pickHeuristicAction(
      [
        { id: "inside", kind: "check", field: "inside", checked: false, decoy: true, label: "Inside" },
        { id: "inside_pickup", kind: "check", field: "inside_pickup", checked: false },
        { id: "continue-pickup", kind: "click", role: "button", label: "Continue" },
      ],
      sheet,
      { status: "collecting", values: { accessorials: [] } },
    );
    expect(pick.actionId).toBe("inside_pickup");
  });

  it("submits Get rates only on review after fields match", () => {
    const filled = {
      origin_zip: "78721",
      dest_zip: "30030",
      weight: "1000",
      pieces: "3",
      pickup_date: "2026-09-22",
      accessorials: ["inside_pickup", "inside_delivery"],
      email: "qa@freightlodge.com",
    };
    const pick = pickHeuristicAction(
      [
        { id: "edit-origin", kind: "click", label: "Edit origin" },
        { id: "get-rates-review", kind: "click", label: "Get rates" },
      ],
      sheet,
      { status: "review", values: filled },
    );
    expect(pick.actionId).toBe("get-rates-review");
    expect(isQuotedSuccess({ status: "quoted", values: filled }, sheet)).toBe(true);
    expect(fieldAccuracy(filled, sheet).pct).toBe(100);
  });

  it("maps a voice Jev origin_zip focus onto the listed origin-zip candidate", () => {
    const mapped = mapVoiceJevToDomAction(
      { on: true, focus: "origin_zip", primarySlot: "origin_zip", touchedSlots: ["origin_zip"], parseConfidence: 0.8 },
      [
        { id: "continue-no-zip", kind: "click", decoy: true, label: "Continue without ZIP" },
        { id: "origin-zip", kind: "fill", field: "origin_zip", current: "" },
        { id: "continue-origin", kind: "click", label: "Continue" },
      ],
      sheet,
      { status: "collecting", values: {} },
    );
    expect(mapped.act).toBe(true);
    expect(mapped.actionId).toBe("origin-zip");
    expect(mapped.gateBlocked).toBe(false);
  });

  it("does not clarify-stop when Continue is a safe listed advance", () => {
    const mapped = mapVoiceJevToDomAction(
      { on: true, needsClarify: true, focus: "dest_zip", parseConfidence: 0.2, gateOverride: null },
      [
        { id: "dest-zip", kind: "fill", field: "dest_zip", current: "30030" },
        { id: "continue-dest", kind: "click", label: "Continue" },
      ],
      sheet,
      {
        status: "collecting",
        values: { dest_zip: "30030", origin_zip: "78721" },
      },
    );
    expect(mapped.act).toBe(true);
    expect(mapped.actionId).toBe("continue-dest");
  });

  it("hybrid script-fills mapped ZIP and does not ask Jev", () => {
    const pick = pickHybridAction(
      [
        { id: "continue-no-zip", kind: "click", role: "button", label: "Continue without ZIP", decoy: true },
        { id: "origin-zip", kind: "fill", role: "textbox", field: "origin_zip", current: "" },
        { id: "continue-origin", kind: "click", role: "button", label: "Continue" },
      ],
      sheet,
      { status: "collecting", values: {} },
    );
    expect(pick.askJev).toBe(false);
    expect(pick.actionId).toBe("origin-zip");
  });

  it("hybrid asks Jev only on Continue vs Get rates and similar forks", () => {
    const fork = pickHybridAction(
      [
        { id: "get-rates-sample", kind: "click", label: "Get rates (sample)", decoy: true },
        { id: "continue-contact", kind: "click", label: "Continue" },
        { id: "get-rates-contact", kind: "click", label: "Get rates" },
      ],
      sheet,
      {
        status: "collecting",
        values: {
          origin_zip: "78721",
          dest_zip: "30030",
          weight: "1000",
          pieces: "3",
          pickup_date: "2026-09-22",
          accessorials: ["inside_pickup", "inside_delivery"],
          email: "qa@freightlodge.com",
        },
      },
    );
    expect(fork.askJev).toBe(true);
    expect(fork.jevCandidates.map((c) => c.id)).toEqual([
      "get-rates-sample",
      "continue-contact",
      "get-rates-contact",
    ]);

    const inside = pickHybridAction(
      [
        { id: "inside", kind: "check", field: "inside", checked: false, decoy: true, label: "Inside" },
        { id: "inside_pickup", kind: "check", field: "inside_pickup", checked: false, label: "Inside pickup" },
        { id: "continue-pickup", kind: "click", label: "Continue" },
      ],
      sheet,
      { status: "collecting", values: { accessorials: [] } },
    );
    expect(inside.askJev).toBe(true);
    expect(inside.actionId).toBe("inside_pickup");
    expect(inside.jevCandidates.map((c) => c.id)).toEqual(["inside", "inside_pickup"]);
  });

  it("fails the scorecard when sample values overwrite the sheet", () => {
    const wrong = {
      origin_zip: "60601",
      dest_zip: "75201",
      weight: "500",
      pieces: "1",
      pickup_date: "2026-09-21",
      accessorials: [],
      email: "sample@exfresso.test",
    };
    const acc = fieldAccuracy(wrong, sheet);
    expect(acc.pct).toBe(0);
    expect(isQuotedSuccess({ status: "quoted", values: wrong }, sheet)).toBe(false);
  });
});

describe("voice quote stays on its own path", () => {
  it("does not register the pilot form inside the VTQ app bundle", () => {
    const app = readClientUi();
    expect(app).not.toContain("exfresso-pilot");
    expect(app).toContain("fetchJevDecision");
    const dialog = readFileSync("src/lib/dialog.js", "utf8");
    expect(dialog).toContain("What’s the origin ZIP?");
  });
});
