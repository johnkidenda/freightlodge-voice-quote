import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readClientUi } from "./client-ui.js";
import { extractSlots, takePlace } from "../src/lib/extract.js";
import { createSession, handleUtterance, PROMPTS } from "../src/lib/dialog.js";
import { composeConversationalReply, presentAgentReply } from "../src/lib/conversational.js";
import { formatPlace } from "../src/lib/completeness.js";

const LANE = "New York City to Austin Texas";
const NOW = new Date("2026-09-18T15:00:00");

describe("multi-word cities — New York City is not leftover City", () => {
  it("parses New York City to Austin Texas as New York → Austin, TX", () => {
    const extracted = extractSlots(LANE);
    expect(extracted.origin.city).toBe("New York");
    expect(extracted.origin.city).not.toBe("City");
    expect(extracted.destination.city).toBe("Austin");
    expect(extracted.destination.state).toBe("TX");
    expect(extracted.origin.postal_code).toBeUndefined();
    expect(extracted.destination.postal_code).toBeUndefined();

    const result = handleUtterance(createSession({ id: "nyc-lane" }), LANE);
    expect(result.session.sheet.lanes.origin.city).toBe("New York");
    expect(result.session.sheet.lanes.origin.city).not.toBe("City");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(formatPlace(result.session.sheet.lanes.origin)).not.toMatch(/City, NY/);
  });

  it("parses New York without City as the city, not a state-only leftover", () => {
    const extracted = extractSlots("New York to Austin Texas");
    expect(extracted.origin.city).toBe("New York");
    expect(extracted.destination.city).toBe("Austin");
  });

  it("keeps Oklahoma City and Kansas City as full names, not City + state", () => {
    expect(takePlace("Oklahoma City to Dallas").city).toBe("Oklahoma City");
    expect(extractSlots("from Kansas City to Chicago").origin.city).toBe("Kansas City");
    expect(extractSlots("from Kansas City to Chicago").destination.city).toBe("Chicago");
  });
});

describe("city vs ZIP metro mismatch — do not silent-keep", () => {
  it("New York + 30301 asks which is right instead of keeping NY + Atlanta ZIP", () => {
    let session = handleUtterance(createSession({ id: "nyc-zip" }), LANE).session;
    expect(session.sheet.lanes.origin.city).toBe("New York");
    expect(session.awaiting).toBe("origin_zip");

    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.city).toBe("New York");
    expect(result.reply).toMatch(/You said New York/i);
    expect(result.reply).toMatch(/30301 looks like Atlanta/i);
    expect(result.reply).toMatch(/Which is right/i);
    expect(result.reply).not.toMatch(/won’t invent|won’t guess|won’t look/i);
    expect(result.extracted.flags.zipClarify.kind).toBe("metro");
  });

  it("choosing the city drops the ZIP and does not invent one", () => {
    let session = handleUtterance(createSession({ id: "nyc-keep-city" }), LANE).session;
    session = handleUtterance(session, "30301").session;
    const city = handleUtterance(session, "New York");
    expect(city.session.sheet.lanes.origin.city).toBe("New York");
    expect(city.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(city.session.zipClarify).toBeNull();
    expect(city.reply).toMatch(/origin ZIP/i);
  });

  it("choosing the ZIP keeps 30301 and clears the conflicting city — no invented NYC ZIP", () => {
    let session = handleUtterance(createSession({ id: "nyc-keep-zip" }), LANE).session;
    session = handleUtterance(session, "30301").session;
    const zip = handleUtterance(session, "30301");
    expect(zip.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(zip.session.sheet.lanes.origin.city).toBeNull();
    expect(zip.session.sheet.lanes.origin.state).toBe("GA");
  });

  it("Atlanta origin + 78721 dest Austin still asks role, not city-vs-ZIP", () => {
    const session = createSession({ id: "role-still" });
    session.sheet.lanes.origin.city = "Atlanta";
    session.sheet.lanes.destination.city = "Austin";
    session.sheet.lanes.destination.state = "TX";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.reply).toMatch(/78721 looks like Austin/i);
    expect(result.reply).toMatch(/destination ZIP/i);
    expect(result.extracted.flags.zipClarify.kind).toBe("role");
  });
});

describe("email ask recommends typing", () => {
  it("formal and conversational prompts tell them to type the address", () => {
    expect(PROMPTS.email).toBe(
      "What email should I put on the sheet so we can send the quote? Please type it in.",
    );
    expect(PROMPTS.email).not.toMatch(/I recommend typing it in for accuracy/);
    expect(PROMPTS.email).not.toMatch(/safer than saying/i);

    const session = createSession({ id: "email-ask" });
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.destination.postal_code = "78721";
    session.sheet.freight.pieces = 3;
    session.sheet.freight.total_weight_lbs = 1000;
    session.sheet.freight.commodity = "oranges";
    session.sheet.pickup.date = "2026-09-18";
    session.askedAccessorials = true;
    session.awaiting = "email";
    const result = handleUtterance(session, "none");
    expect(result.session.awaiting).toBe("email");
    expect(result.reply).toContain(PROMPTS.email);

    const warm = composeConversationalReply({
      formalReply: result.reply,
      extracted: result.extracted,
      sheet: result.session.sheet,
      awaiting: "email",
    });
    expect(warm).toBe("What email should I put on the sheet? Please type it in.");
    expect(presentAgentReply({ ...result, session: { ...result.session, awaiting: "email" } }, true)).toBe(
      "What email should I put on the sheet? Please type it in.",
    );
  });

  it("composer highlights the typed field when awaiting email", () => {
    const app = readClientUi();
    const css = readFileSync("src/style.css", "utf8");
    expect(app).toContain("is-email-ask");
    expect(app).toContain("Type the email address…");
    expect(app).not.toContain("Type the 6-digit code…");
    expect(css).toMatch(/\.composer\.is-email-ask/);
    expect(css).not.toMatch(/\.composer\.is-code-ask/);
  });
});

describe("Friday after next (soft)", () => {
  it("parses Friday after next and Fridays from now from a Friday", () => {
    expect(extractSlots("Friday after next", { now: NOW }).pickup.date).toBe("2026-10-02");
    expect(extractSlots("the Friday after next", { now: NOW }).pickup.date).toBe("2026-10-02");
    expect(extractSlots("Fridays from now", { now: NOW }).pickup.date).toBe("2026-10-02");
    expect(extractSlots("two Fridays from now", { now: NOW }).pickup.date).toBe("2026-10-02");
    expect(extractSlots("next Friday", { now: NOW }).pickup.date).toBe("2026-09-25");
    expect(extractSlots("Friday", { now: NOW }).pickup.date).toBe("2026-09-18");
  });
});

describe("dump and short ZIP still work", () => {
  it("oranges dump still parks weight + cities and does not invent ZIPs", () => {
    const result = handleUtterance(
      createSession({ id: "dump-still-vtq" }),
      "ship a thousand pounds of oranges from Austin to Atlanta",
    );
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
  });

  it("incomplete dest ZIP is still rejected", () => {
    const session = createSession({ id: "short-still" });
    session.sheet.lanes.destination.city = "Austin";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "dest zip 787");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/I heard 787 for the destination, which is only three digits/i);
    expect(result.reply).not.toMatch(/\u2014/);
  });
});
