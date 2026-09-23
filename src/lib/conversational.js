import { isValidZip } from "./completeness.js";
import { isGarbagePlace } from "./extract.js";

export const CONVERSATIONAL_GREETING =
  "Hi — I can take a US domestic LTL quote. Where are we picking up? What’s the origin ZIP?";

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

function joinSpoken(parts) {
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
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
    return `I have ${originCity} and ${destCity} and ${weight} pounds of ${commodity}.`;
  }
  if (dumped && originCity && destCity && commodity && !weight) {
    return `I have ${originCity}, ${destCity}, and ${commodity}.`;
  }

  const bits = [];
  if (extracted?.origin?.postal_code) bits.push(`the origin ZIP — ${extracted.origin.postal_code}`);
  else if (extracted?.origin?.city) bits.push(extracted.origin.city);
  if (extracted?.destination?.postal_code) bits.push(`the destination ZIP — ${extracted.destination.postal_code}`);
  else if (extracted?.destination?.city && !isGarbagePlace(extracted.destination)) {
    bits.push(extracted.destination.city);
  }
  if (extracted?.freight?.pieces) {
    const unit = extracted.freight.piece_unit === "pallets" ? "pallets" : "pieces";
    bits.push(`${extracted.freight.pieces} ${unit}`);
  } else if (extracted?.freight?.piece_unit === "pallets" || extracted?.freight?.piece_unit === "pieces") {
    bits.push(extracted.freight.piece_unit);
  }
  if (extracted?.freight?.total_weight_lbs) bits.push(`${extracted.freight.total_weight_lbs} pounds`);
  if (extracted?.freight?.commodity) bits.push(extracted.freight.commodity);
  if (extracted?.pickup?.date) bits.push(`pickup ${extracted.pickup.date}`);
  if (extracted?.pickup?.accessorials?.length) {
    bits.push(extracted.pickup.accessorials.join(", ").replaceAll("_", " "));
  }
  if (extracted?.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  if (bits.length === 1 && extracted?.destination?.postal_code && !extracted?.origin?.postal_code) {
    return `Got the destination ZIP — ${extracted.destination.postal_code}.`;
  }
  if (bits.length === 1 && extracted?.origin?.postal_code && !extracted?.destination?.postal_code) {
    return `Got the origin ZIP — ${extracted.origin.postal_code}.`;
  }
  return `Got ${joinSpoken(bits)}.`;
}

function conversationalAsk(sheet, awaiting) {
  const originZip = isValidZip(sheet?.lanes?.origin?.postal_code);
  const destZip = isValidZip(sheet?.lanes?.destination?.postal_code);
  const originCity = cityOf(sheet?.lanes?.origin);
  const destCity = cityOf(sheet?.lanes?.destination);
  const hasWeight =
    typeof sheet?.freight?.total_weight_lbs === "number" && sheet.freight.total_weight_lbs > 0;
  const hasMeasure =
    hasWeight ||
    Boolean(sheet?.freight?.dims) ||
    (typeof sheet?.freight?.freight_class === "string" && sheet.freight.freight_class.trim());

  if (!originZip && !destZip && originCity && destCity) {
    if (!hasMeasure) {
      return "I still need the origin and destination ZIPs, and the total weight in pounds.";
    }
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
  if (awaiting === "piece_unit") return "Are you shipping pallets or pieces?";
  if (awaiting === "pieces") {
    if (sheet?.freight?.piece_unit === "pallets") return "How many pallets?";
    if (sheet?.freight?.piece_unit === "pieces") return "How many pieces?";
    return "How many pieces or pallets?";
  }
  if (awaiting === "measure") {
    return "What’s the total weight in pounds? Or dims or class if you already know them.";
  }
  if (awaiting === "commodity") return "What’s the commodity?";
  if (awaiting === "pickup_date") return "What pickup date works?";
  if (awaiting === "accessorials") {
    return "Any extras — liftgate, residential, inside, protect from freeze — or should I put none?";
  }
  if (awaiting === "liftgate_side") {
    return "Is that liftgate at pickup, delivery, or both?";
  }
  if (awaiting === "email") return "What email should I put on the sheet? Typing it is safer than saying it.";
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
    return "The sheet is complete. I’ll hand this to Freight Ops for a live rate.";
  }
  if (extracted?.flags?.zipClarify) return formalReply || "";
  if (extracted?.flags?.incompleteZip) {
    return "That ZIP is short — I need a full 5-digit ZIP.";
  }
  if (extracted?.flags?.incompleteTo) {
    return "That ended at “to” — I still need the destination city, state, or ZIP.";
  }
  if (
    extracted?.flags?.vagueMeasure &&
    !extracted.freight?.total_weight_lbs &&
    !extracted.freight?.dims &&
    !extracted.freight?.freight_class
  ) {
    return "If you have pounds, L×W×H, or a known NMFC class, say it — otherwise I’ll keep asking.";
  }
  if (extracted?.flags?.vagueDate && !extracted.pickup?.date) {
    return "I need a pickup date — today, tomorrow, Friday, or YYYY-MM-DD.";
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
