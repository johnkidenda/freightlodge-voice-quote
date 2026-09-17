import { describe, expect, it } from "vitest";
import { createSession, handleUtterance, openingMessage } from "../src/lib/dialog.js";
import { copyTextToClipboard, formatQaTranscript } from "../src/lib/transcript.js";

describe("QA transcript copy", () => {
  it("labels every turn User:/Agent: and appends a sheet snapshot", () => {
    let session = createSession({ id: "qa-1" });
    const first = handleUtterance(session, "destination zip is 78721");
    session = first.session;
    const messages = [
      { role: "assistant", text: openingMessage() },
      { role: "user", text: "destination zip is 78721" },
      { role: "assistant", text: first.reply },
    ];
    const text = formatQaTranscript(messages, session);
    expect(text).toMatch(/^Agent: Freight Lodge/m);
    expect(text).toContain("User: destination zip is 78721");
    expect(text).toContain(`Agent: ${first.reply}`);
    expect(text).toContain("— Sheet snapshot —");
    expect(text).toMatch(/Origin:/);
    expect(text).toMatch(/Dest:.*78721/);
    expect(text).toMatch(/Weight:/);
    expect(text).toMatch(/Pieces:/);
    expect(text).toMatch(/Awaiting:/);
    expect(text).toMatch(/Status: collecting/);
  });

  it("uses clipboard.writeText when the API is present", async () => {
    const writes = [];
    const ok = await copyTextToClipboard("hello transcript", {
      writeText: async (value) => {
        writes.push(value);
      },
    });
    expect(ok).toBe(true);
    expect(writes).toEqual(["hello transcript"]);
  });
});
