import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatAppVersionLabel } from "../src/lib/app-version.js";
import { composeConversationalReply, presentAgentReply } from "../src/lib/conversational.js";
import {
  LTL_MAX_PALLETS,
  MIN_LB_PER_PALLET,
  PROMPTS,
  createSession,
  formatSpokenDate,
  handleUtterance,
  palletSanityQuestion,
} from "../src/lib/dialog.js";
import { extractSlots } from "../src/lib/extract.js";
import { buildCandidateRates, requestQuote, simulateExfressoRunner } from "../src/lib/handoff.js";
import { palletSanityChoices } from "../src/lib/quick-replies.js";
import { emptySheet } from "../src/lib/sheet.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";

const NOW = new Date(2026, 8, 25, 15, 0, 0);

function zipped(id = "v041") {
  const session = createSession({ id });
  session.sheet.lanes.origin.postal_code = "30301";
  session.sheet.lanes.destination.postal_code = "78721";
  return session;
}

function withPallets(pieces, weight, id = "pal") {
  const session = zipped(id);
  session.sheet.freight.piece_unit = "pallets";
  session.sheet.freight.pieces = pieces;
  if (weight != null) session.sheet.freight.total_weight_lbs = weight;
  session.awaiting = weight == null ? "measure" : "commodity";
  return session;
}

