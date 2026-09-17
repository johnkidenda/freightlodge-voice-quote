import { describe, expect, it } from "vitest";
import { emptySheet } from "../src/lib/sheet.js";
import { extractSlots, mergeExtracted } from "../src/lib/extract.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

function sheetWithAustinDest() {
  const sheet = emptySheet({ id: "austin-dest" });
  sheet.lanes.destination.city = "Austin";
  sheet.lanes.destination.state = "TX";
  sheet.lanes.destination.postal_code = null;
  return sheet;
}

describe("awaiting-slot ZIP and dest corrections", () => {
  it("bare 78721 while awaiting origin_zip fills origin and keeps dest Austin", () => {
    const session = createSession({ id: "zip-a" });
    session.sheet = sheetWithAustinDest();
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("dest_zip");
    expect(result.reply).toMatch(/Austin/i);
  });

  it("that's the destination moves 78721 to dest and keeps Austin", () => {
    let session = createSession({ id: "zip-b" });
    session.sheet = sheetWithAustinDest();
    session.awaiting = "origin_zip";
    session = handleUtterance(session, "78721").session;
    const result = handleUtterance(session, "that's the destination");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("origin_zip");
    expect(result.reply.toLowerCase()).toMatch(/origin zip|origin/);
  });

  it("the ZIP code I just sent is the destination does the same move", () => {
    let session = createSession({ id: "zip-c" });
    session.sheet = sheetWithAustinDest();
    session.awaiting = "origin_zip";
    session = handleUtterance(session, "78721").session;
    const result = handleUtterance(session, "the ZIP code I just sent is the destination");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.reply).not.toMatch(/didn’t add one|didn't add one/i);
  });

  it("awaiting dest_zip + bare ZIP fills dest, not origin", () => {
    const session = createSession({ id: "zip-d" });
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.origin.city = "Atlanta";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
  });

  it("kilograms/oranges/from is not an origin city; Atlanta and Austin still extract", () => {
    const extracted = extractSlots(
      "I like to ship 1,000 kilograms of oranges from kilograms of oranges from Hunter Atlanta to Austin",
    );
    expect(extracted.origin.city).not.toMatch(/kilogram|oranges|from/i);
    expect(extracted.origin.city).toBe("Atlanta");
    expect(extracted.destination.city).toBe("Austin");

    const sheet = mergeExtracted(emptySheet({ id: "noise" }), extracted);
    expect(sheet.lanes.origin.city).toBe("Atlanta");
    expect(sheet.lanes.origin.city).not.toMatch(/Kilograms Of Oranges From/i);
    expect(sheet.lanes.destination.city).toBe("Austin");
  });
});
