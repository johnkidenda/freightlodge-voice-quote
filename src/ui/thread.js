import { escapeHtml } from "../lib/escape-html.js";

export function renderThread(thread, messages) {
  thread.innerHTML = messages
    .map((m) => `<article class="bubble ${m.role}"><p>${escapeHtml(m.text)}</p></article>`)
    .join("");
  thread.scrollTop = thread.scrollHeight;
}
