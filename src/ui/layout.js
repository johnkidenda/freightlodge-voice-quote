import { formatAppVersionLabel, formatAppVersionTitle, getAppCommit, getAppVersion } from "../lib/app-version.js";
import { escapeHtml } from "../lib/escape-html.js";
import { providerSupported } from "../lib/speech-session.js";
import { speakerIcon } from "./speaker.js";

export function layout(conversational) {
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
            <input id="typed" type="text" autocomplete="off" enterkeyhint="send" placeholder="Type origin zip code, dest zip code, pieces…" />
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
          <p id="listen-hint" class="listen-hint" hidden></p>
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
