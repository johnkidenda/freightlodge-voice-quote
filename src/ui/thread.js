import { escapeHtml } from "../lib/escape-html.js";

function renderChoices(message) {
  if (message.role !== "assistant" || !message.choices?.length) return "";
  const open = message.choicesOpen !== false;
  const buttons = message.choices
    .map((choice) => {
      const label = escapeHtml(choice.label);
      const disabled = open ? "" : " disabled aria-disabled=\"true\"";
      return `<button type="button" class="quick-reply" data-choice="${label}" aria-label="Answer ${label}"${disabled}>${label}</button>`;
    })
    .join("");
  const answered = open ? "" : " aria-disabled=\"true\"";
  return `<div class="quick-replies" role="group" aria-label="Suggested replies"${answered}>${buttons}</div>`;
}

export function renderThread(thread, messages) {
  thread.innerHTML = messages
    .map(
      (m, index) =>
        `<article class="bubble ${m.role}" data-index="${index}"><p>${escapeHtml(m.text)}</p>${renderChoices(m)}</article>`,
    )
    .join("");
  pinThreadToEnd(thread);
}

/** Snap a scroll container to its latest content. */
export function pinThreadToEnd(thread) {
  if (!thread) return;
  const next = thread.scrollHeight;
  if (thread.scrollTop !== next) thread.scrollTop = next;
}

/**
 * Pin now, then again after layout. The quote card sits under the thread and
 * changes its height once the estimate (or the hidden follow-up) is painted.
 */
export function settleThreadScroll(thread, anchor) {
  if (!thread) return;
  const pin = () => pinThreadToEnd(thread);
  pin();
  const raf = globalThis.requestAnimationFrame?.bind(globalThis);
  if (typeof raf === "function") {
    raf(() => {
      pin();
      raf(pin);
    });
  }
  const fonts = globalThis.document?.fonts?.ready;
  if (fonts && typeof fonts.then === "function") {
    fonts.then(pin).catch(() => {});
  }
  if (typeof ResizeObserver !== "function") return;
  if (!thread._endPinObserver) {
    thread._endPinObserver = new ResizeObserver(() => pin());
    thread._endPinObserver.observe(thread);
  }
  if (anchor && !anchor._endPinObserved) {
    thread._endPinObserver.observe(anchor);
    anchor._endPinObserved = true;
  }
}
