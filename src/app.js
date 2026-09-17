import { createSession, handleUtterance, openingMessage } from "./lib/dialog.js";
import { progressItems } from "./lib/completeness.js";
import { requestQuote } from "./lib/handoff.js";
import { emailQuote, MAIL_FROM } from "./lib/email.js";
import { speechSupported } from "./lib/speech.js";
import { createSpeechSession, providerSupported } from "./lib/speech-session.js";
import {
  STT_PROVIDERS,
  STT_TOKEN_UNCONFIGURED,
  getSttProvider,
  getSttTokenUrl,
  isCartesiaProvider,
  loadSttProvider,
  saveSttProvider,
} from "./lib/stt-providers.js";
import { formatSessionTranscript, sendSessionTranscript } from "./lib/transcript.js";

const SAMPLE =
  "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1200 pounds, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com";

export function mountApp(root) {
  const state = {
    session: createSession(),
    messages: [{ role: "assistant", text: openingMessage() }],
    listening: false,
    finishing: false,
    interim: "",
    busy: false,
    emailNote: null,
    hold: null,
    sttProvider: loadSttProvider(typeof localStorage !== "undefined" ? localStorage : null),
  };

  root.innerHTML = layout(state.sttProvider);
  const els = {
    thread: root.querySelector("#thread"),
    sheet: root.querySelector("#sheet-list"),
    form: root.querySelector("#composer"),
    input: root.querySelector("#typed"),
    hold: root.querySelector("#hold"),
    holdHint: root.querySelector("#hold-hint"),
    sttBadge: root.querySelector("#stt-badge"),
    sttToggle: root.querySelector("#stt-toggle"),
    quote: root.querySelector("#quote-card"),
    status: root.querySelector("#status-pill"),
    sample: root.querySelector("#sample"),
    sendTranscript: root.querySelector("#send-transcript"),
    sendNote: root.querySelector("#send-note"),
    reset: root.querySelector("#reset"),
    drawer: root.querySelector("#sheet-drawer"),
    toggleSheet: root.querySelector("#toggle-sheet"),
  };

  const sessionRef = { current: null };

  function talkCallbacks() {
    return {
      onStart() {
        state.listening = true;
        state.finishing = false;
        state.interim = "";
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
        push(state, "assistant", speechError(err, state.sttProvider));
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
    };
  }

  function applyHoldAvailability() {
    const talk = state.hold;
    const ok = Boolean(talk?.supported);
    els.hold.disabled = !ok;
    els.hold.classList.toggle("is-disabled", !ok);
    els.hold.setAttribute("aria-disabled", ok ? "false" : "true");
  }

  function attachSpeechSession(providerId) {
    state.hold?.abort?.();
    state.listening = false;
    state.finishing = false;
    state.interim = "";
    const talk = createSpeechSession({
      provider: providerId,
      ...talkCallbacks(),
    });
    state.hold = talk;
    sessionRef.current = talk;
    applyHoldAvailability();
    renderChrome(els, state);
    return talk;
  }

  attachSpeechSession(state.sttProvider);
  bindMic(els.hold, sessionRef);

  els.sttToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stt-provider]");
    if (!btn) return;
    const next = btn.getAttribute("data-stt-provider");
    if (!next || next === state.sttProvider) return;
    state.sttProvider = saveSttProvider(
      next,
      typeof localStorage !== "undefined" ? localStorage : null,
    );
    attachSpeechSession(state.sttProvider);
    syncSttToggle(els, state.sttProvider);
  });

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
    state.messages = [{ role: "assistant", text: openingMessage() }];
    state.emailNote = null;
    state.interim = "";
    render(els, state);
  });

  els.toggleSheet.addEventListener("click", () => {
    els.drawer.classList.toggle("open");
    els.toggleSheet.setAttribute("aria-expanded", els.drawer.classList.contains("open") ? "true" : "false");
  });

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-email-quote]");
    if (btn) void sendEmail(els, state);
  });

  render(els, state);
}

