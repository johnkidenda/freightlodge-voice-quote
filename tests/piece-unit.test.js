import { describe, expect, it } from "vitest";
import { SLOT_ORDER, nextRequiredSlot } from "../src/lib/completeness.js";
import { createSession, handleUtterance, PROMPTS } from "../src/lib/dialog.js";
import { extractSlots } from "../src/lib/extract.js";
import { presentAgentReply } from "../src/lib/conversational.js";

function zippedSession(id = "unit") {
  const session = createSession({ id });
  session.sheet.lanes.origin.postal_code = "60601";
  session.sheet.lanes.destination.postal_code = "75201";
  return session;
}

describe("piece unit then count", () => {
  it("SLOT_ORDER asks piece_unit before pieces", () => {
    expect(SLOT_ORDER.indexOf("piece_unit")).toBe(SLOT_ORDER.indexOf("pieces") - 1);
    expect(PROMPTS.piece_unit).toBe("Are you shipping pallets or pieces?");
    const sheet = zippedSession().sheet;
    expect(nextRequiredSlot(sheet)).toBe("piece_unit");
    sheet.freight.piece_unit = "pallets";
    expect(nextRequiredSlot(sheet)).toBe("pieces");
    sheet.freight.pieces = 2;
    expect(nextRequiredSlot(sheet)).not.toBe("piece_unit");
    expect(nextRequiredSlot(sheet)).not.toBe("pieces");
  });

  it("asks pallets or pieces once both ZIPs are in", () => {
    const result = handleUtterance(zippedSession("ask-unit"), "ready");
    expect(result.session.awaiting).toBe("piece_unit");
    expect(result.reply).toMatch(/Are you shipping pallets or pieces\?/);
    expect(presentAgentReply(result, true)).toMatch(/pallets or pieces/i);
  });

  it("after pallets, asks how many pallets and stores the unit", () => {
    const session = zippedSession("pallets-then-count");
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, "pallets");
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.session.sheet.freight.pieces).toBeNull();
    expect(result.session.awaiting).toBe("pieces");
    expect(result.reply).toMatch(/How many pallets\?/);
    expect(presentAgentReply(result, true)).toMatch(/How many pallets\?/);
  });

  it("after pieces, asks how many pieces", () => {
    const session = zippedSession("pieces-then-count");
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, "we're shipping pieces");
    expect(result.session.sheet.freight.piece_unit).toBe("pieces");
    expect(result.session.awaiting).toBe("pieces");
    expect(result.reply).toMatch(/How many pieces\?/);
  });

  it.each([
    ["skids", "pallets"],
    ["skid", "pallets"],
    ["pcs", "pieces"],
    ["boxes", "pieces"],
    ["crates", "pieces"],
    ["cartons", "pieces"],
  ])("maps %s to %s", (word, unit) => {
    const session = zippedSession(`syn-${word}`);
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, word);
    expect(result.session.sheet.freight.piece_unit).toBe(unit);
    expect(result.session.sheet.freight.pieces).toBeNull();
    expect(result.session.awaiting).toBe("pieces");
  });

  it("a bare count after the unit ask stores the integer and keeps the unit", () => {
    const session = zippedSession("count");
    session.sheet.freight.piece_unit = "pallets";
    session.awaiting = "pieces";
    const result = handleUtterance(session, "4");
    expect(result.session.sheet.freight.pieces).toBe(4);
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.session.awaiting).not.toBe("pieces");
    expect(result.session.awaiting).not.toBe("piece_unit");
  });

  it("combined utterances fill unit and count and skip the extra ask", () => {
    const cases = [
      ["3 pallets", 3, "pallets"],
      ["two skids", 2, "pallets"],
      ["5 pcs", 5, "pieces"],
      ["1 box", 1, "pieces"],
      ["four crates", 4, "pieces"],
      ["6 cartons", 6, "pieces"],
    ];
    for (const [text, count, unit] of cases) {
      const extracted = extractSlots(text, { awaiting: "piece_unit" });
      expect(extracted.freight.pieces, text).toBe(count);
      expect(extracted.freight.piece_unit, text).toBe(unit);

      const result = handleUtterance(zippedSession(`combo-${text}`), text);
      expect(result.session.sheet.freight.pieces, text).toBe(count);
      expect(result.session.sheet.freight.piece_unit, text).toBe(unit);
      expect(result.session.awaiting, text).not.toBe("piece_unit");
      expect(result.session.awaiting, text).not.toBe("pieces");
      expect(result.reply, text).not.toMatch(/How many (pallets|pieces)\?/);
      expect(result.reply, text).not.toMatch(/Are you shipping pallets or pieces/);
    }
  });
});
