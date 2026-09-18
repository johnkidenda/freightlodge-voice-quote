import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance, zipClarifyQuestion } from "../src/lib/dialog.js";
import { extractSlots, resolveZipAttachment } from "../src/lib/extract.js";
import { emptySheet } from "../src/lib/sheet.js";
import {
  impliedStateForCity,
  placeState,
  stateDisplayName,
  stateForZip,
  ZIP3_RANGES,
  ZIP5_EXCEPTIONS,
  ZIP3_RANGE_SOURCE,
  ZIP5_EXCEPTION_SOURCE,
  ZIP_STATE_STATS,
  zipStateClarify,
} from "../src/lib/zip-state.js";
import { presentAgentReply } from "../src/lib/conversational.js";

describe("ZIP3 → state lookup", () => {
  it("maps common freight ZIPs without inventing a city", () => {
    expect(stateForZip("30301")).toBe("GA");
    expect(stateForZip("78721")).toBe("TX");
    expect(stateForZip("10001")).toBe("NY");
    expect(stateForZip("11201")).toBe("NY");
    expect(stateForZip("20147")).toBe("VA");
    expect(stateForZip("20001")).toBe("DC");
    expect(stateForZip("73301")).toBe("TX");
    expect(stateForZip("88510")).toBe("TX");
    expect(stateForZip("05501")).toBe("MA");
    expect(stateForZip("60601")).toBe("IL");
    expect(stateForZip("99501")).toBe("AK");
    expect(stateForZip("30301-1234")).toBe("GA");
    expect(stateForZip("303")).toBeNull();
    expect(stateForZip("")).toBeNull();
  });

  it("applies known multi-state ZIP5 exceptions", () => {
    expect(stateForZip("06390")).toBe("NY");
    expect(stateForZip("83414")).toBe("WY");
    expect(stateForZip("97635")).toBe("CA");
    expect(stateForZip("06301")).toBe("CT");
    expect(stateForZip("83401")).toBe("ID");
    expect(stateForZip("97601")).toBe("OR");
  });

  it("reports compact data size", () => {
    expect(ZIP3_RANGES.length).toBe(ZIP_STATE_STATS.rangeLines);
    expect(Object.keys(ZIP5_EXCEPTIONS).length).toBe(ZIP_STATE_STATS.exceptionEntries);
    expect(ZIP_STATE_STATS.rangeLines).toBeGreaterThanOrEqual(70);
    expect(ZIP_STATE_STATS.exceptionEntries).toBe(3);
    expect(ZIP_STATE_STATS.sourceBytes).toBeGreaterThan(400);
    expect(ZIP_STATE_STATS.sourceBytes).toBeLessThan(2500);
    expect(ZIP3_RANGE_SOURCE.length + ZIP5_EXCEPTION_SOURCE.length + 1).toBe(ZIP_STATE_STATS.sourceBytes);
  });
});

describe("city-implied state", () => {
  it("maps New York and Austin even when state is empty", () => {
    expect(impliedStateForCity("New York")).toBe("NY");
    expect(impliedStateForCity("Austin")).toBe("TX");
    expect(impliedStateForCity("Atlanta")).toBe("GA");
    expect(placeState({ city: "New York", state: null })).toBe("NY");
    expect(placeState({ city: "Austin" })).toBe("TX");
    expect(placeState({ state: "TX" })).toBe("TX");
  });

  it("does not invent a state for ambiguous city names", () => {
    expect(impliedStateForCity("Portland")).toBeNull();
    expect(impliedStateForCity("Columbus")).toBeNull();
    expect(impliedStateForCity("Kansas City")).toBeNull();
    expect(zipStateClarify({ city: "Portland" }, "30301", "origin")).toBeNull();
  });
});

