import { createSession, handleUtterance, openingMessage } from "./lib/dialog.js";
import { requestQuote } from "./lib/handoff.js";
import { emailQuote, MAIL_FROM } from "./lib/email.js";
import { createSpeechSession, providerSupported } from "./lib/speech-session.js";
import { STT_PROVIDER_IDS, getSttProvider } from "./lib/stt-providers.js";
import {
  CONVERSATIONAL_GREETING,
  loadConversationalMode,
  presentAgentReply,
  saveConversationalMode,
} from "./lib/conversational.js";
import { onAgentSpeaking, speakAgentReply, stopAgentSpeech } from "./lib/agent-speech.js";
import { copyTextToClipboard, sendSessionTranscript } from "./lib/transcript.js";
import { playListenCue, primeListenCue } from "./lib/listen-cue.js";
import { formatAppVersionLabel, formatAppVersionTitle, getAppCommit, getAppVersion } from "./lib/app-version.js";
import { fetchJevDecision, isJevDisabled, recentAssistantReplies } from "./lib/jev.js";

const SAMPLE =
  "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1200 pounds, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com";

export function mountApp(root) {
  isJevDisabled({
    search: typeof location !== "undefined" ? location.search : "",
    storage: typeof localStorage !== "undefined" ? localStorage : null,
  });
  const state = {
    session: createSession(),
    messages: [
      {
        role: "assistant",
        text: loadConversationalMode(typeof localStorage !== "undefined" ? localStorage : null)
          ? CONVERSATIONAL_GREETING
          : openingMessage(),
      },
    ],
    listening: false,
    finishing: false,
    interim: "",
    busy: false,
    emailNote: null,
    hold: null,
    conversational: loadConversationalMode(typeof localStorage !== "undefined" ? localStorage : null),
    ttsSpeaking: false,
  };

  root.innerHTML = layout(state.conversational);
  const els = {
    thread: root.querySelector("#thread"),
    form: root.querySelector("#composer"),
    input: root.querySelector("#typed"),
    hold: root.querySelector("#hold"),
    conversational: root.querySelector("#conversational"),
    convoAudio: root.querySelector("#convo-audio"),
    ttsWave: root.querySelector("#tts-wave"),
    quote: root.querySelector("#quote-card"),
    chatCol: root.querySelector(".chat-col"),
    tip: root.querySelector("#voice-tip"),
    status: root.querySelector("#status-pill"),
    sample: root.querySelector("#sample"),
    sendTranscript: root.querySelector("#send-transcript"),
    sendNote: root.querySelector("#send-note"),
    reset: root.querySelector("#reset"),
  };

  const sessionRef = { current: null };

  function talkCallbacks() {
    return {
      onStart() {
        state.listening = true;
        state.finishing = false;
        state.interim = "";
        playListenCue();
        renderChrome(els, state);
      },
      onTailStart() {
        state.listening = true;
        state.finishing = true;
        renderChrome(els, state);
      },
      onEnd() {
        state.listening = false;
        state.finishing = false;
        state.interim = "";
        renderChrome(els, state);
      },
      onError(err) {
        state.listening = false;
        state.finishing = false;
        push(state, "assistant", speechError(err));
        render(els, state);
      },
      onPreview(text) {
        state.interim = text || "";
        renderChrome(els, state);
      },
      onCommit(text) {
        const trimmed = (text || "").trim();
        if (!trimmed || state.busy) return;
        void acceptUserText(els, state, trimmed);
      },
      onEmpty() {
        if (state.busy) return;
        push(state, "assistant", "I didn’t catch that. Say it again, or type it.");
        render(els, state);
      },
    };
  }

  function applyHoldAvailability() {
    const talk = state.hold;
    const ok = Boolean(talk?.supported);
    els.hold.disabled = !ok;
    els.hold.classList.toggle("is-disabled", !ok);
    els.hold.setAttribute("aria-disabled", ok ? "false" : "true");
  }

  function attachSpeechSession() {
    state.hold?.abort?.();
    state.listening = false;
    state.finishing = false;
    state.interim = "";
    const talk = createSpeechSession(talkCallbacks());
    state.hold = talk;
    sessionRef.current = talk;
    applyHoldAvailability();
    renderChrome(els, state);
    return talk;
  }

  attachSpeechSession();
  bindMic(els.hold, sessionRef);
  onAgentSpeaking((speaking) => {
    state.ttsSpeaking = Boolean(speaking);
    renderTtsWave(els, state);
  });

  function toggleConversational() {
    state.conversational = saveConversationalMode(
      !state.conversational,
      typeof localStorage !== "undefined" ? localStorage : null,
    );
    if (!state.conversational) stopAgentSpeech();
    if (state.messages.length === 1 && state.messages[0]?.role === "assistant") {
      state.messages[0].text = state.conversational ? CONVERSATIONAL_GREETING : openingMessage();
    }
    render(els, state);
  }

  els.conversational?.addEventListener("click", toggleConversational);
  els.convoAudio?.addEventListener("click", toggleConversational);

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || state.busy) return;
    els.input.value = "";
    void acceptUserText(els, state, text);
  });

  els.sample.addEventListener("click", () => {
    if (state.busy) return;
    void acceptUserText(els, state, SAMPLE);
  });

  els.sendTranscript.addEventListener("click", () => {
    void sendTranscriptToTeam(els, state);
  });

  els.reset.addEventListener("click", () => {
    state.session = createSession();
    state.messages = [
      { role: "assistant", text: state.conversational ? CONVERSATIONAL_GREETING : openingMessage() },
    ];
    stopAgentSpeech();
    state.emailNote = null;
    state.interim = "";
    render(els, state);
  });

  root.addEventListener("click", (e) => {
    const quoteBtn = e.target.closest("[data-email-quote]");
    if (quoteBtn) void sendEmail(els, state);
  });

  render(els, state);
}

