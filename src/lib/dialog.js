import { emptySheet } from "./sheet.js";
import { isReadyForQuote, nextRequiredSlot } from "./completeness.js";
import {
  applyExtractedSlots,
  applyZipRoleCorrection,
  applyZipToRole,
  detectZipRoleCorrection,
  extractSlots,
  firstBareZip,
  isGarbagePlace,
  resolveZipAttachment,
} from "./extract.js";
import { detectOutOfScope } from "./scope.js";

export const GREETING =
  "Freight Lodge — I’ll take a US domestic LTL quote. Where are we picking up? I need the origin ZIP — I won’t guess it.";

const PROMPTS = {
  origin_zip:
    "What’s the origin ZIP? City is helpful, but I need the five-digit ZIP — I won’t look one up.",
  dest_zip:
    "Where is this going? I need a destination city, state, or ZIP — I won’t invent one.",
  dest_incomplete:
    "That ended at “to” — I still need the destination city, state, or ZIP. I won’t invent a dest.",
  incomplete_zip:
    "That ZIP is short — I need a full 5-digit ZIP. I won’t pad or guess the last digits.",
  incomplete_dest_zip:
    "That destination ZIP is short — I need a full 5-digit ZIP. I won’t pad or guess the last digits.",
  incomplete_origin_zip:
    "That origin ZIP is short — I need a full 5-digit ZIP. I won’t pad or guess the last digits.",
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
    lastReply: null,
    lastExtractKey: null,
    lastBareZip: null,
    zipClarify: null,
  };
}

export function isAlreadyMentioned(text) {
  return /\b((i|we)\s+already\s+(mentioned|said|told|gave)|already mentioned( it)?|i (just )?(said|told) (you )?(that|it)|like i (already )?said)\b/i.test(
    String(text || ""),
  );
}

export function zipClarifyQuestion(clarify, sheet) {
  if (!clarify?.zip || !clarify?.metro?.city) return PROMPTS.origin_zip;
  const place = clarify.metro.city;
  const destCity = sheet?.lanes?.destination?.city;
  const destConflicts =
    destCity && clarify.metro && destCity.toLowerCase() !== place.toLowerCase();
  if (destConflicts && clarify.altZip) {
    return `${clarify.zip} looks like ${place} — did you mean ${destCity} ${clarify.altZip}?`;
  }
  if (destConflicts && destCity) {
    return `${clarify.zip} looks like ${place} — dest is ${destCity}. Is ${clarify.zip} the origin ZIP?`;
  }
  if (clarify.suggestedRole === "dest") {
    return `${clarify.zip} looks like ${place} — is that the destination ZIP?`;
  }
  if (clarify.suggestedRole === "origin") {
    return `${clarify.zip} looks like ${place} — is that the origin ZIP?`;
  }
  return `${clarify.zip} looks like ${place}. Origin ZIP or destination ZIP? I won’t silently invert the lane.`;
}

