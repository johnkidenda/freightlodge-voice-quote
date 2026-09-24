import { describe, expect, it } from "vitest";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { extractSlots } from "../src/lib/extract.js";
import { presentAgentReply } from "../src/lib/conversational.js";

const PAIRS = ["60601 to 75201", "from 60601 to 75201", "origin 60601 dest 75201", "60601 75201"];

describe("dual ZIP while awaiting one ZIP slot", () => {
  it.each(PAIRS)("extracts both ends from %s while awaiting origin_zip", (text) => {
    const extracted = extractSlots(text, { awaiting: "origin_zip" });
    expect(extracted.origin.postal_code).toBe("60601");
    expect(extracted.destination.postal_code).toBe("75201");
  });

  it.each(PAIRS)("extracts both ends from %s while awaiting dest_zip", (text) => {
    const extracted = extractSlots(text, { awaiting: "dest_zip" });
    expect(extracted.origin.postal_code).toBe("60601");
    expect(extracted.destination.postal_code).toBe("75201");
  });

  it.each(PAIRS)("dialog parks both ZIPs from %s while awaiting origin_zip", (text) => {
    const session = createSession({ id: `dual-o-${text}` });
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, text);
    expect(result.session.sheet.lanes.origin.postal_code).toBe("60601");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("75201");
    expect(result.session.zipClarify).toBeFalsy();
    expect(result.reply).not.toMatch(/same ZIP both ends/i);
  });

  it.each(PAIRS)("dialog parks both ZIPs from %s while awaiting dest_zip and origin is empty", (text) => {
    const session = createSession({ id: `dual-d-${text}` });
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, text);
    expect(result.session.sheet.lanes.origin.postal_code).toBe("60601");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("75201");
  });

  it("keeps a parked origin and fills dest from a from/to pair", () => {
    const session = createSession({ id: "dual-parked" });
    session.sheet.lanes.origin.postal_code = "60601";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "from 60601 to 75201");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("60601");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("75201");
  });

  it("a single ZIP still fills only the awaited side", () => {
    const origin = extractSlots("60601", { awaiting: "origin_zip" });
    expect(origin.origin.postal_code).toBe("60601");
    expect(origin.destination.postal_code).toBeUndefined();

    const dest = extractSlots("75201", { awaiting: "dest_zip" });
    expect(dest.destination.postal_code).toBe("75201");
    expect(dest.origin.postal_code).toBeUndefined();
  });

  it.each([
    "origin zip is 60601 and destination zip is 75201",
    "origin zip 60601 destination zip 75201",
    "pickup zip is 60601 and delivery zip is 75201",
  ])("labeled pair %s fills both slots", (text) => {
    for (const awaiting of ["origin_zip", "dest_zip"]) {
      const extracted = extractSlots(text, { awaiting });
      expect(extracted.origin.postal_code, `${awaiting} ${text}`).toBe("60601");
      expect(extracted.destination.postal_code, `${awaiting} ${text}`).toBe("75201");
      const session = createSession({ id: `pair-${awaiting}-${text}` });
      session.awaiting = awaiting;
      const result = handleUtterance(session, text);
      expect(result.session.sheet.lanes.origin.postal_code, text).toBe("60601");
      expect(result.session.sheet.lanes.destination.postal_code, text).toBe("75201");
      expect(result.reply, text).not.toMatch(/only (three|four) digits/i);
    }
  });

  it("keeps a valid origin and says why the 4-digit destination was not stored", () => {
    const session = createSession({ id: "short-dest" });
    session.sheet.lanes.origin.city = "Austin";
    session.sheet.lanes.destination.city = "Atlanta";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "origin zip is 78721 and destination zip is 3030");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.awaiting).toBe("dest_zip");
    expect(result.reply).toBe(
      "I heard 3030 for the destination, which is only four digits. What’s the full ZIP?",
    );
    expect(result.reply).not.toMatch(/\u2014/);
    expect(presentAgentReply(result, true)).toBe(result.reply);
  });

  it("keeps a valid destination and asks for the short origin", () => {
    const session = createSession({ id: "short-origin" });
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "origin zip is 7872 and destination zip is 30030");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("30030");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("origin_zip");
    expect(result.reply).toBe(
      "I heard 7872 for the origin, which is only four digits. What’s the full ZIP?",
    );
  });

  it("keeps the 5-digit side of a from/to pair", () => {
    const session = createSession({ id: "short-from-to" });
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "from 78721 to 3030");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/I heard 3030 for the destination, which is only four digits/);
  });

  it("does not treat an or-choice as two lane ends", () => {
    const extracted = extractSlots("dest zip 30301 or 78721", { awaiting: "dest_zip" });
    expect(extracted.origin.postal_code).not.toBe("30301");
    expect(extracted.destination.postal_code).not.toBe("78721");
  });
});
