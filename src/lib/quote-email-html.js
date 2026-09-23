import { escapeHtml } from "./escape-html.js";

/**
 * Quote-card HTML document. Callers send this string as `html`, never the
 * `{ subject, html }` object from formatQuoteEmailHtml.
 */
export function buildQuoteEmailHtml({ fields, subject, mailFrom, logoUrl, logoCream }) {
  const headline = fields.oos
    ? "Out of scope"
    : fields.errored
      ? "Could not quote"
      : fields.carrier !== "—"
        ? fields.carrier
        : "Freight Lodge quote";
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

  return `<!DOCTYPE html>
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
              <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td bgcolor="${logoCream}" style="background:${logoCream};background-color:${logoCream};padding:12px 14px;">
                    <img src="${logoUrl}" width="120" alt="Freight Lodge" style="display:block;border:0;outline:none;width:120px;height:auto;" />
                  </td>
                </tr>
              </table>
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
                    <p style="margin:6px 0 0;color:#5c6573;font-size:13px;">Sent from ${escapeHtml(mailFrom)}. Request ${escapeHtml(String(fields.requestId))}.</p>
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
}
