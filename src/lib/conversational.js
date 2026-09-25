import { isValidZip, pieceUnitForAck, spokenPieceCount } from "./completeness.js";
import { formatSpokenDate, piecesCountPrompt } from "./dialog.js";
import { isGarbagePlace } from "./extract.js";

export const CONVERSATIONAL_GREETING =
  "Hi. I can take a US domestic LTL quote. What’s the origin zip code?";

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

  const spokenPickup = extracted?.pickup?.date ? `, pickup ${formatSpokenDate(extracted.pickup.date)}` : "";
  if (dumped && originCity && destCity && weight && commodity) {
    return `I have ${weight} pounds of ${commodity} from ${originCity} to ${destCity}${spokenPickup}.`;
  }
  if (dumped && originCity && destCity && commodity && !weight) {
    return `I have ${commodity} from ${originCity} to ${destCity}${spokenPickup}.`;
  }

  const bits = [];
  const originCityNow = extracted?.origin?.city && !extracted?.origin?.postal_code ? extracted.origin.city : null;
  const destCityNow =
    extracted?.destination?.city && !extracted?.destination?.postal_code && !isGarbagePlace(extracted.destination)
      ? extracted.destination.city
      : null;
  if (originCityNow && destCityNow) bits.push(`from ${originCityNow} to ${destCityNow}`);
  else if (extracted?.origin?.postal_code) bits.push(`the origin ZIP, ${extracted.origin.postal_code}`);
  else if (originCityNow) bits.push(`from ${originCityNow}`);
  if (!(originCityNow && destCityNow)) {
    if (extracted?.destination?.postal_code) bits.push(`the destination ZIP, ${extracted.destination.postal_code}`);
    else if (destCityNow) bits.push(`to ${destCityNow}`);
  }
  if (extracted?.freight?.pieces) {
    const unit = pieceUnitForAck(extracted.freight, sheet?.freight);
    bits.push(spokenPieceCount(extracted.freight.pieces, unit, { unknown: "pieces" }));
  } else if (extracted?.freight?.piece_unit === "pallets" || extracted?.freight?.piece_unit === "pieces") {
    bits.push(extracted.freight.piece_unit);
  }
  if (extracted?.freight?.total_weight_lbs) bits.push(`${extracted.freight.total_weight_lbs} pounds`);
  if (extracted?.freight?.commodity) bits.push(extracted.freight.commodity);
  if (extracted?.pickup?.date) bits.push(`pickup ${formatSpokenDate(extracted.pickup.date)}`);
  if (extracted?.pickup?.accessorials?.length) {
    bits.push(extracted.pickup.accessorials.join(", ").replaceAll("_", " "));
  }
  if (extracted?.contact?.email) bits.push(extracted.contact.email);
  if (!bits.length) return "";
  if (bits.length === 1 && extracted?.destination?.postal_code && !extracted?.origin?.postal_code) {
    return `Got the destination ZIP, ${extracted.destination.postal_code}.`;
  }
  if (bits.length === 1 && extracted?.origin?.postal_code && !extracted?.destination?.postal_code) {
    return `Got the origin ZIP, ${extracted.origin.postal_code}.`;
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
      return "I still need the origin and destination zip codes, and the total weight in pounds.";
    }
    return "I still need the origin and destination zip codes.";
  }
  if (awaiting === "origin_zip") {
    return originCity ? `From ${originCity}. What’s the origin zip code?` : "Got it. What’s the pickup zip code?";
  }
  if (awaiting === "dest_zip") {
    return destCity
      ? `To ${destCity}. What’s the destination zip code?`
      : "Where is this going? I need a city, state, or zip code.";
  }
  if (awaiting === "piece_unit") return "Are you shipping pallets or pieces?";
  if (awaiting === "pieces") return piecesCountPrompt(sheet);
  if (awaiting === "measure") {
    return "What’s the total weight in pounds? Or dims or class if you already know them.";
  }
  if (awaiting === "commodity") return "What’s the commodity?";
  if (awaiting === "pickup_date") return "What pickup date works?";
  if (awaiting === "accessorials") {
    return "Any extras? Liftgate, residential, inside, protect from freeze, or should I put none?";
  }
  if (awaiting === "liftgate_side") {
    return "Is that liftgate at pickup, delivery, or both?";
  }
  if (awaiting === "inside_side") {
    return "Inside pickup, inside delivery, or both?";
  }
  if (awaiting === "email") {
    return "What email should I put on the sheet? Please type it in.";
  }
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
    return "The sheet is complete. I’ll work out an estimate.";
  }
  if (extracted?.flags?.zipClarify) return formalReply || "";
  if (extracted?.flags?.incompleteZips?.length) return formalReply || "";
  if (extracted?.flags?.incompleteZip?.digits) return formalReply || "";
  if (extracted?.flags?.ambiguousDate) return formalReply || "";
  if (awaiting === "pallet_sanity") return formalReply || "";
  if (extracted?.flags?.incompleteZip) {
    return "That zip code is short. I need a full 5-digit zip code.";
  }
  if (extracted?.flags?.incompleteTo) {
    return "That ended at “to”. I still need the destination city, state, or zip code.";
  }
  if (
    extracted?.flags?.vagueMeasure &&
    !extracted.freight?.total_weight_lbs &&
    !extracted.freight?.dims &&
    !extracted.freight?.freight_class
  ) {
    return "If you have pounds, L×W×H, or a known NMFC class, say it. Otherwise I’ll keep asking.";
  }
  if (extracted?.flags?.vagueDate && !extracted.pickup?.date) {
    return "I need a pickup date. Today, tomorrow, or Friday.";
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
