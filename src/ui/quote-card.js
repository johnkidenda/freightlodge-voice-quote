import { MAIL_FROM } from "../lib/email.js";
import { escapeHtml } from "../lib/escape-html.js";
import {
  ESTIMATE_ERROR,
  ESTIMATE_LOADING,
  ESTIMATE_NOTE,
  HIDDEN_FOLLOWUP,
  PRICE_DISPLAY,
  formatUsd,
  isHiddenPrice,
} from "../lib/price-display.js";

export function quoteCard(sheet, emailNote, mode = PRICE_DISPLAY) {
  if (sheet.status === "quoting") {
    return `<section class="card wait"><p>${escapeHtml(ESTIMATE_LOADING)}</p></section>`;
  }
  if (sheet.status === "out_of_scope") {
    return `<section class="card oos">
      <h3>Out of scope</h3>
      <p>${escapeHtml(sheet.out_of_scope_reason || "This lane is not domestic LTL.")}</p>
      <p class="muted">Honest handoff. No fake rate.</p>
    </section>`;
  }
  if (sheet.status === "error") {
    return `<section class="card oos">
      <h3>Could not estimate</h3>
      <p>${escapeHtml(sheet.error_reason || ESTIMATE_ERROR)}</p>
    </section>`;
  }
  if (sheet.status !== "quoted" || !sheet.quote_result) return "";
  const q = sheet.quote_result;
  if (isHiddenPrice(mode)) {
    return `<section class="card quote">
      <p class="eyebrow">Estimate</p>
      <p>${escapeHtml(HIDDEN_FOLLOWUP)}</p>
      <button type="button" class="email-btn" data-email-quote>Email me this quote</button>
      <p class="hint">We’ll send it from ${escapeHtml(MAIL_FROM)}.</p>
      ${emailNote ? `<p class="hint">${escapeHtml(emailNote)}</p>` : ""}
    </section>`;
  }
  const total = formatUsd(q.total_usd) || "";
  return `<section class="card quote">
    <p class="eyebrow">Estimate</p>
    <h3>${escapeHtml(q.carrier || "Carrier TBD")}</h3>
    <p class="price">${escapeHtml(total)}</p>
    <dl>
      <div><dt>Service</dt><dd>${escapeHtml(q.service || "")}</dd></div>
      <div><dt>Transit</dt><dd>${escapeHtml(`${q.transit_days_min ?? ""} to ${q.transit_days_max ?? ""} days`)}</dd></div>
      <div><dt>ID</dt><dd>${escapeHtml(q.quote_id || "")}</dd></div>
    </dl>
    <p class="estimate-note">${escapeHtml(ESTIMATE_NOTE)}</p>
    <button type="button" class="email-btn" data-email-quote>Email me this quote</button>
    <p class="hint">We’ll send it from ${escapeHtml(MAIL_FROM)}.</p>
    ${emailNote ? `<p class="hint">${escapeHtml(emailNote)}</p>` : ""}
  </section>`;
}
