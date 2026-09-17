import { formatPlace } from "./completeness.js";

/**
 * Plain-text dump of the current sheet conversation for QA / bug reports.
 * // QA-only — remove before external share
 */
export function formatQaTranscript(messages, session) {
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
  return [
    ...turns,
    "",
    "— Sheet snapshot —",
    `Origin: ${origin}`,
    `Dest: ${dest}`,
    `Weight: ${weight}`,
    `Pieces: ${pieces}`,
    `Awaiting: ${awaiting}`,
    `Status: ${status}`,
  ].join("\n");
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