function layout(providerId) {
  const provider = getSttProvider(providerId);
  const speechOk = providerSupported(provider.id);
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
        <p class="voice-tip">Press and hold the button below to say what you want to ship. We’ll walk you through the details needed for a quote.</p>
        <div id="thread" class="thread" aria-live="polite"></div>
        <div id="quote-card"></div>
        <form id="composer" class="composer">
          <button type="button" id="sample" class="chip">Try a sample lane</button>
          <label class="sr-only" for="typed">Type a message</label>
          <div class="input-row">
            <input id="typed" type="text" autocomplete="off" enterkeyhint="send" placeholder="Type origin ZIP, dest ZIP, pieces…" />
            <button type="submit" class="send">Send</button>
          </div>
          <div id="stt-toggle" class="stt-toggle" role="group" aria-label="STT provider">
            ${STT_PROVIDERS.map(
              (p) =>
                `<button type="button" class="stt-opt${p.id === provider.id ? " is-active" : ""}" data-stt-provider="${p.id}" aria-pressed="${p.id === provider.id ? "true" : "false"}">${p.label}</button>`,
            ).join("")}
          </div>
          <p class="stt-badge-row">
            <span id="stt-badge" class="stt-badge">Active: ${provider.label}</span>
          </p>
          <button type="button" id="hold" class="hold ${speechOk ? "" : "is-disabled"}" aria-pressed="false">
            <span class="hold-dot"></span>
            <span class="hold-label">Hold to talk</span>
          </button>
          <p id="hold-hint" class="hint">${defaultHoldHint(provider.id, speechOk)}</p>
          <button type="button" id="send-transcript" class="send-transcript">Send transcript</button>
          <p id="send-note" class="send-note" hidden></p>
        </form>
      </section>

      <aside class="sheet-col">
        <button type="button" id="toggle-sheet" class="sheet-toggle" aria-expanded="false">Sheet progress</button>
        <div id="sheet-drawer" class="sheet-drawer">
          <h2>Quote sheet</h2>
          <p class="muted">v1 · never invent ZIP / dims / weight / class</p>
          <ol id="sheet-list" class="sheet-list"></ol>
        </div>
      </aside>
    </main>

    <footer class="powered-by">
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

async function acceptUserText(els, state, text) {
  if (state.busy) return;
  push(state, "user", text);
  render(els, state);
  const result = handleUtterance(state.session, text);
  state.session = result.session;
  push(state, "assistant", result.reply);
  render(els, state);

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
      push(state, "assistant", "Quote is back. No book or pay from this app — email it if you want a copy.");
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
  try {
    const result = await sendSessionTranscript(state.messages, state.session);
    if (result.ok) {
      btn.textContent = "Sent";
      btn.classList.add("sent");
      note.hidden = false;
      note.textContent = "Thanks — the team will review.";
      window.clearTimeout(btn._sentTimer);
      btn._sentTimer = window.setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove("sent");
        btn.disabled = false;
      }, 2200);
      return;
    }
    if (result.mailto) {
      window.location.href = result.mailto;
      btn.textContent = "Opening mail…";
      note.hidden = false;
      note.textContent = "If mail didn’t open, try again or email john@freightlodge.com.";
    } else {
      btn.textContent = "Send failed";
      note.hidden = false;
      note.textContent = "Couldn’t send — try again.";
    }
  } catch (err) {
    btn.textContent = "Send failed";
    note.hidden = false;
    note.textContent = "Couldn’t send — try again.";
  }
  window.clearTimeout(btn._sentTimer);
  btn._sentTimer = window.setTimeout(() => {
    btn.textContent = label;
    btn.classList.remove("sent");
    btn.disabled = false;
  }, 2200);
}

async function sendEmail(els, state) {
  const sheet = state.session.sheet;
  const result = await emailQuote(sheet, { apiBase: import.meta.env.BASE_URL.replace(/\/$/, "") });
  state.emailNote = result.note || `Would send from ${MAIL_FROM}.`;
  if (result.mailto) {
    window.location.href = result.mailto;
  }
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

  const items = progressItems(state.session.sheet, {
    askedAccessorials: state.session.askedAccessorials,
  });
  els.sheet.innerHTML = items
    .map(
      (item) => `
      <li class="${item.done ? "done" : ""}">
        <span class="tick">${item.done ? "●" : "○"}</span>
        <span>
          <strong>${escapeHtml(item.label)}</strong>
          <em>${escapeHtml(item.value || "—")}</em>
        </span>
      </li>`,
    )
    .join("");

  els.quote.innerHTML = quoteCard(state.session.sheet, state.emailNote);
}

function renderChrome(els, state) {
  const status = state.finishing ? "finishing" : state.listening ? "listening" : state.session.sheet.status;
  els.status.textContent = status.replaceAll("_", " ");
  els.status.dataset.status = status;
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
  if (els.sttBadge) {
    els.sttBadge.textContent = `Active: ${getSttProvider(state.sttProvider).label}`;
  }
  if (state.finishing) {
    els.holdHint.textContent = state.interim ? `${providerHintPrefix(state.sttProvider)} ${state.interim}` : `${providerHintPrefix(state.sttProvider)} Finishing…`;
  } else if (state.listening && state.interim) {
    els.holdHint.textContent = `${providerHintPrefix(state.sttProvider)} ${state.interim}`;
  } else if (state.hold?.supported) {
    els.holdHint.textContent = defaultHoldHint(state.sttProvider, true, state.hold.mode);
  } else {
    els.holdHint.textContent = defaultHoldHint(state.sttProvider, false, state.hold?.mode);
  }
}

function syncSttToggle(els, providerId) {
  els.sttToggle?.querySelectorAll("[data-stt-provider]").forEach((btn) => {
    const active = btn.getAttribute("data-stt-provider") === providerId;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function providerHintPrefix(providerId) {
  return `[${getSttProvider(providerId).label}]`;
}

function defaultHoldHint(providerId, supported, mode) {
  const prefix = providerHintPrefix(providerId);
  if (isCartesiaProvider(providerId) && !getSttTokenUrl()) {
    return `${prefix} ${STT_TOKEN_UNCONFIGURED}`;
  }
  if (!supported) {
    return isCartesiaProvider(providerId)
      ? `${prefix} Mic capture isn’t available. Type instead.`
      : "Voice needs Chrome/Safari with mic permission. Type instead.";
  }
  if (mode === "toggle") {
    return `${prefix} Tap to record, tap again to send. I wait a beat after Stop so the last words aren’t cut off.`;
  }
  return `${prefix} Press and hold. Release — I wait a beat so the last words aren’t cut off.`;
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
    <p class="hint">From ${escapeHtml(MAIL_FROM)} when SMTP is live. Demo opens a mailto and logs a stub.</p>
    ${emailNote ? `<p class="hint">${escapeHtml(emailNote)}</p>` : ""}
  </section>`;
}

function speechError(err, providerId) {
  const code = err?.error || err?.message || "mic error";
  const text = String(code);
  if (text.includes("not-allowed") || text.includes("permission")) {
    return "Mic permission was denied. Type the lane instead.";
  }
  if (err?.code === "STT_TOKEN_UNCONFIGURED" || text.includes(STT_TOKEN_UNCONFIGURED)) {
    return STT_TOKEN_UNCONFIGURED;
  }
  const label = getSttProvider(providerId).label;
  return `${label} isn’t available (${text}). Type instead — I won’t invent ZIPs or weights.`;
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
