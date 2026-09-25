import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSession, handleUtterance, PROMPTS, SHEET_READY_REPLY } from "../src/lib/dialog.js";
import { requestQuote } from "../src/lib/handoff.js";
import { presentAgentReply } from "../src/lib/conversational.js";
import {
  ESTIMATE_ERROR,
  ESTIMATE_LOADING,
  ESTIMATE_NOTE,
  HIDDEN_FOLLOWUP,
  PRICE_DISPLAY,
  estimateSpeech,
  readPriceDisplay,
} from "../src/lib/price-display.js";
import { emptySheet } from "../src/lib/sheet.js";
import { quoteCard } from "../src/ui/quote-card.js";

const NOW = new Date(2026, 8, 25, 15, 0, 0);

function readySheet() {
  const sheet = emptySheet({ id: "est-1" });
  sheet.lanes.origin.postal_code = "30301";
  sheet.lanes.destination.postal_code = "78721";
  sheet.freight.pieces = 5;
  sheet.freight.piece_unit = "pallets";
  sheet.freight.total_weight_lbs = 1000;
  sheet.freight.commodity = "oranges";
  sheet.pickup.date = "2026-10-02";
  sheet.contact.email = "shipper@example.com";
  sheet.status = "ready_for_quote";
  return sheet;
}

function quotedSheet(total = 258.5) {
  const sheet = readySheet();
  sheet.status = "quoted";
  sheet.quote_result = {
    carrier: "XPO Logistics",
    service: "LTL Economy",
    total_usd: total,
    transit_days_min: 4,
    transit_days_max: 6,
    quote_id: "FL-EST-EST1",
  };
  return sheet;
}

describe("v0.41 estimate display", () => {
  it("defaults to estimate and can hide the dollar amount", () => {
    expect(PRICE_DISPLAY).toBe("estimate");
    expect(readPriceDisplay("")).toBe("estimate");
    expect(readPriceDisplay("?price=hidden")).toBe("hidden");
    expect(readPriceDisplay("?price=estimate")).toBe("estimate");
    expect(readPriceDisplay("?price=live")).toBe("estimate");
    const sheet = quotedSheet();
    const shown = estimateSpeech(sheet, { mode: "estimate", from: "john@freightlodge.com" });
    expect(shown).toBe(
      "Your estimate is $258.50. Tap 'Email me this quote' if you want it sent to shipper@example.com from john@freightlodge.com.",
    );
    const hiddenSpeech = estimateSpeech(sheet, { mode: "hidden", from: "john@freightlodge.com" });
    expect(hiddenSpeech).toBe(HIDDEN_FOLLOWUP);
    expect(hiddenSpeech).not.toMatch(/\$\d/);

    const card = quoteCard(sheet, null, "estimate");
    expect(card).toContain(ESTIMATE_NOTE);
    expect(card).toContain("Estimate");
    expect(card).toContain("$258.50");
    expect(card).not.toMatch(/stub|Exfresso runner|live rate/i);

    const hiddenCard = quoteCard(sheet, null, "hidden");
    expect(hiddenCard).toContain(HIDDEN_FOLLOWUP);
    expect(hiddenCard).not.toMatch(/\$\d/);
    expect(hiddenCard).not.toContain("258.50");

    const loading = quoteCard({ status: "quoting" }, null, "estimate");
    expect(loading).toContain(ESTIMATE_LOADING);
    expect(loading).not.toMatch(/Exfresso|stub/i);
  });

  it("falls back to the local estimate on any non-2xx or network error", async () => {
    const sheet = readySheet();
    for (const status of [404, 405, 501, 500, 503]) {
      const result = await requestQuote(sheet, {
        delayMs: 0,
        fetchFn: async () => ({ ok: false, status, json: async () => ({}) }),
      });
      expect(result.ok, String(status)).toBe(true);
      expect(result.quote_sheet.status, String(status)).toBe("quoted");
      expect(result.quote_sheet.quote_result.total_usd, String(status)).toBe(258.5);
      expect(JSON.stringify(result), String(status)).not.toMatch(/HTTP \d+/);
    }
    const offline = await requestQuote(sheet, {
      delayMs: 0,
      fetchFn: async () => {
        throw new Error("network down");
      },
    });
    expect(offline.quote_sheet.quote_result.total_usd).toBe(258.5);

    const remote = await requestQuote(sheet, {
      delayMs: 0,
      fetchFn: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          quote_sheet: { ...sheet, status: "quoted", quote_result: { total_usd: 10, carrier: "Remote" } },
        }),
      }),
    });
    expect(remote.quote_sheet.quote_result.total_usd).toBe(10);
  });

  it("uses a friendly message only when the estimate cannot be computed", async () => {
    const result = await requestQuote(emptySheet({ id: "empty" }), {
      delayMs: 0,
      fetchFn: async () => ({ ok: false, status: 501, json: async () => ({}) }),
    });
    expect(result.ok).toBe(false);
    expect(result.quote_sheet.quote_result).toBeNull();
    expect(result.quote_sheet.error_reason).toBe(ESTIMATE_ERROR);
    expect(result.quote_sheet.error_reason).not.toMatch(/HTTP|501|not ready/i);
  });
});

