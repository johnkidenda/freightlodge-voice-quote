import { SCHEMA_VERSION } from "./sheet.js";
import { hasPlaceHint, isGarbagePlace } from "./extract.js";

const ZIP_RE = /^[0-9]{5}(-[0-9]{4})?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidZip(value) {
  return typeof value === "string" && ZIP_RE.test(value.trim());
}

export function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

export function hasCompleteDims(dims) {
  if (!dims || typeof dims !== "object") return false;
  const keys = ["length_in", "width_in", "height_in"];
  return keys.every((k) => typeof dims[k] === "number" && Number.isFinite(dims[k]) && dims[k] > 0);
}

export function hasMeasure(freight) {
  if (!freight) return false;
  const weight =
    typeof freight.total_weight_lbs === "number" &&
    Number.isFinite(freight.total_weight_lbs) &&
    freight.total_weight_lbs > 0;
  const klass =
    typeof freight.freight_class === "string" && freight.freight_class.trim().length > 0;
  return Boolean(weight || hasCompleteDims(freight.dims) || klass);
}

export function missingReadyFields(sheet) {
  const missing = [];
  if (!sheet || sheet.schema_version !== SCHEMA_VERSION) {
    return ["schema_version", ...readyFieldKeys()];
  }
  if (!isValidZip(sheet.lanes?.origin?.postal_code)) missing.push("lanes.origin.postal_code");
  if (!isValidZip(sheet.lanes?.destination?.postal_code)) {
    missing.push("lanes.destination.postal_code");
  }
  if (!Number.isInteger(sheet.freight?.pieces) || sheet.freight.pieces < 1) {
    missing.push("freight.pieces");
  }
  if (!hasMeasure(sheet.freight)) {
    missing.push("freight.total_weight_lbs|freight.dims|freight.freight_class");
  }
  if (typeof sheet.freight?.commodity !== "string" || !sheet.freight.commodity.trim()) {
    missing.push("freight.commodity");
  }
  if (typeof sheet.pickup?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.pickup.date)) {
    missing.push("pickup.date");
  }
  if (!isValidEmail(sheet.contact?.email)) missing.push("contact.email");
  return missing;
}

export function readyFieldKeys() {
  return [
    "lanes.origin.postal_code",
    "lanes.destination.postal_code",
    "freight.pieces",
    "freight.total_weight_lbs|freight.dims|freight.freight_class",
    "freight.commodity",
    "pickup.date",
    "contact.email",
  ];
}

export function isReadyForQuote(sheet) {
  if (!sheet) return false;
  if (sheet.status === "out_of_scope") return false;
  return missingReadyFields(sheet).length === 0;
}

/**
 * Lane minimum used to ignore a Jev clarify/ready-low gate:
 * origin ZIP + dest ZIP + a real measure (weight, dims, or class).
 * Pieces / accessorials / email stay askable after this.
 */
export function hasMinimumLane(sheet) {
  return (
    isValidZip(sheet?.lanes?.origin?.postal_code) &&
    isValidZip(sheet?.lanes?.destination?.postal_code) &&
    hasMeasure(sheet?.freight)
  );
}

export const SLOT_ORDER = [
  "origin_zip",
  "dest_zip",
  "pieces",
  "measure",
  "commodity",
  "pickup_date",
  "accessorials",
  "email",
];

export function nextRequiredSlot(sheet, { askedAccessorials = false } = {}) {
  const origin = sheet?.lanes?.origin;
  const dest = sheet?.lanes?.destination;
  const destMissingOrGarbage =
    isGarbagePlace(dest) || (!isValidZip(dest?.postal_code) && !hasPlaceHint(dest) && hasPlaceHint(origin));
  if (destMissingOrGarbage && !isValidZip(dest?.postal_code)) return "dest_zip";
  if (!isValidZip(origin?.postal_code)) return "origin_zip";
  if (!isValidZip(dest?.postal_code)) return "dest_zip";
  if (!Number.isInteger(sheet?.freight?.pieces) || sheet.freight.pieces < 1) return "pieces";
  if (!hasMeasure(sheet?.freight)) return "measure";
  if (typeof sheet?.freight?.commodity !== "string" || !sheet.freight.commodity.trim()) {
    return "commodity";
  }
  if (typeof sheet?.pickup?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(sheet.pickup.date)) {
    return "pickup_date";
  }
  if (!askedAccessorials && !(sheet?.pickup?.accessorials?.length > 0)) return "accessorials";
  if (!isValidEmail(sheet?.contact?.email)) return "email";
  return null;
}

export function formatPlace(place) {
  if (!place) return null;
  const parts = [place.city, place.state, place.postal_code].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}
