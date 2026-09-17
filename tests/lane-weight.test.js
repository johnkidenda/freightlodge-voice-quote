import { describe, expect, it } from "vitest";
import {
  extractSlots,
  kgToPounds,
  mergeExtracted,
  splitTwoKnownCities,
} from "../src/lib/extract.js";
import { emptySheet } from "../src/lib/sheet.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

describe("A — dest-ZIP phrases fill dest only", () => {
  it("destination zip is 78721 does not mirror onto origin", () => {
    const extracted = extractSlots("destination zip is 78721", { awaiting: "origin_zip" });
    expect(extracted.destination.postal_code).toBe("78721");
    expect(extracted.origin.postal_code).toBeUndefined();

    const result = handleUtterance(createSession({ id: "dest-only-a" }), "destination zip is 78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("origin_zip");
  });

  it("dest zip 78721 while awaiting origin_zip stays dest-only", () => {
    const session = createSession({ id: "dest-only-b" });
    session.awaiting = "origin_zip";
    session.sheet.lanes.destination.city = "Austin";
    const result = handleUtterance(session, "dest zip 78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
  });

  it("78721 is the destination does not copy ZIP to origin", () => {
    const extracted = extractSlots("78721 is the destination", { awaiting: "origin_zip" });
    expect(extracted.destination.postal_code).toBe("78721");
    expect(extracted.origin.postal_code).toBeUndefined();
  });
});

describe("B — Atlanta Austin is two cities, not a compound origin", () => {
  it("splits from Atlanta Austin into origin Atlanta and dest Austin", () => {
    expect(splitTwoKnownCities("Atlanta Austin")).toEqual(["Atlanta", "Austin"]);
    const extracted = extractSlots("from Atlanta Austin");
    expect(extracted.origin.city).toBe("Atlanta");
    expect(extracted.destination.city).toBe("Austin");
    expect(extracted.origin.city).not.toBe("Atlanta Austin");
  });

  it("from Atlanta Austin with kg freight still splits the lane", () => {
    const extracted = extractSlots("I like to ship 1,000 kilograms of oranges from Atlanta Austin");
    expect(extracted.origin.city).toBe("Atlanta");
    expect(extracted.destination.city).toBe("Austin");
    expect(extracted.origin.city).not.toMatch(/Austin Austin|Atlanta Austin/i);
  });

  it("keeps Los Angeles as one origin city", () => {
    const extracted = extractSlots("from Los Angeles to Dallas");
    expect(extracted.origin.city).toBe("Los Angeles");
    expect(extracted.destination.city).toBe("Dallas");
  });
});

describe("C — incomplete ZIP asks for 5 digits", () => {
  it("dest zip 787 does not silently ignore — asks for 5 digits", () => {
    const session = createSession({ id: "short-zip-a" });
    session.sheet.lanes.destination.city = "Austin";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "dest zip 787");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.reply).toMatch(/5-digit|five.digit/i);
    expect(result.session.awaiting).toBe("dest_zip");
  });

  it("bare 787 while awaiting dest_zip asks for 5 digits", () => {
    const session = createSession({ id: "short-zip-b" });
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "787");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/5-digit|five.digit/i);
  });

  it("extract flags dest zip 787 as incomplete and does not store it", () => {
    const extracted = extractSlots("dest zip 787", { awaiting: "dest_zip" });
    expect(extracted.destination.postal_code).toBeUndefined();
    expect(extracted.flags.incompleteZip).toEqual({ digits: "787", role: "dest" });
  });
});

describe("D — kilograms persist as pounds", () => {
  it("converts 1000 kg to about 2205 lb", () => {
    expect(kgToPounds(1000)).toBe(2205);
    expect(extractSlots("1,000 kilograms").freight.total_weight_lbs).toBe(2205);
    expect(extractSlots("1000 kg").freight.total_weight_lbs).toBe(2205);
    expect(extractSlots("1000 kilos of oranges").freight.total_weight_lbs).toBe(2205);
  });

  it("persists kg weight so three pieces does not re-ask measure", () => {
    let session = createSession({ id: "kg-persist" });
    const first = handleUtterance(
      session,
      "I like to ship 1,000 kilograms of oranges from Atlanta to Austin",
    );
    session = first.session;
    expect(session.sheet.freight.total_weight_lbs).toBe(2205);
    expect(session.sheet.freight.commodity).toMatch(/orange/i);
    expect(first.reply).toMatch(/2205/i);

    const second = handleUtterance(session, "three pieces");
    expect(second.session.sheet.freight.total_weight_lbs).toBe(2205);
    expect(second.session.sheet.freight.pieces).toBe(3);
    expect(second.reply).not.toMatch(/pounds|L×W×H|NMFC|won’t guess class/i);
    expect(second.session.awaiting).toMatch(/zip/);
  });

  it("mergeExtracted keeps prior kg weight when a later turn only adds pieces", () => {
    const sheet = emptySheet({ id: "kg-merge" });
    const withKg = mergeExtracted(sheet, extractSlots("1000 kg of oranges"));
    expect(withKg.freight.total_weight_lbs).toBe(2205);
    const withPieces = mergeExtracted(withKg, extractSlots("three pieces"));
    expect(withPieces.freight.total_weight_lbs).toBe(2205);
    expect(withPieces.freight.pieces).toBe(3);
  });
});
