import { describe, expect, it } from "vitest";
import { emptySheet, SCHEMA_VERSION } from "../src/lib/sheet.js";
import {
  hasCompleteDims,
  hasMeasure,
  isReadyForQuote,
  missingReadyFields,
  nextRequiredSlot,
} from "../src/lib/completeness.js";
import { handleUtterance, createSession } from "../src/lib/dialog.js";
import { pickLowestRate, simulateExfressoRunner } from "../src/lib/handoff.js";
import { formatQuoteEmail } from "../src/lib/email.js";

function completeSheet(overrides = {}) {
  const sheet = emptySheet({ id: "test-sheet", now: "2026-09-16T12:00:00.000Z" });
  sheet.lanes.origin = { city: "Chicago", state: "IL", postal_code: "60601", country: "US" };
  sheet.lanes.destination = { city: "Dallas", state: "TX", postal_code: "75201", country: "US" };
  sheet.freight.pieces = 3;
  sheet.freight.total_weight_lbs = 1200;
  sheet.freight.commodity = "auto parts";
  sheet.pickup.date = "2026-09-18";
  sheet.contact.email = "shipper@example.com";
  return { ...sheet, ...overrides, freight: { ...sheet.freight, ...(overrides.freight || {}) } };
}

describe("quote sheet v1 completeness", () => {
  it("stamps schema_version 1.0 on every new sheet", () => {
    expect(emptySheet().schema_version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe("1.0");
  });

  it("is not ready until origin/dest ZIP, pieces, measure, commodity, date, email are present", () => {
    const sheet = emptySheet();
    expect(isReadyForQuote(sheet)).toBe(false);
    expect(missingReadyFields(sheet)).toEqual(
      expect.arrayContaining([
        "lanes.origin.postal_code",
        "lanes.destination.postal_code",
        "freight.pieces",
        "freight.total_weight_lbs|freight.dims|freight.freight_class",
        "freight.commodity",
        "pickup.date",
        "contact.email",
      ]),
    );
  });

  it("accepts weight OR complete dims OR freight class as the measure", () => {
    const base = completeSheet({ freight: { total_weight_lbs: null } });
    base.freight.total_weight_lbs = null;
    expect(hasMeasure(base.freight)).toBe(false);

    const withWeight = completeSheet();
    expect(hasMeasure(withWeight.freight)).toBe(true);
    expect(isReadyForQuote(withWeight)).toBe(true);

    const withDims = completeSheet({ freight: { total_weight_lbs: null } });
    withDims.freight.total_weight_lbs = null;
    withDims.freight.dims = { length_in: 48, width_in: 40, height_in: 48, per_piece: true };
    expect(hasCompleteDims(withDims.freight.dims)).toBe(true);
    expect(hasMeasure(withDims.freight)).toBe(true);
    expect(isReadyForQuote(withDims)).toBe(true);

    const withClass = completeSheet({ freight: { total_weight_lbs: null } });
    withClass.freight.total_weight_lbs = null;
    withClass.freight.freight_class = "70";
    expect(hasMeasure(withClass.freight)).toBe(true);
    expect(isReadyForQuote(withClass)).toBe(true);
  });

  it("rejects incomplete dims as a measure", () => {
    const sheet = completeSheet();
    sheet.freight.total_weight_lbs = null;
    sheet.freight.dims = { length_in: 48, width_in: 40, height_in: null, per_piece: true };
    expect(hasCompleteDims(sheet.freight.dims)).toBe(false);
    expect(isReadyForQuote(sheet)).toBe(false);
  });

  it("asks for slots in a stable order", () => {
    const sheet = emptySheet();
    expect(nextRequiredSlot(sheet)).toBe("origin_zip");
    sheet.lanes.origin.postal_code = "60601";
    expect(nextRequiredSlot(sheet)).toBe("dest_zip");
  });

  it("becomes ready_for_quote after a complete conversation", () => {
    const now = new Date("2026-09-16T15:00:00");
    let session = createSession({ id: "conv-1", now });
    const turns = [
      "Chicago IL 60601 to Dallas TX 75201",
      "3 pallets",
      "1200 pounds",
      "auto parts",
      "tomorrow",
      "liftgate at delivery, none else",
      "shipper@example.com",
    ];
    let last;
    for (const turn of turns) {
      last = handleUtterance(session, turn, { now });
      session = last.session;
    }
    expect(last.ready).toBe(true);
    expect(session.sheet.status).toBe("ready_for_quote");
    expect(session.sheet.schema_version).toBe("1.0");
    expect(session.sheet.lanes.origin.postal_code).toBe("60601");
    expect(session.sheet.lanes.destination.postal_code).toBe("75201");
    expect(session.sheet.freight.pieces).toBe(3);
    expect(session.sheet.freight.total_weight_lbs).toBe(1200);
    expect(session.sheet.pickup.date).toBe("2026-09-17");
    expect(session.sheet.contact.email).toBe("shipper@example.com");
  });

  it("fills a complete one-liner without inventing extra measure fields", () => {
    const now = new Date("2026-09-16T15:00:00");
    const result = handleUtterance(
      createSession({ id: "one-liner", now }),
      "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1200 pounds, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com",
      { now },
    );
    expect(result.ready).toBe(true);
    expect(result.session.sheet.freight.freight_class).toBeNull();
    expect(result.session.sheet.freight.dims).toBeNull();
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1200);
    expect(result.session.sheet.pickup.accessorials).toContain("liftgate_delivery");
  });
});

