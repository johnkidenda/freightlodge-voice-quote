import { emailQuoteSendUrl } from "./email-verify-client.js";

export const MAIL_FROM = "john@freightlodge.com";
export const EMAIL_PATH = "/api/email-quote";

export function formatQuoteEmail(sheet) {
  const q = sheet.quote_result || {};
  const origin = [sheet.lanes?.origin?.city, sheet.lanes?.origin?.state, sheet.lanes?.origin?.postal_code]
    .filter(Boolean)
    .join(", ");
  const dest = [
    sheet.lanes?.destination?.city,
    sheet.lanes?.destination?.state,
    sheet.lanes?.destination?.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  const quoteBlock =
    sheet.status === "out_of_scope"
      ? `Out of scope: ${sheet.out_of_scope_reason || "not a domestic LTL lane."}`
      : sheet.status === "error"
        ? `Could not quote: ${sheet.error_reason || "runner error."}`
        : [
            `Quote ${q.quote_id || "—"}`,
            `Carrier: ${q.carrier || "—"}`,
            `Service: ${q.service || "—"}`,
            `Total: ${typeof q.total_usd === "number" ? `$${q.total_usd.toFixed(2)}` : "—"}`,
            `Transit: ${q.transit_days_min ?? "—"}–${q.transit_days_max ?? "—"} days`,
            q.raw_summary || "",
          ].join("\n");

  return {
    subject: q.quote_id ? `Freight Lodge quote ${q.quote_id}` : "Freight Lodge quote",
    body: [
      "Freight Lodge quote",
      "",
      quoteBlock,
      "",
      `Lane: ${origin || "—"} → ${dest || "—"}`,
      `Pieces: ${sheet.freight?.pieces ?? "—"}`,
      `Weight: ${sheet.freight?.total_weight_lbs ?? "—"} lb`,
      `Commodity: ${sheet.freight?.commodity || "—"}`,
      `Pickup: ${sheet.pickup?.date || "—"}`,
      `Request: ${sheet.quote_request_id}`,
      "",
      "This MVP stops at quote — no book or pay.",
      `Sent from ${MAIL_FROM}.`,
    ].join("\n"),
  };
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
 * Server-send the quote from john@freightlodge.com.
 * Never treats mailto as success. On failure the caller copies `body`.
 */
export async function emailQuote(sheet, { fetchFn, apiBase, env } = {}) {
  const to = sheet.contact?.email;
  const { subject, body } = formatQuoteEmail(sheet);
  const fail = (error) => ({
    ok: false,
    sent: false,
    mode: "error",
    from: MAIL_FROM,
    to,
    subject,
    body,
    error,
    note: error,
  });

  if (!to) return fail("Need a confirmed email on the sheet.");

  try {
    const res = await (fetchFn || fetch)(emailUrl(apiBase, env), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to,
        subject,
        body,
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
        mode: data.mode || "smtp",
        from: data.from || MAIL_FROM,
        to: data.to || to,
        subject: data.subject || subject,
        body,
        note: `Sent to ${data.to || to} from ${data.from || MAIL_FROM}.`,
      };
    }
    return fail(data.error || "Could not send the quote email.");
  } catch {
    return fail("Could not send the quote email.");
  }
}
