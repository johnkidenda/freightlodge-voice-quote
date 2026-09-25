import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readClientUi } from "./client-ui.js";
import { createSession, handleUtterance, openingMessage } from "../src/lib/dialog.js";
import { CONVERSATIONAL_GREETING, presentAgentReply } from "../src/lib/conversational.js";
import { extractSlots } from "../src/lib/extract.js";
import { LIFTGATE_CHOICES } from "../src/lib/quick-replies.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";

/** Thu Sep 24 2026, local calendar. That is the America/Chicago date of the live call. */
const THU_SEP_24_2026 = new Date(2026, 8, 24, 20, 13, 0);

describe("repeated ZIP fragments keep the last full ZIP", () => {
  it("destination 300 then 30030 stores 30030 and does not flag the fragment", () => {
    const text = "full destination zip code is 300 full destination zip code is 30030";
    const extracted = extractSlots(text, { awaiting: "dest_zip", destCity: "Atlanta" });
    expect(extracted.destination.postal_code).toBe("30030");
    expect(extracted.flags.incompleteZip).toBeFalsy();
    expect(extracted.flags.incompleteZips).toBeFalsy();

    const session = createSession({ id: "frag-30030" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: "78721", country: "US" };
    session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: null, country: "US" };
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, text);
    expect(result.session.sheet.lanes.destination.postal_code).toBe("30030");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.sheet.freight.commodity).toBeFalsy();
    expect(result.reply).not.toMatch(/I heard 300\b/);
    expect(result.reply).not.toMatch(/only three digits/i);
    expect(result.reply).not.toMatch(/\bfull\b/i);

    const counted = handleUtterance(result.session, "2 pallets");
    const weighed = handleUtterance(counted.session, "500 pounds");
    expect(weighed.session.sheet.freight.commodity).toBeFalsy();
    expect(weighed.session.awaiting).toBe("commodity");
    expect(weighed.reply).toMatch(/What’s the commodity\?/);
  });
});

describe("both short ZIPs are one clarify turn", () => {
  it("flags origin 721 and destination 0030 together", () => {
    const text = "origin is 721 destination is 0030";
    const extracted = extractSlots(text, { awaiting: "origin_zip" });
    expect(extracted.origin.postal_code).toBeUndefined();
    expect(extracted.destination.postal_code).toBeUndefined();
    expect(extracted.flags.incompleteZips).toEqual([
      { digits: "721", role: "origin", labeled: true },
      { digits: "0030", role: "dest", labeled: true },
    ]);

    const session = createSession({ id: "both-short" });
    session.sheet.lanes.origin.city = "Austin";
    session.sheet.lanes.destination.city = "Atlanta";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, text);
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/721 for the origin/);
    expect(result.reply).toMatch(/0030 for the destination/);
    expect(result.reply).toMatch(/full 5-digit zip codes/);
    expect(result.reply).not.toMatch(/\u2014/);
    expect(presentAgentReply(result, true)).toBe(result.reply);
    expect((result.reply.match(/\?/g) || []).length).toBe(1);
  });
});

describe("ZIP confirm skips when the lookup city matches the stated city", () => {
  it("bare 30030 while origin is still Austin attaches to Atlanta without the destination confirm", () => {
    const session = createSession({ id: "atl-match" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: null, country: "US" };
    session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: null, country: "US" };
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "30030");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("30030");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.zipClarify).toBeFalsy();
    expect(result.reply).not.toBe("30030 looks like Atlanta. Is that the destination zip code?");
  });

  it("still confirms when the ZIP city does not match the stated city", () => {
    const session = createSession({ id: "atl-mismatch" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: "78721", country: "US" };
    session.sheet.lanes.destination = { city: "Dallas", state: "TX", postal_code: null, country: "US" };
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "30030");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/30030 looks like Atlanta/i);
  });

  it("still confirms a role guess when that slot has no city", () => {
    const session = createSession({ id: "no-city" });
    session.sheet.lanes.origin = { city: "Atlanta", state: "GA", postal_code: null, country: "US" };
    session.sheet.lanes.destination = { city: null, state: "TX", postal_code: null, country: "US" };
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/78721 looks like Austin/i);
    expect(result.reply).toMatch(/destination zip code/i);
  });
});

describe("ambiguous next weekday on Thu Sep 24 2026", () => {
  it("is a Thursday in the fixed local calendar", () => {
    expect(THU_SEP_24_2026.getFullYear()).toBe(2026);
    expect(THU_SEP_24_2026.getMonth()).toBe(8);
    expect(THU_SEP_24_2026.getDate()).toBe(24);
    expect(THU_SEP_24_2026.getDay()).toBe(4);
  });

  it("offers Friday Sep 25 or Friday Oct 2 for next Friday", () => {
    const extracted = extractSlots("next Friday", { now: THU_SEP_24_2026 });
    expect(extracted.pickup.date).toBeUndefined();
    expect(extracted.flags.ambiguousDate.soon).toBe("2026-09-25");
    expect(extracted.flags.ambiguousDate.later).toBe("2026-10-02");

    const session = createSession({ id: "next-fri" });
    session.sheet.lanes.origin.postal_code = "78721";
    session.sheet.lanes.destination.postal_code = "30030";
    session.sheet.freight.pieces = 2;
    session.sheet.freight.piece_unit = "pallets";
    session.sheet.freight.total_weight_lbs = 1000;
    session.sheet.freight.commodity = "oranges";
    session.awaiting = "pickup_date";
    const result = handleUtterance(session, "next Friday", { now: THU_SEP_24_2026 });
    expect(result.session.sheet.pickup.date).toBeNull();
    expect(result.reply).toBe("Friday Sep 25, or Friday Oct 2?");
    expect(result.reply).not.toMatch(/\u2014/);
    expect(presentAgentReply(result, true)).toBe(result.reply);

    const sooner = handleUtterance(result.session, "Friday Sep 25", { now: THU_SEP_24_2026 });
    expect(sooner.session.sheet.pickup.date).toBe("2026-09-25");

    const later = handleUtterance(result.session, "the later one", { now: THU_SEP_24_2026 });
    expect(later.session.sheet.pickup.date).toBe("2026-10-02");
  });

  it("keeps an unambiguous Friday and a far next Monday silent", () => {
    expect(extractSlots("Friday", { now: THU_SEP_24_2026 }).pickup.date).toBe("2026-09-25");
    expect(extractSlots("Friday", { now: THU_SEP_24_2026 }).flags.ambiguousDate).toBeUndefined();
    expect(extractSlots("next Monday", { now: THU_SEP_24_2026 }).pickup.date).toBe("2026-09-28");
    expect(extractSlots("tomorrow", { now: THU_SEP_24_2026 }).pickup.date).toBe("2026-09-25");
  });
});

