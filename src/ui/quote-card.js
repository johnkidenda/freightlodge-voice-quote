import { MAIL_FROM } from "../lib/email.js";
import { escapeHtml } from "../lib/escape-html.js";

export function quoteCard(sheet, emailNote) {
  if (sheet.status === "quoting") {
    return `<section class="card wait"><p>Talking to the Exfresso runner stub…</p></section>`;
  }
  if (sheet.status === "out_of_scope") {
    return `<section class="card oos">
      <h3>Out of scope</h3>
      <p>${escapeHtml(sheet.out_of_scope_reason || "This lane is not domestic LTL.")}</p>
      <p class="muted">Honest handoff — no fake rate.</p>
    </section>`;
  }
  if (sheet.status === "error") {
    return `<section class="card oos">
      <h3>Could not quote</h3>
      <p>${escapeHtml(sheet.error_reason || "Runner error.")}</p>
    </section>`;
  }
  if (sheet.status !== "quoted" || !sheet.quote_result) return "";
  const q = sheet.quote_result;
  const total = typeof q.total_usd === "number" ? `$${q.total_usd.toFixed(2)}` : "—";
  return `<section class="card quote">
    <p class="eyebrow">Quote</p>
    <h3>${escapeHtml(q.carrier || "Carrier TBD")}</h3>
    <p class="price">${escapeHtml(total)}</p>
    <dl>
      <div><dt>Service</dt><dd>${escapeHtml(q.service || "—")}</dd></div>
      <div><dt>Transit</dt><dd>${escapeHtml(`${q.transit_days_min ?? "—"}–${q.transit_days_max ?? "—"} days`)}</dd></div>
      <div><dt>ID</dt><dd>${escapeHtml(q.quote_id || "—")}</dd></div>
    </dl>
    <p class="muted">${escapeHtml(q.raw_summary || "")}</p>
    <button type="button" class="email-btn" data-email-quote>Email me this quote</button>
    <p class="hint">We’ll send it from ${escapeHtml(MAIL_FROM)}.</p>
    ${emailNote ? `<p class="hint">${escapeHtml(emailNote)}</p>` : ""}
  </section>`;
}