function layout(conversational) {
  const speechOk = providerSupported();
  const assetBase = import.meta.env.BASE_URL || "./";
  return `
    <header class="top">
      <div class="brand">
        <img class="brand-logo" src="${assetBase}assets/logo-b.png" width="120" height="47" alt="Freight Lodge" />
        <div>
          <p class="eyebrow">Freight Lodge</p>
          <h1>Voice to quote</h1>
        </div>
      </div>
      <div class="top-actions">
        <span id="status-pill" class="pill">collecting</span>
        <button type="button" id="reset" class="textish">New sheet</button>
      </div>
    </header>

    <main class="stage">
      <section class="chat-col">
        <p id="voice-tip" class="voice-tip">Press and hold the button below to say what you want to ship. We’ll walk you through the details needed for a quote.</p>
        <div id="thread" class="thread" aria-live="polite"></div>
        <div id="quote-card"></div>
        <form id="composer" class="composer">
          <button type="button" id="sample" class="chip">Try a sample lane</button>
          <label class="sr-only" for="typed">Type a message</label>
          <div class="input-row">
            <input id="typed" type="text" autocomplete="off" enterkeyhint="send" placeholder="Type origin ZIP, dest ZIP, pieces…" />
            <button type="submit" class="send">Send</button>
          </div>
          <div class="mode-row">
            <div class="mode-cluster">
              <button type="button" id="conversational" class="mode-toggle${conversational ? " is-active" : ""}" aria-pressed="${conversational ? "true" : "false"}">
                Conversational mode
              </button>
              <button type="button" id="convo-audio" class="convo-audio" data-on="${conversational ? "true" : "false"}" aria-pressed="${conversational ? "true" : "false"}" title="${conversational ? "Turn conversational mode off" : "Turn conversational mode on"}" aria-label="${conversational ? "Turn conversational mode off" : "Turn conversational mode on"}">
                ${speakerIcon(conversational)}
              </button>
              <span id="tts-wave" class="tts-wave" hidden aria-hidden="true" title="Speaking">
                <span></span><span></span><span></span><span></span>
              </span>
            </div>
            <button type="button" id="send-transcript" class="send-transcript">Send transcript</button>
          </div>
          <button type="button" id="hold" class="hold ${speechOk ? "" : "is-disabled"}" aria-pressed="false">
            <span class="hold-dot"></span>
            <span class="hold-label">Hold to talk</span>
          </button>
          <p id="send-note" class="send-note" hidden></p>
        </form>
      </section>
    </main>

    <footer class="powered-by">
      <span class="app-version-foot" title="${escapeHtml(formatAppVersionTitle(getAppVersion(), getAppCommit()))}">${escapeHtml(formatAppVersionLabel(getAppVersion()))}</span>
      <span class="powered-label">Powered by</span>
      <a class="powered-logo" href="https://exfresso.com/" target="_blank" rel="noopener noreferrer" aria-label="Exfresso">
        <img src="${assetBase}assets/exfresso-logo.svg" alt="" height="18" />
      </a>
    </footer>
  `;
}

