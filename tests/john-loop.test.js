import { describe, expect, it } from "vitest";
import { extractSlots, parseWeightPounds } from "../src/lib/extract.js";
import { nextRequiredSlot } from "../src/lib/completeness.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

const GEORGIA_INCOMPLETE = "I'd like to ship $1,000 lb of peaches from Georgia to";

describe("John live-loop regressions", () => {
  it("does not set dest city Ship; parses $1,000 lb; origin GA; asks dest", () => {
    const extracted = extractSlots(GEORGIA_INCOMPLETE);
    expect(extracted.destination.city).toBeUndefined();
    expect(extracted.destination.city).not.toBe("Ship");
    expect(extracted.freight.total_weight_lbs).toBe(1000);
    expect(extracted.origin.state).toBe("GA");
    expect(extracted.origin.city).toBeUndefined();
    expect(extracted.flags.incompleteTo).toBe(true);
    expect(extracted.freight.commodity).toMatch(/peach/i);

    const result = handleUtterance(createSession({ id: "ga-1" }), GEORGIA_INCOMPLETE);
    expect(result.session.sheet.lanes.destination.city).toBeNull();
    expect(result.session.sheet.lanes.destination.city).not.toBe("Ship");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.lanes.origin.state).toBe("GA");
    expect(result.reply.toLowerCase()).toMatch(/dest/);
    expect(result.reply).not.toMatch(/Got dest Ship/i);
    expect(result.session.awaiting).toBe("dest_zip");
    expect(nextRequiredSlot(result.session.sheet)).toBe("dest_zip");
  });

  it("ship 500 lb from Chicago IL 60601 to Dallas TX 75201 → dest Dallas, weight 500", () => {
    const extracted = extractSlots("ship 500 lb from Chicago IL 60601 to Dallas TX 75201");
    expect(extracted.destination.city).toBe("Dallas");
    expect(extracted.destination.city).not.toBe("Ship");
    expect(extracted.destination.state).toBe("TX");
    expect(extracted.destination.postal_code).toBe("75201");
    expect(extracted.origin.postal_code).toBe("60601");
    expect(extracted.freight.total_weight_lbs).toBe(500);
  });

  it("parses $1,000 lb and 1,200 lb", () => {
    expect(parseWeightPounds("$1,000")).toBe(1000);
    expect(extractSlots("$1,000 lb").freight.total_weight_lbs).toBe(1000);
    expect(extractSlots("1,200 lb").freight.total_weight_lbs).toBe(1200);
  });

  it("repeating the incomplete Georgia utterance does not loop Got dest Ship", () => {
    let session = createSession({ id: "ga-loop" });
    const first = handleUtterance(session, GEORGIA_INCOMPLETE);
    session = first.session;
    const second = handleUtterance(session, GEORGIA_INCOMPLETE);
    expect(first.reply).not.toMatch(/Got dest Ship/i);
    expect(second.reply).not.toMatch(/Got dest Ship/i);
    expect(second.session.sheet.lanes.destination.city).not.toBe("Ship");
    expect(second.session.sheet.lanes.destination.city).toBeNull();
    expect(second.reply.toLowerCase()).toMatch(/dest/);
    expect(second.reply).not.toBe(first.reply);
  });
});
