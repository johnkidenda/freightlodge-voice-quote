import { describe, expect, it } from "vitest";
import { createSession, formatSpokenDate, handleUtterance } from "../src/lib/dialog.js";
import { formatQuoteEmail, formatQuoteEmailHtml } from "../src/lib/email.js";
import {
  interpretPalletSize,
  PALLET_SIZE_CHOICES,
  palletDimsRecord,
} from "../src/lib/pallet-size.js";
import { PALLET_SIZE_CHOICES as replyChoices, SHIP_DAY_CHOICES, quickRepliesFor } from "../src/lib/quick-replies.js";
import { chicagoDateIso, nextBusinessDayIso, shipDayConfirmPrompt } from "../src/lib/ship-day.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";
import { quoteCard } from "../src/ui/quote-card.js";
import { presentAgentReply } from "../src/lib/conversational.js";

/** Wednesday Sep 30, 2026, 15:00 UTC is still Wednesday morning in Chicago. */
const WED_SEP_30 = new Date("2026-09-30T15:00:00.000Z");
/** Friday Sep 25, 2026, 23:00 America/Chicago (CDT) is Saturday 04:00 UTC. */
const FRI_11PM_CHICAGO = new Date("2026-09-26T04:00:00.000Z");

function chicago(isoHour) {
  return new Date(isoHour);
}

function zipped(id = "v042") {
  const session = createSession({ id, now: WED_SEP_30 });
  session.sheet.lanes.origin.postal_code = "60601";
  session.sheet.lanes.destination.postal_code = "75201";
  session.sheet.freight.piece_unit = "pallets";
  return session;
}

