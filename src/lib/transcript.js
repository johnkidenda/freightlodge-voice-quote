import { formatPlace } from "./completeness.js";

/**
 * Plain-text dump of the current sheet conversation for team delivery.
 */
export function formatSessionTranscript(messages, session) {
  const turns = (messages || []).map((m) => {
    const label = m.role === "user" ? "User" : "Agent";
    return `${label}: ${m.text ?? ""}`;
  });
  const sheet = session?.sheet;
  const origin = formatPlace(sheet?.lanes?.origin) || "—";
  const dest = formatPlace(sheet?.lanes?.destination) || "—";
  const weight = sheet?.freight?.total_weight_lbs ?? "—";
  const pieces = sheet?.freight?.pieces ?? "—";
  const awaiting = session?.awaiting || "—";
  const status = sheet?.status || "—";
  const accessorials = (sheet?.pickup?.accessorials || []).join(", ") || "—";
  const requestId = sheet?.quote_request_id || "—";
  return [
    ...turns,
    "",
    "— Sheet snapshot —",
    `Request: ${requestId}`,
    `Origin: ${origin}`,
    `Dest: ${dest}`,
    `Weight: ${weight}`,
    `Pieces: ${pieces}`,
    `Accessorials: ${accessorials}`,
    `Awaiting: ${awaiting}`,
    `Status: ${status}`,
  ].join("\n");
}

/** @deprecated alias */
export const formatQaTranscript = formatSessionTranscript;

export function transcriptSubject(session) {
  const id = session?.sheet?.quote_request_id || "session";
  const short = String(id).slice(0, 8);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `[Freight Lodge transcript] ${short} ${stamp}`;
}

/**
 * Deliver transcript to the team. Tries webhook env, then FormSubmit to
 * john@freightlodge.com, then mailto fallback.
 */
export async function sendSessionTranscript(messages, session, { fetchFn = fetch } = {}) {
  const transcript = formatSessionTranscript(messages, session);
  const subject = transcriptSubject(session);
  const webhook =
    (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_TRANSCRIPT_WEBHOOK_URL) ||
    globalThis.FREIGHT_TRANSCRIPT_WEBHOOK_URL ||
    "";

  if (webhook) {
    try {
      const res = await fetchFn(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ subject, transcript, message: transcript }),
      });
      if (res.ok) return { ok: true, mode: "webhook", subject, transcript };
    } catch {
      // fall through
    }
  }

  try {
    const res = await fetchFn("https://formsubmit.co/ajax/john@freightlodge.com", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: subject,
        message: transcript,
        _template: "box",
        _captcha: "false",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success !== false) {
      return { ok: true, mode: "formsubmit", subject, transcript };
    }
  } catch {
    // fall through to mailto
  }

  const qs = new URLSearchParams({ subject, body: transcript });
  return {
    ok: false,
    mode: "mailto",
    subject,
    transcript,
    mailto: `mailto:${encodeURIComponent("john@freightlodge.com")}?${qs.toString()}`,
  };
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
