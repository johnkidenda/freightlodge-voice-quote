import { describe, expect, it } from "vitest";
import { extractSlots } from "../src/lib/extract.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { formatQaTranscript } from "../src/lib/transcript.js";

const STUTTERED = [
  "the Atlanta zip code is 30 the Atlanta zip code is 30301",
  "and the Austin zip code is the Atlanta zip code is 30301",
  "and Austin zip code is 78721",
].join(" ");

const CLEAN = "Atlanta zip is 30301 and Austin zip is 78721";

function sessionAtlantaAustin() {
  const session = createSession({ id: "atl-aus" });
  session.sheet.lanes.origin.city = "Atlanta";
  session.sheet.lanes.origin.state = "GA";
  session.sheet.lanes.destination.city = "Austin";
  session.sheet.lanes.destination.state = "TX";
  session.sheet.freight.total_weight_lbs = 2205;
  session.awaiting = "origin_zip";
  return session;
}

describe("city-labeled ZIPs survive STT stutter", () => {
  it("clean Atlanta/Austin ZIP pairing", () => {
    const extracted = extractSlots(CLEAN, {
      awaiting: "origin_zip",
      originCity: "Atlanta",
      destCity: "Austin",
    });
    expect(extracted.origin.postal_code).toBe("30301");
    expect(extracted.destination.postal_code).toBe("78721");
    expect(extracted.destination.postal_code).not.toBe(extracted.origin.postal_code);

    const result = handleUtterance(sessionAtlantaAustin(), CLEAN);
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
  });

  it("stuttered dual-ZIP utterance keeps Austin 78721, not dest 30301", () => {
    const extracted = extractSlots(STUTTERED, {
      awaiting: "origin_zip",
      originCity: "Atlanta",
      destCity: "Austin",
    });
    expect(extracted.origin.postal_code).toBe("30301");
    expect(extracted.destination.postal_code).toBe("78721");
    expect(extracted.destination.postal_code).not.toBe("30301");

    const result = handleUtterance(sessionAtlantaAustin(), STUTTERED);
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("78721");
    expect(result.session.sheet.lanes.origin.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.state).toBe("TX");
    expect(result.reply).not.toMatch(/dest 30301/i);
  });
});

describe("dest Austin rejects Atlanta ZIP silently", () => {
  it("dest Austin + dest 30301 clarifies instead of accepting", () => {
    const session = sessionAtlantaAustin();
    session.sheet.lanes.origin.postal_code = "99999";
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.city).toBe("Austin");
    expect(result.reply).toMatch(/30301 looks like Atlanta/i);
    expect(result.reply).toMatch(/Austin|origin ZIP/i);
  });

  it("dest Austin + 30301 with 78721 in the same turn mentions Austin 78721", () => {
    const session = sessionAtlantaAustin();
    session.awaiting = "dest_zip";
    const result = handleUtterance(session, "dest zip 30301 or 78721");
    if (result.session.sheet.lanes.destination.postal_code === "78721") {
      expect(result.session.sheet.lanes.destination.city).toBe("Austin");
      expect(result.session.sheet.lanes.origin.postal_code).not.toBe("78721");
    } else {
      expect(result.session.sheet.lanes.destination.postal_code).not.toBe("30301");
      expect(result.reply).toMatch(/30301 looks like Atlanta/i);
      expect(result.reply).toMatch(/78721/);
    }
  });
});

describe("freeze protect accessorials", () => {
  it("freeze please protect sets protect_from_freeze and copy snapshot lists it", () => {
    const extracted = extractSlots("freeze please protect");
    expect(extracted.pickup.accessorials).toContain("protect_from_freeze");
    expect(extractSlots("protect from freeze").pickup.accessorials).toContain("protect_from_freeze");

    const session = sessionAtlantaAustin();
    session.sheet.lanes.origin.postal_code = "30301";
    session.sheet.lanes.destination.postal_code = "78721";
    session.sheet.freight.pieces = 3;
    session.sheet.freight.commodity = "oranges";
    session.sheet.pickup.date = "2026-09-18";
    session.awaiting = "accessorials";
    const result = handleUtterance(session, "freeze please protect");
    expect(result.session.sheet.pickup.accessorials).toContain("protect_from_freeze");
    expect(result.reply.toLowerCase()).toMatch(/protect from freeze|freeze/);

    const snap = formatQaTranscript(
      [{ role: "user", text: "freeze please protect" }, { role: "assistant", text: result.reply }],
      result.session,
    );
    expect(snap).toMatch(/Accessorials:.*protect_from_freeze/);
  });

  it("please protect / protect while awaiting accessorials sets freeze protect", () => {
    function readyForAccessorials(id) {
      const session = sessionAtlantaAustin();
      session.sheet.lanes.origin.postal_code = "30301";
      session.sheet.lanes.destination.postal_code = "78721";
      session.sheet.freight.pieces = 3;
      session.sheet.freight.total_weight_lbs = 1000;
      session.sheet.freight.commodity = "oranges";
      session.sheet.pickup.date = "2026-09-18";
      session.sheet.pickup.accessorials = [];
      session.awaiting = "accessorials";
      session.id = id;
      return session;
    }

    const please = handleUtterance(readyForAccessorials("protect-please"), "please protect");
    expect(please.session.sheet.pickup.accessorials).toContain("protect_from_freeze");
    expect(please.session.askedAccessorials).toBe(true);
    expect(please.ready).toBe(false);
    expect(please.session.awaiting).toBe("email");
    expect(please.reply.toLowerCase()).toMatch(/protect from freeze|freeze/);

    const bare = handleUtterance(readyForAccessorials("protect-bare"), "protect");
    expect(bare.session.sheet.pickup.accessorials).toContain("protect_from_freeze");
    expect(bare.session.awaiting).not.toBeNull();
    expect(bare.ready).toBe(false);

    const miss = handleUtterance(readyForAccessorials("protect-miss"), "hmm what now");
    expect(miss.session.sheet.pickup.accessorials).toEqual([]);
    expect(miss.session.askedAccessorials).toBe(false);
    expect(miss.session.awaiting).toBe("accessorials");
    expect(miss.ready).toBe(false);
  });
});
