import { getApiBaseUrl } from "./api-base.js";
import { extractContactEmail as peekContactEmail } from "./extract.js";

export const VERIFY_CODE_COOLDOWN_MS = 30_000;
export const VERIFY_CODE_DIGITS = 6;

/**
 * Origin of VITE_API_BASE_URL.
 * `/api` stays `/api`; a Worker root stays the Worker root.
 */
export function getTokenProxyOrigin(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  return getApiBaseUrl(env);
}

export function emailVerifyStartUrl(apiBase = "", env) {
  const origin = getTokenProxyOrigin(env);
  if (origin) {
    if (origin.endsWith("/api") || origin === "/api") return `${origin}/email/verify/start`;
    return `${origin}/email/verify/start`;
  }
  return `${String(apiBase || "").replace(/\/$/, "")}/api/email/verify/start`;
}

export function emailVerifyConfirmUrl(apiBase = "", env) {
  const origin = getTokenProxyOrigin(env);
  if (origin) return `${origin}/email/verify/confirm`;
  return `${String(apiBase || "").replace(/\/$/, "")}/api/email/verify/confirm`;
}

export function emailQuoteSendUrl(apiBase = "", env) {
  const origin = getTokenProxyOrigin(env);
  if (origin) {
    if (origin.endsWith("/api") || origin === "/api") return `${origin}/email-quote`;
    return `${origin}/email/quote`;
  }
  return `${String(apiBase || "").replace(/\/$/, "")}/api/email-quote`;
}

export function extractContactEmail(text, awaiting) {
  return peekContactEmail(text, awaiting) || "";
}

export function looksLikeVerifyCode(text) {
  return /^\s*\d{6}\s*$/.test(String(text || ""));
}

export function holdUnverifiedEmail(session) {
  if (!session?.sheet) return session;
  const status = session.sheet.status === "ready_for_quote" ? "collecting" : session.sheet.status;
  return {
    ...session,
    awaiting: "email",
    sheet: {
      ...session.sheet,
      status,
      contact: { ...(session.sheet.contact || {}), email: null },
    },
  };
}

export function verifyStartCopy(email, conversational = false) {
  const addr = String(email || "").trim();
  if (conversational) return `I emailed a 6-digit code to ${addr}. Type it here.`;
  return `I sent a 6-digit code to ${addr}. Type it here to confirm that address.`;
}

export function verifyFailCopy() {
  return "That code didn’t work. Try again, or ask me to resend.";
}

export function verifySendFailCopy(email) {
  const addr = String(email || "").trim();
  return addr
    ? `I couldn’t send a code to ${addr}. Check the address and try again.`
    : "I couldn’t send a code. Check the address and try again.";
}

export function verifyExpiredCopy() {
  return "That code expired. Tap Resend for a new one.";
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function startEmailVerify(email, { fetchFn, apiBase = "", env } = {}) {
  const url = emailVerifyStartUrl(apiBase, env);
  const fetchImpl = fetchFn || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) {
    return { ok: false, error: "Could not send a code." };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: String(email || "").trim() }),
    });
    const data = await readJsonSafe(res);
    if (data?.ok && data.challenge_id) {
      return {
        ok: true,
        challenge_id: data.challenge_id,
        expires_in: Number(data.expires_in) > 0 ? Number(data.expires_in) : 600,
        dev: Boolean(data.dev),
        email: String(email || "").trim(),
      };
    }
    return {
      ok: false,
      error: data?.error || (res.status === 503 ? "Email send is not configured." : "Could not send a code."),
      status: res.status,
    };
  } catch {
    return { ok: false, error: "Could not send a code." };
  }
}

export async function confirmEmailVerify(email, challengeId, code, { fetchFn, apiBase = "", env } = {}) {
  const url = emailVerifyConfirmUrl(apiBase, env);
  const fetchImpl = fetchFn || (typeof fetch === "function" ? fetch : null);
  if (!fetchImpl) {
    return { ok: false, error: "That code didn’t work." };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: String(email || "").trim(),
        challenge_id: challengeId,
        code: String(code || "").trim(),
      }),
    });
    const data = await readJsonSafe(res);
    if (data?.ok && data.verified) {
      return { ok: true, verified: true, email: data.email || String(email || "").trim() };
    }
    return { ok: false, error: data?.error || "That code didn’t work." };
  } catch {
    return { ok: false, error: "That code didn’t work." };
  }
}
