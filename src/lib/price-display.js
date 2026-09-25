/** How a computed rate is shown. The rating formula does not change. */
export const PRICE_DISPLAY = "estimate";

export const ESTIMATE_NOTE = "Estimate. Final rate confirmed by Freight Lodge.";
export const ESTIMATE_LOADING = "Working out your estimate…";
export const HIDDEN_FOLLOWUP = "The Freight Lodge team will follow up with a quote.";
export const ESTIMATE_ERROR =
  "I couldn’t work out an estimate just now. The Freight Lodge team can follow up.";

export function isHiddenPrice(mode = PRICE_DISPLAY) {
  return mode === "hidden";
}

export function formatUsd(total) {
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  return `$${total.toFixed(2)}`;
}

/**
 * Spoken line after a rate is ready.
 * `hidden` never includes a dollar amount.
 */
export function estimateSpeech(sheet, { mode = PRICE_DISPLAY, from } = {}) {
  if (isHiddenPrice(mode)) return HIDDEN_FOLLOWUP;
  const amount = formatUsd(sheet?.quote_result?.total_usd);
  if (!amount) return HIDDEN_FOLLOWUP;
  const to = sheet?.contact?.email;
  if (to && from) {
    return `Your estimate is ${amount}. Tap 'Email me this quote' if you want it sent to ${to} from ${from}.`;
  }
  return `Your estimate is ${amount}. Email it if you want a copy.`;
}