describe("v0.41 pallet sanity", () => {
  it("names the LTL pallet cap and the light-pallet floor once", () => {
    expect(LTL_MAX_PALLETS).toBe(12);
    expect(MIN_LB_PER_PALLET).toBe(50);
    const src = readFileSync("src/lib/dialog.js", "utf8");
    expect(src.match(/export const LTL_MAX_PALLETS/g)).toHaveLength(1);
    expect(src.match(/export const MIN_LB_PER_PALLET/g)).toHaveLength(1);
  });

  it("asks before quoting when the pallet count is above 12 or each pallet is under 50 lb", () => {
    const heavy = handleUtterance(withPallets(65, null, "count-first"), "1000 pounds");
    expect(heavy.session.sheet.freight.pieces).toBe(65);
    expect(heavy.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(heavy.session.awaiting).toBe("pallet_sanity");
    expect(heavy.ready).toBe(false);
    expect(heavy.reply).toBe(palletSanityQuestion({
      pieces: 65,
      weight: 1000,
      tooMany: true,
      light: true,
      per: 1000 / 65,
    }));
    expect(heavy.reply).toMatch(/above the LTL range of 12/);
    expect(heavy.reply).toMatch(/under 50 lb a pallet/);
    expect(heavy.reply).toMatch(/Quote 65 pallets anyway\?/);
    expect(palletSanityChoices(65).map((choice) => choice.label)).toEqual(["Yes, 65", "No, fix it"]);
    expect(heavy.reply).not.toMatch(/\u2014/);

    const light = handleUtterance(withPallets(4, null, "light"), "100 pounds");
    expect(light.session.awaiting).toBe("pallet_sanity");
    expect(light.reply).toMatch(/Quote 4 pallets anyway\?/);
    expect(light.reply).not.toMatch(/above the LTL range/);

    const many = handleUtterance(withPallets(13, null, "many"), "20000 pounds");
    expect(many.session.awaiting).toBe("pallet_sanity");
    expect(many.reply).toMatch(/13 pallets is above the LTL range of 12/);
    expect(many.reply).not.toMatch(/under 50 lb/);
  });

  it("does not ask for a normal pallet count, for pieces, or before a measure exists", () => {
    const normal = handleUtterance(withPallets(5, null, "normal"), "1000 pounds");
    expect(normal.session.awaiting).not.toBe("pallet_sanity");
    expect(normal.reply).not.toMatch(/anyway\?/);

    const edge = handleUtterance(withPallets(12, null, "edge"), "600 pounds");
    expect(edge.session.awaiting).not.toBe("pallet_sanity");

    const countOnly = handleUtterance(withPallets(65, null, "defer"), "sixty five");
    expect(countOnly.session.sheet.freight.pieces).toBe(65);
    expect(countOnly.session.awaiting).not.toBe("pallet_sanity");

    const pieces = withPallets(65, 1000, "boxes");
    pieces.sheet.freight.piece_unit = "pieces";
    pieces.awaiting = "commodity";
    const boxed = handleUtterance(pieces, "oranges");
    expect(boxed.session.awaiting).not.toBe("pallet_sanity");
  });

  it("yes continues toward the quote and no re-asks the count, by button label, typing, or voice", () => {
    const pending = handleUtterance(withPallets(65, 1000, "yes-no"), "oranges");
    expect(pending.session.awaiting).toBe("pallet_sanity");

    const yesLabel = handleUtterance(pending.session, "Yes, 65");
    expect(yesLabel.session.sheet.freight.pieces).toBe(65);
    expect(yesLabel.session.palletSanity).toEqual({ pieces: 65, weight: 1000 });
    expect(yesLabel.session.awaiting).toBe("pickup_date");
    expect(yesLabel.reply).not.toMatch(/anyway\?/);

    const yeah = handleUtterance(pending.session, "yeah");
    expect(yeah.session.palletSanity.pieces).toBe(65);
    expect(yeah.session.awaiting).toBe("pickup_date");

    const typedNo = handleUtterance(pending.session, "no");
    expect(typedNo.session.sheet.freight.pieces).toBeNull();
    expect(typedNo.session.awaiting).toBe("pieces");
    expect(typedNo.reply).toMatch(/What’s the pallet count\?/);
    expect(typedNo.reply).toMatch(/correct the weight/);
    expect(typedNo.reply).not.toMatch(/Please type it in/);

    const fix = handleUtterance(pending.session, "No, fix it");
    expect(fix.session.sheet.freight.pieces).toBeNull();
    const fixed = handleUtterance(fix.session, "five");
    expect(fixed.session.sheet.freight.pieces).toBe(5);
    expect(fixed.session.awaiting).not.toBe("pallet_sanity");
    expect(fixed.session.awaiting).not.toBe("pieces");
  });

  it("a confirmed count quotes, and a changed weight asks again", () => {
    let session = withPallets(65, 1000, "ready");
    session.sheet.freight.commodity = "oranges";
    session.sheet.pickup.date = "2026-10-02";
    session.askedAccessorials = true;
    session.sheet.contact.email = "shipper@example.com";
    session.awaiting = "pallet_sanity";
    const asked = handleUtterance(session, "still 65 pallets");
    expect(asked.session.awaiting).toBe("pallet_sanity");
    expect(asked.ready).toBe(false);

    const yes = handleUtterance(asked.session, "yes");
    expect(yes.ready).toBe(true);
    expect(yes.session.sheet.status).toBe("ready_for_quote");
    expect(yes.session.sheet.freight.pieces).toBe(65);

    const again = handleUtterance(yes.session, "actually 400 pounds");
    expect(again.session.sheet.freight.total_weight_lbs).toBe(400);
    expect(again.session.awaiting).toBe("pallet_sanity");
    expect(again.ready).toBe(false);
  });
});

describe("v0.41 spoken pallet counts", () => {
  it("accepts five, twelve, and sixty five without a type-it prompt", () => {
    const session = zipped("spoken");
    session.sheet.freight.piece_unit = "pallets";
    session.awaiting = "pieces";
    for (const [text, count] of [
      ["five", 5],
      ["twelve", 12],
      ["sixty five", 65],
      ["sixty-five", 65],
      ["it's sixty five", 65],
    ]) {
      const result = handleUtterance(
        { ...session, sheet: structuredClone(session.sheet) },
        text,
      );
      expect(result.session.sheet.freight.pieces, text).toBe(count);
    }
    expect(extractSlots("sixty five pallets", { awaiting: "piece_unit" }).freight).toMatchObject({
      pieces: 65,
      piece_unit: "pallets",
    });
    expect(PROMPTS.pieces).not.toMatch(/Please type it in/);
    expect(PROMPTS.email).toMatch(/Please type it in/);
  });
});

describe("v0.41 date words and city direction", () => {
  it("reads a stored date back as weekday, month, and day", () => {
    expect(formatSpokenDate("2026-10-02")).toBe("Friday, October 2");
    expect(formatSpokenDate("2026-09-25")).toBe("Friday, September 25");
    const session = createSession({ id: "date-words" });
    const result = handleUtterance(session, "pickup October 2", { now: NOW });
    expect(result.session.sheet.pickup.date).toBe("2026-10-02");
    expect(result.reply).toContain("pickup Friday, October 2");
    expect(result.reply).not.toContain("2026-10-02");
    expect(presentAgentReply(result, true)).toContain("Friday, October 2");
    expect(presentAgentReply(result, true)).not.toContain("2026-10-02");
  });

  it("names origin then destination when echoing both cities", () => {
    const result = handleUtterance(
      createSession({ id: "cities" }),
      "ship oranges from Austin to Atlanta, pickup October 2",
      { now: NOW },
    );
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.pickup.date).toBe("2026-10-02");
    expect(result.reply).toContain("from Austin to Atlanta");
    expect(result.reply).toContain("Friday, October 2");
    expect(result.reply).not.toContain("2026-10-02");
    expect(result.reply).not.toMatch(/\borigin Austin\b/);
    expect(result.reply).not.toMatch(/\bdest Atlanta\b/);
    const warm = presentAgentReply(result, true);
    expect(warm).toContain("from Austin to Atlanta");
    expect(warm).toContain("Friday, October 2");
    expect(composeConversationalReply({
      formalReply: result.reply,
      extracted: result.extracted,
      sheet: result.session.sheet,
      awaiting: result.session.awaiting,
    })).toContain("from Austin to Atlanta");
  });
});

