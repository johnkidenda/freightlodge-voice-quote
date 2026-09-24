import { describe, expect, it } from "vitest";
import { createSession, handleUtterance } from "../src/lib/dialog.js";

describe("same origin/dest ZIP confirm", () => {
  it("does not park dest 30301 when origin is already 30301 until they confirm", () => {
    let session = createSession({ id: "same-zip" });
    session = handleUtterance(session, "origin zip 30301").session;
    expect(session.sheet.lanes.origin.postal_code).toBe("30301");
    session.awaiting = "dest_zip";
    session.sheet.lanes.destination.city = "Atlanta";
    const result = handleUtterance(session, "destination zip 30301");
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(result.session.zipClarify.kind).toBe("same");
    expect(result.reply).toMatch(/both be 30301/i);
    expect(result.reply).toMatch(/same zip code both ends/i);
    expect(result.reply).not.toMatch(/won’t|invent|guess/i);
  });

  it("yes parks dest 30301; no leaves dest ZIP empty", () => {
    let session = createSession({ id: "same-yes" });
    session = handleUtterance(session, "origin zip 30301").session;
    session.awaiting = "dest_zip";
    session.sheet.lanes.destination.city = "Atlanta";
    session = handleUtterance(session, "destination zip 30301").session;
    const yes = handleUtterance(session, "yes");
    expect(yes.session.sheet.lanes.destination.postal_code).toBe("30301");
    expect(yes.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(yes.session.zipClarify).toBeNull();
    expect(yes.session.sameZipConfirmed).toBe(true);

    session = createSession({ id: "same-no" });
    session = handleUtterance(session, "origin zip 30301").session;
    session.awaiting = "dest_zip";
    session.sheet.lanes.destination.city = "Atlanta";
    session = handleUtterance(session, "destination zip 30301").session;
    const no = handleUtterance(session, "no");
    expect(no.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(no.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(no.reply.toLowerCase()).toMatch(/destination zip|dest/);
  });

  it("distinct ZIPs still park without a same-end ask", () => {
    const result = handleUtterance(createSession({ id: "distinct" }), "from 60601 to 75201");
    expect(result.session.sheet.lanes.origin.postal_code).toBe("60601");
    expect(result.session.sheet.lanes.destination.postal_code).toBe("75201");
    expect(result.extracted.flags.zipClarify).toBeFalsy();
    expect(result.reply).not.toMatch(/same zip(?: code)? both ends/i);
  });
});
