import { describe, expect, it } from "vitest";
import { extractSlots } from "../src/lib/extract.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

const LABELED = "Origin Austin destination Atlanta commodity oranges weight 1000 pounds";

describe("stiff labeled field dumps", () => {
  it("parks origin, dest, commodity, and weight from label order", () => {
    const extracted = extractSlots(LABELED, { awaiting: "origin_zip" });
    expect(extracted.origin.city).toBe("Austin");
    expect(extracted.destination.city).toBe("Atlanta");
    expect(extracted.freight.commodity).toMatch(/orange/i);
    expect(extracted.freight.total_weight_lbs).toBe(1000);
    expect(extracted.origin.postal_code).toBeUndefined();
    expect(extracted.destination.postal_code).toBeUndefined();
  });

  it("asks only for the missing origin zip code", () => {
    const result = handleUtterance(createSession({ id: "labeled-dump" }), LABELED);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.awaiting).toBe("origin_zip");
    expect(result.reply).toMatch(/origin zip code/i);
    expect(result.reply).toMatch(/Atlanta/);
    expect(result.reply).not.toMatch(/where is this going/i);
    expect(result.reply).not.toMatch(/What’s the commodity/i);
  });

  it("keeps cities when destination is labeled before origin", () => {
    const text = "Destination Atlanta Origin Austin commodity oranges weight 1000 pounds";
    const result = handleUtterance(createSession({ id: "labeled-flip" }), text);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.awaiting).toBe("origin_zip");
    expect(result.reply).not.toMatch(/where is this going/i);
  });

  it("parks cities when weight is stated before the lane", () => {
    const text = "weight 1000 pounds Destination Atlanta origin Austin commodity oranges";
    const result = handleUtterance(createSession({ id: "labeled-weight-first" }), text);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.awaiting).toBe("origin_zip");
  });

  it("also fills pieces, class, dims, and email when those labels are present", () => {
    const text =
      "pickup Austin dest Chicago pieces 4 class 70 dims 48 x 40 x 36 email ops@example.com weight 800 pounds";
    const result = handleUtterance(createSession({ id: "labeled-more" }), text);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Chicago");
    expect(result.session.sheet.freight.pieces).toBe(4);
    expect(result.session.sheet.freight.piece_unit).toBe("pieces");
    expect(result.session.sheet.freight.freight_class).toBe("70");
    expect(result.session.sheet.freight.dims).toEqual({
      length_in: 48,
      width_in: 40,
      height_in: 36,
      per_piece: true,
    });
    expect(result.session.sheet.contact.email).toBe("ops@example.com");
    expect(result.session.sheet.freight.total_weight_lbs).toBe(800);
    expect(result.session.awaiting).toBe("origin_zip");
  });
});
