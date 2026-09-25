import { emptySheet } from "./sheet.js";
import {
  awaitingSlotIsFilled,
  hasMeasure,
  isReadyForQuote,
  isValidZip,
  nextRequiredSlot,
  pieceUnitForAck,
  spokenPieceCount,
  utteranceCorrectsSlot,
} from "./completeness.js";
import {
  applyCityZipChoice,
  applyExtractedSlots,
  applyZipRoleCorrection,
  applyZipToRole,
  detectCityZipMetroClarify,
  detectZipRoleCorrection,
  distinctUtteranceZips,
  extractSlots,
  firstBareZip,
  isGarbagePlace,
  resolveZipAttachment,
} from "./extract.js";
import { detectOutOfScope } from "./scope.js";
import { stateDisplayName } from "./zip-state.js";

export const GREETING =
  "Freight Lodge. I’ll take a US domestic LTL quote. What’s the origin zip code?";

const PROMPTS = {
  origin_zip: "What’s the origin zip code? City is helpful, but I need the 5-digit zip code.",
  dest_zip: "Where is this going? I need a destination city, state, or zip code.",
  dest_incomplete: "That ended at “to”. I still need the destination city, state, or zip code.",
  incomplete_zip: "That zip code is short. I need a full 5-digit zip code.",
  incomplete_dest_zip: "That destination zip code is short. I need a full 5-digit zip code.",
  incomplete_origin_zip: "That origin zip code is short. I need a full 5-digit zip code.",
  piece_unit: "Are you shipping pallets or pieces?",
  pieces: "How many pieces or pallets?",
  measure:
    "I need a real measure: total weight in pounds, or L×W×H in inches, or the NMFC class if you already know it.",
  commodity: "What’s the commodity?",
  pickup_date: "What pickup date works?",
  accessorials:
    "Any accessorials? Liftgate, residential, inside, limited access, appointment, freeze protect, or say none.",
  liftgate_side: "Liftgate at pickup, delivery, or both?",
  inside_side: "Inside pickup, inside delivery, or both?",
  email:
    "What email should I put on the sheet so we can send the quote? Please type it in.",
};

export const SHEET_READY_REPLY = "Sheet’s complete. Working out your estimate…";

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
    dateClarify: null,
    sameZipConfirmed: false,
    palletSanity: null,
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
    return `${clarify.zip} looks like ${zipName}, but ${side} is ${placeName}. Which is right?`;
  }
  if (clarify?.kind === "same" && clarify.zip) {
    return `Origin and destination would both be ${clarify.zip}. Same zip code both ends. Is that right?`;
  }
  if (!clarify?.zip || !clarify?.metro?.city) return PROMPTS.origin_zip;
  if (clarify.kind === "metro") {
    const stated = [clarify.statedCity, clarify.statedState].filter(Boolean).join(", ") || "that city";
    const cityName = clarify.statedCity || stated;
    return `You said ${stated} but ${clarify.zip} looks like ${clarify.metro.city}. Which is right, ${cityName} or ${clarify.zip}?`;
  }
  const place = clarify.metro.city;
  const destCity = sheet?.lanes?.destination?.city;
  const destConflicts =
    destCity && clarify.metro && destCity.toLowerCase() !== place.toLowerCase();
  if (destConflicts && clarify.altZip) {
    return `${clarify.zip} looks like ${place}. Did you mean ${destCity} ${clarify.altZip}?`;
  }
  if (destConflicts && destCity) {
    return `${clarify.zip} looks like ${place}. Dest is ${destCity}. Is ${clarify.zip} the origin zip code?`;
  }
  if (clarify.suggestedRole === "dest") {
    return `${clarify.zip} looks like ${place}. Is that the destination zip code?`;
  }
  if (clarify.suggestedRole === "origin") {
    return `${clarify.zip} looks like ${place}. Is that the origin zip code?`;
  }
  return `${clarify.zip} looks like ${place}. Origin zip code or destination zip code?`;
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
  const deliv = /\b(deliver\w*|destination|dest)\b/.test(t);
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

function decideInsideSide(raw) {
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (/\b(both\s+ends|both|each|either|pickup and delivery|delivery and pickup|origin and destination|destination and origin)\b/.test(t)) {
    return "both";
  }
  const pick = /\b(pick\s*-?\s*up|pickup|origin)\b/.test(t);
  const deliv = /\b(deliver(?:y|ed)?|destination|dest)\b/.test(t);
  if (pick && deliv) return "both";
  if (pick) return "pickup";
  if (deliv) return "delivery";
  return null;
}

