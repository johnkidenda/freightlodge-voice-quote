import { describe, expect, it } from "vitest";
import { extractSlots } from "../src/lib/extract.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { nextRequiredSlot } from "../src/lib/completeness.js";
import { normalizeJevDecision } from "../src/lib/jev-core.js";
import { presentAgentReply } from "../src/lib/conversational.js";

function readyForAccessorials(id = "acc") {
  const session = createSession({ id });
  session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: "78721", country: "US" };
  session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: "30301", country: "US" };
  session.sheet.freight.pieces = 3;
  session.sheet.freight.total_weight_lbs = 1000;
  session.sheet.freight.commodity = "oranges";
  session.sheet.pickup.date = "2026-09-20";
  session.sheet.pickup.accessorials = [];
  session.awaiting = "accessorials";
  session.askedAccessorials = false;
  return session;
}

function jevAccessorialsClarify() {
  return normalizeJevDecision({
    on: true,
    ready: false,
    needsClarify: true,
    focus: "accessorials",
    touchedSlots: ["accessorials"],
    readyNoul: 0.1,
    clarifyNoul: 0.8,
  });
}

describe("inside without a side asks which end", () => {
  it("bare inside does not fill both ends", () => {
    for (const utterance of ["inside", "Inside", "inside.", "I need inside"]) {
      const extracted = extractSlots(utterance, { awaiting: "accessorials" });
      expect(extracted.pickup.accessorials || [], utterance).toEqual([]);
      expect(extracted.flags.ambiguousInside, utterance).toBe(true);
      const result = handleUtterance(readyForAccessorials(`in-${utterance}`), utterance);
      expect(result.session.sheet.pickup.accessorials, utterance).toEqual([]);
      expect(result.session.awaiting, utterance).toBe("inside_side");
      expect(result.reply, utterance).toBe("Inside pickup, inside delivery, or both?");
      expect(result.reply, utterance).not.toMatch(/\u2014/);
      expect(result.reply, utterance).not.toMatch(/Any (accessorials|extras)/i);
      expect(presentAgentReply(result, true)).toBe("Inside pickup, inside delivery, or both?");
    }
  });

  it.each([
    ["pickup", ["inside_pickup"]],
    ["delivery", ["inside_delivery"]],
    ["both", ["inside_pickup", "inside_delivery"]],
    ["both ends", ["inside_pickup", "inside_delivery"]],
    ["origin", ["inside_pickup"]],
    ["destination", ["inside_delivery"]],
  ])("answer %s fills %j and moves on", (answer, ids) => {
    const asked = handleUtterance(readyForAccessorials(`side-${answer}`), "inside");
    const result = handleUtterance(asked.session, answer);
    expect(result.session.sheet.pickup.accessorials).toEqual(expect.arrayContaining(ids));
    expect(result.session.sheet.pickup.accessorials).toHaveLength(ids.length);
    expect(result.session.awaiting).toBe("email");
    expect(result.session.accessorialClarify).toBeNull();
    expect(result.reply).not.toMatch(/Inside pickup, inside delivery/);
  });

  it("explicit inside delivery / pickup / both fill directly", () => {
    const cases = [
      ["inside delivery", ["inside_delivery"]],
      ["inside pickup", ["inside_pickup"]],
      ["inside both", ["inside_pickup", "inside_delivery"]],
      ["inside origin", ["inside_pickup"]],
      ["inside destination", ["inside_delivery"]],
    ];
    for (const [utterance, ids] of cases) {
      const extracted = extractSlots(utterance, { awaiting: "accessorials" });
      expect(extracted.flags.ambiguousInside, utterance).toBeFalsy();
      expect(extracted.pickup.accessorials, utterance).toEqual(expect.arrayContaining(ids));
      const result = handleUtterance(readyForAccessorials(`direct-${utterance}`), utterance);
      expect(result.session.sheet.pickup.accessorials, utterance).toEqual(expect.arrayContaining(ids));
      expect(result.session.sheet.pickup.accessorials, utterance).toHaveLength(ids.length);
      expect(result.session.awaiting, utterance).toBe("email");
      expect(result.reply, utterance).not.toMatch(/Inside pickup, inside delivery/);
      expect(nextRequiredSlot(result.session.sheet, { askedAccessorials: true })).not.toBe("accessorials");
    }
  });

  it("saying inside again still asks which side", () => {
    let result = handleUtterance(readyForAccessorials("in-twice"), "inside");
    expect(result.session.awaiting).toBe("inside_side");
    result = handleUtterance(result.session, "inside");
    expect(result.session.sheet.pickup.accessorials).toEqual([]);
    expect(result.session.awaiting).toBe("inside_side");
    expect(result.reply).toBe("Inside pickup, inside delivery, or both?");
    expect(result.reply).not.toMatch(/didn[’']t catch a new accessorials/i);
  });

  it("asks which side even when Jev wants a generic accessorials clarify", () => {
    const result = handleUtterance(readyForAccessorials("in-jev"), "inside", {
      jev: jevAccessorialsClarify(),
    });
    expect(result.session.sheet.pickup.accessorials).toEqual([]);
    expect(result.session.awaiting).toBe("inside_side");
    expect(result.reply).toBe("Inside pickup, inside delivery, or both?");
    expect(result.reply).not.toMatch(/double-check accessorials|Any (accessorials|extras)/i);
    const parked = handleUtterance(result.session, "delivery");
    expect(parked.session.sheet.pickup.accessorials).toEqual(["inside_delivery"]);
    expect(parked.session.awaiting).toBe("email");
    expect(parked.reply).not.toMatch(/double-check accessorials|Any (accessorials|extras)/i);
  });
});

describe("v0.24 liftgate clarifies side without wiping inside (7af26cfd)", () => {
  it("bare liftgate does not park both sides", () => {
    const extracted = extractSlots("liftgate", { awaiting: "accessorials" });
    expect(extracted.pickup.accessorials || []).toEqual([]);
    expect(extracted.flags.ambiguousLiftgate).toBe(true);
    expect(extractSlots("liftgate pickup", { awaiting: "accessorials" }).pickup.accessorials).toEqual([
      "liftgate_pickup",
    ]);
    expect(extractSlots("liftgate delivery", { awaiting: "accessorials" }).pickup.accessorials).toEqual([
      "liftgate_delivery",
    ]);
  });

  it("inside then liftgate keeps inside and asks pickup vs delivery", () => {
    let result = handleUtterance(readyForAccessorials("lg-1"), "inside delivery");
    expect(result.session.sheet.pickup.accessorials).toEqual(["inside_delivery"]);
    result = handleUtterance(result.session, "liftgate");
    expect(result.session.sheet.pickup.accessorials).toEqual(["inside_delivery"]);
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_pickup");
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(result.session.awaiting).toBe("liftgate_side");
    expect(result.reply).toMatch(/pickup, delivery, or both/i);
    expect(result.reply).not.toMatch(/Any (accessorials|extras)/i);
    expect(result.reply).not.toMatch(/\u2014/);

    const pickup = handleUtterance(result.session, "pickup");
    expect(pickup.session.sheet.pickup.accessorials).toEqual(["inside_delivery", "liftgate_pickup"]);
    expect(pickup.session.sheet.pickup.accessorials).not.toContain("inside_pickup");
    expect(pickup.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(pickup.session.awaiting).toBe("email");
    expect(pickup.session.accessorialClarify).toBeNull();
  });

  it("same-turn inside and liftgate asks inside first, then liftgate", () => {
    const result = handleUtterance(readyForAccessorials("lg-same"), "inside and liftgate");
    expect(result.session.sheet.pickup.accessorials).toEqual([]);
    expect(result.session.awaiting).toBe("inside_side");
    expect(result.reply).toBe("Inside pickup, inside delivery, or both?");
    const insides = handleUtterance(result.session, "both");
    expect(insides.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(insides.session.sheet.pickup.accessorials).not.toContain("liftgate_pickup");
    expect(insides.session.awaiting).toBe("liftgate_side");
    const both = handleUtterance(insides.session, "both");
    expect(both.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery", "liftgate_pickup", "liftgate_delivery"]),
    );
  });
});

describe("v0.24 partial ZIP dump retains the valid ZIP (7af26cfd)", () => {
  it("origin 78721 and dest 10010 parks 78721 after dest mismatch", () => {
    let session = createSession({ id: "zip-dump" });
    session = handleUtterance(
      session,
      "ship a thousand pounds of oranges from Austin to Atlanta",
    ).session;
    expect(session.sheet.lanes.origin.city).toBe("Austin");
    expect(session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(session.awaiting).toBe("origin_zip");

    const dumped = handleUtterance(session, "origin 78721 and dest 10010");
    expect(dumped.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(dumped.session.sheet.lanes.origin.city).toBe("Austin");
    expect(dumped.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(dumped.session.awaiting).toBe("dest_zip");
    expect(dumped.session.awaiting).not.toBe("origin_zip");
    expect(dumped.reply).toMatch(/10010|New York|Atlanta/i);
    expect(dumped.reply).not.toMatch(/origin ZIP/i);

    const rejected = handleUtterance(dumped.session, "Atlanta");
    expect(rejected.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(rejected.session.sheet.lanes.origin.city).toBe("Austin");
    expect(rejected.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(rejected.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(rejected.session.awaiting).toBe("dest_zip");
    expect(rejected.reply).not.toMatch(/origin zip(?! code)|still need zip(?! code)/i);
    expect(rejected.reply).toMatch(/destination zip code/i);
    expect(presentAgentReply(rejected, true)).not.toMatch(/origin zip(?! code)|still need zip(?! code)/i);
    expect(presentAgentReply(rejected, true)).toMatch(/destination ZIP/i);
  });
});
