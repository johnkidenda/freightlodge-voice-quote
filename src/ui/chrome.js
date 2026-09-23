import { applyQuotedLayout } from "./quoted-layout.js";
import { speakerIcon } from "./speaker.js";

export function renderChrome(els, state) {
  const status = state.finishing ? "finishing" : state.listening ? "listening" : state.session.sheet.status;
  els.status.textContent = status.replaceAll("_", " ");
  els.status.dataset.status = status;
  applyQuotedLayout(els, state.session.sheet.status);
  els.hold.classList.toggle("hot", state.listening && !state.finishing);
  els.hold.classList.toggle("finishing", state.finishing);
  const label = els.hold.querySelector(".hold-label");
  if (label) {
    if (state.finishing) label.textContent = "Finishing…";
    else if (state.listening && state.hold?.mode === "toggle") label.textContent = "Recording… tap to send";
    else if (!state.listening) {
      label.textContent = state.hold?.mode === "toggle" ? "Tap to talk" : "Hold to talk";
    }
  }
  if (els.conversational) {
    els.conversational.classList.toggle("is-active", state.conversational);
    els.conversational.setAttribute("aria-pressed", state.conversational ? "true" : "false");
  }
  const awaitingEmail = state.session.awaiting === "email";
  els.form?.classList.toggle("is-email-ask", awaitingEmail);
  if (els.input) {
    els.input.placeholder = awaitingEmail
      ? "Type the email address…"
      : "Type origin ZIP, dest ZIP, pieces…";
    els.input.setAttribute("inputmode", awaitingEmail ? "email" : "text");
    els.input.setAttribute("autocomplete", awaitingEmail ? "email" : "off");
  }
  renderConvoAudio(els, state);
  renderTtsWave(els, state);
}

function renderConvoAudio(els, state) {
  if (!els.convoAudio) return;
  const on = Boolean(state.conversational);
  els.convoAudio.dataset.on = on ? "true" : "false";
  els.convoAudio.setAttribute("aria-pressed", on ? "true" : "false");
  const label = on ? "Turn conversational mode off" : "Turn conversational mode on";
  els.convoAudio.title = label;
  els.convoAudio.setAttribute("aria-label", label);
  els.convoAudio.innerHTML = speakerIcon(on);
}

export function renderTtsWave(els, state) {
  if (!els.ttsWave) return;
  const show = Boolean(state.conversational && state.ttsSpeaking);
  els.ttsWave.hidden = !show;
  els.ttsWave.setAttribute("aria-hidden", show ? "false" : "true");
}
