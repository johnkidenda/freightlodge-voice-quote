import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance, openingMessage } from "../src/lib/dialog.js";
import {
  copyTextToClipboard,
  formatQaTranscript,
  sendSessionTranscript,
  transcriptMailtoHref,
  TRANSCRIPT_TO,
} from "../src/lib/transcript.js";

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

describe("sendSessionTranscript delivery", () => {
  it("uses mailto as the primary path and never calls FormSubmit", async () => {
    const session = createSession({ id: "mail-1" });
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ success: true }) };
    };
    const result = await sendSessionTranscript(
      [{ role: "user", text: "Chicago 60601 to Dallas 75201" }],
      session,
      { fetchFn, webhookUrl: "" },
    );
    expect(calls).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("mailto");
    expect(result.mailto).toMatch(/^mailto:john%40freightlodge\.com\?/);
    expect(decodeURIComponent(result.mailto.replace(/\+/g, "%20"))).toContain("[Freight Lodge transcript]");
    expect(result.transcript).toContain("User: Chicago 60601 to Dallas 75201");
    expect(transcriptMailtoHref("subj", "body")).toContain(encodeURIComponent(TRANSCRIPT_TO));
    const src = readFileSync("src/lib/transcript.js", "utf8");
    expect(src).not.toMatch(/formsubmit\.co/i);
    expect(readFileSync("src/app.js", "utf8")).toContain("Opened mail app with transcript");
    expect(readFileSync("src/app.js", "utf8")).toContain("Could not send — copy instead");
  });

  it("uses the optional webhook when it returns 2xx, and falls back to mailto on failure", async () => {
    const session = createSession({ id: "hook-1" });
    const messages = [{ role: "assistant", text: "hi" }];
    const ok = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://hooks.example/transcript",
      fetchFn: async () => ({ ok: true }),
    });
    expect(ok.mode).toBe("webhook");
    expect(ok.ok).toBe(true);

    const failed = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://hooks.example/transcript",
      fetchFn: async () => {
        throw new Error("network");
      },
    });
    expect(failed.mode).toBe("mailto");
    expect(failed.ok).toBe(true);
    expect(failed.mailto).toContain("mailto:");
  });
});