function insideIdsForSide(side) {
  if (side === "pickup") return ["inside_pickup"];
  if (side === "delivery") return ["inside_delivery"];
  if (side === "both") return ["inside_pickup", "inside_delivery"];
  return [];
}

const DIGIT_WORDS = ["", "one", "two", "three", "four", "five", "six"];

function incompleteZipPhrase(flag) {
  const digits = String(flag?.digits || "");
  const role = flag?.role;
  if (!flag?.labeled || !digits || (role !== "dest" && role !== "origin")) return "";
  const side = role === "dest" ? "destination" : "origin";
  const n = digits.length;
  const word = DIGIT_WORDS[n] || String(n);
  const unit = n === 1 ? "digit" : "digits";
  return `${digits} for the ${side}, which is only ${word} ${unit}`;
}

function incompleteZipReply(flag) {
  const phrase = incompleteZipPhrase(flag);
  if (phrase) return `I heard ${phrase}. What’s the full zip code?`;
  const role = flag?.role;
  if (role === "dest") return PROMPTS.incomplete_dest_zip;
  if (role === "origin") return PROMPTS.incomplete_origin_zip;
  return PROMPTS.incomplete_zip;
}

function incompleteZipsReply(flags) {
  const phrases = (flags || []).map(incompleteZipPhrase).filter(Boolean);
  if (phrases.length < 2) return incompleteZipReply(flags?.[0]);
  return `I heard ${phrases[0]} and ${phrases[1]}. What are the full 5-digit zip codes?`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Spoken calendar date. Sheet and payload keep the ISO value. */
export function formatSpokenDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return String(iso || "");
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return String(iso || "");
  return `${WEEKDAY_NAMES[dt.getDay()]}, ${MONTH_NAMES[m - 1]} ${d}`;
}

/** More than this many pallets is outside a normal LTL handling-unit count. */
export const LTL_MAX_PALLETS = 12;

/** Under this many pounds per pallet, confirm before quoting. */
export const MIN_LB_PER_PALLET = 50;

export const PALLET_FIX_LABEL = "No, fix it";

export function palletYesLabel(pieces) {
  return `Yes, ${pieces}`;
}

/**
 * Pallets only. Null until a real measure is on the sheet, so a high count
 * and a light weight confirm once.
 */
export function palletSanityIssue(sheet) {
  const freight = sheet?.freight;
  if (freight?.piece_unit !== "pallets") return null;
  const pieces = freight.pieces;
  if (!Number.isInteger(pieces) || pieces < 1) return null;
  if (!hasMeasure(freight)) return null;
  const weight =
    typeof freight.total_weight_lbs === "number" && freight.total_weight_lbs > 0
      ? freight.total_weight_lbs
      : null;
  const tooMany = pieces > LTL_MAX_PALLETS;
  const per = weight != null ? weight / pieces : null;
  const light = per != null && per < MIN_LB_PER_PALLET;
  if (!tooMany && !light) return null;
  return { pieces, weight, tooMany, light, per };
}

export function palletSanityCovers(session, issue) {
  const ok = session?.palletSanity;
  if (!ok || ok.pieces !== issue?.pieces) return false;
  if (issue.weight == null) return ok.weight == null;
  return ok.weight === issue.weight;
}

export function palletSanityQuestion(issue) {
  const n = issue.pieces;
  const reasons = [];
  if (issue.tooMany) reasons.push(`${n} pallets is above the LTL range of ${LTL_MAX_PALLETS}`);
  if (issue.light) {
    const each = Math.round(issue.per);
    reasons.push(
      `${n} pallets at ${issue.weight} lb is about ${each} lb each, under ${MIN_LB_PER_PALLET} lb a pallet`,
    );
  }
  return `${reasons.join(", and ")}. Quote ${n} pallets anyway?`;
}

export function palletFixPrompt() {
  return "What’s the pallet count? You can correct the weight too.";
}

function isPalletSanityYes(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "");
  return /^(yes|yep|yeah|yup|correct|ok|okay|sure)\b/.test(t);
}

function isPalletSanityNo(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "");
  if (/\bfix it\b/.test(t)) return true;
  return /^(no|nope|nah)\b/.test(t);
}

