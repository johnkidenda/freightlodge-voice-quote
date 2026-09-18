import { describe, expect, it } from "vitest";
import { applyExtractedSlots, extractSlots } from "../src/lib/extract.js";
import { emptySheet } from "../src/lib/sheet.js";
import { createSession, handleUtterance } from "../src/lib/dialog.js";
import { createTranscriptBuffer } from "../src/lib/speech.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";
import { presentAgentReply } from "../src/lib/conversational.js";

const DUMP = "ship a thousand pounds of oranges from Austin to Atlanta";
const GATES = ["origin_zip", "dest_zip", "pieces", "commodity", "measure"];

describe("hold-and-dump — multi-slot from one utterance", () => {
  it("extracts weight, commodity, origin city, dest city even when awaiting origin_zip", () => {
    for (const awaiting of GATES) {
      const extracted = extractSlots(DUMP, { awaiting });
      expect(extracted.freight.total_weight_lbs, awaiting).toBe(1000);
      expect(extracted.freight.commodity, awaiting).toMatch(/orange/i);
      expect(extracted.origin.city, awaiting).toBe("Austin");
      expect(extracted.destination.city, awaiting).toBe("Atlanta");
      expect(extracted.origin.postal_code, awaiting).toBeUndefined();
      expect(extracted.destination.postal_code, awaiting).toBeUndefined();
    }
  });

  it("apply parks every slot while session is gated on origin_zip", () => {
    const session = createSession({ id: "dump-1" });
    expect(session.awaiting).toBe("origin_zip");
    const extracted = extractSlots(DUMP, { awaiting: session.awaiting });
    const sheet = applyExtractedSlots(emptySheet({ id: "dump-apply" }), extracted);
    expect(sheet.freight.total_weight_lbs).toBe(1000);
    expect(sheet.freight.commodity).toMatch(/orange/i);
    expect(sheet.lanes.origin.city).toBe("Austin");
    expect(sheet.lanes.destination.city).toBe("Atlanta");
  });

  it("one agent turn parks all four and asks only for the next missing ZIP", () => {
    const session = createSession({ id: "dump-turn" });
    const result = handleUtterance(session, DUMP);
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.session.sheet.lanes.origin.postal_code).toBeNull();
    expect(result.session.sheet.lanes.destination.postal_code).toBeNull();
    expect(result.reply).toMatch(/^Got /);
    expect(result.reply).toMatch(/1000/);
    expect(result.reply).toMatch(/orange/i);
    expect(result.reply).toMatch(/Austin/);
    expect(result.reply).toMatch(/Atlanta/);
    expect(result.session.awaiting).toBe("origin_zip");
    expect(result.reply).toMatch(/origin ZIP/i);
    expect(result.reply).not.toMatch(/How many pieces/i);
    expect(result.reply).not.toMatch(/What’s the commodity/i);
  });

  it("scripted hold releases the full dump once, then the agent parks every slot", () => {
    const buf = createTranscriptBuffer();
    buf.start();
    const progressive = [
      "ship",
      "ship a thousand pounds",
      "ship a thousand pounds of oranges from Austin",
      DUMP,
    ];
    for (const text of progressive) {
      const step = buf.applyResults([{ transcript: text, isFinal: true }]);
      expect(step.commit).toBeNull();
    }
    const committed = buf.release();
    expect(committed).toBe(DUMP);

    const result = handleUtterance(createSession({ id: "dump-hold" }), committed);
    expect(result.session.sheet.freight.total_weight_lbs).toBe(1000);
    expect(result.session.sheet.freight.commodity).toMatch(/orange/i);
    expect(result.session.sheet.lanes.origin.city).toBe("Austin");
    expect(result.session.sheet.lanes.destination.city).toBe("Atlanta");
    expect(result.reply).toMatch(/^Got /);
    expect(result.session.awaiting).toBe("origin_zip");

    const transcript = formatSessionTranscript(
      [
        { role: "user", text: committed },
        { role: "assistant", text: result.reply },
      ],
      result.session,
    );
    expect(transcript).toContain("STT: Web Speech");
    expect(transcript).toMatch(/Austin/);
    expect(transcript).toMatch(/Atlanta/);
    expect(transcript).toMatch(/1000/);
  });

  it("conversational rewrite acknowledges the dump and asks only for ZIPs", () => {
    const result = handleUtterance(createSession({ id: "dump-convo" }), DUMP);
    const warm = presentAgentReply(result, true);
    expect(warm).toMatch(/Austin/);
    expect(warm).toMatch(/Atlanta/);
    expect(warm).toMatch(/1000/);
    expect(warm).toMatch(/orange/i);
    expect(warm).toMatch(/ZIP/i);
    expect(warm).not.toMatch(/I won’t look one up/i);
    expect(presentAgentReply(result, false)).toBe(result.reply);
  });
});
