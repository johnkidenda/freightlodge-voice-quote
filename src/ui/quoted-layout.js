/**
 * Quoted sheet hides the tip, sample chip, typed row, and mode cluster
 * so they do not cover the quote card. Hold to talk and Send transcript
 * stay in the composer and remain tappable.
 */
export function applyQuotedLayout(els, sheetStatus) {
  const quoted = sheetStatus === "quoted";
  els.chatCol?.classList.toggle("is-quoted", quoted);
  if (els.form) {
    els.form.hidden = false;
    els.form.setAttribute("aria-hidden", "false");
    const find = typeof els.form.querySelector === "function" ? (sel) => els.form.querySelector(sel) : null;
    if (find) {
      const sample = find("#sample");
      const inputRow = find(".input-row");
      const modeCluster = find(".mode-cluster");
      if (sample) sample.hidden = quoted;
      if (inputRow) inputRow.hidden = quoted;
      if (modeCluster) modeCluster.hidden = quoted;
      const hold = find("#hold");
      const send = find("#send-transcript");
      if (hold) hold.hidden = false;
      if (send) send.hidden = false;
    }
  }
  if (els.tip) {
    els.tip.hidden = quoted;
  }
}
