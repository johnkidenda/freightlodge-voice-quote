import { describe, expect, it } from "vitest";
import { extractSlots, mergeExtracted } from "../src/lib/extract.js";
import { emptySheet } from "../src/lib/sheet.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

function sessionAtlantaToTx() {
  const session = createSession({ id: "atl-tx" });
  session.sheet.lanes.origin.city = "Atlanta";
  session.sheet.lanes.destination.state = "TX";
  session.awaiting = "origin_zip";
  return session;
}

describe("PR6 phone — spoken thousand kg same turn", () => {
  it("thousand kilograms of oranges from Atlanta to Austin → 2205 lb, cities set", () => {
    const extracted = extractSlots("thousand kilograms of oranges from Atlanta to Austin");
    expect(extracted.freight.total_weight_lbs).toBe(2205);
    expect(extracted.origin.city).toBe("Atlanta");
    expect(extracted.destination.city).toBe("Austin");

    const result = handleUtterance(
      createSession({ id: "spoken-kg" }),
      "thousand kilograms of oranges from Atlanta to Austin",
    );
    expect(result.session.sheet.freight.total_weight_lbs).toBe(2205);
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.reply).toMatch(/2205/);
  });

  it("parses a thousand kg and one thousand kilos", () => {
    expect(extractSlots("a thousand kg").freight.total_weight_lbs).toBe(2205);
    expect(extractSlots("one thousand kilograms").freight.total_weight_lbs).toBe(2205);
    expect(extractSlots("a thousand kilos of oranges").freight.total_weight_lbs).toBe(2205);
  });
});

describe("PR6 phone — origin ZIP never wipes dest", () => {
  it("78721 while awaiting origin_zip keeps dest TX", () => {
    const session = sessionAtlantaToTx();
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).not.toBe("Atlanta");
    expect(result.reply).not.toMatch(/Where is this going\?/i);
  });

  it("787 78721 accepts 78721 and preserves dest TX", () => {
    const session = sessionAtlantaToTx();
    session.sheet.lanes.destination.city = "Austin";
    const result = handleUtterance(session, "787 78721");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.postal_code).not.toBe("787");
  });

  it("merge ZIP onto a place does not replace city/state", () => {
    const sheet = emptySheet({ id: "merge-zip" });
    sheet.lanes.origin.city = "Atlanta";
    sheet.lanes.destination.state = "TX";
    sheet.lanes.destination.city = "Austin";
    const next = mergeExtracted(sheet, { origin: { postal_code: "30301" }, destination: {}, freight: {}, pickup: {}, contact: {}, flags: {} });
    expect(next.lanes.origin.city).toBe("Atlanta");
    expect(next.lanes.origin.postal_code).toBe("30301");
    expect(next.lanes.destination.state).toBe("TX");
    expect(next.lanes.destination.city).toBe("Austin");
  });
});

describe("PR6 phone — ZIP/city conflict is not a silent invert", () => {
  it("78721 on Atlanta origin with dest Austin/TX asks before pairing", () => {
    const session = sessionAtlantaToTx();
    session.sheet.lanes.destination.city = "Austin";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.reply).toMatch(/78721 looks like Austin/i);
    expect(result.reply).toMatch(/destination ZIP/i);
  });

  it("yes after conflict puts 78721 on dest, not Atlanta origin", () => {
    let session = sessionAtlantaToTx();
    session.sheet.lanes.destination.city = "Austin";
    session = handleUtterance(session, "78721").session;
    const yes = handleUtterance(session, "yes");
    expect(yes.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(yes.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(yes.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(yes.session.sheet.lanes.destination.city).toBe("Austin");
    expect(yes.session.sheet.lanes.destination.state).toBe("TX");
  });

  it("30301 while dest is TX and origin Atlanta does not silent-invert", () => {
    const session = sessionAtlantaToTx();
    session.sheet.lanes.origin.postal_code = "99999";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.reply).toMatch(/30301 looks like Atlanta/i);
    expect(result.session.sheet.lanes.origin.postal_code).not.toBe("78721");
    expect(result.session.sheet.lanes.destination.postal_code).not.toBe("30301");
  });
});

describe("PR6 phone — already mentioned weight", () => {
  it("I already mentioned it with weight set asks for pieces, not only a blunt pieces prompt", () => {
    const session = createSession({ id: "already" });
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.destination.postal_code = "78721";
    session.sheet.freight.total_weight_lbs = 2205;
    session.awaiting = "pieces";
    const result = handleUtterance(session, "I already mentioned it");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(2205);
    expect(result.session.sheet.freight.pieces).toBeNull();
    expect(result.session.sheet.freight.piece_unit).toBeNull();
    expect(result.session.awaiting).toBe("piece_unit");
    expect(result.reply).toMatch(/got the weight/i);
    expect(result.reply).toMatch(/pallets or pieces/i);
  });
});