function decideZipClarify(raw, clarify) {
  if (!clarify) return null;
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (/\b(dest|destination|going|deliver)\b/.test(t)) return "dest";
  if (/\b(origin|pickup|pick up|ship from)\b/.test(t)) return "origin";
  if (/^\s*(yes|yeah|yep|yup|correct|thats right|that is right|it is)\b/.test(t)) {
    return clarify.suggestedRole || "dest";
  }
  if (/^\s*(no|nope|nah)\b/.test(t)) {
    return clarify.attemptedRole || "origin";
  }
  return null;
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

  const awaitingNow =
    session.awaiting === "origin_zip" || session.awaiting === "dest_zip"
      ? session.awaiting
      : nextRequiredSlot(sheet0, { askedAccessorials: session.askedAccessorials });

  let sheetFromClarify = sheet0;
  let zipClarify = session.zipClarify || null;
  if (zipClarify) {
    const decided = decideZipClarify(raw, zipClarify);
    if (decided) {
      sheetFromClarify = applyZipToRole(sheet0, decided, zipClarify.zip);
      zipClarify = null;
    } else if (firstBareZip(raw)) {
      zipClarify = null;
    }
  }

  const extracted = extractSlots(raw, {
    now,
    awaiting: awaitingNow,
    originCity: sheetFromClarify.lanes?.origin?.city,
    destCity: sheetFromClarify.lanes?.destination?.city,
  });
  const bothDistinctZips =
    extracted.origin?.postal_code &&
    extracted.destination?.postal_code &&
    extracted.origin.postal_code !== extracted.destination.postal_code;
  const zipIntent =
    bothDistinctZips
      ? null
      : awaitingNow === "origin_zip" && extracted.origin?.postal_code
        ? "origin"
        : awaitingNow === "dest_zip" && extracted.destination?.postal_code
          ? "dest"
          : extracted.origin?.postal_code
            ? "origin"
            : extracted.destination?.postal_code
              ? "dest"
              : null;
  const zipForIntent =
    zipIntent === "origin" ? extracted.origin.postal_code : zipIntent === "dest" ? extracted.destination.postal_code : null;
  if (zipIntent && zipForIntent) {
    const verdict = resolveZipAttachment(sheetFromClarify, zipForIntent, zipIntent);
    if (verdict.clarify) {
      const uttered = [...String(raw).matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]);
      const altZip = uttered.find((z) => z !== zipForIntent) || null;
      if (zipIntent === "origin") delete extracted.origin.postal_code;
      if (zipIntent === "dest") delete extracted.destination.postal_code;
      verdict.clarify.altZip = altZip;
      extracted.flags.zipClarify = verdict.clarify;
      zipClarify = verdict.clarify;
    }
  }

  // Hold-and-dump: merge every extracted slot. `awaiting` only disambiguates
  // bare ZIPs / lone counts in extract — it must never drop weight, commodity,
  // or cities from the same utterance.
  let sheet = applyExtractedSlots(sheetFromClarify, extracted);

  const roleFix = detectZipRoleCorrection(raw);
  const zipForFix = firstBareZip(raw) || extracted.flags.bareZip || session.lastBareZip;
  if (roleFix && zipForFix) {
    sheet = applyZipRoleCorrection(sheet, roleFix, zipForFix);
    if (roleFix === "dest") extracted.destination.postal_code = zipForFix;
    if (roleFix === "origin") extracted.origin.postal_code = zipForFix;
    extracted.flags.zipRole = roleFix;
  }

  const lastBareZip = firstBareZip(raw) || extracted.flags.bareZip || session.lastBareZip;

  let askedAccessorials = session.askedAccessorials;
  if (
    session.awaiting === "accessorials" ||
    extracted.flags.accessorialsNone ||
    (extracted.pickup.accessorials && extracted.pickup.accessorials.length)
  ) {
    askedAccessorials = true;
  }

  if (extracted.flags.zipClarify) {
    const reply = zipClarifyQuestion(extracted.flags.zipClarify, sheet);
    return finish(session, sheet, askedAccessorials, reply, extracted, awaitingNow, undefined, lastBareZip, zipClarify);
  }

  if (
    isAlreadyMentioned(raw) &&
    awaitingNow === "pieces" &&
    typeof sheet.freight?.total_weight_lbs === "number" &&
    sheet.freight.total_weight_lbs > 0 &&
    !extracted.freight?.pieces
  ) {
    const reply = "Got the weight; I still need piece/pallet count.";
    return finish(session, sheet, askedAccessorials, reply, extracted, "pieces", undefined, lastBareZip, zipClarify);
  }

  if (extracted.flags.incompleteZip) {
    const role = extracted.flags.incompleteZip.role;
    const reply =
      role === "dest"
        ? PROMPTS.incomplete_dest_zip
        : role === "origin"
          ? PROMPTS.incomplete_origin_zip
          : PROMPTS.incomplete_zip;
    const stay =
      role === "dest" ? "dest_zip" : role === "origin" ? "origin_zip" : session.awaiting;
    return finish(session, sheet, askedAccessorials, reply, extracted, stay);
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
      session: { ...session, sheet, askedAccessorials, awaiting: null, lastBareZip, zipClarify: null },
      reply,
      extracted,
      ready: true,
      outOfScope: false,
    };
  }

  const awaiting = nextRequiredSlot(sheet, { askedAccessorials });
  const extractKey = extractKeyOf(extracted);
  const addedNothing = session.lastExtractKey === extractKey && !extracted.flags.zipRole;
  let reply;
  if (extracted.flags.incompleteTo && !hasRealDest(sheet.lanes.destination)) {
    reply = addedNothing
      ? "Still no destination after “to”. Say the city, state, or ZIP you’re going to — I won’t guess."
      : PROMPTS.dest_incomplete;
  } else {
    const ack = acknowledge(extracted, sheet);
    const ask = promptFor(awaiting, sheet);
    reply = ack ? `${ack} ${ask}` : ask;
    if (addedNothing && reply === session.lastReply) {
      reply =
        awaiting === "dest_zip"
          ? "Still need the destination city, state, or ZIP — that last message didn’t add one."
          : `I didn’t catch a new ${awaiting?.replaceAll("_", " ") || "detail"} in that. ${ask}`;
    }
  }
  return finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify);
}

