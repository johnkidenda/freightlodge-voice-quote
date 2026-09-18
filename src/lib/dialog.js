import { emptySheet } from "./sheet.js";
import { isReadyForQuote, nextRequiredSlot } from "./completeness.js";
import {
  applyCityZipChoice,
  applyExtractedSlots,
  applyZipRoleCorrection,
  applyZipToRole,
  detectCityZipMetroClarify,
  detectZipRoleCorrection,
  extractSlots,
  firstBareZip,
  isGarbagePlace,
  resolveZipAttachment,
} from "./extract.js";
import { detectOutOfScope } from "./scope.js";
import { stateDisplayName } from "./zip-state.js";

export const GREETING =
  "Freight Lodge — I’ll take a US domestic LTL quote. Where are we picking up? What’s the origin ZIP?";

const PROMPTS = {
  origin_zip: "What’s the origin ZIP? City is helpful, but I need the five-digit ZIP.",
  dest_zip: "Where is this going? I need a destination city, state, or ZIP.",
  dest_incomplete: "That ended at “to” — I still need the destination city, state, or ZIP.",
  incomplete_zip: "That ZIP is short — I need a full 5-digit ZIP.",
  incomplete_dest_zip: "That destination ZIP is short — I need a full 5-digit ZIP.",
  incomplete_origin_zip: "That origin ZIP is short — I need a full 5-digit ZIP.",
  pieces: "How many pieces or pallets?",
  measure:
    "I need a real measure: total weight in pounds, or L×W×H in inches, or the NMFC class if you already know it.",
  commodity: "What’s the commodity?",
  pickup_date: "What pickup date works? Say a day or YYYY-MM-DD.",
  accessorials:
    "Any accessorials — liftgate, residential, inside, limited access, appointment, freeze protect? Or say none.",
  email:
    "What email should I put on the sheet so we can send the quote? Typing the address is safer than saying it — voice often mangles emails.",
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
    sameZipConfirmed: false,
  };
}

export function isAlreadyMentioned(text) {
  return /\b((i|we)\s+already\s+(mentioned|said|told|gave)|already mentioned( it)?|i (just )?(said|told) (you )?(that|it)|like i (already )?said)\b/i.test(
    String(text || ""),
  );
}

export function zipClarifyQuestion(clarify, sheet) {
  if (clarify?.kind === "state" && clarify.zip && clarify.zipState && clarify.placeState) {
    const zipName = stateDisplayName(clarify.zipState);
    const placeName = stateDisplayName(clarify.placeState);
    const side = clarify.attemptedRole === "dest" ? "destination" : "origin";
    return `${clarify.zip} looks like ${zipName}, but ${side} is ${placeName} — which is right?`;
  }
  if (clarify?.kind === "same" && clarify.zip) {
    return `Origin and destination would both be ${clarify.zip}. Same ZIP both ends — is that right?`;
  }
  if (!clarify?.zip || !clarify?.metro?.city) return PROMPTS.origin_zip;
  if (clarify.kind === "metro") {
    const stated = [clarify.statedCity, clarify.statedState].filter(Boolean).join(", ") || "that city";
    const cityName = clarify.statedCity || stated;
    return `You said ${stated} but ${clarify.zip} looks like ${clarify.metro.city}. Which is right — ${cityName} or ${clarify.zip}?`;
  }
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
  return `${clarify.zip} looks like ${place}. Origin ZIP or destination ZIP?`;
}

function stateTokenRe(code) {
  const name = stateDisplayName(code)
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const abbr = String(code || "").toLowerCase();
  if (!name || !abbr) return null;
  return new RegExp(`\\b(${name}|${abbr})\\b`, "i");
}

function decideZipStateClarify(raw, clarify) {
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  const zipRe = stateTokenRe(clarify.zipState);
  const placeRe = stateTokenRe(clarify.placeState);
  const zipDigits = String(clarify.zip || "").replace(/\D/g, "").slice(0, 5);
  if ((zipRe && zipRe.test(t)) || (zipDigits && t.includes(zipDigits)) || /\b(the zip|that zip|zip code)\b/.test(t)) {
    return clarify.attemptedRole || "origin";
  }
  if ((placeRe && placeRe.test(t)) || /^\s*(no|nope|nah)\b/.test(t)) {
    return "keep";
  }
  return null;
}

