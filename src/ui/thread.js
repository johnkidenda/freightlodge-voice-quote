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
  thread.scrollTop = thread.scrollHeight;
}
