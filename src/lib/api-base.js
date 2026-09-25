/**
 * Public base URL for the email Worker (or local Vite /api).
 * Safe to bake into the SPA. Never put TYPESAFE_API_KEY or RESEND_API_KEY here.
 */
export function getApiBaseUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const raw = env?.VITE_API_BASE_URL;
  return raw == null ? "" : String(raw).trim().replace(/\/$/, "");
}
