import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSession, handleUtterance, openingMessage } from "../src/lib/dialog.js";
import { STT_PROVIDER_IDS, getSttProvider } from "../src/lib/stt-providers.js";
import {
  copyTextToClipboard,
  FORMSUBMIT_AJAX_URL,
  formatQaTranscript,
  formSubmitLooksLikeActivate,
  isFormSubmitDelivered,
  sendSessionTranscript,
  transcriptMailtoHref,
  TRANSCRIPT_TO,
} from "../src/lib/transcript.js";

function jsonRes(body, ok = true) {
  return {
    ok,
    text: async () => JSON.stringify(body),
  };
}

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
    expect(text).toContain("Sheet snapshot:");
    expect(text).toMatch(/Origin:/);
    expect(text).toMatch(/Dest:.*78721/);
    expect(text).toMatch(/Weight:/);
    expect(text).toMatch(/Pieces:/);
    expect(text).toMatch(/Awaiting:/);
    expect(text).toMatch(/Status: collecting/);
    expect(text).toContain("STT: Web Speech");
    expect(text).toContain("Jev: off");
    expect(text).not.toContain("Voice:");
    expect(text).not.toContain("TTS first-audio ms:");
    expect(text).not.toContain("TTS duration ms:");
  });

  it("stamps Web Speech on the sheet snapshot", () => {
    const session = createSession({ id: "stt-snap" });
    const messages = [{ role: "user", text: "hello" }];
    expect(getSttProvider(STT_PROVIDER_IDS.WEB_SPEECH).label).toBe("Web Speech");
    expect(formatQaTranscript(messages, { ...session, sttProvider: STT_PROVIDER_IDS.WEB_SPEECH })).toContain(
      "STT: Web Speech",
    );
    expect(formatQaTranscript(messages, session)).toContain("STT: Web Speech");
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

describe("FormSubmit activate detection", () => {
  it("treats activate / action-required wording as not delivered", () => {
    expect(formSubmitLooksLikeActivate({ success: true, message: "Please activate your form" })).toBe(true);
    expect(formSubmitLooksLikeActivate({ message: "Action required — confirm your email" })).toBe(true);
    expect(formSubmitLooksLikeActivate({}, "Check your inbox to confirm this form")).toBe(true);
    expect(formSubmitLooksLikeActivate({ success: true, message: "Your form has been submitted" })).toBe(false);
    expect(
      isFormSubmitDelivered(jsonRes({ success: true, message: "Please activate / confirm your email" }), {
        success: true,
        message: "Please activate / confirm your email",
      }),
    ).toBe(false);
    expect(isFormSubmitDelivered({ ok: true }, { success: "false" })).toBe(false);
    expect(isFormSubmitDelivered({ ok: true }, { success: true })).toBe(true);
    expect(isFormSubmitDelivered({ ok: true }, { success: "true" })).toBe(true);
  });
});

describe("sendSessionTranscript delivery", () => {
  it("POSTs FormSubmit AJAX as the silent primary path", async () => {
    const session = createSession({ id: "mail-1" });
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return jsonRes({ success: true, message: "Your form has been submitted" });
    };
    const result = await sendSessionTranscript(
      [{ role: "user", text: "Chicago 60601 to Dallas 75201" }],
      session,
      { fetchFn, webhookUrl: "", sttProvider: STT_PROVIDER_IDS.WEB_SPEECH },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(FORMSUBMIT_AJAX_URL);
    expect(calls[0].url).toContain("formsubmit.co/ajax/john@freightlodge.com");
    const body = JSON.parse(calls[0].init.body);
    expect(body.message).toContain("User: Chicago 60601 to Dallas 75201");
    expect(body.message).toContain("STT: Web Speech");
    expect(body.message).not.toContain("Voice:");
    expect(body.message).not.toMatch(/TTS first-audio ms:/);
    expect(body._subject).toContain("[Freight Lodge transcript]");
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("formsubmit");
    expect(transcriptMailtoHref("subj", "body")).toContain(encodeURIComponent(TRANSCRIPT_TO));
    const src = readFileSync("src/lib/transcript.js", "utf8");
    expect(src).toMatch(/formsubmit\.co\/ajax/i);
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain("Opened mail app…");
    expect(app).toContain("Could not send silently. Opened mail");
    expect(app).toContain('result.mode === "formsubmit"');
    expect(app).toContain("sttProvider: STT_PROVIDER_IDS.WEB_SPEECH");
    expect(app).not.toContain("Opened mail app with transcript");
  });

  it("does not claim success on FormSubmit activate-style replies and falls back to mailto", async () => {
    const session = createSession({ id: "activate-1" });
    const messages = [{ role: "assistant", text: "hi" }];
    const result = await sendSessionTranscript(messages, session, {
      webhookUrl: "",
      fetchFn: async () => jsonRes({ success: true, message: "Please activate your email to continue" }),
    });
    expect(result.ok).toBe(false);
    expect(result.mode).toBe("mailto");
    expect(result.mailto).toMatch(/^mailto:john%40freightlodge\.com\?/);
    expect(decodeURIComponent(result.mailto.replace(/\+/g, "%20"))).toContain("[Freight Lodge transcript]");
  });

  it("uses the optional webhook when it returns 2xx, and FormSubmit then mailto on failure", async () => {
    const session = createSession({ id: "hook-1" });
    const messages = [{ role: "assistant", text: "hi" }];
    const ok = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://hooks.example/transcript",
      fetchFn: async () => ({ ok: true }),
    });
    expect(ok.mode).toBe("webhook");
    expect(ok.ok).toBe(true);

    const calls = [];
    const failed = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://hooks.example/transcript",
      fetchFn: async (url) => {
        calls.push(url);
        if (String(url).includes("hooks.example")) throw new Error("network");
        return jsonRes({ success: true });
      },
    });
    expect(calls[0]).toContain("hooks.example");
    expect(failed.mode).toBe("formsubmit");
    expect(failed.ok).toBe(true);

    const mailto = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://hooks.example/transcript",
      fetchFn: async () => {
        throw new Error("network");
      },
    });
    expect(mailto.mode).toBe("mailto");
    expect(mailto.ok).toBe(false);
    expect(mailto.mailto).toContain("mailto:");
  });

  it("treats a FormSubmit webhook activate reply as failure, then retries default FormSubmit", async () => {
    const session = createSession({ id: "hook-fs" });
    const messages = [{ role: "user", text: "lane" }];
    const urls = [];
    const result = await sendSessionTranscript(messages, session, {
      webhookUrl: "https://formsubmit.co/ajax/other@example.com",
      fetchFn: async (url) => {
        urls.push(url);
        if (url.includes("other@example.com")) {
          return jsonRes({ success: "true", message: "Action required — confirm your email" });
        }
        return jsonRes({ success: true, message: "Your form has been submitted" });
      },
    });
    expect(urls[0]).toContain("other@example.com");
    expect(urls[1]).toBe(FORMSUBMIT_AJAX_URL);
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("formsubmit");
  });
});
