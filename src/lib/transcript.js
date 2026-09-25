import { formatPlace, formatStoredPieces } from "./completeness.js";
import { getSttProvider } from "./stt-providers.js";

export const TRANSCRIPT_TO = "john@freightlodge.com";
export const FORMSUBMIT_AJAX_URL = `https://formsubmit.co/ajax/${TRANSCRIPT_TO}`;

const ACTIVATE_RE =
  /activat|action required|confirm (your )?e-?mail|check your (e-?mail|inbox)|please confirm|not (yet )?activated|verification (e-?mail|link)|confirm this form|confirm your form/i;

/**
 * Plain-text dump of the current sheet conversation for team delivery.
 */
function formatTurnStamp(at) {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `[${d.toISOString().replace(/\.\d{3}Z$/, "Z")}] `;
}

function formatQuoteAmount(sheet) {
  const total = sheet?.quote_result?.total_usd;
  if (typeof total !== "number" || !Number.isFinite(total)) return "—";
  return `$${total.toFixed(2)}`;
}

export function formatSessionTranscript(messages, session) {
  const turns = (messages || []).map((m) => {
    const label = m.role === "user" ? "User" : "Agent";
    const stamp = formatTurnStamp(m.at);
    return `${stamp}${label}: ${m.text ?? ""}`;
  });
  const sheet = session?.sheet;
  const origin = formatPlace(sheet?.lanes?.origin) || "—";
  const dest = formatPlace(sheet?.lanes?.destination) || "—";
  const weight = sheet?.freight?.total_weight_lbs ?? "—";
  const pieces = formatPieces(sheet?.freight);
  const commodity = sheet?.freight?.commodity || "—";
  const pickupDate = sheet?.pickup?.date || "—";
  const email = sheet?.contact?.email || "—";
  const quote = formatQuoteAmount(sheet);
  const awaiting = session?.awaiting || "—";
  const status = sheet?.status || "—";
  const accessorials = (sheet?.pickup?.accessorials || []).join(", ") || "—";
  const requestId = sheet?.quote_request_id || "—";
  const sttLabel = getSttProvider(session?.sttProvider).label;
  return [
    ...turns,
    "",
    "Sheet snapshot:",
    `Request: ${requestId}`,
    `STT: ${sttLabel}`,
    `Origin: ${origin}`,
    `Dest: ${dest}`,
    `Weight: ${weight}`,
    `Pieces: ${pieces}`,
    `Commodity: ${commodity}`,
    `Pickup date: ${pickupDate}`,
    `Email: ${email}`,
    `Quote: ${quote}`,
    `Accessorials: ${accessorials}`,
    `Awaiting: ${awaiting}`,
    `Status: ${status}`,
  ].join("\n");
}

function formatPieces(freight) {
  return formatStoredPieces(freight);
}

/** @deprecated alias */
export const formatQaTranscript = formatSessionTranscript;

export function transcriptSubject(session) {
  const id = session?.sheet?.quote_request_id || "session";
  const short = String(id).slice(0, 8);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `[Freight Lodge transcript] ${short} ${stamp}`;
}

export function transcriptMailtoHref(subject, transcript, to = TRANSCRIPT_TO) {
  const qs = new URLSearchParams({ subject, body: transcript });
  return `mailto:${encodeURIComponent(to)}?${qs.toString()}`;
}

export function getTranscriptWebhookUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const fromEnv = env?.VITE_TRANSCRIPT_WEBHOOK_URL;
  const fromGlobal = globalThis.FREIGHT_TRANSCRIPT_WEBHOOK_URL;
  const raw = fromEnv || fromGlobal || "";
  return String(raw).trim();
}

export function looksLikeFormSubmitUrl(url) {
  return /formsubmit\.co/i.test(String(url || ""));
}

function isTruthySuccess(value) {
  return value === true || value === "true" || value === "True" || value === 1 || value === "1";
}

function isFalsySuccess(value) {
  return value === false || value === "false" || value === "False" || value === 0 || value === "0";
}

/** FormSubmit first-use / reactivation replies must never look like a delivered chat. */
export function formSubmitLooksLikeActivate(data, text = "") {
  const parts = [];
  if (typeof data === "string") parts.push(data);
  if (data && typeof data === "object") {
    for (const key of ["message", "error", "title", "next", "description", "info"]) {
      if (data[key] != null) parts.push(String(data[key]));
    }
  }
  if (text) parts.push(String(text));
  return ACTIVATE_RE.test(parts.join(" "));
}

export function isFormSubmitDelivered(res, data, text = "") {
  if (!res || !res.ok) return false;
  if (formSubmitLooksLikeActivate(data, text)) return false;
  if (isFalsySuccess(data?.success)) return false;
  return isTruthySuccess(data?.success);
}

export async function readFetchBody(res) {
  let text = "";
  try {
    if (typeof res?.text === "function") text = await res.text();
  } catch {
    text = "";
  }
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  return { data, text };
}

function mailtoResult(subject, transcript) {
  return {
    ok: false,
    mode: "mailto",
    subject,
    transcript,
    mailto: transcriptMailtoHref(subject, transcript),
  };
}

/**
 * Deliver transcript to the team.
 * 1. Optional webhook (`VITE_TRANSCRIPT_WEBHOOK_URL`) if it returns 2xx
 *    (FormSubmit-shaped URLs still go through activate detection)
 * 2. FormSubmit AJAX to john@freightlodge.com (silent POST)
 * 3. mailto last-resort only — never report this as a silent send success
 */
export async function sendSessionTranscript(
  messages,
  session,
  { fetchFn = fetch, webhookUrl, sttProvider } = {},
) {
  const transcript = formatSessionTranscript(messages, {
    ...session,
    sttProvider: sttProvider ?? session?.sttProvider,
  });
  const subject = transcriptSubject(session);
  const webhook = webhookUrl == null ? getTranscriptWebhookUrl() : String(webhookUrl).trim();

  if (webhook) {
    try {
      const res = await fetchFn(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ subject, transcript, message: transcript }),
      });
      if (looksLikeFormSubmitUrl(webhook)) {
        const { data, text } = await readFetchBody(res);
        if (isFormSubmitDelivered(res, data, text)) {
          return { ok: true, mode: "webhook", subject, transcript };
        }
      } else if (res.ok) {
        return { ok: true, mode: "webhook", subject, transcript };
      }
    } catch {
      /* try FormSubmit next */
    }
  }

  try {
    const res = await fetchFn(FORMSUBMIT_AJAX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: subject,
        message: transcript,
        _template: "box",
        _captcha: "false",
      }),
    });
    const { data, text } = await readFetchBody(res);
    if (isFormSubmitDelivered(res, data, text)) {
      return { ok: true, mode: "formsubmit", subject, transcript };
    }
  } catch {
    /* mailto is last resort */
  }

  return mailtoResult(subject, transcript);
}

/** Clipboard write on a user gesture. writeText first; execCommand fallback for older Safari. */
export async function copyTextToClipboard(text, clipboard = globalThis.navigator?.clipboard) {
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Boolean(ok);
  } catch {
    return false;
  }
}
