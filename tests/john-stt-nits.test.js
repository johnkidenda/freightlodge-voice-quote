import { describe, expect, it } from "vitest";
import { extractSlots, mergeExtracted, stripSpeechFillers } from "../src/lib/extract.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { emptySheet } from "../src/lib/sheet.js";

describe("speech fillers are not city tokens", () => {
  it("strips um/uh/erm from place names", () => {
    expect(stripSpeechFillers("Uh Atlanta")).toBe("Atlanta");
    expect(stripSpeechFillers("from um Atlanta to erm Austin")).toBe("from Atlanta to Austin");
    const extracted = extractSlots("from Uh Atlanta to Austin");
    expect(extracted.origin.city).toBe("Atlanta");
    expect(extracted.destination.city).toBe("Austin");
    expect(extracted.origin.city).not.toMatch(/uh/i);
    expect(extracted.destination.city).not.toMatch(/uh/i);
  });
});

describe("labeled cities are not inverted by ZIP / filler turns", () => {
  function labeledAtlantaAustin() {
    const session = createSession({ id: "labeled-lane" });
    session.sheet.lanes.origin.city = "Atlanta";
    session.sheet.lanes.destination.city = "Austin";
    session.sheet.lanes.destination.state = "TX";
    session.awaiting = "origin_zip";
    return session;
  }

  it("Uh Atlanta zip + Austin zip keep Atlanta 30301 / Austin 78721", () => {
    const result = handleUtterance(
      labeledAtlantaAustin(),
      "Uh Atlanta zip is 30301 and Austin zip is 78721",
    );
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.city).not.toMatch(/uh/i);
    expect(result.session.sheet.lanes.destination.city).not.toMatch(/uh/i);
    expect(result.session.sheet.lanes.origin.state).not.toBe("TX");
  });

  it("merge does not swap a labeled dest onto origin from Uh Atlanta", () => {
    const sheet = emptySheet({ id: "keep-cities" });
    sheet.lanes.origin.city = "Atlanta";
    sheet.lanes.destination.city = "Austin";
    sheet.lanes.destination.state = "TX";
    const next = mergeExtracted(sheet, {
      origin: { city: "Atlanta", state: "TX", postal_code: "30301" },
      destination: { city: "Uh Atlanta", postal_code: "78721" },
      freight: {},
      pickup: {},
      contact: {},
      flags: {},
    });
    expect(next.lanes.origin.city).toBe("Atlanta");
    expect(next.lanes.destination.city).toBe("Austin");
    expect(next.lanes.origin.state).not.toBe("TX");
    expect(next.lanes.origin.postal_code).toBe("30301");
    expect(next.lanes.destination.postal_code).toBe("78721");
  });
});

describe("STT num means no accessorials", () => {
  it("maps num / nun to accessorials none", () => {
    expect(extractSlots("num", { awaiting: "accessorials" }).flags.accessorialsNone).toBe(true);
    expect(extractSlots("num extras").flags.accessorialsNone).toBe(true);
    expect(extractSlots("nun").flags.accessorialsNone).toBe(true);
    expect(extractSlots("num", { awaiting: "accessorials" }).pickup.accessorials).toEqual([]);
  });

  it("dialog accepts num while awaiting accessorials", () => {
    const session = createSession({ id: "stt-num" });
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.destination.postal_code = "78721";
    session.sheet.freight.pieces = 3;
    session.sheet.freight.total_weight_lbs = 1200;
    session.sheet.freight.commodity = "oranges";
    session.sheet.pickup.date = "2026-09-18";
    session.awaiting = "accessorials";
    const result = handleUtterance(session, "num");
    expect(result.session.askedAccessorials).toBe(true);
    expect(result.session.sheet.pickup.accessorials).toEqual([]);
    expect(result.session.awaiting).toBe("email");
  });
});