describe("handoff stub", () => {
  it("picks the lowest total_usd when multiple rates exist", () => {
    const best = pickLowestRate([
      { carrier: "A", total_usd: 410 },
      { carrier: "B", total_usd: 299.5 },
      { carrier: "C", total_usd: 350 },
    ]);
    expect(best.carrier).toBe("B");
    expect(best.total_usd).toBe(299.5);
  });

  it("returns a realistic quote_result for a ready sheet", () => {
    const result = simulateExfressoRunner(completeSheet());
    expect(result.ok).toBe(true);
    expect(result.quote_sheet.status).toBe("quoted");
    expect(result.quote_sheet.quote_result.total_usd).toBeGreaterThan(0);
    expect(result.quote_sheet.quote_result.carrier).toBeTruthy();
    expect(result.quote_sheet.quote_result.quote_id).toMatch(/^FL-STUB-/);
  });

  it("never invents a rate for out_of_scope", () => {
    const sheet = completeSheet();
    sheet.status = "out_of_scope";
    sheet.out_of_scope_reason = "Hard international";
    const result = simulateExfressoRunner(sheet);
    expect(result.ok).toBe(false);
    expect(result.quote_sheet.quote_result).toBeNull();
  });

  it("errors instead of faking a rate when the sheet is incomplete", () => {
    const result = simulateExfressoRunner(emptySheet());
    expect(result.ok).toBe(false);
    expect(result.quote_sheet.status).toBe("error");
    expect(result.quote_sheet.quote_result).toBeNull();
    expect(result.quote_sheet.error_reason).toMatch(/not ready/i);
  });

  it("mirrors error_reason onto the email body like out_of_scope_reason", () => {
    const errored = completeSheet();
    errored.status = "error";
    errored.error_reason = "Exfresso login timeout";
    errored.quote_result = null;
    expect(formatQuoteEmail(errored).body).toMatch(/Exfresso login timeout/);

    const oos = completeSheet();
    oos.status = "out_of_scope";
    oos.out_of_scope_reason = "Hard international";
    oos.quote_result = null;
    expect(formatQuoteEmail(oos).body).toMatch(/Hard international/);
    expect(formatQuoteEmail(oos).body).not.toMatch(/\$\d/);
  });
});