describe("v0.42 pallet size", () => {
  it("offers the three buttons and does not assume a size", () => {
    expect(PALLET_SIZE_CHOICES.map((choice) => choice.label)).toEqual(["48x40x48", "48x48x48", "Custom"]);
    expect(replyChoices).toBe(PALLET_SIZE_CHOICES);
    const session = zipped();
    session.awaiting = "pieces";
    const count = handleUtterance(session, "2", { now: WED_SEP_30 });
    expect(count.session.sheet.freight.pieces).toBe(2);
    expect(count.session.sheet.freight.dims).toBeNull();
    expect(count.session.awaiting).toBe("pallet_size");
    expect(count.reply).toMatch(/What size are the pallets\?/);
    expect(count.reply).not.toMatch(/assum|default|48 x 40/i);
    expect(count.ready).toBe(false);
    expect(quickRepliesFor(count).map((choice) => choice.label)).toEqual(["48x40x48", "48x48x48", "Custom"]);
    expect(presentAgentReply(count, true)).toMatch(/What size are the pallets\?/);
  });

  it("stores a tapped standard size and keeps going only after a choice", () => {
    let session = zipped("tap");
    session.sheet.freight.pieces = 2;
    session.awaiting = "pallet_size";
    const picked = handleUtterance(session, "48x40x48", { now: WED_SEP_30 });
    expect(picked.session.sheet.freight.dims).toEqual(
      palletDimsRecord({ l: 48, w: 40, h: 48, source: "button_48x40x48", choice: "48x40x48" }),
    );
    expect(picked.session.awaiting).toBe("measure");
    expect(picked.reply).toMatch(/total weight/i);

    const second = handleUtterance(
      { ...session, sheet: structuredClone(session.sheet) },
      "48x48x48",
      { now: WED_SEP_30 },
    );
    expect(second.session.sheet.freight.dims.source).toBe("button_48x48x48");
    expect(second.session.sheet.freight.dims.choice).toBe("48x48x48");
    expect(second.session.sheet.freight.dims).toMatchObject({ l: 48, w: 48, h: 48, unit: "in" });
  });

  it("accepts spoken sizes, ordinals, and custom dimensions", () => {
    const session = zipped("voice");
    session.sheet.freight.pieces = 2;
    session.awaiting = "pallet_size";
    const spoken = handleUtterance(session, "forty eight by forty by forty eight", { now: WED_SEP_30 });
    expect(spoken.session.sheet.freight.dims).toMatchObject({
      l: 48,
      w: 40,
      h: 48,
      unit: "in",
      source: "voice",
      choice: "48x40x48",
    });

    const by = handleUtterance(
      { ...session, sheet: structuredClone(session.sheet) },
      "48 by 48 by 48",
      { now: WED_SEP_30 },
    );
    expect(by.session.sheet.freight.dims).toMatchObject({
      l: 48,
      w: 48,
      h: 48,
      source: "voice",
      choice: "48x48x48",
    });

    const first = handleUtterance(
      { ...session, sheet: structuredClone(session.sheet) },
      "first one",
      { now: WED_SEP_30 },
    );
    expect(first.session.sheet.freight.dims).toMatchObject({ source: "voice", choice: "48x40x48", l: 48, w: 40, h: 48 });
    const second = interpretPalletSize("second one");
    expect(second).toMatchObject({ source: "voice", choice: "48x48x48", l: 48, w: 48, h: 48 });

    const custom = handleUtterance(
      { ...session, sheet: structuredClone(session.sheet) },
      "custom",
      { now: WED_SEP_30 },
    );
    expect(custom.session.awaiting).toBe("pallet_size");
    expect(custom.session.palletSizePhase).toBe("custom");
    expect(custom.session.sheet.freight.dims).toBeNull();
    expect(custom.reply).toMatch(/length, width, and height in inches/i);
    expect(quickRepliesFor(custom)).toBeNull();

    const together = handleUtterance(custom.session, "40 by 42 by 36", { now: WED_SEP_30 });
    expect(together.session.sheet.freight.dims).toMatchObject({
      l: 40,
      w: 42,
      h: 36,
      source: "custom",
      choice: "custom",
      unit: "in",
    });

    const stepped = handleUtterance(custom.session, "40", { now: WED_SEP_30 });
    expect(stepped.reply).toMatch(/width in inches/i);
    const width = handleUtterance(stepped.session, "42", { now: WED_SEP_30 });
    expect(width.reply).toMatch(/height in inches/i);
    const height = handleUtterance(width.session, "36", { now: WED_SEP_30 });
    expect(height.session.sheet.freight.dims).toMatchObject({ l: 40, w: 42, h: 36, source: "custom", choice: "custom" });
  });

  it("re-asks when a side is outside 1 to 120 and does not store it", () => {
    const session = zipped("bad");
    session.sheet.freight.pieces = 1;
    session.awaiting = "pallet_size";
    const bad = handleUtterance(session, "200 by 40 by 48", { now: WED_SEP_30 });
    expect(bad.session.sheet.freight.dims).toBeNull();
    expect(bad.session.awaiting).toBe("pallet_size");
    expect(bad.reply).toMatch(/1 to 120/);
    expect(bad.reply).toMatch(/length, width, and height/i);

    const zero = handleUtterance(session, "custom", { now: WED_SEP_30 });
    const again = handleUtterance(zero.session, "0 by 40 by 48", { now: WED_SEP_30 });
    expect(again.session.sheet.freight.dims).toBeNull();
    expect(again.reply).toMatch(/1 to 120/);
  });

  it("does not ask for a size on pieces, and still asks weight after a pallet size", () => {
    const pieces = zipped("boxes");
    pieces.sheet.freight.piece_unit = "pieces";
    pieces.awaiting = "pieces";
    const count = handleUtterance(pieces, "4", { now: WED_SEP_30 });
    expect(count.session.awaiting).toBe("measure");
    expect(count.reply).toMatch(/weight/i);
    expect(count.reply).not.toMatch(/What size are the pallets/);
  });

  it("shows the size on the quote card, transcript, and both email bodies", () => {
    const sheet = {
      status: "quoted",
      quote_request_id: "req-size",
      lanes: {
        origin: { city: "Chicago", state: "IL", postal_code: "60601" },
        destination: { city: "Dallas", state: "TX", postal_code: "75201" },
      },
      freight: {
        pieces: 2,
        piece_unit: "pallets",
        total_weight_lbs: 800,
        commodity: "oranges",
        dims: palletDimsRecord({ l: 48, w: 40, h: 48, source: "button_48x40x48", choice: "48x40x48" }),
      },
      pickup: { date: "2026-10-01" },
      contact: { email: "shipper@example.com" },
      quote_result: {
        quote_id: "FL-1",
        carrier: "XPO Logistics",
        service: "LTL Economy",
        total_usd: 200,
        transit_days_min: 2,
        transit_days_max: 4,
      },
    };
    const line = "Pallet size: 48 x 40 x 48 in";
    expect(quoteCard(sheet, null, "estimate")).toContain(line);
    expect(quoteCard(sheet, null, "estimate")).toContain("Pickup: 2026-10-01");
    expect(quoteCard(sheet, null, "hidden")).toContain(line);
    expect(formatQuoteEmail(sheet).body).toContain(line);
    expect(formatQuoteEmail(sheet).body).toContain("Pickup: 2026-10-01");
    expect(formatQuoteEmailHtml(sheet).html).toContain("48 x 40 x 48 in");
    expect(formatQuoteEmailHtml(sheet).html).toContain("Pallet size");
    const transcript = formatSessionTranscript([], { sheet, awaiting: null });
    expect(transcript).toContain(line);
  });
});