function placeLabel(place) {
  if (!place || isGarbagePlace(place)) return null;
  const bits = [place.city, place.state].filter(Boolean);
  return bits.length ? bits.join(", ") : null;
}

function promptFor(slot, sheet) {
  if (slot === "dest_zip") {
    const label = placeLabel(sheet.lanes?.destination);
    if (label) return `I have dest ${label}. What’s the destination ZIP? I won’t invent one.`;
  }
  if (slot === "origin_zip") {
    const label = placeLabel(sheet.lanes?.origin);
    if (label) return `I have origin ${label}. What’s the origin ZIP? I won’t look one up.`;
  }
  return slot ? PROMPTS[slot] : PROMPTS.email;
}

function finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify) {
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
      lastReply: reply,
      lastExtractKey: extractKey ?? extractKeyOf(extracted),
      lastBareZip: lastBareZip ?? session.lastBareZip,
      zipClarify: nextSheet.status === "ready_for_quote" ? null : zipClarify ?? null,
    },
    reply,
    extracted,
    ready: nextSheet.status === "ready_for_quote",
    outOfScope: false,
  };
}

function extractKeyOf(extracted) {
  if (!extracted) return "";
  return JSON.stringify({
    o: extracted.origin,
    d: extracted.destination,
    f: extracted.freight,
    p: extracted.pickup,
    c: extracted.contact,
    inc: extracted.flags?.incompleteTo || false,
  });
}

function hasRealDest(place) {
  if (!place || isGarbagePlace(place)) return false;
  return Boolean(place.postal_code || place.city || place.state);
}

function acknowledge(extracted, sheet) {
  const bits = [];
  if (extracted.origin?.postal_code) bits.push(`origin ${extracted.origin.postal_code}`);
  else if (extracted.origin?.city) bits.push(`origin ${extracted.origin.city} (still need ZIP)`);
  else if (extracted.origin?.state) bits.push(`origin ${extracted.origin.state} (still need ZIP)`);
  if (!isGarbagePlace(extracted.destination)) {
    if (extracted.destination?.postal_code) bits.push(`dest ${extracted.destination.postal_code}`);
    else if (extracted.destination?.city) bits.push(`dest ${extracted.destination.city} (still need ZIP)`);
    else if (extracted.destination?.state) bits.push(`dest ${extracted.destination.state} (still need ZIP)`);
  }
  if (extracted.freight?.pieces) bits.push(`${extracted.freight.pieces} pcs`);
  if (extracted.flags?.weightFromKg && extracted.freight?.total_weight_lbs) {
    bits.push(`${extracted.flags.weightKg} kg (~${extracted.freight.total_weight_lbs} lb)`);
  } else if (extracted.freight?.total_weight_lbs) {
    bits.push(`${extracted.freight.total_weight_lbs} lb`);
  }
  if (extracted.freight?.dims) {
    const d = extracted.freight.dims;
    bits.push(`${d.length_in}×${d.width_in}×${d.height_in}`);
  }
  if (extracted.freight?.freight_class) bits.push(`class ${extracted.freight.freight_class}`);
  if (extracted.freight?.commodity) bits.push(extracted.freight.commodity);
  if (extracted.pickup?.date) bits.push(`pickup ${extracted.pickup.date}`);
  if (extracted.pickup?.accessorials?.length) {
    bits.push(extracted.pickup.accessorials.join(", ").replaceAll("_", " "));
  }
  if (extracted.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  return `Got ${bits.join(", ")}.`;
}

export { PROMPTS };
