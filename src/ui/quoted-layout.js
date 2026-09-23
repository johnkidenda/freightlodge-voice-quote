/** Quoted sheet hides the tip and sticky composer so the quote card and Email stay visible. */
export function applyQuotedLayout(els, sheetStatus) {
  const quoted = sheetStatus === "quoted";
  els.chatCol?.classList.toggle("is-quoted", quoted);
  if (els.form) {
    els.form.hidden = quoted;
    els.form.setAttribute("aria-hidden", quoted ? "true" : "false");
  }
  if (els.tip) {
    els.tip.hidden = quoted;
  }
}
