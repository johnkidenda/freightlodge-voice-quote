/** Locked CORS for the Freight Lodge API Worker / local stub. */

export const PAGES_ORIGIN = "https://johnkidenda.github.io";

/** True for the Pages origin and any http://localhost|127.0.0.1 port (dev). */
export function isAllowedOrigin(origin) {
  const raw = String(origin || "").trim();
  if (!raw) return false;
  if (raw === PAGES_ORIGIN) return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:") return false;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * CORS response headers. Allowed origins get ACAO echoed; others get no ACAO
 * (preflight / cross-origin fetch from a stranger origin fails).
 */
export function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** @deprecated kept for tests that still import the old list name */
export const CORS_ORIGINS = Object.freeze([PAGES_ORIGIN]);