function takePalletSanityAnswer(session, raw) {
  if (session?.awaiting !== "pallet_sanity") return null;
  const sheet0 = session.sheet;
  if (isPalletSanityNo(raw)) {
    const sheet = structuredClone(sheet0);
    sheet.freight = { ...sheet.freight, pieces: null };
    return {
      handled: true,
      result: finish(
        { ...session, palletSanity: null },
        sheet,
        session.askedAccessorials,
        palletFixPrompt(),
        null,
        "pieces",
      ),
    };
  }
  if (isPalletSanityYes(raw)) {
    const weight = sheet0.freight?.total_weight_lbs;
    const nextSession = {
      ...session,
      palletSanity: {
        pieces: sheet0.freight?.pieces,
        weight: typeof weight === "number" ? weight : null,
      },
    };
    if (isReadyForQuote(sheet0) && session.askedAccessorials) {
      return {
        handled: true,
        result: finish(
          nextSession,
          sheet0,
          true,
          SHEET_READY_REPLY,
          null,
          null,
        ),
      };
    }
    const awaiting = nextRequiredSlot(sheet0, { askedAccessorials: session.askedAccessorials });
    return {
      handled: true,
      result: finish(
        nextSession,
        sheet0,
        session.askedAccessorials,
        promptFor(awaiting, sheet0),
        null,
        awaiting,
      ),
    };
  }
  return { handled: false };
}

/** Readback when "next <weekday>" is only a day or two away. */
export function ambiguousDateQuestion(flag) {
  return `${formatSpokenDate(flag?.soon)}, or ${formatSpokenDate(flag?.later)}?`;
}

function isoDay(iso) {
  const n = Number(String(iso || "").slice(8, 10));
  return Number.isInteger(n) ? n : null;
}

