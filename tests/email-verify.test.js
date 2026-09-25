import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readClientUi } from "./client-ui.js";
import { describe, expect, it } from "vitest";
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  confirmEmailVerification,
  createEmailStore,
  generateVerifyCode,
  hashEmailCode,
  peekDevChallenge,
  resetEmailStore,
  sendQuoteEmail,
  startEmailVerification,
  timingSafeEqual,
} from "../token-proxy/src/email-verify.js";
import { emailQuote, EMAIL_LOGO_CREAM, formatQuoteEmail, formatQuoteEmailHtml, LOGO_URL, mailtoHref } from "../src/lib/email.js";
import { EMAIL_LOGO_CREAM as BAKED_CREAM, EMAIL_LOGO_PAD } from "../scripts/bake-email-logo.mjs";
import { handleUtterance } from "../src/lib/dialog.js";
import {
  confirmEmailVerify,
  emailQuoteSendUrl,
  emailVerifyConfirmUrl,
  emailVerifyStartUrl,
  extractContactEmail,
  getTokenProxyOrigin,
  holdUnverifiedEmail,
  looksLikeVerifyCode,
  startEmailVerify,
} from "../src/lib/email-verify-client.js";
import { createSession } from "../src/lib/dialog.js";

function sha256Utf8(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("verify code hash / expiry / attempts", () => {
  it("hashes SHA-256 of email|code|salt and never returns the code", async () => {
    const store = createEmailStore();
    const sent = [];
    const result = await startEmailVerification({
      email: " Shipper@Example.COM ",
      ip: "1.1.1.1",
      env: { RESEND_API_KEY: "re_test" },
      store,
      sendMail: async (msg) => {
        sent.push(msg);
      },
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.challenge_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.body.expires_in).toBe(600);
    expect(JSON.stringify(result.body)).not.toMatch(/\b\d{6}\b/);
    expect(result.body.code).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toBe("Freight Lodge <john@freightlodge.com>");
    expect(sent[0].to).toBe("shipper@example.com");
    expect(sent[0].subject).toMatch(/Freight Lodge code/i);
    expect(sent[0].text).toMatch(/\b\d{6}\b/);

    const row = store.challenges.get(result.body.challenge_id);
    expect(row.hash).toBe(await hashEmailCode("shipper@example.com", sent[0].text.match(/\b(\d{6})\b/)[1], row.salt));
    expect(row.hash).toBe(
      sha256Utf8(`shipper@example.com|${sent[0].text.match(/\b(\d{6})\b/)[1]}|${row.salt}`),
    );
    expect(row.hash).not.toBe(sent[0].text.match(/\b(\d{6})\b/)[1]);
  });

  it("confirms a valid code once, then rejects reuse", async () => {
    const store = createEmailStore();
    let code = "";
    const start = await startEmailVerification({
      email: "a@b.com",
      env: { RESEND_API_KEY: "re_test" },
      store,
      sendMail: async (msg) => {
        code = msg.text.match(/\b(\d{6})\b/)[1];
      },
    });
    const ok = await confirmEmailVerification({
      email: "a@b.com",
      challenge_id: start.body.challenge_id,
      code,
      store,
    });
    expect(ok.body).toEqual({ ok: true, verified: true, email: "a@b.com" });
    const reuse = await confirmEmailVerification({
      email: "a@b.com",
      challenge_id: start.body.challenge_id,
      code,
      store,
    });
    expect(reuse.body.ok).toBe(false);
    expect(reuse.body.error).toMatch(/didn[’']t work/i);
  });

  it("expires after 10 minutes", async () => {
    const store = createEmailStore();
    let now = 1_000_000;
    let code = "";
    const start = await startEmailVerification({
      email: "a@b.com",
      env: { RESEND_API_KEY: "re_test" },
      store,
      now: () => now,
      sendMail: async (msg) => {
        code = msg.text.match(/\b(\d{6})\b/)[1];
      },
    });
    now += CODE_TTL_MS + 1;
    const expired = await confirmEmailVerification({
      email: "a@b.com",
      challenge_id: start.body.challenge_id,
      code,
      store,
      now: () => now,
    });
    expect(expired.body.ok).toBe(false);
    expect(expired.body.error).toMatch(/expir/i);
  });

  it("invalidates after about 5 wrong attempts even if the last try is right", async () => {
    const store = createEmailStore();
    let code = "";
    const start = await startEmailVerification({
      email: "a@b.com",
      env: { RESEND_API_KEY: "re_test" },
      store,
      sendMail: async (msg) => {
        code = msg.text.match(/\b(\d{6})\b/)[1];
      },
    });
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      const fail = await confirmEmailVerification({
        email: "a@b.com",
        challenge_id: start.body.challenge_id,
        code: "000000" === code ? "111111" : "000000",
        store,
      });
      expect(fail.body.ok).toBe(false);
    }
    const late = await confirmEmailVerification({
      email: "a@b.com",
      challenge_id: start.body.challenge_id,
      code,
      store,
    });
    expect(late.body.ok).toBe(false);
    expect(JSON.stringify(late.body)).not.toContain(code);
  });

  it("production without RESEND_API_KEY is 503; DEV mode logs but omits the code from JSON", async () => {
    const store = createEmailStore();
    const prod = await startEmailVerification({
      email: "a@b.com",
      env: {},
      store,
    });
    expect(prod.status).toBe(503);
    expect(prod.body.ok).toBe(false);

    resetEmailStore(store);
    const dev = await startEmailVerification({
      email: "dev@example.com",
      env: { EMAIL_VERIFY_DEV_MODE: "1" },
      store,
    });
    expect(dev.status).toBe(200);
    expect(dev.body.dev).toBe(true);
    expect(dev.body.code).toBeUndefined();
    expect(JSON.stringify(dev.body)).not.toMatch(/\b\d{6}\b/);
    const peeked = peekDevChallenge(store, dev.body.challenge_id);
    expect(peeked).toMatch(/^\d{6}$/);
    const ok = await confirmEmailVerification({
      email: "dev@example.com",
      challenge_id: dev.body.challenge_id,
      code: peeked,
      store,
    });
    expect(ok.body.verified).toBe(true);
  });

  it("generateVerifyCode is 6 digits; timingSafeEqual is length-safe", () => {
    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
      const code = generateVerifyCode();
      expect(code).toMatch(/^\d{6}$/);
      seen.add(code);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
  });
});

describe("quote email send — no mailto success", () => {
  it("emailQuote reports Resend success without a mailto field and posts HTML", async () => {
    const sheet = {
      status: "quoted",
      quote_request_id: "q1",
      lanes: {
        origin: { city: "Chicago", state: "IL", postal_code: "60601" },
        destination: { city: "Dallas", state: "TX", postal_code: "75201" },
      },
      freight: { pieces: 3, total_weight_lbs: 1200, commodity: "auto parts" },
      pickup: { date: "2026-09-18" },
      contact: { email: "shipper@example.com" },
      quote_result: { quote_id: "R1", carrier: "X", total_usd: 10, transit_days_min: 2, transit_days_max: 4 },
    };
    const result = await emailQuote(sheet, {
      apiBase: "",
      env: { VITE_API_BASE_URL: "https://proxy.example" },
      fetchFn: async (url, init) => {
        expect(url).toBe("https://proxy.example/email/quote");
        const payload = JSON.parse(init.body);
        expect(payload.to).toBe("shipper@example.com");
        expect(payload.from).toBe("john@freightlodge.com");
        expect(payload.html).toContain("Freight Lodge");
        expect(payload.html).toContain("$10.00");
        expect(payload.html).toMatch(/60601/);
        return {
          ok: true,
          json: async () => ({ ok: true, sent: true, mode: "resend", to: payload.to, from: payload.from }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.mailto).toBeUndefined();
    expect(result.mode).toBe("resend");
    expect(result.html).toContain("<!DOCTYPE html>");
  });

  it("emailQuote failure returns the quote body and no mailto", async () => {
    const sheet = {
      status: "quoted",
      quote_request_id: "q2",
      contact: { email: "shipper@example.com" },
      quote_result: { quote_id: "R2" },
    };
    const result = await emailQuote(sheet, {
      fetchFn: async () => {
        throw new Error("offline");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.sent).toBe(false);
    expect(result.mailto).toBeUndefined();
    expect(result.body).toContain("Freight Lodge quote");
    expect(result.error).toMatch(/could not send/i);
  });

  it("sendQuoteEmail sends HTML through the mail hook", async () => {
    const sent = [];
    const sheet = { status: "quoted", quote_request_id: "q3", quote_result: { quote_id: "R3", carrier: "Y", total_usd: 42 } };
    const result = await sendQuoteEmail({
      to: "shipper@example.com",
      subject: "Freight Lodge quote",
      text: formatQuoteEmail(sheet).body,
      html: formatQuoteEmailHtml(sheet).html,
      env: { RESEND_API_KEY: "re_test" },
      sendMail: async (msg) => sent.push(msg),
    });
    expect(result.status).toBe(200);
    expect(result.body.sent).toBe(true);
    expect(result.body.mode).toBe("resend");
    expect(sent[0].from).toBe("Freight Lodge <john@freightlodge.com>");
    expect(sent[0].html).toContain("Freight Lodge");
    expect(sent[0].html).toContain("$42.00");
    expect(mailtoHref({ contact: { email: "x@y.com" } })).toMatch(/^mailto:/);
  });
});

describe("formatQuoteEmailHtml mirrors the quote card", () => {
  it("includes lane, freight, pickup, branding, and quoted totals", () => {
    const { html, subject } = formatQuoteEmailHtml({
      status: "quoted",
      quote_request_id: "req-88",
      lanes: {
        origin: { city: "Chicago", state: "IL", postal_code: "60601" },
        destination: { city: "Dallas", state: "TX", postal_code: "75201" },
      },
      freight: { pieces: 3, total_weight_lbs: 1200, commodity: "auto parts" },
      pickup: { date: "2026-09-18" },
      quote_result: {
        quote_id: "EX-100",
        carrier: "SAIA",
        service: "LTL",
        total_usd: 412.5,
        transit_days_min: 2,
        transit_days_max: 4,
        raw_summary: "Lowest of 3 rates",
      },
    });
    expect(subject).toBe("Freight Lodge quote EX-100");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Freight Lodge");
    expect(html).toContain("SAIA");
    expect(html).toContain("$412.50");
    expect(html).toContain("2–4 days");
    expect(html).toContain("EX-100");
    expect(html).toContain("Chicago, IL, 60601 → Dallas, TX, 75201");
    expect(html).toContain("auto parts");
    expect(html).toContain("1200 lb");
    expect(html).toContain("2026-09-18");
    expect(html).toMatch(/#f4efe6|#fffdf8|#1b2a4a/);
    expect(html).toContain(EMAIL_LOGO_CREAM);
    expect(html).toContain(`bgcolor="${EMAIL_LOGO_CREAM}"`);
    expect(html).toContain("logo-b-email.png");
    expect(html).not.toContain("logo-b.png");
    expect(html).not.toMatch(/prefers-color-scheme/);
    expect(LOGO_URL).toMatch(/logo-b-email\.png$/);
    expect(html).not.toContain("<script");
  });

  it("bakes the wordmark onto an opaque cream plate (no alpha for Gmail dark mode)", () => {
    expect(EMAIL_LOGO_CREAM.toLowerCase()).toBe("#f5f0e8");
    expect(BAKED_CREAM).toEqual([0xf5, 0xf0, 0xe8]);
    expect(EMAIL_LOGO_PAD).toBeGreaterThan(0);
    const data = readFileSync("public/assets/logo-b-email.png");
    expect(data.subarray(0, 8).toString("binary")).toBe("\x89PNG\r\n\x1a\n");
    const bitDepth = data[24];
    const colorType = data[25];
    expect(bitDepth).toBe(8);
    expect(colorType).toBe(2);
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    expect(width).toBe(640 + EMAIL_LOGO_PAD * 2);
    expect(height).toBe(253 + EMAIL_LOGO_PAD * 2);
  });

  it("mirrors error and out-of-scope copy without inventing a rate", () => {
    const errored = formatQuoteEmailHtml({
      status: "error",
      quote_request_id: "q-err",
      error_reason: "Exfresso login timeout",
      quote_result: null,
    });
    expect(errored.html).toMatch(/Exfresso login timeout/);
    expect(errored.html).not.toMatch(/\$\d/);

    const oos = formatQuoteEmailHtml({
      status: "out_of_scope",
      quote_request_id: "q-oos",
      out_of_scope_reason: "Hard international",
      quote_result: null,
    });
    expect(oos.html).toMatch(/Hard international/);
    expect(oos.html).not.toMatch(/\$\d/);
  });
});

describe("client helpers", () => {
  it("maps VITE_API_BASE_URL origin for email routes", () => {
    expect(getTokenProxyOrigin({ VITE_API_BASE_URL: "https://tunnel.example" })).toBe("https://tunnel.example");
    expect(emailVerifyStartUrl("", { VITE_API_BASE_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/verify/start",
    );
    expect(emailVerifyConfirmUrl("", { VITE_API_BASE_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/verify/confirm",
    );
    expect(emailQuoteSendUrl("", { VITE_API_BASE_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/quote",
    );
    expect(emailVerifyStartUrl("/app", { VITE_API_BASE_URL: "/api" })).toBe("/api/email/verify/start");
    expect(emailQuoteSendUrl("/app", { VITE_API_BASE_URL: "/api" })).toBe("/api/email-quote");
    expect(emailVerifyStartUrl("/app", {})).toBe("/app/api/email/verify/start");
  });

  it("start/confirm helpers never treat a code in JSON as success input", async () => {
    const calls = [];
    const start = await startEmailVerify("a@b.com", {
      fetchFn: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ ok: true, challenge_id: "cid-1", expires_in: 600, code: "999999" }) };
      },
    });
    expect(start.ok).toBe(true);
    expect(start.challenge_id).toBe("cid-1");
    expect(start.code).toBeUndefined();

    const confirm = await confirmEmailVerify("a@b.com", "cid-1", "123456", {
      fetchFn: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, json: async () => ({ ok: true, verified: true, email: "a@b.com" }) };
      },
    });
    expect(confirm).toEqual({ ok: true, verified: true, email: "a@b.com" });
    expect(calls[1].body.code).toBe("123456");
  });

  it("holds an extracted email off the sheet until confirm", () => {
    const session = createSession({ id: "hold-email" });
    session.sheet.contact.email = "shipper@example.com";
    session.sheet.status = "ready_for_quote";
    session.awaiting = null;
    const held = holdUnverifiedEmail(session);
    expect(held.sheet.contact.email).toBeNull();
    expect(held.sheet.status).toBe("collecting");
    expect(held.awaiting).toBe("email");
    expect(extractContactEmail("please use shipper@example.com")).toBe("shipper@example.com");
    expect(looksLikeVerifyCode(" 042891 ")).toBe(true);
    expect(looksLikeVerifyCode("shipper@example.com")).toBe(false);
  });
});

describe("quote path does not require a verify challenge", () => {
  it("typing the sheet email completes the quote without a 6-digit code", () => {
    const session = createSession({ id: "no-otp" });
    session.sheet.lanes.origin.postal_code = "60601";
    session.sheet.lanes.destination.postal_code = "75201";
    session.sheet.freight.pieces = 3;
    session.sheet.freight.total_weight_lbs = 1200;
    session.sheet.freight.commodity = "auto parts";
    session.sheet.pickup.date = "2026-09-18";
    session.askedAccessorials = true;
    session.awaiting = "email";
    const result = handleUtterance(session, "shipper@example.com");
    expect(result.ready).toBe(true);
    expect(result.session.sheet.contact.email).toBe("shipper@example.com");
    expect(result.session.awaiting).toBeNull();
    expect(result.reply).not.toMatch(/6-digit|confirmation code|type it here/i);
  });

  it("app happy path never starts verify or assigns mailto for quote mail", () => {
    const app = readClientUi();
    expect(app).not.toContain("startEmailVerify");
    expect(app).not.toContain("confirmEmailVerify");
    expect(app).not.toContain("holdUnverifiedEmail");
    expect(app).not.toContain("Type the 6-digit code");
    expect(app).not.toContain("data-resend-code");
    expect(app).toContain("copyTextToClipboard(result.body");
    expect(app).toContain("Your quote is");
    expect(app).toContain("Tap 'Email me this quote'");
    const sendEmailFn = app.slice(app.indexOf("async function sendEmail"), app.indexOf("function push("));
    expect(sendEmailFn).not.toMatch(/location\.href/);
    expect(sendEmailFn).not.toMatch(/mailto/);
    expect(app).not.toMatch(/Demo opens a mailto/);
    const acceptFn = app.slice(app.indexOf("async function acceptUserText"), app.indexOf("async function runHandoff"));
    expect(acceptFn).not.toMatch(/verify|challenge|otp/i);
    expect(acceptFn).toContain("handleUtterance");
  });

  it("token-proxy and Vite still expose verify + quote routes for later", () => {
    const stub = readFileSync("token-proxy/local-stub.mjs", "utf8");
    const worker = readFileSync("token-proxy/src/index.js", "utf8");
    const vite = readFileSync("server/vite-plugin-api.js", "utf8");
    const readme = readFileSync("token-proxy/README.md", "utf8");
    expect(stub).toContain("/email/verify/start");
    expect(worker).toContain("isEmailApiPath");
    expect(vite).toContain("/api/email/verify/start");
    expect(vite).toContain("formatQuoteEmailHtml");
    expect(readme).toContain("POST /email/verify/start");
    expect(readme).toContain("RESEND_API_KEY");
    expect(readme).toContain("html?");
  });
});
