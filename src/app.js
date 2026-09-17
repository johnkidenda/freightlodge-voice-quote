import { createSession, handleUtterance, openingMessage } from "./lib/dialog.js";
import { progressItems } from "./lib/completeness.js";
import { requestQuote } from "./lib/handoff.js";
import { emailQuote, MAIL_FROM } from "./lib/email.js";
import { createHoldToTalk, speechSupported } from "./lib/speech.js";

const SAMPLE =
  "Chicago IL 60601 to Dallas TX 75201, 3 pallets, 1200 pounds, auto parts, pickup tomorrow, liftgate delivery, email shipper@example.com";

export function mountApp(root) {
  const state = {
    session: createSession(),
    messages: [{ role: "assistant", text: openingMessage() }],
    listening: false,
    interim: "",
    busy: false,
    emailNote: null,
    hold: null,
  };

  root.innerHTML = layout();
  const els = {
    thread: root.querySelector("#thread"),
    sheet: root.querySelector("#sheet-list"),
    form: root.querySelector("#composer"),
    input: root.querySelector("#typed"),
    hold: root.querySelector("#hold"),
    holdHint: root.querySelector("#hold-hint"),
    quote: root.querySelector("#quote-card"),
    status: root.querySelector("#status-pill"),
    sample: root.querySelector("#sample"),
    reset: root.querySelector("#reset"),
    drawer: root.querySelector("#sheet-drawer"),
    toggleSheet: root.querySelector("#toggle-sheet"),
  };

  const talk = createHoldToTalk({
    onStart() {
      state.listening = true;
      state.interim = "";
      renderChrome(els, state);
    },
    onEnd() {
      state.listening = false;
      state.interim = "";
      renderChrome(els, state);
    },
    onError(err) {
      state.listening = false;
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
  });
  state.hold = talk;

  if (!talk.supported) {
    els.hold.disabled = true;
    els.holdHint.textContent = "Voice needs Chrome/Safari with mic permission. Type instead.";
  }

  bindMic(els.hold, talk);

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

function layout() {
  const speechOk = speechSupported();
  return `
    <header class="top">
      <div class="brand">
        <span class="mark" aria-hidden="true">${logoSvg()}</span>
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
        <div id="thread" class="thread" aria-live="polite"></div>
        <div id="quote-card"></div>
        <form id="composer" class="composer">
          <button type="button" id="sample" class="chip">Try a sample lane</button>
          <label class="sr-only" for="typed">Type a message</label>
          <div class="input-row">
            <input id="typed" type="text" autocomplete="off" enterkeyhint="send" placeholder="Type origin ZIP, dest ZIP, pieces…" />
            <button type="submit" class="send">Send</button>
          </div>
          <button type="button" id="hold" class="hold ${speechOk ? "" : "is-disabled"}" aria-pressed="false">
            <span class="hold-dot"></span>
            <span class="hold-label">Hold to talk</span>
          </button>
          <p id="hold-hint" class="hint">${speechOk ? "Press and hold. I only send when you release." : ""}</p>
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
  `;
}

function bindMic(button, talk) {
  const label = button.querySelector(".hold-label");
  if (talk.mode === "toggle") {
    if (label) label.textContent = "Tap to talk";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      if (talk.isActive?.()) {
        button.setAttribute("aria-pressed", "false");
        button.classList.remove("hot");
        if (label) label.textContent = "Tap to talk";
        talk.stop();
      } else {
        button.setAttribute("aria-pressed", "true");
        button.classList.add("hot");
        if (label) label.textContent = "Recording… tap to send";
        talk.start();
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
    talk.start();
  };
  const stop = (e) => {
    e.preventDefault();
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("hot");
    talk.stop();
  };
  button.addEventListener("pointerdown", go);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("touchend", stop, { passive: false });
  button.addEventListener("lostpointercapture", () => {
    button.classList.remove("hot");
    talk.stop();
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
  const status = state.listening ? "listening" : state.session.sheet.status;
  els.status.textContent = status.replaceAll("_", " ");
  els.status.dataset.status = status;
  els.hold.classList.toggle("hot", state.listening);
  if (state.listening && state.interim) {
    els.holdHint.textContent = state.interim;
  } else if (state.hold?.supported) {
    els.holdHint.textContent =
      state.hold.mode === "toggle"
        ? "Tap to record, tap again to send. I won’t answer while you’re still talking."
        : "Press and hold. Release to send — I won’t answer while you’re still talking.";
  }
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

function speechError(err) {
  const code = err?.error || err?.message || "mic error";
  if (String(code).includes("not-allowed") || String(code).includes("permission")) {
    return "Mic permission was denied. Type the lane instead.";
  }
  return `Voice isn’t available (${code}). Type instead — I won’t invent ZIPs or weights.`;
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