describe("v0.41 copy nits", () => {
  it("asks for a pickup date without an ISO format hint", () => {
    expect(PROMPTS.pickup_date).toBe("What pickup date works?");
    expect(PROMPTS.pickup_date).not.toMatch(/YYYY-MM-DD/);
    const session = createSession({ id: "date-ask" });
    session.sheet.lanes.origin.postal_code = "78721";
    session.sheet.lanes.destination.postal_code = "30030";
    session.sheet.freight.piece_unit = "pallets";
    session.sheet.freight.pieces = 2;
    session.sheet.freight.total_weight_lbs = 400;
    session.sheet.freight.commodity = "oranges";
    session.awaiting = "pickup_date";
    const vague = handleUtterance(session, "ASAP please");
    expect(vague.reply).not.toMatch(/YYYY-MM-DD/);
    expect(presentAgentReply(vague, true)).not.toMatch(/YYYY-MM-DD/);
    expect(presentAgentReply(vague, true)).toMatch(/pickup date/i);
  });

  it("reads the formal echo as Got it, and stays natural when a fact is missing", () => {
    const full = handleUtterance(
      createSession({ id: "echo-full" }),
      "ship a thousand pounds of oranges from Austin to Atlanta",
    );
    expect(full.reply).toContain("Got it: Austin to Atlanta, 1000 lb of oranges.");
    expect(full.reply).not.toMatch(/\u2014/);

    const noCommodity = handleUtterance(
      createSession({ id: "echo-weight" }),
      "1000 pounds from Austin to Atlanta",
    );
    expect(noCommodity.reply).toContain("Got it: Austin to Atlanta, 1000 lb.");
    expect(noCommodity.reply).not.toMatch(/lb of\b/);

    const noWeight = handleUtterance(
      createSession({ id: "echo-goods" }),
      "ship oranges from Austin to Atlanta",
    );
    expect(noWeight.reply).toContain("Got it: Austin to Atlanta, oranges.");
    expect(noWeight.reply).not.toMatch(/\blb\b/);

    const originOnly = handleUtterance(createSession({ id: "echo-from" }), "1000 pounds of oranges from Austin");
    expect(originOnly.reply).toContain("Got it: from Austin, 1000 lb of oranges.");
    expect(originOnly.reply).not.toContain(" to ");

    expect(SHEET_READY_REPLY).toBe("Sheet’s complete. Working out your estimate…");
    expect(SHEET_READY_REPLY).not.toMatch(/live rate|Exfresso/i);

    let session = createSession({ id: "echo-dest", now: NOW });
    session = handleUtterance(session, "78721", { now: NOW }).session;
    const dest = handleUtterance(session, "30030", { now: NOW });
    expect(dest.reply).toContain("Got it: destination 30030.");
    expect(dest.reply).not.toMatch(/\bdest \d/);
  });

  it("keeps live rate, Exfresso runner, and YYYY-MM-DD out of the spoken UI sources", () => {
    const files = [
      "src/app.js",
      "src/lib/dialog.js",
      "src/lib/conversational.js",
      "src/lib/price-display.js",
      "src/ui/quote-card.js",
      "src/lib/jev-core.js",
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/live rate/i);
      expect(src, file).not.toMatch(/Exfresso runner/i);
      expect(src, file).not.toMatch(/YYYY-MM-DD/);
    }
    const card = readFileSync("src/ui/quote-card.js", "utf8");
    expect(card).not.toMatch(/stub/i);
    const summary = readFileSync("src/lib/handoff.js", "utf8");
    expect(summary).not.toMatch(/stub rows|Exfresso will replace/);
    expect(summary).not.toMatch(/Handoff endpoint returned HTTP/);
  });
});