function decideZipClarify(raw, clarify) {
  if (!clarify) return null;
  if (clarify.kind === "state") return decideZipStateClarify(raw, clarify);
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (clarify.kind === "same") {
    if (/^\s*(yes|yeah|yep|yup|correct|same|thats right|that is right|it is)\b/.test(t)) {
      return "same_yes";
    }
    if (/^\s*(no|nope|nah)\b/.test(t)) return "same_no";
    return null;
  }
  if (clarify.kind === "metro") return decideMetroClarify(t, clarify);
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

function decideMetroClarify(t, clarify) {
  const zip = String(clarify.zip || "");
  const city = String(clarify.statedCity || "").toLowerCase();
  const metroCity = String(clarify.metro?.city || "").toLowerCase();
  const mentionsZip = (zip && t.includes(zip)) || /\b(the\s+)?zip(\s+code)?\b/.test(t);
  const mentionsCity = (city && t.includes(city)) || /\b(the\s+)?city\b/.test(t);
  const mentionsMetro = Boolean(metroCity && t.includes(metroCity));
  if (mentionsCity && !mentionsZip && !mentionsMetro) return "keep_city";
  if ((mentionsZip || mentionsMetro) && !mentionsCity) return "keep_zip";
  if (mentionsCity && (mentionsZip || mentionsMetro) && /\b(not|isnt|wrong)\b/.test(t)) {
    if (zip && t.includes(zip)) return "keep_city";
    if (city && t.includes(city)) return "keep_zip";
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
    if (decided === "keep_city") {
      sheetFromClarify = applyCityZipChoice(sheet0, zipClarify, "city");
      zipClarify = null;
    } else if (decided === "keep_zip") {
      sheetFromClarify = applyCityZipChoice(sheet0, zipClarify, "zip");
      zipClarify = null;
    } else if (decided === "same_yes") {
      sheetFromClarify = applyZipToRole(sheet0, zipClarify.attemptedRole || "dest", zipClarify.zip);
      zipClarify = null;
      session = { ...session, sameZipConfirmed: true };
    } else if (decided === "same_no") {
      zipClarify = null;
    } else if (decided === "keep") {
      zipClarify = null;
    } else if (decided) {
      const forceState = zipClarify.kind === "state" ? zipClarify.zipState : undefined;
      sheetFromClarify = applyZipToRole(sheet0, decided, zipClarify.zip, { state: forceState });
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
    const verdict = resolveZipAttachment(sheetFromClarify, zipForIntent, zipIntent, extracted);
    if (verdict.clarify) {
      const uttered = [...String(raw).matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]);
      const altZip = uttered.find((z) => z !== zipForIntent) || null;
      if (zipIntent === "origin") delete extracted.origin.postal_code;
      if (zipIntent === "dest") delete extracted.destination.postal_code;
      verdict.clarify.altZip = altZip;
      extracted.flags.zipClarify = verdict.clarify;
      zipClarify = verdict.clarify;
    }
  } else if (bothDistinctZips) {
    const roles = awaitingNow === "dest_zip" ? ["dest", "origin"] : ["origin", "dest"];
    for (const role of roles) {
      const zip = role === "origin" ? extracted.origin.postal_code : extracted.destination.postal_code;
      const verdict = resolveZipAttachment(sheetFromClarify, zip, role, extracted);
      if (verdict.clarify) {
        if (role === "origin") delete extracted.origin.postal_code;
        if (role === "dest") delete extracted.destination.postal_code;
        extracted.flags.zipClarify = verdict.clarify;
        zipClarify = verdict.clarify;
        break;
      }
    }
  }

  if (zipClarify?.kind === "state" && !extracted.flags.zipClarify) {
    const parked = extracted.origin?.postal_code || extracted.destination?.postal_code;
    if (!parked) extracted.flags.zipClarify = zipClarify;
  }
  if (!extracted.flags.zipClarify) {
    const metroClarify = detectCityZipMetroClarify(sheetFromClarify, extracted);
    if (metroClarify) {
      if (metroClarify.attemptedRole === "origin") delete extracted.origin.postal_code;
      if (metroClarify.attemptedRole === "dest") delete extracted.destination.postal_code;
      extracted.flags.zipClarify = metroClarify;
      zipClarify = metroClarify;
    }
  }

  // Hold-and-dump: merge every extracted slot. `awaiting` only disambiguates
  // bare ZIPs / lone counts in extract — it must never drop weight, commodity,
  // or cities from the same utterance.
  let sheet = applyExtractedSlots(sheetFromClarify, extracted);

  if (!extracted.flags.zipClarify && !session.sameZipConfirmed) {
    const same = detectSameZipClarify(sheetFromClarify, sheet);
    if (same) {
      if (same.attemptedRole === "dest") {
        sheet.lanes.destination.postal_code = sheetFromClarify.lanes.destination.postal_code;
        if (extracted.destination) delete extracted.destination.postal_code;
      } else {
        sheet.lanes.origin.postal_code = sheetFromClarify.lanes.origin.postal_code;
        if (extracted.origin) delete extracted.origin.postal_code;
      }
      extracted.flags.zipClarify = same;
      zipClarify = same;
    }
  }

  const roleFix = detectZipRoleCorrection(raw);
  const zipForFix = firstBareZip(raw) || extracted.flags.bareZip || session.lastBareZip;
  if (roleFix && zipForFix && !extracted.flags.zipClarify) {
    sheet = applyZipRoleCorrection(sheet, roleFix, zipForFix);
    if (roleFix === "dest") extracted.destination.postal_code = zipForFix;
    if (roleFix === "origin") extracted.origin.postal_code = zipForFix;
    extracted.flags.zipRole = roleFix;
  }

  const lastBareZip = firstBareZip(raw) || extracted.flags.bareZip || session.lastBareZip;

  let askedAccessorials = session.askedAccessorials;
  if (
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
      "If you have pounds, L×W×H, or a known NMFC class, say it — otherwise I’ll keep asking.";
    return finish(session, sheet, askedAccessorials, reply, extracted);
  }

  if (extracted.flags.vagueDate && !extracted.pickup.date) {
    const reply = "I need a pickup date (today, tomorrow, Friday, or 2026-09-20).";
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
      ? "Still no destination after “to”. Say the city, state, or ZIP you’re going to."
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
    if (label) return `I have dest ${label}. What’s the destination ZIP?`;
  }
  if (slot === "origin_zip") {
    const label = placeLabel(sheet.lanes?.origin);
    if (label) return `I have origin ${label}. What’s the origin ZIP?`;
  }
  return slot ? PROMPTS[slot] : PROMPTS.email;
}

function zip5(code) {
  const digits = String(code || "").replace(/\D/g, "").slice(0, 5);
  return digits.length === 5 ? digits : "";
}

function detectSameZipClarify(sheet0, sheet) {
  const origin = zip5(sheet?.lanes?.origin?.postal_code);
  const dest = zip5(sheet?.lanes?.destination?.postal_code);
  if (!origin || !dest || origin !== dest) return null;
  const originWas = zip5(sheet0?.lanes?.origin?.postal_code);
  const destWas = zip5(sheet0?.lanes?.destination?.postal_code);
  if (originWas === origin && destWas === dest) return null;
  const destNew = dest !== destWas;
  const originNew = origin !== originWas;
  return {
    kind: "same",
    zip: origin,
    attemptedRole: destNew && !originNew ? "dest" : originNew && !destNew ? "origin" : "dest",
  };
}

function finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify) {
  const nextAwait = awaiting ?? nextRequiredSlot(sheet, { askedAccessorials });
  const nextSheet =
    isReadyForQuote(sheet) && askedAccessorials
      ? { ...sheet, status: "ready_for_quote" }
      : { ...sheet, status: sheet.status === "out_of_scope" ? "out_of_scope" : "collecting" };
  const stillSame = zip5(nextSheet.lanes?.origin?.postal_code) && zip5(nextSheet.lanes?.origin?.postal_code) === zip5(nextSheet.lanes?.destination?.postal_code);
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
      sameZipConfirmed: stillSame ? Boolean(session.sameZipConfirmed) : false,
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
