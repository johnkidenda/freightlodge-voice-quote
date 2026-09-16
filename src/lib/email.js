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

  const lines = [
    "Freight Lodge quote",
    "",
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
          ].join("\n"),
    "",
    `Lane: ${origin || "—"} → ${dest || "—"}`,
    `Pieces: ${sheet.freight?.pieces ?? "—"}`,
    `Weight: ${sheet.freight?.total_weight_lbs ?? "—"} lb`,
    `Commodity: ${sheet.freight?.commodity || "—"}`,
    `Pickup: ${sheet.pickup?.date || "—"}`,
    `Request: ${sheet.quote_request_id}`,
    "",
    "This MVP stops at quote — no book or pay.",
    `Production mail will send from ${MAIL_FROM}.`,
  ];
  return {
    subject: q.quote_id
      ? `Freight Lodge quote ${q.quote_id}`
      : "Freight Lodge quote",
    body: lines.filter((l) => l !== undefined).join("\n"),
  };
}

export function mailtoHref(sheet) {
  const to = sheet.contact?.email || "";
  const { subject, body } = formatQuoteEmail(sheet);
  const qs = new URLSearchParams({ subject, body });
  return `mailto:${encodeURIComponent(to)}?${qs.toString()}`;
}

export function emailUrl(apiBase = "") {
  const override =
    globalThis.FREIGHT_OPS_EMAIL_URL ||
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_EMAIL_URL);
  if (override) return override;
  return `${apiBase.replace(/\/$/, "")}${EMAIL_PATH}`;
}

/**
 * Working MVP path: try POST /api/email-quote (dev server stub logs + returns
 * success). Always also return a mailto fallback so GitHub Pages / phones work
 * with zero secrets. Production: swap the stub for Hostinger SMTP.
 */
export async function emailQuote(sheet, { fetchFn, apiBase } = {}) {
  const to = sheet.contact?.email;
  const { subject, body } = formatQuoteEmail(sheet);
  const mailto = mailtoHref(sheet);
  let stub = {
    ok: true,
    mode: "mailto",
    sent: false,
    from: MAIL_FROM,
    to,
    subject,
    mailto,
    note: `Demo did not send SMTP. Production will send from ${MAIL_FROM} via Hostinger (or other) SMTP.`,
  };

  try {
    const res = await (fetchFn || fetch)(emailUrl(apiBase), {
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
    if (res.ok) {
      const data = await res.json();
      stub = { ...stub, ...data, mailto, from: MAIL_FROM, to };
    }
  } catch {
    // Pages / offline — mailto is enough.
  }

  return stub;
}
