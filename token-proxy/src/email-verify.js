/**
 * In-app email verification: 6-digit code, hash-only storage, TTL, attempts.
 *
 * Storage is in-memory (fine for the local stub / Vite middleware).
 * A Cloudflare Worker isolate would need a durable store (KV / D1) later —
 * this Map does not survive deploys or multi-isolate traffic.
 *
 * Never put SMTP_PASS or the plaintext code in a client response.
 */

export const MAIL_FROM_DEFAULT = "john@freightlodge.com";
export const CODE_DIGITS = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_TTL_SEC = Math.round(CODE_TTL_MS / 1000);
export const MAX_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_PER_EMAIL = 5;
export const RATE_LIMIT_PER_IP = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_FAIL = "That code didn’t work.";
const GENERIC_EXPIRED = "That code expired. Ask for a new one.";
const GENERIC_RATE = "Please wait a bit and try again.";

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmailAddress(value) {
  const email = normalizeEmail(value);
  return email.length > 0 && EMAIL_RE.test(email);
}

export function smtpSettings(env = {}) {
  return {
    host: String(env.SMTP_HOST || "smtp.hostinger.com").trim() || "smtp.hostinger.com",
    port: Number(env.SMTP_PORT || 465) || 465,
    user: String(env.SMTP_USER || MAIL_FROM_DEFAULT).trim() || MAIL_FROM_DEFAULT,
    pass: String(env.SMTP_PASS || "").trim(),
    from: String(env.MAIL_FROM || MAIL_FROM_DEFAULT).trim() || MAIL_FROM_DEFAULT,
  };
}

