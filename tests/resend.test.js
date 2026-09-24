import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  RESEND_EMAILS_URL,
  RESEND_FROM_DEFAULT,
  sendResendMail,
} from "../token-proxy/src/resend.js";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("sendResendMail", () => {
  it("posts a bearer request and resolves on 2xx", async () => {
    const calls = [];
    const result = await sendResendMail(
      { to: "shipper@example.com", subject: "Hi", text: "Hello", html: "<p>Hello</p>" },
      { RESEND_API_KEY: "re_test_key", MAIL_FROM: "Ops <ops@freightlodge.com>" },
      async (url, init) => {
        calls.push({ url, init });
        return { status: 200, ok: true, json: async () => ({ id: "email_1" }) };
      },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(RESEND_EMAILS_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer re_test_key");
    expect(calls[0].init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      from: "Ops <ops@freightlodge.com>",
      to: ["shipper@example.com"],
      subject: "Hi",
      text: "Hello",
      html: "<p>Hello</p>",
    });
  });

  it("uses the default From when MAIL_FROM is unset", async () => {
    let body;
    await sendResendMail(
      { to: "a@b.com", subject: "S", text: "T" },
      { RESEND_API_KEY: "re_test_key" },
      async (_url, init) => {
        body = JSON.parse(init.body);
        return { status: 202, json: async () => ({}) };
      },
    );
    expect(body.from).toBe(RESEND_FROM_DEFAULT);
    expect(body.html).toBe("");
  });

  it("logs status plus Resend name and message on non-2xx, never the key", async () => {
    const logged = [];
    const orig = console.error;
    console.error = (...args) => logged.push(args);
    try {
      await expect(
        sendResendMail(
          { to: "a@b.com", subject: "S", text: "T" },
          { RESEND_API_KEY: "re_secret_key" },
          async () => ({
            status: 422,
            json: async () => ({ name: "validation_error", message: "Invalid `to` field." }),
          }),
        ),
      ).rejects.toMatchObject({ code: "RESEND_HTTP", status: 422 });
    } finally {
      console.error = orig;
    }
    expect(logged).toEqual([["resend_send_failed", 422, "validation_error", "Invalid `to` field."]]);
    expect(JSON.stringify(logged)).not.toContain("re_secret_key");
  });

  it("logs a network failure and throws without the key", async () => {
    const logged = [];
    const orig = console.error;
    console.error = (...args) => logged.push(args);
    try {
      await expect(
        sendResendMail(
          { to: "a@b.com", subject: "S", text: "T" },
          { RESEND_API_KEY: "re_secret_key" },
          async () => {
            throw new Error("fetch failed re_secret_key");
          },
        ),
      ).rejects.toMatchObject({ code: "RESEND_NETWORK" });
    } finally {
      console.error = orig;
    }
    expect(logged[0][0]).toBe("resend_send_failed");
    expect(logged[0][1]).toBe("network");
    expect(JSON.stringify(logged)).not.toContain("re_secret_key");
  });

  it("throws a 503 config error when RESEND_API_KEY is missing and does not call fetch", async () => {
    let called = false;
    await expect(
      sendResendMail({ to: "a@b.com", subject: "S", text: "T" }, {}, async () => {
        called = true;
        return { status: 200, json: async () => ({}) };
      }),
    ).rejects.toMatchObject({
      code: "RESEND_UNCONFIGURED",
      status: 503,
    });
    expect(called).toBe(false);
  });
});

describe("token-proxy/src has no SMTP client", () => {
  it("contains no cloudflare:sockets and no SMTP_", () => {
    const hits = [];
    for (const file of walk("token-proxy/src")) {
      const text = readFileSync(file, "utf8");
      if (text.includes("cloudflare:sockets") || text.includes("SMTP_")) hits.push(file);
    }
    expect(hits).toEqual([]);
  });
});
