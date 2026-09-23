import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance, openingMessage, PROMPTS, zipClarifyQuestion } from "../src/lib/dialog.js";
import { CONVERSATIONAL_GREETING, composeConversationalReply, presentAgentReply } from "../src/lib/conversational.js";

const BANNED =
  /I won[’']t (guess|invent|pad|look( one)? up|treat)|I can[’']t invent|won’t silently invert|won’t pad or guess|won’t treat ASAP/i;

const REPLY_FILES = [
  "src/lib/dialog.js",
  "src/lib/conversational.js",
  "src/app.js",
  "src/ui/layout.js",
  "src/ui/quote-card.js",
];

describe("reply copy purge — ask, don’t narrate the guardrail", () => {
  it("user-facing reply sources drop won’t-invent / won’t-guess phrasing", () => {
    for (const file of REPLY_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(BANNED);
    }
  });

  it("formal + conversational greetings ask for the origin ZIP in plain CS", () => {
    expect(openingMessage()).toBe(
      "Freight Lodge — I’ll take a US domestic LTL quote. Where are we picking up? What’s the origin ZIP?",
    );
    expect(CONVERSATIONAL_GREETING).toBe(
      "Hi — I can take a US domestic LTL quote. Where are we picking up? What’s the origin ZIP?",
    );
    expect(PROMPTS.origin_zip).toBe("What’s the origin ZIP? City is helpful, but I need the five-digit ZIP.");
    expect(PROMPTS.dest_zip).toBe("Where is this going? I need a destination city, state, or ZIP.");
    expect(PROMPTS.pickup_date).toBe("What pickup date works? Say a day or YYYY-MM-DD.");
    expect(PROMPTS.incomplete_zip).toBe("That ZIP is short — I need a full 5-digit ZIP.");
  });

  it("metro clarify and ASAP still ask without the old won’t-invent tail", () => {
    const metro = zipClarifyQuestion({
      kind: "metro",
      zip: "30301",
      metro: { city: "Atlanta" },
      statedCity: "New York",
    });
    expect(metro).toBe("You said New York but 30301 looks like Atlanta. Which is right — New York or 30301?");
    expect(metro).not.toMatch(BANNED);

    const session = createSession({ id: "asap-copy" });
    session.sheet.lanes.origin.postal_code = "60601";
    session.sheet.lanes.destination.postal_code = "75201";
    session.sheet.freight.pieces = 2;
    session.sheet.freight.total_weight_lbs = 400;
    session.sheet.freight.commodity = "fixtures";
    session.awaiting = "pickup_date";
    const result = handleUtterance(session, "ASAP please");
    expect(result.session.sheet.pickup.date).toBeNull();
    expect(result.reply).toMatch(/pickup date/i);
    expect(result.reply).not.toMatch(BANNED);
    expect(presentAgentReply(result, true)).not.toMatch(BANNED);
  });

  it("end-of-flow copy drops booking disclaimers", () => {
    const booking = /no booking from here|no book or pay/i;
    for (const file of [...REPLY_FILES, "index.html", "src/lib/email.js", "src/lib/quote-email-html.js"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(booking);
    }
  });

  it("conversational incomplete ZIP / dest / measure stay short and positive", () => {
    expect(
      composeConversationalReply({
        extracted: { flags: { incompleteZip: { role: "dest" } } },
        formalReply: PROMPTS.incomplete_dest_zip,
      }),
    ).toBe("That ZIP is short — I need a full 5-digit ZIP.");
    expect(
      composeConversationalReply({
        extracted: { flags: { incompleteTo: true } },
        formalReply: PROMPTS.dest_incomplete,
      }),
    ).toBe("That ended at “to” — I still need the destination city, state, or ZIP.");
  });
});
