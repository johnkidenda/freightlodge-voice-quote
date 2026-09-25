import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readClientUi } from "./client-ui.js";
import { createSession, handleUtterance, openingMessage } from "../src/lib/dialog.js";
import { CONVERSATIONAL_GREETING, presentAgentReply } from "../src/lib/conversational.js";
import { extractSlots } from "../src/lib/extract.js";
import { formatJevStamp, guardJevDecision, normalizeJevDecision } from "../src/lib/jev-core.js";
import { createNoInputWatch, NO_INPUT_WINDOW_MS } from "../src/lib/no-input.js";
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
    expect(result.reply).not.toMatch(/I heard 300\b/);
    expect(result.reply).not.toMatch(/only three digits/i);
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
  it("30030 on a stated Atlanta destination does not ask for confirmation", () => {
    const session = createSession({ id: "atl-match" });
    session.sheet.lanes.origin = { city: "Austin", state: "TX", postal_code: null, country: "US" };
    session.sheet.lanes.destination = { city: "Atlanta", state: "GA", postal_code: null, country: "US" };
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "30030");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("30030");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.reply).not.toMatch(/looks like Atlanta/i);
    expect(result.session.zipClarify).toBeFalsy();
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

describe("transcript snapshot fields and every Jev turn", () => {
  it("includes commodity, pickup date, email, quote, timestamps, and both Jev stamps", () => {
    const session = createSession({ id: "snap-039" });
    session.jevEnabled = true;
    session.sheet.freight.commodity = "orange juice";
    session.sheet.pickup.date = "2026-09-25";
    session.sheet.contact.email = "shipper@example.com";
    session.sheet.quote_result = { total_usd: 412.5, carrier: "Test" };
    session.jevLog = [
      "Jev: on ready=0.40 clarify=0.10 slots=origin_zip gate=not-ready",
      "Jev: on ready=0.03 clarify=0.18 slots=email gate=not-ready",
    ];
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
    expect(text).toContain("Jev: on ready=0.40 clarify=0.10 slots=origin_zip gate=not-ready");
    expect(text).toContain("Jev: on ready=0.03 clarify=0.18 slots=email gate=not-ready");
    expect(text).toContain("Jev mode: on");
    expect(text).toContain("Commodity: orange juice");
    expect(text).toContain("Pickup date: 2026-09-25");
    expect(text).toContain("Email: shipper@example.com");
    expect(text).toContain("Quote: $412.50");
  });
});

describe("low ready does not advance unless the sheet is complete", () => {
  it("stamps gate=not-ready at ready=0.03 when email is still the open slot", () => {
    const sheet = {
      schema_version: "1.0",
      lanes: {
        origin: { postal_code: "78721" },
        destination: { postal_code: "30030" },
      },
      freight: { pieces: 2, total_weight_lbs: 1000, commodity: "oranges" },
      pickup: { date: "2026-09-25", accessorials: [] },
      contact: { email: null },
    };
    const jev = normalizeJevDecision({
      on: true,
      ready: false,
      needsClarify: false,
      readyNoul: 0.03,
      clarifyNoul: 0.18,
      touchedSlots: ["email"],
      primarySlot: "email",
    });
    const guarded = guardJevDecision(jev, { sheet, utterance: "not an email yet" });
    expect(guarded.ready).toBe(false);
    expect(guarded.gateOverride).toBeNull();
    const stamp = formatJevStamp(guarded);
    expect(stamp).toContain("ready=0.03");
    expect(stamp).toContain("clarify=0.18");
    expect(stamp).toContain("slots=email");
    expect(stamp).toContain("gate=not-ready");
    expect(stamp).not.toContain("gate=advance");
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

describe("liftgate choices and post-speech no-input window", () => {
  it("Pickup, Delivery, and Both use the same answer path as voice", () => {
    const ui = readClientUi();
    expect(ui).toContain('data-choice="pickup"');
    expect(ui).toContain('data-choice="delivery"');
    expect(ui).toContain('data-choice="both"');
    expect(ui).toContain(">Pickup<");
    expect(ui).toContain(">Delivery<");
    expect(ui).toContain(">Both<");

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

    const pickup = handleUtterance(liftSession(), "pickup");
    expect(pickup.session.sheet.pickup.accessorials).toContain("liftgate_pickup");
    expect(pickup.session.sheet.pickup.accessorials).not.toContain("liftgate_delivery");
    expect(pickup.session.awaiting).not.toBe("liftgate_side");

    const both = handleUtterance(liftSession(), "both");
    expect(both.session.sheet.pickup.accessorials).toEqual(
      expect.arrayContaining(["liftgate_pickup", "liftgate_delivery"]),
    );
  });

  it("does not reprompt until the full window after speech ends, and a new ask resets the timer", () => {
    expect(NO_INPUT_WINDOW_MS).toBeGreaterThan(0);
    let t = 0;
    const timers = [];
    const fires = [];
    const watch = createNoInputWatch({
      now: () => t,
      schedule: (fn, ms) => {
        const id = timers.length + 1;
        timers.push({ id, fn, ms });
        return id;
      },
      unschedule: (id) => {
        const i = timers.findIndex((timer) => timer.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
      onReprompt: () => fires.push(t),
    });

    watch.onNewAsk();
    watch.onSpeakingChange(true);
    watch.onEmptyListen();
    expect(fires).toEqual([]);
    expect(timers).toHaveLength(0);

    t = 4000;
    watch.onSpeakingChange(false);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(NO_INPUT_WINDOW_MS);
    const early = timers[0];
    watch.onNewAsk();
    expect(timers).toHaveLength(0);
    early.fn();
    expect(fires).toEqual([]);

    watch.onSpeakingChange(true);
    watch.onEmptyListen();
    t = 9000;
    watch.onSpeakingChange(false);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(NO_INPUT_WINDOW_MS);
    watch.onUserActivity();
    expect(timers).toHaveLength(0);
    expect(fires).toEqual([]);
  });
});

describe("worker base URL stays the live Jev host", () => {
  it("README still points at the freightlodge STT worker", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("https://freightlodge-stt-token.johnkidenda.workers.dev");
  });
});