export function resolveAmbiguousDateChoice(raw, flag) {
  if (!flag?.soon || !flag?.later) return null;
  const t = String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (t.includes(flag.soon)) return flag.soon;
  if (t.includes(flag.later)) return flag.later;
  if (/\b(later|second|other one|week after|next week|the following)\b/.test(t)) return flag.later;
  if (/\b(sooner|earlier|first one|this week|tomorrow)\b/.test(t)) return flag.soon;
  const soonLabel = formatSpokenDate(flag.soon).toLowerCase();
  const laterLabel = formatSpokenDate(flag.later).toLowerCase();
  if (t.includes(soonLabel)) return flag.soon;
  if (t.includes(laterLabel)) return flag.later;
  const soonDay = isoDay(flag.soon);
  const laterDay = isoDay(flag.later);
  const days = [...t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\b/g)].map((m) => Number(m[1]));
  const soonHit = days.includes(soonDay);
  const laterHit = days.includes(laterDay);
  if (soonHit && !laterHit) return flag.soon;
  if (laterHit && !soonHit) return flag.later;
  return null;
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

  const sanityAnswer = takePalletSanityAnswer(session, raw);
  if (sanityAnswer?.handled) return sanityAnswer.result;
  if (sanityAnswer && !sanityAnswer.handled) {
    session = { ...session, palletSanity: null, awaiting: "pieces" };
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

  const pendingDateChoice = session.dateClarify
    ? resolveAmbiguousDateChoice(raw, session.dateClarify)
    : null;
  session = { ...session, dateClarify: null };

  const extracted = extractSlots(raw, {
    now,
    awaiting: extractAwaiting,
    originCity: sheetFromClarify.lanes?.origin?.city,
    destCity: sheetFromClarify.lanes?.destination?.city,
  });
  if (pendingDateChoice && !extracted.pickup?.date) extracted.pickup.date = pendingDateChoice;
  if (extracted.flags?.ambiguousDate && extracted.pickup?.date) {
    extracted.flags.ambiguousDate = null;
  }
  if (
    zipClarifyDecided &&
    !firstBareZip(raw) &&
    ["keep_city", "keep_zip", "same_yes", "same_no", "keep", "origin", "dest"].includes(zipClarifyDecided)
  ) {
    extracted.origin = {};
    extracted.destination = {};
  }
  let accessorialClarify = session.accessorialClarify || null;
  let queuedLiftgateThisTurn = false;
  if (accessorialClarify?.kind === "inside") {
    const already = extracted.pickup.accessorials || [];
    const hasInside = already.includes("inside_pickup") || already.includes("inside_delivery");
    const side = decideInsideSide(raw);
    const pendingLiftgate = Boolean(accessorialClarify.pendingLiftgate);
    if (hasInside || side) {
      if (!hasInside && side) addAccessorials(extracted, insideIdsForSide(side));
      extracted.flags.ambiguousInside = false;
      if (pendingLiftgate) {
        accessorialClarify = { kind: "liftgate" };
        extracted.flags.ambiguousLiftgate = true;
        queuedLiftgateThisTurn = true;
      } else {
        accessorialClarify = null;
      }
    }
  }
  if (!queuedLiftgateThisTurn && accessorialClarify?.kind === "liftgate") {
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
    const verdict = resolveZipAttachment(sheetFromClarify, zipForIntent, zipIntent, extracted, {
      explicit: roleWasLabeled(raw, zipIntent),
    });
    if (verdict.clarify) {
      const uttered = [...String(raw).matchAll(/\b(\d{5})(?:-\d{4})?\b/g)].map((m) => m[1]);
      const altZip = uttered.find((z) => z !== zipForIntent) || null;
      if (zipIntent === "origin") delete extracted.origin.postal_code;
      if (zipIntent === "dest") delete extracted.destination.postal_code;
      if (altZip) {
        const otherRole = zipIntent === "origin" ? "dest" : "origin";
        const altVerdict = resolveZipAttachment(sheetFromClarify, altZip, otherRole, extracted, {
          explicit: roleWasLabeled(raw, otherRole),
        });
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
      const verdict = resolveZipAttachment(sheetFromClarify, zip, role, extracted, {
        explicit: roleWasLabeled(raw, role),
      });
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

  const spokenZips = distinctUtteranceZips(raw);
  const extractedOriginZip = zip5(extracted.origin?.postal_code);
  const extractedDestZip = zip5(extracted.destination?.postal_code);
  const extractedDistinctPair = Boolean(
    extractedOriginZip && extractedDestZip && extractedOriginZip !== extractedDestZip,
  );
  // Two ZIPs in one turn are an assignment. Never move the first (often origin) onto dest.
  const roleFix =
    extractedDistinctPair || spokenZips.length >= 2 ? null : detectZipRoleCorrection(raw);
  const zipForFix = firstBareZip(raw) || extracted.flags.bareZip || session.lastBareZip;
  const wouldCopyOriginOntoDest =
    roleFix === "dest" &&
    extractedOriginZip &&
    extractedOriginZip === zip5(zipForFix) &&
    extractedDestZip &&
    extractedDestZip !== extractedOriginZip;
  const pureMove = Boolean(roleFix && !firstBareZip(raw));
  if (roleFix && zipForFix && !extracted.flags.zipClarify && !wouldCopyOriginOntoDest) {
    sheet = applyZipRoleCorrection(sheet, roleFix, zipForFix, { clearOther: pureMove });
    if (roleFix === "dest") extracted.destination.postal_code = zipForFix;
    if (roleFix === "origin") extracted.origin.postal_code = zipForFix;
    extracted.flags.zipRole = roleFix;
  }
  // A filled ZIP stays put unless this turn moves it ("that's the destination") or corrects it.
  if (!pureMove && !utteranceCorrectsSlot(raw) && !extracted.flags.zipClarify) {
    const originBefore = zip5(sheetFromClarify?.lanes?.origin?.postal_code);
    const destBefore = zip5(sheetFromClarify?.lanes?.destination?.postal_code);
    if (originBefore && !zip5(sheet.lanes?.origin?.postal_code)) {
      sheet.lanes.origin.postal_code = sheetFromClarify.lanes.origin.postal_code;
      extracted.origin = { ...(extracted.origin || {}), postal_code: originBefore };
    }
    if (destBefore && !zip5(sheet.lanes?.destination?.postal_code)) {
      sheet.lanes.destination.postal_code = sheetFromClarify.lanes.destination.postal_code;
      extracted.destination = { ...(extracted.destination || {}), postal_code: destBefore };
    }
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
    const clarified =
      extracted.flags.zipClarify.attemptedRole === "dest" ? "dest_zip" : "origin_zip";
    const stay = awaitingSlotIsFilled(sheet, clarified)
      ? nextRequiredSlot(sheet, { askedAccessorials }) || clarified
      : clarified;
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  if (extracted.flags.ambiguousInside || accessorialClarify?.kind === "inside") {
    const pendingLiftgate = Boolean(extracted.flags.ambiguousLiftgate || accessorialClarify?.pendingLiftgate);
    accessorialClarify = { kind: "inside", pendingLiftgate };
    const ack = acknowledge(extracted, sheet);
    const reply = ack ? `${ack} ${PROMPTS.inside_side}` : PROMPTS.inside_side;
    return finish(session, sheet, askedAccessorials, reply, extracted, "inside_side", undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  if (extracted.flags.ambiguousLiftgate || accessorialClarify?.kind === "liftgate") {
    accessorialClarify = { kind: "liftgate" };
    const ack = acknowledge(extracted, sheet);
    const reply = ack ? `${ack} ${PROMPTS.liftgate_side}` : PROMPTS.liftgate_side;
    return finish(session, sheet, askedAccessorials, reply, extracted, "liftgate_side", undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  if (
    isAlreadyMentioned(raw) &&
    (awaitingNow === "pieces" || awaitingNow === "piece_unit") &&
    typeof sheet.freight?.total_weight_lbs === "number" &&
    sheet.freight.total_weight_lbs > 0 &&
    !extracted.freight?.pieces &&
    !extracted.freight?.piece_unit
  ) {
    const reply =
      awaitingNow === "piece_unit"
        ? "Got the weight; are you shipping pallets or pieces?"
        : "Got the weight; I still need piece/pallet count.";
    return finish(session, sheet, askedAccessorials, reply, extracted, awaitingNow, undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  if (extracted.flags.incompleteZips?.length > 1) {
    const reply = incompleteZipsReply(extracted.flags.incompleteZips);
    const hasOrigin = extracted.flags.incompleteZips.some((flag) => flag.role === "origin");
    const stay = hasOrigin ? "origin_zip" : "dest_zip";
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, undefined, zipClarify, accessorialClarify);
  }

  if (extracted.flags.incompleteZip) {
    const role = extracted.flags.incompleteZip.role;
    const reply = incompleteZipReply(extracted.flags.incompleteZip);
    const stay =
      role === "dest" ? "dest_zip" : role === "origin" ? "origin_zip" : session.awaiting;
    return finish(session, sheet, askedAccessorials, reply, extracted, stay, undefined, undefined, zipClarify, accessorialClarify);
  }

  if (extracted.flags.ambiguousDate && !extracted.pickup?.date) {
    const dateClarify = extracted.flags.ambiguousDate;
    const reply = ambiguousDateQuestion(dateClarify);
    return finish(
      { ...session, dateClarify },
      sheet,
      askedAccessorials,
      reply,
      extracted,
      "pickup_date",
      undefined,
      lastBareZip,
      zipClarify,
      accessorialClarify,
    );
  }

  if (extracted.flags.vagueMeasure && !extracted.freight.total_weight_lbs && !extracted.freight.dims && !extracted.freight.freight_class) {
    const reply =
      "If you have pounds, L×W×H, or a known NMFC class, say it. Otherwise I’ll keep asking.";
    return finish(session, sheet, askedAccessorials, reply, extracted, undefined, undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  if (extracted.flags.vagueDate && !extracted.pickup.date) {
    const reply = "I need a pickup date (today, tomorrow, or Friday).";
    return finish(session, sheet, askedAccessorials, reply, extracted, undefined, undefined, lastBareZip, zipClarify, accessorialClarify);
  }

  const sanityIssue = palletSanityIssue(sheet);
  if (sanityIssue && !palletSanityCovers(session, sanityIssue)) {
    return finish(
      session,
      sheet,
      askedAccessorials,
      palletSanityQuestion(sanityIssue),
      extracted,
      "pallet_sanity",
      undefined,
      lastBareZip,
      zipClarify,
      accessorialClarify,
    );
  }

  if (isReadyForQuote(sheet) && askedAccessorials) {
    sheet = { ...sheet, status: "ready_for_quote", error_reason: null, out_of_scope_reason: null };
    const reply = SHEET_READY_REPLY;
    return {
      session: {
        ...session,
        sheet,
        askedAccessorials,
        awaiting: null,
        lastBareZip,
        zipClarify: null,
        accessorialClarify: null,
      },
      reply,
      extracted,
      ready: true,
      outOfScope: false,
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
      ? "Still no destination after “to”. Say the city, state, or zip code you’re going to."
      : PROMPTS.dest_incomplete;
  } else {
    const ack = acknowledge(extracted, sheet);
    const ask = promptFor(awaiting, sheet);
    reply = ack ? `${ack} ${ask}` : ask;
    if (addedNothing && reply === session.lastReply) {
      reply =
        awaiting === "dest_zip"
          ? "Still need the destination city, state, or zip code. That last message didn’t add one."
          : `I didn’t catch a new ${spokenSlot(awaiting)} in that. ${ask}`;
    }
  }
  return finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify, accessorialClarify);
}

function placeLabel(place) {
  if (!place || isGarbagePlace(place)) return null;
  const bits = [place.city, place.state].filter(Boolean);
  return bits.length ? bits.join(", ") : null;
}

function promptFor(slot, sheet) {
  if (slot === "dest_zip") {
    const label = placeLabel(sheet.lanes?.destination);
    if (label) return `To ${label}. What’s the destination zip code?`;
  }
  if (slot === "origin_zip") {
    const label = placeLabel(sheet.lanes?.origin);
    if (label) return `From ${label}. What’s the origin zip code?`;
  }
  if (slot === "pieces") return piecesCountPrompt(sheet);
  return slot ? PROMPTS[slot] : PROMPTS.email;
}

export function piecesCountPrompt(sheet) {
  if (sheet?.freight?.piece_unit === "pallets") return "How many pallets?";
  if (sheet?.freight?.piece_unit === "pieces") return "How many pieces?";
  return PROMPTS.pieces;
}

function spokenSlot(slot) {
  if (slot === "origin_zip") return "origin zip code";
  if (slot === "dest_zip") return "destination zip code";
  return slot?.replaceAll("_", " ") || "detail";
}

function roleWasLabeled(raw, role) {
  const t = String(raw || "");
  if (role === "dest") return /\b(?:destination|dest|delivery|deliver(?:y|ed)?\s+to|ship\s+to)\b/i.test(t);
  if (role === "origin") return /\b(?:origins?|pickup|pick\s*up|ship\s+from)\b/i.test(t);
  return false;
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

function finish(session, sheet, askedAccessorials, reply, extracted, awaiting, extractKey, lastBareZip, zipClarify, accessorialClarify) {
  const nextAwait = awaiting ?? nextRequiredSlot(sheet, { askedAccessorials });
  const holdingSanity = nextAwait === "pallet_sanity";
  const nextSheet =
    !holdingSanity && isReadyForQuote(sheet) && askedAccessorials
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
  const originCity = extracted.origin?.city || null;
  const destCity = !isGarbagePlace(extracted.destination) ? extracted.destination?.city || null : null;
  if (originCity && destCity) bits.push(`${originCity} to ${destCity}`);
  else if (originCity) bits.push(`from ${originCity}`);
  else if (destCity) bits.push(`to ${destCity}`);
  if (extracted.origin?.postal_code) bits.push(`origin ${extracted.origin.postal_code}`);
  else if (!originCity && extracted.origin?.state) bits.push(`from ${extracted.origin.state} (still need zip code)`);
  if (!isGarbagePlace(extracted.destination)) {
    if (extracted.destination?.postal_code) bits.push(`dest ${extracted.destination.postal_code}`);
    else if (!destCity && extracted.destination?.state) bits.push(`to ${extracted.destination.state} (still need zip code)`);
  }
  if (extracted.freight?.pieces) {
    const unit = pieceUnitForAck(extracted.freight, sheet?.freight);
    bits.push(spokenPieceCount(extracted.freight.pieces, unit, { unknown: "pcs" }));
  } else if (extracted.freight?.piece_unit === "pallets" || extracted.freight?.piece_unit === "pieces") {
    bits.push(extracted.freight.piece_unit);
  }
  const weightText = extracted.flags?.weightFromKg && extracted.freight?.total_weight_lbs
    ? `${extracted.flags.weightKg} kg (~${extracted.freight.total_weight_lbs} lb)`
    : extracted.freight?.total_weight_lbs
      ? `${extracted.freight.total_weight_lbs} lb`
      : "";
  const commodity = extracted.freight?.commodity || "";
  if (weightText && commodity) bits.push(`${weightText} of ${commodity}`);
  else if (weightText) bits.push(weightText);
  else if (commodity) bits.push(commodity);
  if (extracted.freight?.dims) {
    const d = extracted.freight.dims;
    bits.push(`${d.length_in}×${d.width_in}×${d.height_in}`);
  }
  if (extracted.freight?.freight_class) bits.push(`class ${extracted.freight.freight_class}`);
  if (extracted.pickup?.date) bits.push(`pickup ${formatSpokenDate(extracted.pickup.date)}`);
  if (extracted.pickup?.accessorials?.length) {
    bits.push(extracted.pickup.accessorials.join(", ").replaceAll("_", " "));
  }
  if (extracted.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  return `Got it: ${bits.join(", ")}.`;
}

export { PROMPTS };
