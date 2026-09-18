import { describe, expect, it } from "vitest";
import { extractSlots, mergeExtracted } from "../src/lib/extract.js";
import { emptySheet } from "../src/lib/sheet.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { formatPlace } from "../src/lib/completeness.js";

const DUMP = "ship a thousand pounds of oranges from Austin to Atlanta";

function sessionDumpAtlantaAustin() {
  const session = createSession({ id: "sarah-zip" });
  const dumped = handleUtterance(session, DUMP);
  dumped.session.sheet.lanes.origin.city = "Atlanta";
  dumped.session.sheet.lanes.origin.state = "GA";
  dumped.session.sheet.lanes.destination.city = "Austin";
  dumped.session.sheet.lanes.destination.state = "TX";
  dumped.session.awaiting = "origin_zip";
  return dumped.session;
}

function readyForAccessorials(id) {
  const session = createSession({ id });
  session.sheet.lanes.origin.city = "Atlanta";
  session.sheet.lanes.origin.state = "GA";
  session.sheet.lanes.origin.postal_code = "30301";
  session.sheet.lanes.destination.city = "Austin";
  session.sheet.lanes.destination.state = "TX";
  session.sheet.lanes.destination.postal_code = "78721";
  session.sheet.freight.pieces = 3;
  session.sheet.freight.total_weight_lbs = 1000;
  session.sheet.freight.commodity = "oranges";
  session.sheet.pickup.date = "2026-09-18";
  session.sheet.pickup.accessorials = [];
  session.awaiting = "accessorials";
  return session;
}

describe("noise words before a ZIP do not rewrite the city", () => {
  it("Sarah actually 30301 keeps Atlanta and applies the ZIP", () => {
    const session = sessionDumpAtlantaAustin();
    expect(session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(session.sheet.lanes.origin.postal_code).toBeNull();

    const extracted = extractSlots("Sarah actually 30301", {
      awaiting: "origin_zip",
      originCity: "Atlanta",
      destCity: "Austin",
    });
    expect(extracted.origin.postal_code).toBe("30301");
    expect(extracted.origin.city).toBeUndefined();

    const result = handleUtterance(session, "Sarah actually 30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.state).toBe("GA");
    expect(result.session.sheet.lanes.origin.city).not.toMatch(/Sarah/i);
    expect(formatPlace(result.session.sheet.lanes.origin)).toBe("Atlanta, GA, 30301");
    expect(formatPlace(result.session.sheet.lanes.origin)).not.toMatch(/Sarah/i);
  });

  it("merge does not replace a prior city with unknown words + ZIP", () => {
    const sheet = emptySheet({ id: "keep-atl" });
    sheet.lanes.origin.city = "Atlanta";
    sheet.lanes.origin.state = "GA";
    const next = mergeExtracted(sheet, {
      origin: { city: "Sarah Actually", postal_code: "30301" },
      destination: {},
      freight: {},
      pickup: {},
      contact: {},
      flags: {},
    });
    expect(next.lanes.origin.city).toBe("Atlanta");
    expect(next.lanes.origin.postal_code).toBe("30301");
    expect(next.lanes.origin.state).toBe("GA");
  });

  it("known city + ZIP may confirm the city", () => {
    const extracted = extractSlots("Atlanta 30301", {
      awaiting: "origin_zip",
      originCity: "Atlanta",
    });
    expect(extracted.origin.postal_code).toBe("30301");
    expect(extracted.origin.city).toBe("Atlanta");
  });
});

describe("protect synonyms while awaiting accessorials", () => {
  it.each([
    "please protected",
    "protected",
    "protect",
    "freeze protected",
    "please protect",
  ])("%s sets protect_from_freeze", (utterance) => {
    const extracted = extractSlots(utterance, { awaiting: "accessorials" });
    expect(extracted.pickup.accessorials, utterance).toContain("protect_from_freeze");

    const result = handleUtterance(readyForAccessorials(`protect-${utterance}`), utterance);
    expect(result.session.sheet.pickup.accessorials).toContain("protect_from_freeze");
    expect(result.session.askedAccessorials).toBe(true);
    expect(result.session.awaiting).toBe("email");
  });

  it("unrelated talk still does not invent protect", () => {
    const result = handleUtterance(readyForAccessorials("protect-miss"), "hmm what now");
    expect(result.session.sheet.pickup.accessorials).toEqual([]);
    expect(result.session.awaiting).toBe("accessorials");
  });
});

describe("dump path still parks oranges Austin→Atlanta", () => {
  it("does not invent ZIPs and still parks weight + commodity + cities", () => {
    const result = handleUtterance(createSession({ id: "dump-still" }), DUMP);
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("origin_zip");
  });
});