describe("ZIP-in-state dialog", () => {
  it("Texas + 30301 clarifies and does not park the ZIP", () => {
    const session = createSession({ id: "tx-30301" });
    session.sheet.lanes.origin.state = "TX";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.state).toBe("TX");
    expect(result.session.sheet.lanes.origin.city).toBeNull();
    expect(result.reply).toBe("30301 looks like Georgia, but origin is Texas — which is right?");
    expect(result.extracted.flags.zipClarify.kind).toBe("state");
    expect(result.session.zipClarify.kind).toBe("state");
  });

  it("spoken from Texas then origin ZIP 30301 is the same mismatch", () => {
    let session = createSession({ id: "from-tx" });
    session = handleUtterance(session, "from Texas").session;
    expect(session.sheet.lanes.origin.state).toBe("TX");
    const result = handleUtterance(session, "origin zip 30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.state).toBe("TX");
    expect(result.reply).toMatch(/30301 looks like Georgia, but origin is Texas/i);
  });

  it("same-turn from Texas 30301 does not silently keep the pair", () => {
    const result = handleUtterance(createSession({ id: "same-tx" }), "from Texas 30301");
    expect(result.session.sheet.lanes.origin.state).toBe("TX");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.reply).toMatch(/30301 looks like Georgia, but origin is Texas/i);
  });

  it("Georgia is right parks 30301 and sets origin to Georgia", () => {
    let session = createSession({ id: "ga-right" });
    session.sheet.lanes.origin.state = "TX";
    session.awaiting = "origin_zip";
    session = handleUtterance(session, "30301").session;
    const yes = handleUtterance(session, "Georgia");
    expect(yes.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(yes.session.sheet.lanes.origin.state).toBe("GA");
    expect(yes.session.zipClarify).toBeNull();
  });

  it("Texas is right keeps Texas and does not park 30301", () => {
    let session = createSession({ id: "tx-right" });
    session.sheet.lanes.origin.state = "TX";
    session.awaiting = "origin_zip";
    session = handleUtterance(session, "30301").session;
    const no = handleUtterance(session, "Texas");
    expect(no.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(no.session.sheet.lanes.origin.state).toBe("TX");
    expect(no.session.zipClarify).toBeNull();
    expect(no.reply.toLowerCase()).toMatch(/origin zip|origin/);
  });

  it("Austin city (no state) + 99501 clarifies Alaska vs Texas", () => {
    const session = createSession({ id: "aus-ak" });
    session.sheet.lanes.origin.city = "Austin";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "99501");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.origin.state).toBeNull();
    expect(result.reply).toBe("99501 looks like Alaska, but origin is Texas — which is right?");
  });

  it("New York city + 30301 still uses metro city clarify, not a silent park", () => {
    const session = createSession({ id: "nyc-ga" });
    session.sheet.lanes.origin.city = "New York";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.city).toBe("New York");
    expect(result.reply).toMatch(/30301 looks like Atlanta/i);
  });

  it("Texas + 78721 parks the ZIP and keeps Texas", () => {
    const session = createSession({ id: "tx-match" });
    session.sheet.lanes.origin.state = "TX";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "78721");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.state).toBe("TX");
    expect(result.reply).not.toMatch(/which is right/i);
    expect(result.extracted.flags.zipClarify).toBeFalsy();
  });

  it("ZIP-only 30301 parks without a false mismatch and fills Georgia", () => {
    const result = handleUtterance(createSession({ id: "zip-only" }), "30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.origin.state).toBe("GA");
    expect(result.session.sheet.lanes.origin.city).toBeNull();
    expect(result.reply).not.toMatch(/which is right|looks like/i);
    expect(result.extracted.flags.zipClarify).toBeFalsy();
    expect(result.session.awaiting).toBe("dest_zip");
  });

  it("destination zip 78721 still parks without a false mismatch", () => {
    const result = handleUtterance(createSession({ id: "dest-only" }), "destination zip is 78721");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.reply).not.toMatch(/which is right/i);
  });

  it("does not invent a city name from the ZIP on a state match", () => {
    const session = createSession({ id: "no-city" });
    session.sheet.lanes.origin.state = "GA";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.origin.state).toBe("GA");
    expect(result.session.sheet.lanes.origin.city).toBeNull();
  });

  it("dest Austin + 30301 still uses metro copy, not the state sentence", () => {
    const session = createSession({ id: "metro-keep" });
    session.sheet.lanes.origin.city = "Atlanta";
    session.sheet.lanes.origin.state = "GA";
    session.sheet.lanes.destination.city = "Austin";
    session.sheet.lanes.destination.state = "TX";
    session.sheet.lanes.origin.postal_code = "99999";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/30301 looks like Atlanta/i);
    expect(result.reply).not.toMatch(/origin is Texas/i);
  });

  it("dump path still parks Austin / Atlanta without inventing ZIPs", () => {
    const result = handleUtterance(
      createSession({ id: "dump-keep" }),
      "ship a thousand pounds of oranges from Austin to Atlanta",
    );
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
  });

  it("NYC city parse still treats New York as the city and 10001 matches", () => {
    const fromNy = extractSlots("from New York");
    expect(fromNy.origin.city).toBe("New York");
    const session = createSession({ id: "nyc-10001" });
    session.sheet.lanes.origin.city = "New York";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "10001");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("10001");
    expect(result.session.sheet.lanes.origin.city).toBe("New York");
    expect(result.session.sheet.lanes.origin.state).toBe("NY");
    expect(result.reply).not.toMatch(/which is right/i);
  });

  it("conversational mode keeps the human state-mismatch sentence", () => {
    const session = createSession({ id: "warm-state" });
    session.sheet.lanes.origin.state = "TX";
    session.awaiting = "origin_zip";
    const result = handleUtterance(session, "30301");
    const warm = presentAgentReply(result, true);
    expect(warm).toBe("30301 looks like Georgia, but origin is Texas — which is right?");
    expect(warm).not.toMatch(/\bdest\b/);
  });

  it("zipClarifyQuestion uses full state words", () => {
    const q = zipClarifyQuestion(
      { kind: "state", zip: "30301", zipState: "GA", placeState: "TX", attemptedRole: "origin" },
      emptySheet(),
    );
    expect(q).toBe("30301 looks like Georgia, but origin is Texas — which is right?");
    expect(stateDisplayName("GA")).toBe("Georgia");
  });

  it("resolveZipAttachment overlay catches same-turn Texas + 30301", () => {
    const sheet = emptySheet({ id: "overlay" });
    const verdict = resolveZipAttachment(
      sheet,
      "30301",
      "origin",
      { origin: { state: "TX", postal_code: "30301" }, destination: {} },
    );
    expect(verdict.attach).toBeNull();
    expect(verdict.clarify.kind).toBe("state");
    expect(verdict.clarify.zipState).toBe("GA");
    expect(verdict.clarify.placeState).toBe("TX");
  });
});

describe("lookup module stays client-side and compact", () => {
  it("does not pull a city gazetteer or remote API into the ZIP table", () => {
    const src = readFileSync("src/lib/zip-state.js", "utf8");
    expect(src).not.toMatch(/fetch\(|axios|googleapis|zippopotam/i);
    expect(ZIP3_RANGE_SOURCE).not.toMatch(/Atlanta|Austin|Chicago/);
    expect(ZIP5_EXCEPTION_SOURCE).not.toMatch(/Atlanta|Austin|Chicago/);
  });
});