describe("v0.41 transcript version and taps", () => {
  it("stamps the app version on the sheet and in the emailed snapshot", () => {
    const session = createSession({ id: "ver" });
    expect(session.sheet.app_version).toBe("v0.41");
    expect(emptySheet().app_version).toBe(formatAppVersionLabel());
    const text = formatSessionTranscript(
      [
        { role: "user", text: "Pallets", via: "tap" },
        { role: "user", text: "five" },
        { role: "assistant", text: "Your quote is $258.50. Tap 'Email me this quote' if you want it sent." },
      ],
      session,
    );
    expect(text.startsWith("Version: v0.41\n")).toBe(true);
    expect(text).toContain("Sheet snapshot:\nVersion: v0.41");
    expect(text).toContain("User [tap]: Pallets");
    expect(text).toContain("User: five");
    expect(text).not.toContain("User [tap]: five");
    expect(text).toContain("Your quote is $258.50");
  });
});

describe("v0.41 rating payload", () => {
  it("sends pieces and piece_unit on the quote sheet, and the stub price ignores the count", async () => {
    const light = emptySheet({ id: "rate-5" });
    light.lanes.origin.postal_code = "30301";
    light.lanes.destination.postal_code = "78721";
    light.freight.pieces = 5;
    light.freight.piece_unit = "pallets";
    light.freight.total_weight_lbs = 1000;
    light.freight.commodity = "oranges";
    light.pickup.date = "2026-10-02";
    light.contact.email = "shipper@example.com";
    light.status = "ready_for_quote";

    const many = structuredClone(light);
    many.freight.pieces = 65;
    const lifted = structuredClone(light);
    lifted.pickup.accessorials = ["liftgate_pickup"];

    const five = simulateExfressoRunner(light);
    const sixtyFive = simulateExfressoRunner(many);
    const withLift = simulateExfressoRunner(lifted);
    expect(five.quote_sheet.freight.pieces).toBe(5);
    expect(five.quote_sheet.freight.piece_unit).toBe("pallets");
    expect(five.quote_sheet.quote_result.total_usd).toBe(258.5);
    expect(sixtyFive.quote_sheet.quote_result.total_usd).toBe(five.quote_sheet.quote_result.total_usd);
    expect(withLift.quote_sheet.quote_result.total_usd).toBe(297.98);
    expect(buildCandidateRates(light)[0].total_usd).toBe(buildCandidateRates(many)[0].total_usd);

    let posted = null;
    const fetchFn = async (url, init) => {
      posted = { url, body: JSON.parse(init.body) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    await requestQuote(light, { fetchFn, delayMs: 0 });
    expect(posted.body.quote_sheet.freight.pieces).toBe(5);
    expect(posted.body.quote_sheet.freight.piece_unit).toBe("pallets");
    expect(posted.body.quote_sheet.freight.total_weight_lbs).toBe(1000);
    expect(posted.body.quote_sheet.lanes.origin.postal_code).toBe("30301");
    expect(posted.body.quote_sheet.lanes.destination.postal_code).toBe("78721");
    expect(posted.body.quote_sheet.pickup.accessorials).toEqual([]);

    const worker = readFileSync("token-proxy/src/index.js", "utf8");
    expect(worker).not.toContain("quote-handoff");
    expect(worker).not.toContain("buildCandidateRates");
  });
});
