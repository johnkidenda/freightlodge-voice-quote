import { emailQuoteSendUrl } from "./email-verify-client.js";

export const MAIL_FROM = "john@freightlodge.com";
export const EMAIL_PATH = "/api/email-quote";

const LOGO_URL = "https://johnkidenda.github.io/freightlodge-voice-quote/assets/logo-b.png";

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function placeLine(place) {
  return [place?.city, place?.state, place?.postal_code].filter(Boolean).join(", ");
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
    pieces: sheet?.freight?.pieces ?? "—",
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
      "This MVP stops at quote — no book or pay.",
      `Sent from ${MAIL_FROM}.`,
    ].join("\n"),
  };
}

/**
 * Quote-card HTML for SMTP (cream / navy / serif). Inline styles for mail clients.
 */
export function formatQuoteEmailHtml(sheet) {
  const fields = quoteEmailFields(sheet);
  const { subject } = formatQuoteEmail(sheet);
  const headline = fields.oos ? "Out of scope" : fields.errored ? "Could not quote" : fields.carrier !== "—" ? fields.carrier : "Freight Lodge quote";
  const lead = fields.oos
    ? escapeHtml(fields.oosReason)
    : fields.errored
      ? escapeHtml(fields.errorReason)
      : "";
  const rateRows = fields.quoted
    ? `
      <tr>
        <td style="padding:0 0 18px;">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9a6f1d;font-weight:700;">Quote</p>
          <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.2;color:#1b2a4a;">${escapeHtml(headline)}</h1>
          <p style="margin:8px 0 0;font-size:32px;font-weight:700;letter-spacing:-0.03em;color:#162033;">${escapeHtml(fields.total)}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
            <tr>
              <td style="width:33%;padding:0 8px 0 0;vertical-align:top;">
                <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6573;">Service</p>
                <p style="margin:0;font-weight:650;color:#162033;">${escapeHtml(fields.service)}</p>
              </td>
              <td style="width:33%;padding:0 8px;vertical-align:top;">
                <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6573;">Transit</p>
                <p style="margin:0;font-weight:650;color:#162033;">${escapeHtml(fields.transit)}</p>
              </td>
              <td style="width:33%;padding:0 0 0 8px;vertical-align:top;">
                <p style="margin:0 0 2px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#5c6573;">ID</p>
                <p style="margin:0;font-weight:650;color:#162033;">${escapeHtml(fields.quoteId)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${
        fields.rawSummary
          ? `<tr><td style="padding:0 0 16px;"><p style="margin:0;color:#5c6573;font-size:14px;">${escapeHtml(fields.rawSummary)}</p></td></tr>`
          : ""
      }`
    : `
      <tr>
        <td style="padding:0 0 16px;">
          <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#1b2a4a;">${escapeHtml(headline)}</h1>
          <p style="margin:0;color:#162033;font-size:16px;">${lead}</p>
        </td>
      </tr>`;

  const sheetRows = [
    ["Lane", fields.lane],
    ["Pieces", String(fields.pieces)],
    ["Weight", fields.weight],
    ["Commodity", fields.commodity],
    ["Pickup", fields.pickup],
  ]
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;border-top:1px solid #eee6d8;font-size:13px;color:#5c6573;width:38%;">${escapeHtml(label)}</td>
          <td style="padding:8px 0;border-top:1px solid #eee6d8;font-size:15px;font-weight:650;color:#162033;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4efe6;color:#162033;font-family:'Source Sans 3','Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4efe6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding:8px 8px 18px;">
              <img src="${LOGO_URL}" width="120" alt="Freight Lodge" style="display:block;border:0;width:120px;height:auto;" />
              <p style="margin:10px 0 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#9a6f1d;font-weight:700;">Freight Lodge</p>
              <p style="margin:2px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#1b2a4a;">Voice to quote</p>
            </td>
          </tr>
          <tr>
            <td style="background:#fffdf8;border:1px solid #d9d0c2;border-radius:16px;padding:22px 22px 10px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${rateRows}
                <tr>
                  <td style="padding:4px 0 8px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${sheetRows}</table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 0 8px;">
                    <p style="margin:0;color:#5c6573;font-size:13px;">This MVP stops at quote — no book or pay.</p>
                    <p style="margin:6px 0 0;color:#5c6573;font-size:13px;">Sent from ${escapeHtml(MAIL_FROM)}. Request ${escapeHtml(String(fields.requestId))}.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

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
        mode: data.mode || "smtp",
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
