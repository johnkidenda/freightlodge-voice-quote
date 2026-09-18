import { isValidZip } from "./completeness.js";
import { isGarbagePlace } from "./extract.js";

export const CONVERSATIONAL_GREETING =
  "Hi — I can take a US domestic LTL quote. Where are we picking up? I’ll need the origin ZIP; I won’t guess it.";

export const CONVERSATIONAL_STORAGE_KEY = "freightlodge.conversational";

export function loadConversationalMode(storage) {
  try {
    return storage?.getItem?.(CONVERSATIONAL_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveConversationalMode(on, storage) {
  const next = Boolean(on);
  try {
    storage?.setItem?.(CONVERSATIONAL_STORAGE_KEY, next ? "on" : "off");
  } catch {
    /* quota / private mode */
  }
  return next;
}

function cityOf(place) {
  if (!place || isGarbagePlace(place)) return null;
  const city = String(place.city || "").trim();
  return city || null;
}

function conversationalHave(sheet, extracted) {
  const originCity = cityOf(sheet?.lanes?.origin);
  const destCity = cityOf(sheet?.lanes?.destination);
  const weight = sheet?.freight?.total_weight_lbs;
  const commodity = typeof sheet?.freight?.commodity === "string" ? sheet.freight.commodity.trim() : "";
  const dumped =
    extracted?.freight?.total_weight_lbs ||
    extracted?.freight?.commodity ||
    extracted?.origin?.city ||
    extracted?.destination?.city;

  if (dumped && originCity && destCity && weight && commodity) {
    return `I have ${originCity} and ${destCity} and ${weight} lb of ${commodity}.`;
  }

  const bits = [];
  if (extracted?.origin?.postal_code) bits.push(`origin ${extracted.origin.postal_code}`);
  else if (extracted?.origin?.city) bits.push(extracted.origin.city);
  if (extracted?.destination?.postal_code) bits.push(`dest ${extracted.destination.postal_code}`);
  else if (extracted?.destination?.city && !isGarbagePlace(extracted.destination)) {
    bits.push(extracted.destination.city);
  }
  if (extracted?.freight?.pieces) bits.push(`${extracted.freight.pieces} pcs`);
  if (extracted?.freight?.total_weight_lbs) bits.push(`${extracted.freight.total_weight_lbs} lb`);
  if (extracted?.freight?.commodity) bits.push(extracted.freight.commodity);
  if (extracted?.pickup?.date) bits.push(`pickup ${extracted.pickup.date}`);
  if (extracted?.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  return `Got ${bits.join(", ")}.`;
}

function conversationalAsk(sheet, awaiting) {
  const originZip = isValidZip(sheet?.lanes?.origin?.postal_code);
  const destZip = isValidZip(sheet?.lanes?.destination?.postal_code);
  const originCity = cityOf(sheet?.lanes?.origin);
  const destCity = cityOf(sheet?.lanes?.destination);

  if (!originZip && !destZip && originCity && destCity) {
    return "I still need the origin and destination ZIPs.";
  }
  if (awaiting === "origin_zip") {
    return originCity ? `What’s the origin ZIP for ${originCity}?` : "Got it — what’s the pickup ZIP?";
  }
  if (awaiting === "dest_zip") {
    return destCity
      ? `I have ${destCity}. What’s the destination ZIP?`
      : "Where is this going? I need a city, state, or ZIP.";
  }
  if (awaiting === "pieces") return "How many pieces or pallets?";
  if (awaiting === "measure") {
    return "What’s the total weight in pounds? Or dims or class if you already know them — I won’t guess.";
  }
  if (awaiting === "commodity") return "What’s the commodity?";
  if (awaiting === "pickup_date") return "What pickup date works?";
  if (awaiting === "accessorials") {
    return "Any extras — liftgate, residential, inside — or should I put none?";
  }
  if (awaiting === "email") return "What email should I put on the sheet?";
  return "";
}

/**
 * Warmer, shorter copy of the same facts + next missing ask.
 * Never invents ZIPs, dims, weights, class, or rates.
 */
export function composeConversationalReply({
  formalReply,
  extracted,
  sheet,
  awaiting,
  ready,
  outOfScope,
} = {}) {
  if (outOfScope) return formalReply || "";
  if (ready) {
    return "The sheet is complete. I’ll hand this to Freight Ops for a live rate — no booking from here.";
  }
  if (extracted?.flags?.zipClarify) return formalReply || "";
  if (extracted?.flags?.incompleteZip) {
    return "That ZIP is short — I need a full 5-digit ZIP. I won’t pad or guess the last digits.";
  }
  if (extracted?.flags?.incompleteTo) {
    return "That ended at “to” — I still need the destination city, state, or ZIP. I won’t invent a dest.";
  }
  if (
    extracted?.flags?.vagueMeasure &&
    !extracted.freight?.total_weight_lbs &&
    !extracted.freight?.dims &&
    !extracted.freight?.freight_class
  ) {
    return "I can’t invent a weight, dim, or class from that. If you have pounds, L×W×H, or a known NMFC class, say it.";
  }
  if (extracted?.flags?.vagueDate && !extracted.pickup?.date) {
    return "I need a real pickup date — today, tomorrow, Friday, or YYYY-MM-DD. I won’t treat ASAP as a date.";
  }

  const have = conversationalHave(sheet, extracted);
  const ask = conversationalAsk(sheet, awaiting);
  if (have && ask) return `${have} ${ask}`;
  if (ask) return ask;
  if (have) return have;
  return formalReply || "";
}

export function presentAgentReply(result, conversational) {
  const formal = result?.reply || "";
  if (!conversational) return formal;
  return composeConversationalReply({
    formalReply: formal,
    extracted: result.extracted,
    sheet: result.session?.sheet,
    awaiting: result.session?.awaiting,
    ready: result.ready,
    outOfScope: result.outOfScope,
  });
}