export function isDevVerifyMode(env = {}) {
  const raw = String(env.EMAIL_VERIFY_DEV_MODE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function smtpPasswordSet(env = {}) {
  return Boolean(smtpSettings(env).pass);
}

function hex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomBytes(size, getRandomValues = (arr) => crypto.getRandomValues(arr)) {
  const buf = new Uint8Array(size);
  getRandomValues(buf);
  return buf;
}

export function newChallengeId(getRandomValues) {
  if (typeof crypto.randomUUID === "function" && !getRandomValues) {
    return crypto.randomUUID();
  }
  const bytes = randomBytes(16, getRandomValues);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = hex(bytes);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function newSalt(getRandomValues) {
  return hex(randomBytes(16, getRandomValues));
}

/**
 * Cryptographically random 6-digit code (000000–999999).
 * Rejection sampling avoids modulo bias from 2^32 % 1e6.
 */
export function generateVerifyCode(getRandomValues = (arr) => crypto.getRandomValues(arr)) {
  const max = 10 ** CODE_DIGITS;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let n;
  do {
    getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % max).padStart(CODE_DIGITS, "0");
}

export async function hashEmailCode(email, code, salt) {
  const payload = `${normalizeEmail(email)}|${String(code)}|${String(salt)}`;
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(new Uint8Array(digest));
}

export function timingSafeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  const len = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function createEmailStore() {
  return {
    challenges: new Map(),
    rate: new Map(),
    /** Dev/test only — never serialized to clients. */
    lastDev: null,
    devCodes: new Map(),
  };
}

export const defaultEmailStore = createEmailStore();

export function resetEmailStore(store = defaultEmailStore) {
  store.challenges.clear();
  store.rate.clear();
  store.lastDev = null;
  store.devCodes.clear();
  return store;
}

function pruneExpired(store, nowMs) {
  for (const [id, row] of store.challenges) {
    if (!row || row.expiresAt <= nowMs) store.challenges.delete(id);
  }
  for (const [key, row] of store.rate) {
    if (!row || row.resetAt <= nowMs) store.rate.delete(key);
  }
  for (const [id, row] of store.devCodes) {
    if (!store.challenges.has(id)) store.devCodes.delete(id);
  }
}

function hitRateLimit(store, key, max, nowMs, windowMs = RATE_LIMIT_WINDOW_MS) {
  const row = store.rate.get(key);
  if (!row || row.resetAt <= nowMs) {
    store.rate.set(key, { count: 1, resetAt: nowMs + windowMs });
    return false;
  }
  row.count += 1;
  return row.count > max;
}

function invalidateEmailChallenges(store, email) {
  const want = normalizeEmail(email);
  for (const [id, row] of store.challenges) {
    if (row?.email === want) {
      store.challenges.delete(id);
      store.devCodes.delete(id);
    }
  }
}

export function formatVerifyEmail({ code, from = MAIL_FROM_DEFAULT }) {
  return {
    subject: "Your Freight Lodge code",
    text: [
      `Your Freight Lodge confirmation code is ${code}.`,
      "",
      "It expires in 10 minutes. Enter it in the app — do not forward this email.",
      "If you did not ask for a quote, you can ignore this.",
      "",
      `Sent from ${from}`,
    ].join("\n"),
  };
}

/**
 * Peek the last plaintext code for tests when EMAIL_VERIFY_DEV_MODE=1.
 * Not part of the public HTTP contract.
 */
export function peekDevChallenge(store = defaultEmailStore, challengeId) {
  if (challengeId) return store.devCodes.get(challengeId) || null;
  return store.lastDev;
}

/**
 * @returns {{ status: number, body: object }}
 */
export async function startEmailVerification({
  email,
  ip = "unknown",
  env = {},
  store = defaultEmailStore,
  sendMail,
  now = Date.now,
  getRandomValues,
} = {}) {
  const nowMs = typeof now === "function" ? now() : Number(now);
  pruneExpired(store, nowMs);

  if (!isValidEmailAddress(email)) {
    return { status: 400, body: { ok: false, error: "Enter a valid email address." } };
  }

  const normalized = normalizeEmail(email);
  const dev = isDevVerifyMode(env);
  const hasPass = smtpPasswordSet(env);
  if (!dev && !hasPass) {
    return {
      status: 503,
      body: { ok: false, error: "Email send is not configured." },
    };
  }
  if (!dev && hasPass && typeof sendMail !== "function") {
    return {
      status: 503,
      body: {
        ok: false,
        error: "Email send needs the Node stub (Hostinger SMTP). This runtime cannot open SMTP.",
      },
    };
  }

  if (hitRateLimit(store, `email:${normalized}`, RATE_LIMIT_PER_EMAIL, nowMs)) {
    return { status: 429, body: { ok: false, error: GENERIC_RATE } };
  }
  if (hitRateLimit(store, `ip:${ip || "unknown"}`, RATE_LIMIT_PER_IP, nowMs)) {
    return { status: 429, body: { ok: false, error: GENERIC_RATE } };
  }

  const smtp = smtpSettings(env);
  const code = generateVerifyCode(getRandomValues);
  const salt = newSalt(getRandomValues);
  const challengeId = newChallengeId(getRandomValues);
  const hash = await hashEmailCode(normalized, code, salt);

  invalidateEmailChallenges(store, normalized);
  store.challenges.set(challengeId, {
    email: normalized,
    hash,
    salt,
    expiresAt: nowMs + CODE_TTL_MS,
    attempts: 0,
  });

  if (dev) {
    store.devCodes.set(challengeId, code);
    store.lastDev = { email: normalized, challenge_id: challengeId, code };
    console.log(`[email-verify] DEV code for ${normalized}: ${code} (not in JSON)`);
  }

  if (!dev) {
    const mail = formatVerifyEmail({ code, from: smtp.from });
    try {
      await sendMail({
        to: normalized,
        from: smtp.from,
        subject: mail.subject,
        text: mail.text,
      });
    } catch (err) {
      store.challenges.delete(challengeId);
      store.devCodes.delete(challengeId);
      if (store.lastDev?.challenge_id === challengeId) store.lastDev = null;
      return {
        status: 502,
        body: { ok: false, error: "I couldn’t send a code to that address. Try again." },
      };
    }
  }

  const body = {
    ok: true,
    challenge_id: challengeId,
    expires_in: CODE_TTL_SEC,
  };
  if (dev) body.dev = true;
  return { status: 200, body };
}

/**
 * @returns {{ status: number, body: object }}
 */
export async function confirmEmailVerification({
  email,
  challenge_id,
  code,
  store = defaultEmailStore,
  now = Date.now,
} = {}) {
  const nowMs = typeof now === "function" ? now() : Number(now);
  const normalized = normalizeEmail(email);
  const digits = String(code || "").replace(/\D/g, "");
  const id = String(challenge_id || "").trim();
  const row = store.challenges.get(id);

  if (row && row.expiresAt <= nowMs) {
    store.challenges.delete(id);
    store.devCodes.delete(id);
    pruneExpired(store, nowMs);
    return { status: 400, body: { ok: false, error: GENERIC_EXPIRED } };
  }

  pruneExpired(store, nowMs);

  if (!isValidEmailAddress(normalized) || !id || digits.length !== CODE_DIGITS || !row) {
    return { status: 400, body: { ok: false, error: GENERIC_FAIL } };
  }
  if (row.email !== normalized) {
    return { status: 400, body: { ok: false, error: GENERIC_FAIL } };
  }

  row.attempts += 1;
  if (row.attempts > MAX_ATTEMPTS) {
    store.challenges.delete(id);
    store.devCodes.delete(id);
    return { status: 400, body: { ok: false, error: GENERIC_FAIL } };
  }

  const expected = row.hash;
  const actual = await hashEmailCode(normalized, digits, row.salt);
  if (!timingSafeEqual(expected, actual)) {
    if (row.attempts >= MAX_ATTEMPTS) {
      store.challenges.delete(id);
      store.devCodes.delete(id);
    }
    return { status: 400, body: { ok: false, error: GENERIC_FAIL } };
  }

  store.challenges.delete(id);
  store.devCodes.delete(id);
  if (store.lastDev?.challenge_id === id) store.lastDev = null;
  return {
    status: 200,
    body: { ok: true, verified: true, email: normalized },
  };
}

/**
 * SMTP send of a formatted quote. Text + HTML come from the client
 * (`formatQuoteEmail` / `formatQuoteEmailHtml`). Quote send does not
 * require a prior verify challenge.
 */
export async function sendQuoteEmail({
  to,
  subject,
  text,
  html,
  env = {},
  sendMail,
} = {}) {
  const smtp = smtpSettings(env);
  const dest = normalizeEmail(to);
  if (!isValidEmailAddress(dest)) {
    return { status: 400, body: { ok: false, error: "Need an email on the sheet." } };
  }

  const subj = String(subject || "Freight Lodge quote").trim() || "Freight Lodge quote";
  const bodyText = String(text || "").trim();
  const bodyHtml = String(html || "").trim();
  const from = smtp.from;
  const dev = isDevVerifyMode(env);

  if (!dev && !smtp.pass) {
    return {
      status: 503,
      body: { ok: false, error: "Email send is not configured.", from, to: dest, subject: subj },
    };
  }
  if (!dev && smtp.pass && typeof sendMail !== "function") {
    return {
      status: 503,
      body: {
        ok: false,
        error: "Email send needs the Node stub (Hostinger SMTP). This runtime cannot open SMTP.",
        from,
        to: dest,
        subject: subj,
      },
    };
  }

  if (dev && typeof sendMail !== "function") {
    console.log("[email-quote] DEV — logged, not SMTP-sent", { to: dest, subject: subj, html: Boolean(bodyHtml) });
    return {
      status: 200,
      body: { ok: true, mode: "dev", sent: true, from, to: dest, subject: subj, dev: true },
    };
  }

  try {
    await sendMail({
      to: dest,
      from,
      subject: subj,
      text: bodyText,
      ...(bodyHtml ? { html: bodyHtml } : {}),
    });
    return {
      status: 200,
      body: { ok: true, mode: "smtp", sent: true, from, to: dest, subject: subj },
    };
  } catch {
    return {
      status: 502,
      body: { ok: false, error: "Could not send the quote email.", from, to: dest, subject: subj },
    };
  }
}

export function isEmailApiPath(path) {
  const p = String(path || "").split("?")[0].replace(/\/$/, "") || "/";
  return (
    p === "/email/verify/start" ||
    p === "/email/verify/confirm" ||
    p === "/email/quote" ||
    p === "/api/email/verify/start" ||
    p === "/api/email/verify/confirm" ||
    p === "/api/email/quote" ||
    p === "/api/email-quote"
  );
}

export async function dispatchEmailApi(path, body, ctx = {}) {
  const p = String(path || "").split("?")[0].replace(/\/$/, "") || "/";
  if (p.endsWith("/email/verify/start")) {
    return startEmailVerification({ ...ctx, email: body?.email });
  }
  if (p.endsWith("/email/verify/confirm")) {
    return confirmEmailVerification({
      ...ctx,
      email: body?.email,
      challenge_id: body?.challenge_id,
      code: body?.code,
    });
  }
  if (p.endsWith("/email/quote") || p.endsWith("/email-quote")) {
    return sendQuoteEmail({
      ...ctx,
      to: body?.to || body?.quote_sheet?.contact?.email,
      subject: body?.subject,
      text: body?.body,
      html: body?.html,
    });
  }
  return { status: 404, body: { ok: false, error: "not found" } };
}
