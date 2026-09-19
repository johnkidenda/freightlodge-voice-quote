import { emptySheet } from "./sheet.js";
import { isReadyForQuote, isValidZip, nextRequiredSlot } from "./completeness.js";
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
import {
  appendJevLog,
  awaitingSlotIsFilled,
  guardJevDecision,
  jevClarifyScript,
  normalizeJevDecision,
  utteranceCorrectsSlot,
} from "./jev-core.js";

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
  liftgate_side: "Liftgate at pickup, delivery, or both?",
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
    accessorialClarify: null,
    sameZipConfirmed: false,
    jevLog: [],
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

function decideLiftgateSide(raw) {
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (
    /\b(both|each|either|pickup and delivery|delivery and pickup|pick\s*up and deliv|deliv\w* and pick)\b/.test(t)
  ) {
    return "both";
  }
  const pick = /\b(pick\s*-?\s*up|pickup|origin)\b/.test(t);
  const deliv = /\b(deliv|destination|dest)\b/.test(t);
  if (pick && deliv) return "both";
  if (pick) return "pickup";
  if (deliv) return "delivery";
  if (/^\s*(no|nope|nah|none)(?:\s+lift\s*-?\s*gates?)?\b/.test(t) && !pick && !deliv) return "none";
  return null;
}

function liftgateIdsForSide(side) {
  if (side === "pickup") return ["liftgate_pickup"];
  if (side === "delivery") return ["liftgate_delivery"];
  if (side === "both") return ["liftgate_pickup", "liftgate_delivery"];
  return [];
}

