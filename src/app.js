import { createSession, handleUtterance, openingMessage } from "./lib/dialog.js";
import { requestQuote } from "./lib/handoff.js";
import { emailQuote, MAIL_FROM } from "./lib/email.js";
import { createSpeechSession } from "./lib/speech-session.js";
import { STT_PROVIDER_IDS, getSttProvider } from "./lib/stt-providers.js";
import {
  CONVERSATIONAL_GREETING,
  loadConversationalMode,
  presentAgentReply,
  saveConversationalMode,
} from "./lib/conversational.js";
import { onAgentSpeaking, speakAgentReply, stopAgentSpeech } from "./lib/agent-speech.js";
import { createNoInputWatch } from "./lib/no-input.js";
import { copyTextToClipboard, sendSessionTranscript } from "./lib/transcript.js";
import { playListenCue } from "./lib/listen-cue.js";
import {
  fetchJevDecision,
  isJevDisabled,
  recentAssistantReplies,
  saveJevSessionEnabled,
} from "./lib/jev.js";
import { renderChrome, renderTtsWave } from "./ui/chrome.js";
import { layout } from "./ui/layout.js";
import { bindMic } from "./ui/mic.js";
import { quoteCard } from "./ui/quote-card.js";
import { renderThread } from "./ui/thread.js";

export { applyQuotedLayout } from "./ui/quoted-layout.js";

const SAMPLE =
  "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1200 pounds, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com";

function browserStorage() {
  return typeof localStorage !== "undefined" ? localStorage : null;
}

function browserSessionStore() {
  return typeof sessionStorage !== "undefined" ? sessionStorage : null;
}

function jevEnabledNow() {
  return !isJevDisabled({
    search: typeof location !== "undefined" ? location.search : "",
    storage: browserStorage(),
    sessionStore: browserSessionStore(),
  });
}

function greetingFor(conversational) {
  return conversational ? CONVERSATIONAL_GREETING : openingMessage();
}

function createViewState() {
  const conversational = loadConversationalMode(browserStorage());
  const jevOn = jevEnabledNow();
  const session = createSession();
  session.jevEnabled = jevOn;
  return {
    session,
    messages: [{ role: "assistant", text: greetingFor(conversational), at: new Date().toISOString() }],
    listening: false,
    finishing: false,
    busy: false,
    emailNote: null,
    hold: null,
    conversational,
    jevOn,
    ttsSpeaking: false,
  };
}

