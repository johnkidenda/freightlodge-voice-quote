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

describe("v0.24 inside accessorial sticks (7af26cfd)", () => {
  it("bare inside / inside delivery / inside pickup park and do not re-ask extras", () => {
    for (const utterance of ["inside", "Inside", "inside.", "I need inside", "inside delivery", "inside pickup"]) {
      const extracted = extractSlots(utterance, { awaiting: "accessorials" });
      expect(extracted.pickup.accessorials?.length, utterance).toBeGreaterThan(0);
      if (/deliv/i.test(utterance)) {
        expect(extracted.pickup.accessorials, utterance).toContain("inside_delivery");
        expect(extracted.pickup.accessorials, utterance).not.toContain("inside_pickup");
      } else if (/pick/i.test(utterance)) {
        expect(extracted.pickup.accessorials, utterance).toContain("inside_pickup");
        expect(extracted.pickup.accessorials, utterance).not.toContain("inside_delivery");
      } else {
        expect(extracted.pickup.accessorials, utterance).toEqual(
          expect.arrayContaining(["inside_pickup", "inside_delivery"]),
        );
      }

      const result = handleUtterance(readyForAccessorials(`in-${utterance}`), utterance);
      expect(result.session.sheet.pickup.accessorials.length, utterance).toBeGreaterThan(0);
      expect(result.session.askedAccessorials, utterance).toBe(true);
      expect(result.session.awaiting, utterance).not.toBe("accessorials");
      expect(result.reply, utterance).not.toMatch(/Any (accessorials|extras)/i);
      expect(nextRequiredSlot(result.session.sheet, { askedAccessorials: result.session.askedAccessorials })).not.toBe(
        "accessorials",
      );
    }
  });

  it("saying inside twice keeps the accessorials and does not re-ask extras", () => {
    let result = handleUtterance(readyForAccessorials("in-twice"), "inside");
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(result.session.awaiting).toBe("email");
    result = handleUtterance(result.session, "inside");
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(result.session.askedAccessorials).toBe(true);
    expect(result.session.awaiting).not.toBe("accessorials");
    expect(result.reply).not.toMatch(/Any (accessorials|extras)/i);
    expect(result.reply).not.toMatch(/didn[’']t catch a new accessorials/i);
  });

  it("Jev does not re-ask extras after inside is parked", () => {
    const result = handleUtterance(readyForAccessorials("in-jev"), "inside", {
      jev: jevAccessorialsClarify(),
    });
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(result.jev.needsClarify).toBe(false);
    expect(result.jev.focus).toBeNull();
    expect(result.session.awaiting).toBe("email");
    expect(result.reply).not.toMatch(/double-check accessorials|Any (accessorials|extras)/i);
    expect(result.session.jevLog.at(-1)).toMatch(/Jev: on /);
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
    let result = handleUtterance(readyForAccessorials("lg-1"), "inside");
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    result = handleUtterance(result.session, "liftgate");
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_pickup");
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(result.session.awaiting).toBe("liftgate_side");
    expect(result.reply).toMatch(/pickup, delivery, or both/i);
    expect(result.reply).not.toMatch(/Any (accessorials|extras)/i);
    expect(result.reply).not.toMatch(/\u2014/);

    const pickup = handleUtterance(result.session, "pickup");
    expect(pickup.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery", "liftgate_pickup"]),
    );
    expect(pickup.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(pickup.session.awaiting).toBe("email");
    expect(pickup.session.accessorialClarify).toBeNull();
  });

  it("same-turn inside and liftgate accumulates inside and still clarifies liftgate", () => {
    const result = handleUtterance(readyForAccessorials("lg-same"), "inside and liftgate");
    expect(result.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["inside_pickup", "inside_delivery"]),
    );
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_pickup");
    expect(result.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(result.session.awaiting).toBe("liftgate_side");
    const both = handleUtterance(result.session, "both");
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
    expect(rejected.reply).not.toMatch(/origin ZIP|still need ZIP/i);
    expect(rejected.reply).toMatch(/destination ZIP/i);
    expect(presentAgentReply(rejected, true)).not.toMatch(/origin ZIP|still need ZIP/i);
    expect(presentAgentReply(rejected, true)).toMatch(/destination ZIP/i);
  });
});
