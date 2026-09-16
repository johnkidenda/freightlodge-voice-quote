import { describe, expect, it } from "vitest";
import { extractSlots, parseWeightPounds, takePlace } from "../src/lib/extract.js";
import { formatPlace } from "../src/lib/completeness.js";
import { handleUtterance, createSession } from "../src/lib/dialog.js";

describe("weight thousand separators", () => {
  it("parses 1,200 lb as 1200, not 200", () => {
    expect(parseWeightPounds("1,200")).toBe(1200);
    expect(extractSlots("1,200 lb").freight.total_weight_lbs).toBe(1200);
    expect(extractSlots("1,200lbs").freight.total_weight_lbs).toBe(1200);
  });

  it("parses 1200 lb without commas", () => {
    expect(extractSlots("1200 lb").freight.total_weight_lbs).toBe(1200);
    expect(extractSlots("1200 pounds").freight.total_weight_lbs).toBe(1200);
  });

  it("parses 1,200.5 lb decimals after stripping commas", () => {
    expect(parseWeightPounds("1,200.5")).toBe(1200.5);
    expect(extractSlots("1,200.5 lb").freight.total_weight_lbs).toBe(1200.5);
  });

  it("does not treat a bare 1,200 as a weight", () => {
    expect(extractSlots("about 1,200 of them").freight.total_weight_lbs).toBeUndefined();
  });
});

describe("place fields hold only place data", () => {
  it("does not leak leftover utterance into dest or origin city", () => {
    const extracted = extractSlots(
      "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1,200 lbs, auto parts, pickup tomorrow, email shipper@example.com",
    );
    expect(extracted.origin).toEqual({
      city: "Chicago",
      state: "IL",
      postal_code: "60601",
    });
    expect(extracted.destination).toEqual({
      city: "Dallas",
      state: "TX",
      postal_code: "75201",
    });
    expect(extracted.freight.total_weight_lbs).toBe(1200);
    expect(formatPlace(extracted.origin)).toBe("Chicago, IL, 60601");
    expect(formatPlace(extracted.destination)).toBe("Dallas, TX, 75201");
    expect(formatPlace(extracted.destination)).not.toMatch(/pallet|lb|email|auto|pickup/i);
  });

  it("stops dest parsing before 'need a quote' leftovers", () => {
    const extracted = extractSlots("from Chicago to Dallas TX 75201 need a quote tomorrow");
    expect(extracted.origin.city).toBe("Chicago");
    expect(extracted.destination.city).toBe("Dallas");
    expect(extracted.destination.state).toBe("TX");
    expect(extracted.destination.postal_code).toBe("75201");
    expect(extracted.destination.city).not.toMatch(/need|quote|tomorrow/i);
  });

  it("does not treat leading chat as origin city", () => {
    const extracted = extractSlots("Need a quote from Chicago IL 60601 to Dallas TX 75201");
    expect(extracted.origin.city).toBe("Chicago");
    expect(extracted.origin.city).not.toMatch(/need|quote/i);
    expect(extracted.destination.city).toBe("Dallas");
  });

  it("takePlace returns only city/state/ZIP tokens", () => {
    expect(takePlace("Dallas TX 75201, 3 pallets, 1,200 lbs of widgets")).toEqual({
      city: "Dallas",
      state: "TX",
      postal_code: "75201",
    });
    expect(takePlace("Los Angeles CA 90012")).toEqual({
      city: "Los Angeles",
      state: "CA",
      postal_code: "90012",
    });
  });

  it("dialog sheet summaries stay place-only after a long one-liner", () => {
    const now = new Date("2026-09-16T15:00:00");
    const result = handleUtterance(
      createSession({ id: "place-nit", now }),
      "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1,200 lbs, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com",
      { now },
    );
    expect(result.session.sheet.lanes.destination.city).toBe("Dallas");
    expect(result.session.sheet.lanes.origin.city).toBe("Chicago");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1200);
    expect(formatPlace(result.session.sheet.lanes.destination)).toBe("Dallas, TX, 75201");
  });
});

describe("commodity keeps the goods phrase", () => {
  it("takes the description after 'pallets of', not just packaging", () => {
    expect(extractSlots("3 pallets of widgets").freight.commodity).toBe("widgets");
    expect(extractSlots("3 pallets of used auto parts").freight.commodity).toBe("used auto parts");
  });
});