export function mountApp(root) {
  isJevDisabled({
    search: typeof location !== "undefined" ? location.search : "",
    storage: browserStorage(),
  });
  const state = createViewState();

  root.innerHTML = layout(state.conversational, state.jevOn);
  const els = {
    thread: root.querySelector("#thread"),
    form: root.querySelector("#composer"),
    input: root.querySelector("#typed"),
    hold: root.querySelector("#hold"),
    conversational: root.querySelector("#conversational"),
    convoAudio: root.querySelector("#convo-audio"),
    jevMode: root.querySelector("#jev-mode"),
    ttsWave: root.querySelector("#tts-wave"),
    quote: root.querySelector("#quote-card"),
    chatCol: root.querySelector(".chat-col"),
    tip: root.querySelector("#voice-tip"),
    status: root.querySelector("#status-pill"),
    sample: root.querySelector("#sample"),
    sendTranscript: root.querySelector("#send-transcript"),
    sendNote: root.querySelector("#send-note"),
    choices: root.querySelector("#choice-row"),
    reset: root.querySelector("#reset"),
  };

  const noInput = createNoInputWatch({
    onReprompt() {
      if (state.busy || state.listening || state.finishing) return;
      noInput.onNewAsk();
      const text = "I didn’t catch that. Say it again, or type it.";
      push(state, "assistant", text);
      render(els, state);
      speakOrStop(state, text);
    },
  });

  const sessionRef = { current: null };

  function talkCallbacks() {
    return {
      onStart() {
        noInput.onUserActivity();
        state.listening = true;
        state.finishing = false;
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
        renderChrome(els, state);
      },
      onError(err) {
        state.listening = false;
        state.finishing = false;
        push(state, "assistant", speechError(err));
        render(els, state);
      },
      onPreview() {
        // Interim text stays in the speech buffer and commits on release
        // (short answers like "one pallet"). The thread does not paint it.
      },
      onCommit(text) {
        const trimmed = (text || "").trim();
        if (!trimmed || state.busy) return;
        void acceptUserText(els, state, trimmed);
      },
      onEmpty() {
        if (state.busy || state.listening) return;
        noInput.onEmptyListen();
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
    const talk = createSpeechSession({
      ...talkCallbacks(),
      numericSlot: () => {
        const slot = state.session?.awaiting;
        return slot === "pieces" || slot === "measure";
      },
    });
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
    noInput.onSpeakingChange(speaking);
    renderTtsWave(els, state);
  });

  function toggleConversational() {
    state.conversational = saveConversationalMode(!state.conversational, browserStorage());
    if (!state.conversational) stopAgentSpeech();
    if (state.messages.length === 1 && state.messages[0]?.role === "assistant") {
      state.messages[0].text = greetingFor(state.conversational);
    }
    render(els, state);
  }

  function toggleJev() {
    state.jevOn = saveJevSessionEnabled(!state.jevOn, browserSessionStore());
    state.session.jevEnabled = state.jevOn;
    render(els, state);
  }

  els.conversational?.addEventListener("click", toggleConversational);
  els.convoAudio?.addEventListener("click", toggleConversational);
  els.jevMode?.addEventListener("click", toggleJev);

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || state.busy) return;
    els.input.value = "";
    noInput.onUserActivity();
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
    state.session.jevEnabled = state.jevOn;
    state.messages = [{ role: "assistant", text: greetingFor(state.conversational), at: new Date().toISOString() }];
    stopAgentSpeech();
    state.emailNote = null;
    noInput.onNewAsk();
    render(els, state);
  });

  root.addEventListener("click", (e) => {
    const quoteBtn = e.target.closest("[data-email-quote]");
    if (quoteBtn) void sendEmail(els, state);
    const choice = e.target.closest("[data-choice]");
    if (!choice || state.busy) return;
    if (state.session.awaiting !== "liftgate_side") return;
    const text = choice.getAttribute("data-choice") || "";
    if (!text) return;
    noInput.onUserActivity();
    void acceptUserText(els, state, text);
  });

  render(els, state);
  noInput.onNewAsk();
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

  noInput.onUserActivity();
  state.session.jevEnabled = state.jevOn;
  const jev = await fetchJevDecision({
    utterance: text,
    sheet: state.session.sheet,
    recentReplies: recentAssistantReplies(state.messages, 3),
    awaiting: state.session.awaiting,
    askedAccessorials: state.session.askedAccessorials,
    search: typeof location !== "undefined" ? location.search : "",
    storage: browserStorage(),
    sessionStore: browserSessionStore(),
  });
  const result = handleUtterance(state.session, text, { jev });
  state.session = result.session;
  const reply = presentAgentReply(result, state.conversational);
  push(state, "assistant", reply);
  render(els, state);
  noInput.onNewAsk();
  speakOrStop(state, reply);

  if (result.outOfScope) return;
  if (result.ready) {
    await runHandoff(els, state);
  }
}

function handoffAssistantLine(sheet) {
  if (sheet.status === "quoted") {
    const to = sheet.contact?.email;
    return to
      ? `Quote is back. I can email it to ${to} from ${MAIL_FROM}. Tap Email me this quote.`
      : "Quote is back. Email it if you want a copy.";
  }
  if (sheet.status === "out_of_scope") {
    return sheet.out_of_scope_reason || "Out of scope. No fake rate.";
  }
  if (sheet.status === "error") {
    return sheet.error_reason || "The runner hit an error. No fake rate.";
  }
  return "";
}

async function runHandoff(els, state) {
  state.busy = true;
  state.session.sheet = { ...state.session.sheet, status: "quoting", quote_result: null };
  render(els, state);
  try {
    const payload = await requestQuote(state.session.sheet, {
      apiBase: pageApiBase(),
    });
    state.session.sheet = payload.quote_sheet;
    const line = handoffAssistantLine(payload.quote_sheet);
    if (line) push(state, "assistant", line);
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
      note.textContent = "Thanks. The team will review.";
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
        ? "Could not send silently. Opened mail. A copy is on the clipboard if mail didn’t open."
        : "Could not send silently. Opened mail.";
      restore(4000);
      return;
    }
    btn.textContent = "Send failed";
    note.hidden = false;
    note.textContent = "Could not send. Copy instead.";
  } catch {
    btn.textContent = "Send failed";
    note.hidden = false;
    note.textContent = "Could not send. Copy instead.";
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
  state.messages.push({ role, text, at: new Date().toISOString() });
}

function render(els, state) {
  renderChrome(els, state);
  renderThread(els.thread, state.messages);
  els.quote.innerHTML = quoteCard(state.session.sheet, state.emailNote);
}

function speechError(err) {
  const code = err?.error || err?.message || "mic error";
  const text = String(code);
  if (text.includes("not-allowed") || text.includes("permission")) {
    return "Mic permission was denied. Type the lane instead.";
  }
  const label = getSttProvider(STT_PROVIDER_IDS.WEB_SPEECH).label;
  if (/empty transcript/i.test(text)) {
    return `${label} heard nothing. Hold, speak clearly, then release, or type instead.`;
  }
  return `${label} isn’t available (${text}). Type the lane instead.`;
}
