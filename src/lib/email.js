import { formatStoredPieces } from "./completeness.js";
import { emailQuoteSendUrl } from "./email-verify-client.js";
import { buildQuoteEmailHtml } from "./quote-email-html.js";

export const MAIL_FROM = "john@freightlodge.com";
export const EMAIL_PATH = "/api/email-quote";

/** Opaque cream plate — Gmail dark mode inverts HTML, not image pixels. */
export const EMAIL_LOGO_CREAM = "#F5F0E8";
export const LOGO_URL = "https://johnkidenda.github.io/freightlodge-voice-quote/assets/logo-b-email.png";

function placeLine(place) {
  return [place?.city, place?.state, place?.postal_code].filter(Boolean).join(", ");
}

function piecesLine(freight) {
  return formatStoredPieces(freight);
}

export function quoteEmailFields(sheet) {
  const q = sheet?.quote_result || {};
  const origin = placeLine(sheet?.lanes?.origin);
  const dest = placeLine(sheet?.lanes?.destination);
  const total =
    typeof q.total_usd === "number" && Number.isFinite(q.total_usd) ? `$${q.total_usd.toFixed(2)}` : "—";
  const quoted = sheet?.status === "quoted" && Boolean(sheet?.quote_result);
  return {
    origin: origin || "—",
    dest: dest || "—",
    lane: `${origin || "—"} → ${dest || "—"}`,
    pieces: piecesLine(sheet?.freight),
    weight: `${sheet?.freight?.total_weight_lbs ?? "—"} lb`,
    commodity: sheet?.freight?.commodity || "—",
    pickup: sheet?.pickup?.date || "—",
    quoteId: q.quote_id || "—",
    carrier: q.carrier || "—",
    service: q.service || "—",
    total,
    transit: `${q.transit_days_min ?? "—"}–${q.transit_days_max ?? "—"} days`,
    rawSummary: q.raw_summary || "",
    requestId: sheet?.quote_request_id || "—",
    status: sheet?.status || "",
    quoted,
    oos: sheet?.status === "out_of_scope",
    errored: sheet?.status === "error",
    oosReason: sheet?.out_of_scope_reason || "not a domestic LTL lane.",
    errorReason: sheet?.error_reason || "runner error.",
  };
}

function quoteBlockText(fields) {
  if (fields.oos) return `Out of scope: ${fields.oosReason}`;
  if (fields.errored) return `Could not quote: ${fields.errorReason}`;
  return [
    `Quote ${fields.quoteId}`,
    `Carrier: ${fields.carrier}`,
    `Service: ${fields.service}`,
    `Total: ${fields.total}`,
    `Transit: ${fields.transit}`,
    fields.rawSummary,
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n");
}

export function formatQuoteEmail(sheet) {
  const fields = quoteEmailFields(sheet);
  return {
    subject: fields.quoted && fields.quoteId !== "—" ? `Freight Lodge quote ${fields.quoteId}` : "Freight Lodge quote",
    body: [
      "Freight Lodge quote",
      "",
      quoteBlockText(fields),
      "",
      `Lane: ${fields.lane}`,
      `Pieces: ${fields.pieces}`,
      `Weight: ${fields.weight}`,
      `Commodity: ${fields.commodity}`,
      `Pickup: ${fields.pickup}`,
      `Request: ${fields.requestId}`,
      "",
      `Sent from ${MAIL_FROM}.`,
    ].join("\n"),
  };
}

/**
 * Quote-card HTML for mail clients (cream / navy / serif). Inline styles.
 * Returns `{ subject, html }`. Send `html` only — never the whole object.
 */
export function formatQuoteEmailHtml(sheet) {
  const fields = quoteEmailFields(sheet);
  const { subject } = formatQuoteEmail(sheet);
  const html = buildQuoteEmailHtml({
    fields,
    subject,
    mailFrom: MAIL_FROM,
    logoUrl: LOGO_URL,
    logoCream: EMAIL_LOGO_CREAM,
  });
  return { subject, html };
}

/** Leftover helper for tests/docs. Quote send never uses this as a success path. */
export function mailtoHref(sheet) {
  const to = sheet.contact?.email || "";
  const { subject, body } = formatQuoteEmail(sheet);
  const qs = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(to)}?${qs.toString()}`;
}

export function emailUrl(apiBase = "", env) {
  const override =
    globalThis.FREIGHT_OPS_EMAIL_URL ||
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_EMAIL_URL);
  if (override) return override;
  return emailQuoteSendUrl(apiBase, env);
}

/**
 * Server-send the quote from john@freightlodge.com (HTML + text).
 * Never treats mailto as success. On failure the caller copies `body`.
 */
export async function emailQuote(sheet, { fetchFn, apiBase, env } = {}) {
  const to = sheet.contact?.email;
  const { subject, body } = formatQuoteEmail(sheet);
  const { html } = formatQuoteEmailHtml(sheet);
  const fail = (error) => ({
    ok: false,
    sent: false,
    mode: "error",
    from: MAIL_FROM,
    to,
    subject,
    body,
    html,
    error,
    note: error,
  });

  if (!to) return fail("Need an email on the sheet.");

  try {
    const res = await (fetchFn || fetch)(emailUrl(apiBase, env), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to,
        subject,
        body,
        html,
        quote_sheet: sheet,
      }),
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (res.ok && data.ok && data.sent) {
      return {
        ok: true,
        sent: true,
        mode: data.mode || "resend",
        from: data.from || MAIL_FROM,
        to: data.to || to,
        subject: data.subject || subject,
        body,
        html,
        note: `Sent to ${data.to || to} from ${data.from || MAIL_FROM}.`,
      };
    }
    return fail(data.error || "Could not send the quote email.");
  } catch {
    return fail("Could not send the quote email.");
  }
}