function bindMic(button, sessionRef) {
  const talk = () => sessionRef.current;
  const label = button.querySelector(".hold-label");
  if (talk()?.mode === "toggle") {
    if (label) label.textContent = "Tap to talk";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      const session = talk();
      if (!session) return;
      if (session.isTailing?.()) return;
      if (session.isActive?.()) {
        button.setAttribute("aria-pressed", "false");
        button.classList.remove("hot");
        if (label) label.textContent = "Finishing…";
        session.stop();
      } else {
        button.setAttribute("aria-pressed", "true");
        button.classList.add("hot");
        if (label) label.textContent = "Recording… tap to send";
        primeListenCue();
        playListenCue();
        session.start();
      }
    });
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    return;
  }

  const go = (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    button.setAttribute("aria-pressed", "true");
    button.classList.add("hot");
    primeListenCue();
    playListenCue();
    talk()?.start();
  };
  const stop = (e) => {
    e.preventDefault();
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("hot");
    talk()?.stop();
  };
  button.addEventListener("pointerdown", go);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("touchend", stop, { passive: false });
  button.addEventListener("lostpointercapture", () => {
    button.classList.remove("hot");
    talk()?.stop();
  });
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}

function pageApiBase() {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function speakOrStop(state, reply) {
  if (state.conversational) void speakAgentReply(reply);
  else stopAgentSpeech();
}

async function acceptUserText(els, state, text) {
  if (state.busy) return;
  push(state, "user", text);
  render(els, state);

  const jev = await fetchJevDecision({
    utterance: text,
    sheet: state.session.sheet,
    recentReplies: recentAssistantReplies(state.messages, 3),
    awaiting: state.session.awaiting,
    askedAccessorials: state.session.askedAccessorials,
  });
  const result = handleUtterance(state.session, text, { jev });
  state.session = result.session;
  const reply = presentAgentReply(result, state.conversational);
  push(state, "assistant", reply);
  render(els, state);
  speakOrStop(state, reply);

  if (result.outOfScope) {
    render(els, state);
    return;
  }
  if (result.ready) {
    await runHandoff(els, state);
  }
}

async function runHandoff(els, state) {
  state.busy = true;
  state.session.sheet = { ...state.session.sheet, status: "quoting", quote_result: null };
  render(els, state);
  try {
    const payload = await requestQuote(state.session.sheet, {
      apiBase: import.meta.env.BASE_URL.replace(/\/$/, ""),
    });
    state.session.sheet = payload.quote_sheet;
    if (payload.quote_sheet.status === "quoted") {
      const to = payload.quote_sheet.contact?.email;
      push(
        state,
        "assistant",
        to
          ? `Quote is back. I can email it to ${to} from ${MAIL_FROM} — tap Email me this quote. No book or pay from this app.`
          : "Quote is back. No book or pay from this app — email it if you want a copy.",
      );
    } else if (payload.quote_sheet.status === "out_of_scope") {
      push(
        state,
        "assistant",
        payload.quote_sheet.out_of_scope_reason || "Out of scope. No fake rate.",
      );
    } else if (payload.quote_sheet.status === "error") {
      push(
        state,
        "assistant",
        payload.quote_sheet.error_reason || "The runner hit an error. No fake rate.",
      );
    }
  } catch (err) {
    state.session.sheet = {
      ...state.session.sheet,
      status: "error",
      error_reason: String(err.message || err),
      quote_result: null,
    };
    push(state, "assistant", "Handoff failed. No fake rate.");
  } finally {
    state.busy = false;
    render(els, state);
  }
}

async function sendTranscriptToTeam(els, state) {
  const btn = els.sendTranscript;
  const note = els.sendNote;
  const label = "Send transcript";
  btn.disabled = true;
  btn.textContent = "Sending…";
  note.hidden = true;
  note.textContent = "";

  function restore(delayMs = 2800) {
    window.clearTimeout(btn._sentTimer);
    btn._sentTimer = window.setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("sent");
      btn.disabled = false;
    }, delayMs);
  }

  try {
    const result = await sendSessionTranscript(state.messages, state.session, {
      sttProvider: STT_PROVIDER_IDS.WEB_SPEECH,
    });
    if (result.ok && (result.mode === "formsubmit" || result.mode === "webhook")) {
      btn.textContent = "Sent";
      btn.classList.add("sent");
      note.hidden = false;
      note.textContent = "Thanks — the team will review.";
      restore();
      return;
    }
    if (result.mailto) {
      let copied = false;
      try {
        copied = await copyTextToClipboard(result.transcript);
      } catch {
        copied = false;
      }
      try {
        window.location.href = result.mailto;
      } catch {
        /* some WebViews block mailto */
      }
      btn.textContent = "Opened mail app…";
      note.hidden = false;
      note.textContent = copied
        ? "Could not send silently — opened mail. A copy is on the clipboard if mail didn’t open."
        : "Could not send silently — opened mail.";
      restore(4000);
      return;
    }
    btn.textContent = "Send failed";
    note.hidden = false;
    note.textContent = "Could not send — copy instead.";
  } catch (err) {
    btn.textContent = "Send failed";
    note.hidden = false;
    note.textContent = "Could not send — copy instead.";
  }
  restore();
}

