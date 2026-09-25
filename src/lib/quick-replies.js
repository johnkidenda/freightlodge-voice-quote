import { formatSpokenDate, zipClarifyQuestion } from "./dialog.js";
import { stateDisplayName } from "./zip-state.js";

/** Visible label is the text submitted, so the transcript matches the button. */
export const PIECE_UNIT_CHOICES = [{ label: "Pallets" }, { label: "Pieces" }];

export const YES_NO_CHOICES = [{ label: "Yes" }, { label: "No" }];

export const LIFTGATE_CHOICES = [
  { label: "Pickup" },
  { label: "Delivery" },
  { label: "Both" },
  { label: "No" },
];

export const INSIDE_CHOICES = [
  { label: "Inside pickup" },
  { label: "Inside delivery" },
  { label: "Both" },
];

export const ZIP_END_CHOICES = [{ label: "Origin" }, { label: "Destination" }];

function copyChoices(list) {
  return list.map((choice) => ({ label: choice.label }));
}

function pair(left, right) {
  const a = String(left || "").trim();
  const b = String(right || "").trim();
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null;
  return [{ label: a }, { label: b }];
}

function zipChoices(clarify, sheet, reply) {
  const question = zipClarifyQuestion(clarify, sheet);
  if (!question || !reply.includes(question)) return null;

  if (clarify.kind === "state" && clarify.zipState && clarify.placeState) {
    return pair(stateDisplayName(clarify.zipState), stateDisplayName(clarify.placeState));
  }
  if (clarify.kind === "metro") {
    const zip = String(clarify.zip || "");
    const tail = ` or ${zip}?`;
    const head = "Which is right, ";
    const start = question.lastIndexOf(head);
    const end = question.lastIndexOf(tail);
    if (start >= 0 && end > start) return pair(question.slice(start + head.length, end), zip);
    return null;
  }
  if (clarify.kind === "same" || /Is that right\?$/.test(question)) return copyChoices(YES_NO_CHOICES);
  if (/Origin zip code or destination zip code\?$/.test(question)) return copyChoices(ZIP_END_CHOICES);
  if (
    /Is that the (?:destination|origin) zip code\?$/.test(question) ||
    /Is \d{5} the origin zip code\?$/.test(question) ||
    /Did you mean /.test(question)
  ) {
    return copyChoices(YES_NO_CHOICES);
  }
  return null;
}

/**
 * Choices for the question this turn actually asked.
 * Open-ended asks (ZIPs, counts, weight, commodity, email, free dates) return null.
 */
export function quickRepliesFor(result, displayedReply = result?.reply) {
  if (!result || result.outOfScope || result.ready) return null;
  const reply = String(displayedReply || "");
  if (!reply) return null;

  const date = result.session?.dateClarify;
  if (date?.soon && date?.later && result.extracted?.flags?.ambiguousDate) {
    const soon = formatSpokenDate(date.soon);
    const later = formatSpokenDate(date.later);
    if (reply.includes(soon) && reply.includes(later)) return pair(soon, later);
  }

  const zip = result.extracted?.flags?.zipClarify;
  if (zip) return zipChoices(zip, result.session?.sheet, reply);

  if (/liftgate at pickup, delivery, or both\?/i.test(reply)) return copyChoices(LIFTGATE_CHOICES);
  if (/inside pickup, inside delivery, or both\?/i.test(reply)) return copyChoices(INSIDE_CHOICES);
  if (/pallets or pieces\?/i.test(reply)) return copyChoices(PIECE_UNIT_CHOICES);
  return null;
}
