import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { emailQuote, formatQuoteEmail, mailtoHref } from "../src/lib/email.js";
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
      env: { SMTP_PASS: "secret" },
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
    expect(sent[0].from).toBe("john@freightlodge.com");
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
      env: { SMTP_PASS: "x" },
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
      env: { SMTP_PASS: "x" },
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
      env: { SMTP_PASS: "x" },
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

  it("production without SMTP_PASS is 503; DEV mode logs but omits the code from JSON", async () => {
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
  it("emailQuote reports SMTP success without a mailto field", async () => {
    const sheet = {
      status: "quoted",
      quote_request_id: "q1",
      contact: { email: "shipper@example.com" },
      quote_result: { quote_id: "R1", carrier: "X", total_usd: 10, transit_days_min: 2, transit_days_max: 4 },
    };
    const result = await emailQuote(sheet, {
      apiBase: "",
      env: { VITE_STT_TOKEN_URL: "https://proxy.example/stt-token" },
      fetchFn: async (url, init) => {
        expect(url).toBe("https://proxy.example/email/quote");
        const payload = JSON.parse(init.body);
        expect(payload.to).toBe("shipper@example.com");
        expect(payload.from).toBe("john@freightlodge.com");
        return {
          ok: true,
          json: async () => ({ ok: true, sent: true, mode: "smtp", to: payload.to, from: payload.from }),
        };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(result.mailto).toBeUndefined();
    expect(result.mode).toBe("smtp");
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

  it("sendQuoteEmail uses SMTP when sendMail is provided", async () => {
    const sent = [];
    const result = await sendQuoteEmail({
      to: "shipper@example.com",
      subject: "Freight Lodge quote",
      text: formatQuoteEmail({ status: "quoted", quote_request_id: "q3", quote_result: {} }).body,
      env: { SMTP_PASS: "secret" },
      sendMail: async (msg) => sent.push(msg),
    });
    expect(result.status).toBe(200);
    expect(result.body.sent).toBe(true);
    expect(result.body.mode).toBe("smtp");
    expect(sent[0].from).toBe("john@freightlodge.com");
    expect(mailtoHref({ contact: { email: "x@y.com" } })).toMatch(/^mailto:/);
  });
});

describe("client helpers", () => {
  it("maps VITE_STT_TOKEN_URL origin the same way as /jev", () => {
    expect(getTokenProxyOrigin({ VITE_STT_TOKEN_URL: "https://tunnel.example" })).toBe("https://tunnel.example");
    expect(emailVerifyStartUrl("", { VITE_STT_TOKEN_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/verify/start",
    );
    expect(emailVerifyConfirmUrl("", { VITE_STT_TOKEN_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/verify/confirm",
    );
    expect(emailQuoteSendUrl("", { VITE_STT_TOKEN_URL: "https://tunnel.example" })).toBe(
      "https://tunnel.example/email/quote",
    );
    expect(emailVerifyStartUrl("/app", { VITE_STT_TOKEN_URL: "/api/stt-token" })).toBe("/api/email/verify/start");
    expect(emailQuoteSendUrl("/app", { VITE_STT_TOKEN_URL: "/api/stt-token" })).toBe("/api/email-quote");
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

describe("app no longer opens mailto for verify or quote email", () => {
  it("sendEmail copies on failure and never assigns location.href for quote mail", () => {
    const app = readFileSync("src/app.js", "utf8");
    expect(app).toContain("startEmailVerify");
    expect(app).toContain("confirmEmailVerify");
    expect(app).toContain("Type the 6-digit code…");
    expect(app).toContain("data-resend-code");
    expect(app).toContain("copyTextToClipboard(result.body");
    const sendEmailFn = app.slice(app.indexOf("async function sendEmail"), app.indexOf("function push("));
    expect(sendEmailFn).not.toMatch(/location\.href/);
    expect(sendEmailFn).not.toMatch(/mailto/);
    expect(app).not.toMatch(/Demo opens a mailto/);
  });

  it("token-proxy and Vite expose the verify + quote routes", () => {
    const stub = readFileSync("token-proxy/local-stub.mjs", "utf8");
    const worker = readFileSync("token-proxy/src/index.js", "utf8");
    const vite = readFileSync("server/vite-plugin-api.js", "utf8");
    const readme = readFileSync("token-proxy/README.md", "utf8");
    expect(stub).toContain("/email/verify/start");
    expect(worker).toContain("isEmailApiPath");
    expect(vite).toContain("/api/email/verify/start");
    expect(readme).toContain("POST /email/verify/start");
    expect(readme).toContain("SMTP_PASS");
  });
});