async function sendEmail(els, state) {
  const sheet = state.session.sheet;
  const result = await emailQuote(sheet, { apiBase: pageApiBase() });
  if (result.ok && result.sent) {
    state.emailNote = result.note || `Sent from ${MAIL_FROM}.`;
    render(els, state);
    return;
  }
  let copied = false;
  try {
    copied = await copyTextToClipboard(result.body || "");
  } catch {
    copied = false;
  }
  const err = result.error || "Could not send the quote email.";
  state.emailNote = copied ? `${err} A copy of the quote is on the clipboard.` : err;
  render(els, state);
}

function push(state, role, text) {
  state.messages.push({ role, text });
}

function render(els, state) {
  renderChrome(els, state);
  els.thread.innerHTML = state.messages
    .map(
      (m) =>
        `<article class="bubble ${m.role}"><p>${escapeHtml(m.text)}</p></article>`,
    )
    .join("");
  els.thread.scrollTop = els.thread.scrollHeight;

  els.quote.innerHTML = quoteCard(state.session.sheet, state.emailNote);
}

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

function renderChrome(els, state) {
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

function speakerIcon(on) {
  if (on) {
    return `<svg class="convo-speaker" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>`;
  }
  return `<svg class="convo-speaker is-muted" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z"/>
  </svg>`;
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

function renderTtsWave(els, state) {
  if (!els.ttsWave) return;
  const show = Boolean(state.conversational && state.ttsSpeaking);
  els.ttsWave.hidden = !show;
  els.ttsWave.setAttribute("aria-hidden", show ? "false" : "true");
}

function quoteCard(sheet, emailNote) {
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

function speechError(err) {
  const code = err?.error || err?.message || "mic error";
  const text = String(code);
  if (text.includes("not-allowed") || text.includes("permission")) {
    return "Mic permission was denied. Type the lane instead.";
  }
  const label = getSttProvider(STT_PROVIDER_IDS.WEB_SPEECH).label;
  if (/empty transcript/i.test(text)) {
    return `${label} heard nothing. Hold, speak clearly, then release — or type instead.`;
  }
  return `${label} isn’t available (${text}). Type the lane instead.`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function logoSvg() {
  return `<svg viewBox="0 0 40 40" width="40" height="40">
    <rect width="40" height="40" rx="10" fill="#1b2a4a"/>
    <path d="M8 22 L20 10 L32 22" fill="none" stroke="#e6c27a" stroke-width="2.4"/>
    <path d="M12 21 V30 H28 V21" fill="none" stroke="#f6f1e8" stroke-width="2"/>
    <rect x="17.2" y="24" width="5.6" height="6" fill="#e6c27a"/>
  </svg>`;
}
