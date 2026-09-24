/**
 * Send mail through the Resend HTTP API. Works in the Worker and in Node.
 * Never log RESEND_API_KEY.
 */

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const RESEND_FROM_DEFAULT = "Freight Lodge <john@freightlodge.com>";

export function mailFromAddress(env = {}) {
  const from = String(env?.MAIL_FROM || "").trim();
  return from || RESEND_FROM_DEFAULT;
}

export function resendConfigured(env = {}) {
  return Boolean(String(env?.RESEND_API_KEY || "").trim());
}

function errorNameMessage(data) {
  if (!data || typeof data !== "object") return { name: "", message: "" };
  const nested = data.error && typeof data.error === "object" ? data.error : null;
  return {
    name: String(data.name || nested?.name || "").slice(0, 80),
    message: String(data.message || nested?.message || "").slice(0, 180),
  };
}

export async function sendResendMail(msg, env = {}, fetchImpl = globalThis.fetch) {
  const key = String(env?.RESEND_API_KEY || "").trim();
  if (!key) {
    const err = new Error("Email send is not configured. RESEND_API_KEY is missing.");
    err.code = "RESEND_UNCONFIGURED";
    err.status = 503;
    throw err;
  }
  const from = String(msg?.from || "").trim() || mailFromAddress(env);
  const to = String(msg?.to || "").trim();
  const subject = String(msg?.subject || "");
  const text = String(msg?.text || "");
  const html = msg?.html == null ? "" : String(msg.html);
  let response;
  try {
    response = await fetchImpl(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
  } catch (err) {
    const message = String(err?.message || err).replaceAll(key, "[redacted]").slice(0, 180);
    console.error("resend_send_failed", "network", message);
    const wrapped = new Error("Could not reach Resend.");
    wrapped.code = "RESEND_NETWORK";
    throw wrapped;
  }
  if (response.status >= 200 && response.status < 300) return { ok: true };
  let name = "";
  let message = "";
  try {
    const parsed = errorNameMessage(await response.json());
    name = parsed.name;
    message = parsed.message;
  } catch {
    /* non-JSON error body */
  }
  console.error("resend_send_failed", response.status, name, message);
  const err = new Error(message || "Resend rejected the email.");
  err.code = "RESEND_HTTP";
  err.status = response.status;
  throw err;
}
