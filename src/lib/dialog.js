import { emptySheet } from "./sheet.js";
import { isReadyForQuote, nextRequiredSlot } from "./completeness.js";
import { extractSlots, mergeExtracted } from "./extract.js";
import { detectOutOfScope } from "./scope.js";

export const GREETING =
  "Freight Lodge — I’ll take a US domestic LTL quote. Where are we picking up? I need the origin ZIP — I won’t guess it.";

const PROMPTS = {
  origin_zip:
    "What’s the origin ZIP? City is helpful, but I need the five-digit ZIP — I won’t look one up.",
  dest_zip:
    "And the destination ZIP? Same rule: I need the actual ZIP, I won’t invent one.",
  pieces: "How many pieces or pallets?",
  measure:
    "I need a real measure: total weight in pounds, or L×W×H in inches, or the NMFC class if you already know it. I won’t guess class or weight.",
  commodity: "What’s the commodity?",
  pickup_date: "What pickup date works? Say a day or YYYY-MM-DD — I won’t treat “ASAP” as a date.",
  accessorials:
    "Any accessorials — liftgate, residential, inside, limited access, appointment, freeze protect? Or say none.",
  email: "What email should I put on the sheet so we can send the quote?",
};

export function createSession({ id, now } = {}) {
  return {
    sheet: emptySheet({ id, now }),
    askedAccessorials: false,
    awaiting: "origin_zip",
    messages: [],
  };
}

export function openingMessage() {
  return GREETING;
}

/**
 * Advance the quote sheet from one user utterance.
 * Never invents ZIPs, dims, weights, or freight class.
 */
export function handleUtterance(session, text, { now } = {}) {
  const raw = (text || "").trim();
  const sheet0 = session.sheet;
  const scope = detectOutOfScope(raw, sheet0);
  if (scope.outOfScope) {
    const sheet = {
      ...structuredClone(sheet0),
      status: "out_of_scope",
      out_of_scope_reason: scope.reason,
      quote_result: null,
    };
    return {
      session: {
        ...session,
        sheet,
        awaiting: null,
      },
      reply: scope.message,
      extracted: null,
      ready: false,
      outOfScope: true,
    };
  }

  const extracted = extractSlots(raw, { now, awaiting: session.awaiting });
  let sheet = mergeExtracted(sheet0, extracted);

  let askedAccessorials = session.askedAccessorials;
  if (
    session.awaiting === "accessorials" ||
    extracted.flags.accessorialsNone ||
    (extracted.pickup.accessorials && extracted.pickup.accessorials.length)
  ) {
    askedAccessorials = true;
  }

  if (extracted.flags.vagueMeasure && !extracted.freight.total_weight_lbs && !extracted.freight.dims && !extracted.freight.freight_class) {
    const reply =
      "I can’t invent a weight, dim, or class from that. If you have pounds, L×W×H, or a known NMFC class, say it — otherwise leave it and I’ll keep asking.";
    return finish(session, sheet, askedAccessorials, reply, extracted);
  }

  if (extracted.flags.vagueDate && !extracted.pickup.date) {
    const reply = "I need a real pickup date (today, tomorrow, Friday, or 2026-09-20). I won’t treat ASAP as a date.";
    return finish(session, sheet, askedAccessorials, reply, extracted);
  }

  if (isReadyForQuote(sheet) && askedAccessorials) {
    sheet = { ...sheet, status: "ready_for_quote", error_reason: null, out_of_scope_reason: null };
    const reply = "Sheet’s complete. Handing this to Freight Ops’ Exfresso runner for a live rate — no booking from here.";
    return {
      session: { ...session, sheet, askedAccessorials, awaiting: null },
      reply,
      extracted,
      ready: true,
      outOfScope: false,
    };
  }

  const awaiting = nextRequiredSlot(sheet, { askedAccessorials });
  const ack = acknowledge(extracted, sheet);
  const ask = awaiting ? PROMPTS[awaiting] : PROMPTS.email;
  const reply = ack ? `${ack} ${ask}` : ask;
  return finish(session, sheet, askedAccessorials, reply, extracted, awaiting);
}

function finish(session, sheet, askedAccessorials, reply, extracted, awaiting) {
  const nextAwait = awaiting ?? nextRequiredSlot(sheet, { askedAccessorials });
  const nextSheet =
    isReadyForQuote(sheet) && askedAccessorials
      ? { ...sheet, status: "ready_for_quote" }
      : { ...sheet, status: sheet.status === "out_of_scope" ? "out_of_scope" : "collecting" };
  return {
    session: {
      ...session,
      sheet: nextSheet,
      askedAccessorials,
      awaiting: nextSheet.status === "ready_for_quote" ? null : nextAwait,
    },
    reply,
    extracted,
    ready: nextSheet.status === "ready_for_quote",
    outOfScope: false,
  };
}

function acknowledge(extracted, sheet) {
  const bits = [];
  if (extracted.origin?.postal_code) bits.push(`origin ${extracted.origin.postal_code}`);
  else if (extracted.origin?.city) bits.push(`origin ${extracted.origin.city} (still need ZIP)`);
  if (extracted.destination?.postal_code) bits.push(`dest ${extracted.destination.postal_code}`);
  else if (extracted.destination?.city) bits.push(`dest ${extracted.destination.city} (still need ZIP)`);
  if (extracted.freight?.pieces) bits.push(`${extracted.freight.pieces} pcs`);
  if (extracted.freight?.total_weight_lbs) bits.push(`${extracted.freight.total_weight_lbs} lb`);
  if (extracted.freight?.dims) {
    const d = extracted.freight.dims;
    bits.push(`${d.length_in}×${d.width_in}×${d.height_in}`);
  }
  if (extracted.freight?.freight_class) bits.push(`class ${extracted.freight.freight_class}`);
  if (extracted.freight?.commodity) bits.push(extracted.freight.commodity);
  if (extracted.pickup?.date) bits.push(`pickup ${extracted.pickup.date}`);
  if (extracted.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  return `Got ${bits.join(", ")}.`;
}

export { PROMPTS };
