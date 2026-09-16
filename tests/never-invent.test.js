import { describe, expect, it } from "vitest";
import { emptySheet } from "../src/lib/sheet.js";
import { extractSlots, mergeExtracted } from "../src/lib/extract.js";
import { handleUtterance, createSession } from "../src/lib/dialog.js";
import { detectOutOfScope } from "../src/lib/scope.js";

describe("never invent ZIPs, dims, weights, or class", () => {
  it("does not invent ZIPs from city names", () => {
    const extracted = extractSlots("Ship from Chicago to Dallas");
    expect(extracted.origin.postal_code).toBeUndefined();
    expect(extracted.destination.postal_code).toBeUndefined();
    expect(extracted.origin.city).toBe("Chicago");
    expect(extracted.destination.city).toBe("Dallas");

    const sheet = mergeExtracted(emptySheet(), extracted);
    expect(sheet.lanes.origin.postal_code).toBeNull();
    expect(sheet.lanes.destination.postal_code).toBeNull();
  });

  it("does not invent weight, dims, or class from commodity or pallet count", () => {
    const extracted = extractSlots("3 pallets of machinery");
    expect(extracted.freight.pieces).toBe(3);
    expect(extracted.freight.commodity).toMatch(/machinery/i);
    expect(extracted.freight.total_weight_lbs).toBeUndefined();
    expect(extracted.freight.dims).toBeUndefined();
    expect(extracted.freight.freight_class).toBeUndefined();

    const sheet = mergeExtracted(emptySheet(), extracted);
    expect(sheet.freight.total_weight_lbs).toBeNull();
    expect(sheet.freight.dims).toBeNull();
    expect(sheet.freight.freight_class).toBeNull();
  });

  it("does not invent a class from 'standard class' or 'whatever class'", () => {
    const extracted = extractSlots("just use standard class");
    expect(extracted.freight.freight_class).toBeUndefined();
    expect(extracted.flags.vagueMeasure).toBe(true);
  });

  it("does not invent a weight from vague amounts", () => {
    const extracted = extractSlots("about a few hundred pounds of furniture");
    expect(extracted.freight.total_weight_lbs).toBeUndefined();
  });

  it("only records an explicit NMFC class", () => {
    const extracted = extractSlots("freight class 70");
    expect(extracted.freight.freight_class).toBe("70");
    const bad = extractSlots("class 12");
    expect(bad.freight.freight_class).toBeUndefined();
  });

  it("only records complete L×W×H, never a single side as dims", () => {
    const full = extractSlots("48 x 40 x 48 inches");
    expect(full.freight.dims).toEqual({
      length_in: 48,
      width_in: 40,
      height_in: 48,
      per_piece: true,
    });
    const partial = extractSlots("they are 48 inches long");
    expect(partial.freight.dims).toBeUndefined();
  });

  it("dialog keeps asking for ZIP instead of filling one", () => {
    let session = createSession({ id: "ni-1" });
    const result = handleUtterance(session, "from Chicago to Dallas");
    session = result.session;
    expect(session.sheet.lanes.origin.postal_code).toBeNull();
    expect(session.sheet.lanes.destination.postal_code).toBeNull();
    expect(session.sheet.status).toBe("collecting");
    expect(result.reply.toLowerCase()).toMatch(/zip/);
    expect(result.ready).toBe(false);
  });

  it("does not treat ASAP as a pickup date", () => {
    let session = createSession({ id: "ni-2" });
    session.sheet.lanes.origin.postal_code = "60601";
    session.sheet.lanes.destination.postal_code = "75201";
    session.sheet.freight.pieces = 2;
    session.sheet.freight.total_weight_lbs = 400;
    session.sheet.freight.commodity = "fixtures";
    session.awaiting = "pickup_date";
    const result = handleUtterance(session, "ASAP please");
    expect(result.session.sheet.pickup.date).toBeNull();
    expect(result.reply.toLowerCase()).toMatch(/date/);
  });
});

describe("out of scope is honest", () => {
  it("flags hard international and never sets a quote_result", () => {
    const scope = detectOutOfScope("Need ocean FCL from Shanghai to Long Beach", emptySheet());
    expect(scope.outOfScope).toBe(true);

    const result = handleUtterance(createSession({ id: "oos" }), "shipping to Toronto Canada");
    expect(result.outOfScope).toBe(true);
    expect(result.session.sheet.status).toBe("out_of_scope");
    expect(result.session.sheet.quote_result).toBeNull();
    expect(result.session.sheet.out_of_scope_reason).toBeTruthy();
    expect(result.reply.toLowerCase()).toMatch(/no fake rate/);
  });
});