describe("transcript snapshot fields", () => {
  it("includes commodity, pickup date, email, quote, and timestamps, with no Jev lines", () => {
    const session = createSession({ id: "snap-039" });
    session.sheet.freight.commodity = "orange juice";
    session.sheet.pickup.date = "2026-09-25";
    session.sheet.contact.email = "shipper@example.com";
    session.sheet.quote_result = { total_usd: 412.5, carrier: "Test" };
    const text = formatSessionTranscript(
      [
        { role: "assistant", text: "What’s the origin zip code?", at: "2026-09-25T01:12:00.000Z" },
        { role: "user", text: "78721", at: "2026-09-25T01:13:00.000Z" },
        { role: "assistant", text: "Destination?", at: "2026-09-25T01:13:04.000Z" },
        { role: "user", text: "shipper@example.com", at: "2026-09-25T01:14:00.000Z" },
      ],
      session,
    );
    expect(text).toContain("[2026-09-25T01:13:00Z] User: 78721");
    expect(text).toContain("[2026-09-25T01:14:00Z] User: shipper@example.com");
    expect(text).not.toMatch(/Jev mode:/);
    expect(text).not.toMatch(/^Jev:/m);
    expect(text).toContain("Commodity: orange juice");
    expect(text).toContain("Pickup date: 2026-09-25");
    expect(text).toContain("Email: shipper@example.com");
    expect(text).toContain("Quote: $412.50");
  });
});

describe("opening asks one question", () => {
  it("formal and conversational openings ask only for the origin zip code", () => {
    expect(openingMessage().match(/\?/g)).toHaveLength(1);
    expect(openingMessage()).toMatch(/What’s the origin zip code\?$/);
    expect(openingMessage()).not.toMatch(/Where are we picking up/);
    expect(CONVERSATIONAL_GREETING.match(/\?/g)).toHaveLength(1);
    expect(CONVERSATIONAL_GREETING).toMatch(/What’s the origin zip code\?$/);
    expect(CONVERSATIONAL_GREETING).not.toMatch(/Where are we picking up/);
  });
});

describe("liftgate choices", () => {
  it("Pickup, Delivery, Both, and No use the same answer path as voice", () => {
    expect(LIFTGATE_CHOICES.map((choice) => choice.label)).toEqual(["Pickup", "Delivery", "Both", "No"]);
    const ui = readClientUi();
    expect(ui).toContain("data-choice=");
    expect(ui).toContain("quick-reply");
    expect(ui).not.toContain('id="choice-row"');

    function liftSession() {
      const session = createSession({ id: "lift-choice" });
      session.sheet.lanes.origin.postal_code = "78721";
      session.sheet.lanes.destination.postal_code = "30030";
      session.sheet.freight.pieces = 1;
      session.sheet.freight.piece_unit = "pallets";
      session.sheet.freight.total_weight_lbs = 500;
      session.sheet.freight.commodity = "oranges";
      session.sheet.pickup.date = "2026-10-02";
      session.awaiting = "liftgate_side";
      session.accessorialClarify = { kind: "liftgate" };
      session.askedAccessorials = true;
      return session;
    }

    function expectSide(text, ids) {
      const result = handleUtterance(liftSession(), text);
      expect(result.session.sheet.pickup.accessorials, text).toEqual(expect.arrayContaining(ids));
      expect(result.session.sheet.pickup.accessorials, text).toHaveLength(ids.length);
      expect(result.session.awaiting, text).not.toBe("liftgate_side");
      expect(result.reply, text).not.toBe("Liftgate at pickup, delivery, or both?");
    }

    expectSide("pickup", ["liftgate_pickup"]);
    expectSide("Pickup", ["liftgate_pickup"]);
    expectSide("at pickup", ["liftgate_pickup"]);
    expectSide("delivery", ["liftgate_delivery"]);
    expectSide("Delivery", ["liftgate_delivery"]);
    expectSide("at delivery", ["liftgate_delivery"]);
    expectSide("both", ["liftgate_pickup", "liftgate_delivery"]);
    expectSide("Both", ["liftgate_pickup", "liftgate_delivery"]);
    expectSide("at both", ["liftgate_pickup", "liftgate_delivery"]);

    expectSide("Delivery", ["liftgate_delivery"]);
    expectSide("No", []);
  });
});

describe("worker base URL stays the live Jev host", () => {
  it("README still points at the freightlodge STT worker", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("https://freightlodge-stt-token.johnkidenda.workers.dev");
  });
});