describe("v0.42 ship day", () => {
  it("rolls Mon-Thu, Friday, Saturday, and Sunday onto the next business day", () => {
    expect(nextBusinessDayIso(chicago("2026-09-28T15:00:00.000Z"))).toBe("2026-09-29");
    expect(nextBusinessDayIso(chicago("2026-09-29T15:00:00.000Z"))).toBe("2026-09-30");
    expect(nextBusinessDayIso(chicago("2026-09-30T15:00:00.000Z"))).toBe("2026-10-01");
    expect(nextBusinessDayIso(chicago("2026-10-01T15:00:00.000Z"))).toBe("2026-10-02");
    expect(nextBusinessDayIso(chicago("2026-09-25T15:00:00.000Z"))).toBe("2026-09-28");
    expect(nextBusinessDayIso(chicago("2026-09-26T15:00:00.000Z"))).toBe("2026-09-28");
    expect(nextBusinessDayIso(chicago("2026-09-27T15:00:00.000Z"))).toBe("2026-09-28");
  });

  it("rolls the month and the year without holiday logic", () => {
    expect(chicagoDateIso(chicago("2026-08-31T20:00:00.000Z"))).toBe("2026-08-31");
    expect(nextBusinessDayIso(chicago("2026-08-31T20:00:00.000Z"))).toBe("2026-09-01");
    expect(chicagoDateIso(chicago("2026-12-31T21:00:00.000Z"))).toBe("2026-12-31");
    expect(nextBusinessDayIso(chicago("2026-12-31T21:00:00.000Z"))).toBe("2027-01-01");
    expect(nextBusinessDayIso(chicago("2027-01-01T21:00:00.000Z"))).toBe("2027-01-04");
  });

  it("uses Chicago when 11 PM Friday is already Saturday in UTC", () => {
    expect(FRI_11PM_CHICAGO.toISOString()).toBe("2026-09-26T04:00:00.000Z");
    expect(chicagoDateIso(FRI_11PM_CHICAGO)).toBe("2026-09-25");
    expect(nextBusinessDayIso(FRI_11PM_CHICAGO)).toBe("2026-09-28");
    const sundayNight = new Date("2026-09-28T04:00:00.000Z");
    expect(chicagoDateIso(sundayNight)).toBe("2026-09-27");
    expect(nextBusinessDayIso(sundayNight)).toBe("2026-09-28");
  });

  it("confirms the next business day and stores Yes as YYYY-MM-DD", () => {
    const session = zipped("ship");
    session.sheet.freight.pieces = 2;
    session.sheet.freight.dims = palletDimsRecord({
      l: 48,
      w: 40,
      h: 48,
      source: "button_48x40x48",
      choice: "48x40x48",
    });
    session.sheet.freight.total_weight_lbs = 800;
    session.sheet.freight.commodity = "oranges";
    session.awaiting = "commodity";
    const asked = handleUtterance(session, "oranges", { now: WED_SEP_30 });
    const spoken = formatSpokenDate("2026-10-01");
    expect(spoken).toBe("Thursday, October 1");
    expect(asked.reply).toBe(shipDayConfirmPrompt(spoken));
    expect(asked.reply).toBe("I can have it picked up Thursday, October 1. Does that work?");
    expect(asked.session.shipDayOffer).toBe("2026-10-01");
    expect(asked.session.sheet.pickup.date).toBeNull();
    expect(quickRepliesFor(asked).map((choice) => choice.label)).toEqual(["Yes", "Pick another day"]);
    expect(SHIP_DAY_CHOICES.map((choice) => choice.label)).toEqual(["Yes", "Pick another day"]);
    expect(presentAgentReply(asked, true)).toBe(asked.reply);

    const yes = handleUtterance(asked.session, "Yes", { now: WED_SEP_30 });
    expect(yes.session.sheet.pickup.date).toBe("2026-10-01");
    expect(yes.session.awaiting).toBe("accessorials");

    const voiceYes = handleUtterance(asked.session, "yeah that works", { now: WED_SEP_30 });
    expect(voiceYes.session.sheet.pickup.date).toBe("2026-10-01");
  });

  it("lets the user pick another day, reuses the date parser, and rejects past dates", () => {
    const session = zipped("other");
    session.sheet.freight.pieces = 2;
    session.sheet.freight.dims = palletDimsRecord({
      l: 48,
      w: 48,
      h: 48,
      source: "voice",
      choice: "48x48x48",
    });
    session.sheet.freight.total_weight_lbs = 500;
    session.sheet.freight.commodity = "oranges";
    session.awaiting = "pickup_date";
    session.shipDayOffer = "2026-10-01";
    const other = handleUtterance(session, "Pick another day", { now: WED_SEP_30 });
    expect(other.session.sheet.pickup.date).toBeNull();
    expect(other.session.shipDayPicking).toBe(true);
    expect(other.reply).toBe("What day should we pick it up?");
    expect(quickRepliesFor(other)).toBeNull();

    const friday = handleUtterance(other.session, "Friday", { now: WED_SEP_30 });
    expect(friday.session.sheet.pickup.date).toBe("2026-10-02");
    const named = handleUtterance(other.session, "next Monday", { now: WED_SEP_30 });
    expect(named.session.sheet.pickup.date).toBe("2026-10-05");

    const typed = handleUtterance(other.session, "2026-10-05", { now: WED_SEP_30 });
    expect(typed.session.sheet.pickup.date).toBe("2026-10-05");

    const past = handleUtterance(other.session, "2026-09-01", { now: WED_SEP_30 });
    expect(past.session.sheet.pickup.date).toBeNull();
    expect(past.reply).toMatch(/already passed/);
    expect(past.session.awaiting).toBe("pickup_date");

    const override = handleUtterance(session, "2026-10-08", { now: WED_SEP_30 });
    expect(override.session.sheet.pickup.date).toBe("2026-10-08");
  });

  it("proposes Monday when the clock is 11 PM Friday in Chicago", () => {
    const session = zipped("friday-night");
    session.sheet.freight.pieces = 1;
    session.sheet.freight.dims = palletDimsRecord({
      l: 48,
      w: 40,
      h: 48,
      source: "button_48x40x48",
      choice: "48x40x48",
    });
    session.sheet.freight.total_weight_lbs = 400;
    session.sheet.freight.commodity = "tiles";
    session.awaiting = "pickup_date";
    const asked = handleUtterance(session, "hello", { now: FRI_11PM_CHICAGO });
    expect(asked.session.shipDayOffer).toBe("2026-09-28");
    expect(asked.reply).toBe("I can have it picked up Monday, September 28. Does that work?");
    const yes = handleUtterance(asked.session, "Yes", { now: FRI_11PM_CHICAGO });
    expect(yes.session.sheet.pickup.date).toBe("2026-09-28");
  });
});