function addAccessorials(extracted, ids) {
  if (!extracted.pickup) extracted.pickup = {};
  const cur = Array.isArray(extracted.pickup.accessorials) ? extracted.pickup.accessorials : [];
  extracted.pickup.accessorials = [...new Set([...cur, ...ids])];
  return extracted;
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
export function handleUtterance(session, text, { now, jev } = {}) {
  const raw = (text || "").trim();
  const sheet0 = session.sheet;
  const jevRaw = jev ? normalizeJevDecision(jev) : null;
  const jevDecision = jevRaw
    ? guardJevDecision(jevRaw, {
        sheet: sheet0,
        utterance: raw,
        askedAccessorials: session.askedAccessorials,
      })
    : null;
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
        jevLog: appendJevLog(session, jevDecision),
      },
      reply: scope.message,
      extracted: null,
      ready: false,
      outOfScope: true,
      jev: jevDecision,
    };
  }

  const stickyZip = session.awaiting === "origin_zip" || session.awaiting === "dest_zip";
  const awaitingNow =
    stickyZip && !awaitingSlotIsFilled(sheet0, session.awaiting)
      ? session.awaiting
      : nextRequiredSlot(sheet0, { askedAccessorials: session.askedAccessorials });
  const extractAwaiting = session.zipClarify
    ? session.zipClarify.attemptedRole === "dest"
      ? "dest_zip"
      : session.zipClarify.attemptedRole === "origin"
        ? "origin_zip"
        : awaitingNow
    : jevDecision?.on && jevDecision.focus
      ? jevDecision.focus
      : awaitingNow;

  let sheetFromClarify = sheet0;
  let zipClarify = session.zipClarify || null;
  let zipClarifyDecided = null;
  const pendingClarifyRole = zipClarify?.attemptedRole || null;
  if (zipClarify) {
    const decided = decideZipClarify(raw, zipClarify);
    zipClarifyDecided = decided;
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
    awaiting: extractAwaiting,
    originCity: sheetFromClarify.lanes?.origin?.city,
    destCity: sheetFromClarify.lanes?.destination?.city,
  });
  if (
    zipClarifyDecided &&
    !firstBareZip(raw) &&
    ["keep_city", "keep_zip", "same_yes", "same_no", "keep", "origin", "dest"].includes(zipClarifyDecided)
  ) {
    extracted.origin = {};
    extracted.destination = {};
  }
  let accessorialClarify = session.accessorialClarify || null;
  if (accessorialClarify?.kind === "liftgate") {
    const already = extracted.pickup.accessorials || [];
    const hasLift = already.includes("liftgate_pickup") || already.includes("liftgate_delivery");
    const side = decideLiftgateSide(raw);
    if (hasLift) {
      extracted.flags.ambiguousLiftgate = false;
      accessorialClarify = null;
    } else if (side === "none") {
      extracted.flags.ambiguousLiftgate = false;
      accessorialClarify = null;
    } else if (side) {
      addAccessorials(extracted, liftgateIdsForSide(side));
      extracted.flags.ambiguousLiftgate = false;
      accessorialClarify = null;
    }
  }
  rehomeZipOffFilledSide(sheetFromClarify, extracted, raw);
  const bothDistinctZips =
    extracted.origin?.postal_code &&
    extracted.destination?.postal_code &&
    extracted.origin.postal_code !== extracted.destination.postal_code;
  const zipIntent =
    bothDistinctZips
      ? null
      : extractAwaiting === "origin_zip" && extracted.origin?.postal_code
        ? "origin"
        : extractAwaiting === "dest_zip" && extracted.destination?.postal_code
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
      if (altZip) {
        const otherRole = zipIntent === "origin" ? "dest" : "origin";
        const altVerdict = resolveZipAttachment(sheetFromClarify, altZip, otherRole, extracted);
        if (!altVerdict.clarify && altVerdict.attach) {
          applyZipRoleMove(extracted, altZip, altVerdict.attach);
        }
      }
      verdict.clarify.altZip = altZip;
      extracted.flags.zipClarify = verdict.clarify;
      zipClarify = verdict.clarify;
    } else if (verdict.attach && verdict.attach !== zipIntent) {
      applyZipRoleMove(extracted, zipForIntent, verdict.attach);
    }
  } else if (bothDistinctZips) {
    const roles = extractAwaiting === "dest_zip" ? ["dest", "origin"] : ["origin", "dest"];
    let firstClarify = null;
    for (const role of roles) {
      const zip = role === "origin" ? extracted.origin.postal_code : extracted.destination.postal_code;
      if (!zip) continue;
      const verdict = resolveZipAttachment(sheetFromClarify, zip, role, extracted);
      if (verdict.clarify) {
        if (role === "origin") delete extracted.origin.postal_code;
        if (role === "dest") delete extracted.destination.postal_code;
        if (!firstClarify) {
          firstClarify = verdict.clarify;
          extracted.flags.zipClarify = verdict.clarify;
          zipClarify = verdict.clarify;
        }
        continue;
      }
      if (verdict.attach && verdict.attach !== role) {
        applyZipRoleMove(extracted, zip, verdict.attach);
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

  const jevAfter = jevRaw
    ? guardJevDecision(jevRaw, { sheet, utterance: raw, askedAccessorials })
    : null;

  if (extracted.flags.zipClarify) {
    const reply = zipClarifyQuestion(extracted.flags.zipClarify, sheet);
    const clarified =
      extracted.flags.zipClarify.attemptedRole === "dest" ? "dest_zip" : "origin_zip";
    const stay = awaitingSlotIsFilled(sheet, clarified)
      ? nextRequiredSlot(sheet, { askedAccessorials }) || clarified
      : clarified;
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
  }

  if (extracted.flags.ambiguousLiftgate || accessorialClarify?.kind === "liftgate") {
    accessorialClarify = { kind: "liftgate" };
    const ack = acknowledge(extracted, sheet);
    const reply = ack ? `${ack} ${PROMPTS.liftgate_side}` : PROMPTS.liftgate_side;
    return finish(session, sheet, askedAccessorials, reply, extracted, "liftgate_side", undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
  }

  if (
    isAlreadyMentioned(raw) &&
    awaitingNow === "pieces" &&
    typeof sheet.freight?.total_weight_lbs === "number" &&
    sheet.freight.total_weight_lbs > 0 &&
    !extracted.freight?.pieces
  ) {
    const reply = "Got the weight; I still need piece/pallet count.";
    return finish(session, sheet, askedAccessorials, reply, extracted, "pieces", undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
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
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, undefined, zipClarify, jevAfter, accessorialClarify);
  }

  if (extracted.flags.vagueMeasure && !extracted.freight.total_weight_lbs && !extracted.freight.dims && !extracted.freight.freight_class) {
    const reply =
      "If you have pounds, L×W×H, or a known NMFC class, say it — otherwise I’ll keep asking.";
    return finish(session, sheet, askedAccessorials, reply, extracted, undefined, undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
  }

  if (extracted.flags.vagueDate && !extracted.pickup.date) {
    const reply = "I need a pickup date (today, tomorrow, Friday, or 2026-09-20).";
    return finish(session, sheet, askedAccessorials, reply, extracted, undefined, undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
  }

  const jevWantsClarify = Boolean(jevAfter?.on && jevAfter.needsClarify);
  const jevBlocksReady = Boolean(jevAfter?.on && (jevAfter.needsClarify || jevAfter.ready === false));

  if (jevWantsClarify) {
    const stay = jevAfter.focus || nextRequiredSlot(sheet, { askedAccessorials }) || extractAwaiting;
    const reply = jevClarifyScript(jevAfter, stay);
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, lastBareZip, zipClarify, jevAfter, accessorialClarify);
  }

  if (isReadyForQuote(sheet) && askedAccessorials && !jevBlocksReady) {
    sheet = { ...sheet, status: "ready_for_quote", error_reason: null, out_of_scope_reason: null };
    const reply = "Sheet’s complete. Handing this to Freight Ops’ Exfresso runner for a live rate — no booking from here.";
    return {
      session: {
        ...session,
        sheet,
        askedAccessorials,
        awaiting: null,
        lastBareZip,
        zipClarify: null,
        accessorialClarify: null,
        jevLog: appendJevLog(session, jevAfter),
      },
      reply,
      extracted,
      ready: true,
      outOfScope: false,
      jev: jevAfter,
    };
  }

  let awaiting = nextRequiredSlot(sheet, { askedAccessorials });
  if (
    pendingClarifyRole &&
    (zipClarifyDecided === "keep" || zipClarifyDecided === "keep_city" || zipClarifyDecided === "same_no")
  ) {
    const slot = pendingClarifyRole === "dest" ? "dest_zip" : "origin_zip";
    if (!awaitingSlotIsFilled(sheet, slot)) awaiting = slot;
  }
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
  return finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify, jevAfter, accessorialClarify);
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

function applyZipRoleMove(extracted, zip, role) {
  if (!extracted || !zip || !role) return extracted;
  if (role === "dest") {
    extracted.destination = { ...(extracted.destination || {}), postal_code: zip };
    if (extracted.origin?.postal_code === zip) delete extracted.origin.postal_code;
  } else if (role === "origin") {
    extracted.origin = { ...(extracted.origin || {}), postal_code: zip };
    if (extracted.destination?.postal_code === zip) delete extracted.destination.postal_code;
  }
  return extracted;
}

/**
 * Never overwrite a filled ZIP unless the user explicitly corrects it.
 * A new ZIP while origin is already parked goes to dest when dest is empty.
 */
function rehomeZipOffFilledSide(sheet, extracted, utterance) {
  if (!extracted) return extracted;
  const corrects = utteranceCorrectsSlot(utterance);
  const originFilled = isValidZip(sheet?.lanes?.origin?.postal_code);
  const destFilled = isValidZip(sheet?.lanes?.destination?.postal_code);
  const parkedOrigin = zip5(sheet?.lanes?.origin?.postal_code);
  const parkedDest = zip5(sheet?.lanes?.destination?.postal_code);
  const newOrigin = extracted.origin?.postal_code;
  const newDest = extracted.destination?.postal_code;

  if (!corrects && originFilled && newOrigin && zip5(newOrigin) !== parkedOrigin) {
    if (!destFilled && !newDest) {
      extracted.destination = { ...(extracted.destination || {}), postal_code: newOrigin };
    }
    delete extracted.origin.postal_code;
  }
  if (!corrects && destFilled && newDest && zip5(newDest) !== parkedDest) {
    if (!originFilled && !extracted.origin?.postal_code) {
      extracted.origin = { ...(extracted.origin || {}), postal_code: newDest };
    }
    delete extracted.destination.postal_code;
  }
  return extracted;
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

function finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify, jevDecision, accessorialClarify) {
  const nextAwait = awaiting ?? nextRequiredSlot(sheet, { askedAccessorials });
  const jevBlocksReady = Boolean(jevDecision?.on && (jevDecision.needsClarify || jevDecision.ready === false));
  const nextSheet =
    isReadyForQuote(sheet) && askedAccessorials && !jevBlocksReady
      ? { ...sheet, status: "ready_for_quote" }
      : { ...sheet, status: sheet.status === "out_of_scope" ? "out_of_scope" : "collecting" };
  const stillSame = zip5(nextSheet.lanes?.origin?.postal_code) && zip5(nextSheet.lanes?.origin?.postal_code) === zip5(nextSheet.lanes?.destination?.postal_code);
  const nextAccessorialClarify =
    nextSheet.status === "ready_for_quote"
      ? null
      : accessorialClarify === undefined
        ? session.accessorialClarify ?? null
        : accessorialClarify;
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
      accessorialClarify: nextAccessorialClarify,
      sameZipConfirmed: stillSame ? Boolean(session.sameZipConfirmed) : false,
      jevLog: appendJevLog(session, jevDecision),
    },
    reply,
    extracted,
    ready: nextSheet.status === "ready_for_quote",
    outOfScope: false,
    jev: jevDecision,
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
