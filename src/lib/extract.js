import { ACCESSORIALS } from "./sheet.js";
import { fillStateFromZip, placeState, stateForZip, zipDigits, zipStateClarify } from "./zip-state.js";
import {
  STATE_NAME_TO_CODE,
  STATE_CODES,
  NMFC_CLASSES,
  WORD_NUMBERS,
  WEEKDAYS,
  MONTHS,
  ACCESSORIAL_PATTERNS,
  NONE_ACCESSORIALS,
  STT_NONE_ACCESSORIALS,
  VAGUE_MEASURE,
  VAGUE_DATE,
  SPEECH_FILLERS,
  PLACE_NOISE,
  PLACE_STOP,
  ZIP_PREFIX_NOISE,
  LEADING_FILLER,
  US_CITIES,
  ZIP_PREFIX_METRO,
} from "./place-lexicon.js";

/**
 * Extract only values the speaker stated. Never city→ZIP, commodity→class,
 * or vague measures. Callers must leave nulls alone when a field is absent.
 */
export function extractSlots(text, { now, awaiting, originCity, destCity } = {}) {
  const raw = stripSpeechFillers(text || "");
  const extracted = {
    origin: {},
    destination: {},
    freight: {},
    pickup: {},
    contact: {},
    flags: {
      accessorialsNone: false,
      vagueMeasure: VAGUE_MEASURE.test(raw),
      vagueDate: VAGUE_DATE.test(raw) && !hasExplicitDate(raw),
      incompleteTo: isIncompleteTo(raw),
      invented: [],
    },
  };
  if (!raw) return extracted;

  extractLane(raw, extracted, awaiting, { originCity, destCity });
  extractPieces(raw, extracted, awaiting);
  extractWeight(raw, extracted);
  extractDims(raw, extracted);
  extractClass(raw, extracted);
  extractCommodity(raw, extracted, awaiting);
  extractDate(raw, extracted, now);
  extractTime(raw, extracted);
  extractAccessorials(raw, extracted, awaiting);
  extractContact(raw, extracted, awaiting);
  extractHazmat(raw, extracted);
  applyLabeledFieldDump(raw, extracted);

  return extracted;
}

/** Drop STT filler tokens so “Uh Atlanta” is just Atlanta. */
export function stripSpeechFillers(text) {
  return String(text || "")
    .replace(/\b(?:um+|uh+|erm+|uhh+|umm+|hmm+|ahh?|er)\b[,.]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isKnownUsCity(name) {
  if (!name) return false;
  return US_CITIES.has(String(name).trim().toLowerCase());
}

export function metroForZip(zip) {
  const prefix = String(zip || "").replace(/\D/g, "").slice(0, 3);
  if (!prefix) return null;
  return ZIP_PREFIX_METRO[prefix] || null;
}

function cityOf(place) {
  return String(place?.city || "").trim().toLowerCase();
}

export function placeCityMatchesMetro(place, metro) {
  if (!place || !metro) return false;
  const city = cityOf(place);
  return Boolean(city && city === metro.city.toLowerCase());
}

/** Case and light format insensitive: "Atlanta", "ATLANTA", "Atlanta, GA". */
export function cityNameMatchesMetro(place, metro) {
  if (!place || !metro?.city) return false;
  const metroCity = String(metro.city)
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let city = String(place.city || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!city || !metroCity) return false;
  if (city === metroCity) return true;
  if (city.startsWith(`${metroCity} `)) return true;
  return false;
}

export function placeConflictsWithMetro(place, metro) {
  if (!place || !metro) return false;
  const city = cityOf(place);
  if (city && isKnownUsCity(city) && city !== metro.city.toLowerCase()) return true;
  const state = String(place.state || "").toUpperCase();
  if (state && metro.state && state !== metro.state && !placeCityMatchesMetro(place, metro)) {
    return true;
  }
  return false;
}

export function placeMatchesMetro(place, metro) {
  if (!place || !metro) return false;
  if (placeCityMatchesMetro(place, metro)) return true;
  const state = String(place.state || "").toUpperCase();
  if (state && state === metro.state && !cityOf(place)) return true;
  return false;
}

/** Sheet place with this utterance's city, state, and ZIP overlaid. The spoken ZIP wins. */
export function overlayPlace(sheetPlace, extractedPlace) {
  const next = { ...(sheetPlace || {}) };
  if (extractedPlace?.city) next.city = extractedPlace.city;
  if (extractedPlace?.state) next.state = extractedPlace.state;
  if (extractedPlace?.postal_code) next.postal_code = extractedPlace.postal_code;
  return next;
}

/**
 * Decide whether a ZIP can attach to the awaiting side without inverting
 * a known city/state pair (Atlanta + 78721, dest TX/Austin), silently
 * pairing a ZIP whose metro disagrees with the stated city (NYC + 30301),
 * or parking a ZIP that does not belong to the known / city-implied state.
 */
export function resolveZipAttachment(sheet, zip, intendedRole, extracted = null, { explicit = false } = {}) {
  if (!intendedRole || !zip) return { attach: intendedRole || null, clarify: null };
  const origin = overlayPlace(sheet?.lanes?.origin, extracted?.origin);
  const dest = overlayPlace(sheet?.lanes?.destination, extracted?.destination);
  const target = intendedRole === "origin" ? origin : dest;
  const other = intendedRole === "origin" ? dest : origin;
  const otherRole = intendedRole === "origin" ? "dest" : "origin";
  const metro = metroForZip(zip);
  const zip5 = zipDigits(zip).slice(0, 5);
  const parkedOrigin = zipDigits(sheet?.lanes?.origin?.postal_code).slice(0, 5);
  const parkedDest = zipDigits(sheet?.lanes?.destination?.postal_code).slice(0, 5);
  const originParked = parkedOrigin.length === 5;
  const destParked = parkedDest.length === 5;

  // Sheet ZIPs only. Overlay may already contain the candidate ZIP.
  if (intendedRole === "origin" && originParked && parkedOrigin !== zip5) {
    const destSt = placeState(dest);
    const zipSt = stateForZip(zip);
    const destMetroMatch = Boolean(
      metro && (placeMatchesMetro(dest, metro) || placeCityMatchesMetro(dest, metro)),
    );
    if (!destParked && (destMetroMatch || !destSt || destSt === zipSt)) {
      return { attach: "dest", clarify: null };
    }
    return { attach: null, clarify: null };
  }
  if (intendedRole === "dest" && destParked && parkedDest !== zip5) {
    const originSt = placeState(origin);
    const zipSt = stateForZip(zip);
    const originMetroMatch = Boolean(
      metro && (placeMatchesMetro(origin, metro) || placeCityMatchesMetro(origin, metro)),
    );
    if (!originParked && (originMetroMatch || !originSt || originSt === zipSt)) {
      return { attach: "origin", clarify: null };
    }
    return { attach: null, clarify: null };
  }
  const otherMatch = Boolean(
    metro && (placeMatchesMetro(other, metro) || placeCityMatchesMetro(other, metro)),
  );
  const targetCity = cityOf(target);
  const targetCityConflict = Boolean(
    metro && targetCity && isKnownUsCity(targetCity) && targetCity !== metro.city.toLowerCase(),
  );
  const targetConflict = Boolean(metro && placeConflictsWithMetro(target, metro));

  if (metro && targetConflict && otherMatch) {
    const otherParked = intendedRole === "origin" ? destParked : originParked;
    // The ZIP's city is already the city on that slot. Attach it. Still ask
    // when that slot has no city, or the city does not match, or a different
    // ZIP is already parked there.
    // Bare ZIP whose metro city is already the city on the other slot can
    // move there without "Is that the destination zip code?". An explicit
    // "dest zip …" label stays a confirm, so a mismatch is not stolen.
    if (cityNameMatchesMetro(other, metro) && !otherParked && !explicit) {
      return { attach: otherRole, clarify: null };
    }
    return {
      attach: null,
      clarify: {
        kind: "role",
        zip,
        attemptedRole: intendedRole,
        suggestedRole: otherRole,
        metro,
        statedCity: target.city || null,
        statedState: target.state || null,
      },
    };
  }
  if (metro && targetCityConflict) {
    return {
      attach: null,
      clarify: {
        kind: "metro",
        zip,
        attemptedRole: intendedRole,
        suggestedRole: null,
        metro,
        statedCity: target.city || null,
        statedState: target.state || null,
      },
    };
  }

  // Same-side only: origin ZIP vs origin city/state; dest ZIP vs dest city/state.
  const stateClarify = zipStateClarify(target, zip, intendedRole);
  if (stateClarify) {
    const otherSt = placeState(other);
    const zipSt = stateClarify.zipState;
    if (otherSt && zipSt === otherSt && (intendedRole === "origin" ? !destParked : !originParked)) {
      return { attach: otherRole, clarify: null };
    }
    return { attach: null, clarify: stateClarify };
  }

  return { attach: intendedRole, clarify: null };
}

/** Same-side city vs ZIP metro mismatch when both ZIPs arrived in one turn. */
export function detectCityZipMetroClarify(sheet, extracted) {
  const roles = [
    ["origin", extracted?.origin?.postal_code],
    ["dest", extracted?.destination?.postal_code],
  ];
  for (const [role, zip] of roles) {
    if (!zip) continue;
    const place = overlayPlace(
      role === "origin" ? sheet?.lanes?.origin : sheet?.lanes?.destination,
      role === "origin" ? extracted.origin : extracted.destination,
    );
    const metro = metroForZip(zip);
    if (!metro) continue;
    const city = cityOf(place);
    const cityConflict = Boolean(city && isKnownUsCity(city) && city !== metro.city.toLowerCase());
    if (!cityConflict) continue;
    const other = overlayPlace(
      role === "origin" ? sheet?.lanes?.destination : sheet?.lanes?.origin,
      role === "origin" ? extracted.destination : extracted.origin,
    );
    if (placeMatchesMetro(other, metro) || placeCityMatchesMetro(other, metro)) continue;
    return {
      kind: "metro",
      zip,
      attemptedRole: role,
      suggestedRole: null,
      metro,
      statedCity: place.city || null,
      statedState: place.state || null,
    };
  }
  return null;
}

export function applyZipToRole(sheet, role, zip, { state } = {}) {
  if (!role || !zip) return sheet;
  const next = structuredClone(sheet);
  const place = role === "dest" ? next.lanes.destination : role === "origin" ? next.lanes.origin : null;
  if (!place) return next;
  place.postal_code = zip;
  if (state) place.state = state;
  else fillStateFromZip(place, zip);
  return next;
}

/**
 * City vs ZIP metro choice. Keep the stated city (drop ZIP) or keep the ZIP
 * (drop conflicting city/state). Never invent a replacement ZIP or city.
 */
export function applyCityZipChoice(sheet, clarify, keep) {
  if (!clarify?.zip || !clarify.attemptedRole) return sheet;
  const next = structuredClone(sheet);
  const place = clarify.attemptedRole === "dest" ? next.lanes.destination : next.lanes.origin;
  if (keep === "city") {
    if (place.postal_code === clarify.zip) place.postal_code = null;
  } else if (keep === "zip") {
    place.postal_code = clarify.zip;
    place.city = null;
    place.state = null;
  }
  return next;
}

export function splitTwoKnownCities(value) {
  const words = String(value || "")
    .replace(/[,\.;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length < 2) return null;
  for (let i = 1; i < words.length; i += 1) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    if (isKnownUsCity(left) && isKnownUsCity(right)) {
      return [titleCase(left), titleCase(right)];
    }
  }
  return null;
}

function cityNameAlternation() {
  return [...US_CITIES]
    .sort((a, b) => b.length - a.length)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

/**
 * Last clear city→ZIP pairing in the utterance. Stuttered repeats
 * overwrite the same city; a later city does not steal an earlier city’s ZIP.
 */
export function extractCityLabeledZips(text) {
  const raw = String(text || "");
  if (!raw.trim()) return new Map();
  const cities = cityNameAlternation();
  const last = new Map();
  const tight = new RegExp(
    String.raw`\b(${cities})(?:\s+zip(?:\s*code)?)?(?:\s+is)?[:\s]+(\d{5})(?:-\d{4})?\b`,
    "gi",
  );
  for (const m of raw.matchAll(tight)) {
    last.set(m[1].toLowerCase(), m[2]);
  }
  const windowed = new RegExp(
    String.raw`\b(${cities})\b(?:(?!\b(?:${cities})\b).){0,48}?(\d{5})(?:-\d{4})?\b`,
    "gi",
  );
  for (const m of raw.matchAll(windowed)) {
    last.set(m[1].toLowerCase(), m[2]);
  }
  return last;
}

function roleForLabeledCity(city, zip, extracted, sheetCities = {}) {
  const c = String(city || "").toLowerCase();
  if (!c) return null;
  if (cityOf(extracted.origin) === c || String(sheetCities.originCity || "").toLowerCase() === c) {
    return "origin";
  }
  if (cityOf(extracted.destination) === c || String(sheetCities.destCity || "").toLowerCase() === c) {
    return "dest";
  }
  const metro = metroForZip(zip);
  if (metro && metro.city.toLowerCase() === c) {
    if (cityOf(extracted.origin) === c) return "origin";
    if (cityOf(extracted.destination) === c) return "dest";
  }
  if (extracted.destination.city && cityOf(extracted.destination) !== c && !extracted.origin.city) {
    return "origin";
  }
  if (extracted.origin.city && cityOf(extracted.origin) !== c && !extracted.destination.city) {
    return "dest";
  }
  return null;
}

function applyCityLabeledZips(extracted, cityZips, sheetCities = {}) {
  if (!cityZips || cityZips.size === 0) return false;
  let applied = false;
  const unassigned = [];
  for (const [city, zip] of cityZips) {
    const role = roleForLabeledCity(city, zip, extracted, sheetCities);
    if (role === "origin") {
      extracted.origin.postal_code = zip;
      if (!extracted.origin.city) extracted.origin.city = titleCase(city);
      applied = true;
    } else if (role === "dest") {
      extracted.destination.postal_code = zip;
      if (!extracted.destination.city) extracted.destination.city = titleCase(city);
      applied = true;
    } else {
      unassigned.push([city, zip]);
    }
  }
  if (unassigned.length && !extracted.origin.postal_code) {
    const [city, zip] = unassigned.shift();
    extracted.origin.postal_code = zip;
    if (!extracted.origin.city) extracted.origin.city = titleCase(city);
    applied = true;
  }
  if (unassigned.length && !extracted.destination.postal_code) {
    const [city, zip] = unassigned.shift();
    extracted.destination.postal_code = zip;
    if (!extracted.destination.city) extracted.destination.city = titleCase(city);
    applied = true;
  }
  const zips = [...new Set([...cityZips.values()])];
  if (
    extracted.origin.postal_code &&
    extracted.destination.postal_code === extracted.origin.postal_code &&
    zips.length >= 2
  ) {
    const other = zips.find((z) => z !== extracted.origin.postal_code);
    if (other) extracted.destination.postal_code = other;
  }
  return applied;
}

const ORIGIN_ZIP_LABEL = String.raw`origin|pickup|pick\s*up|ship\s+from`;
const DEST_ZIP_LABEL = String.raw`destination|dest|delivery|deliver(?:y|ed)?\s+to|ship\s+to`;
const LABELED_ZIP_TAIL = String.raw`(?:\s+zip|\s+zipcode|\s+zip\s*code)?(?:\s+is)?[:\s]+`;

function labeledZipRe(label, digits) {
  return new RegExp(String.raw`\b(?:${label})${LABELED_ZIP_TAIL}(${digits})(?!\d)`, "i");
}

/**
 * Every ZIP-like run tied to one lane role, in utterance order.
 * Repeated STT ("zip code is 300 ... zip code is 30030") keeps each hit.
 */
function roleZipHits(raw, role) {
  const label = role === "origin" ? ORIGIN_ZIP_LABEL : DEST_ZIP_LABEL;
  const loose =
    role === "origin"
      ? /\borigins?\b(?:\s+[a-z]+){0,6}?\s+is\s+(\d{3,5})(-\d{4})?(?!\d)/gi
      : /\b(?:destination|dest)\b(?:\s+[a-z]+){0,6}?\s+is\s+(\d{3,5})(-\d{4})?(?!\d)/gi;
  const labeled = new RegExp(
    String.raw`\b(?:${label})${LABELED_ZIP_TAIL}(\d{3,5})(-\d{4})?(?!\d)`,
    "gi",
  );
  const hits = [];
  for (const re of [labeled, loose]) {
    let match;
    while ((match = re.exec(raw))) {
      hits.push({ digits: match[1], plus4: match[2] || "", index: match.index });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.digits.length - a.digits.length);
  const seen = new Set();
  const out = [];
  for (const hit of hits) {
    const key = `${hit.index}:${hit.digits}${hit.plus4}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

/**
 * Same slot, several ZIP-like numbers: keep the last valid 5-digit one.
 * Shorter fragments are ignored once a 5-digit ZIP is present.
 */
function pickRoleZip(hits) {
  const full = hits.filter((hit) => hit.digits.length === 5);
  if (full.length) {
    const last = full[full.length - 1];
    return { zip: `${last.digits}${last.plus4 || ""}`, short: null };
  }
  if (hits.length) return { zip: null, short: hits[hits.length - 1].digits };
  return { zip: null, short: null };
}

/**
 * from/to (or X to Y) where one side is 5 digits and the other is not.
 * Both-valid pairs stay on the existing path. An "or" is a choice, not a lane.
 */
function matchPartialZipPair(raw) {
  if (/\bor\b/i.test(raw)) return null;
  const patterns = [
    /\bfrom\s+(\d{3,5})(?:-\d{4})?\s+(?:to|through)\s+(\d{3,5})(?:-\d{4})?(?!\d)/i,
    /\b(\d{5})(?:-\d{4})?\s+(?:to|through)\s+(\d{3,4})(?!\d)/i,
    /\b(\d{3,4})(?!\d)\s+(?:to|through)\s+(\d{5})(?:-\d{4})?\b/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (!m) continue;
    const originDigits = m[1];
    const destDigits = m[2];
    const originOk = originDigits.length === 5;
    const destOk = destDigits.length === 5;
    if (originOk === destOk) continue;
    return {
      originZip: originOk ? originDigits : null,
      destZip: destOk ? destDigits : null,
      incomplete: originOk
        ? { digits: destDigits, role: "dest", labeled: true }
        : { digits: originDigits, role: "origin", labeled: true },
    };
  }
  return null;
}

function uniqueLaneZips(zipTokens) {
  const seen = [];
  for (const m of zipTokens) {
    const zip = m[1] + (m[2] || "");
    if (!seen.includes(zip)) seen.push(zip);
  }
  return seen;
}

const LABELED_FIELD_RE =
  /\b(ship\s+from|ship\s+to|pick\s*up|deliver(?:y|ed)?\s+to|destination|origin|commodity|product|goods|weighing|weight|pieces|piece|pallets|pallet|qty|quantity|dimensions|dims|freight\s+class|class|email|dest)\b/gi;

function slotForLabeledField(label) {
  const key = String(label || "")
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (/^(ship from|pick up|pickup|origin)$/.test(key)) return "origin";
  if (/^(ship to|deliver to|delivery to|delivered to|destination|dest)$/.test(key)) return "dest";
  if (/^(commodity|product|goods)$/.test(key)) return "commodity";
  if (/^(weighing|weight)$/.test(key)) return "weight";
  if (/^(pieces|piece|qty|quantity)$/.test(key)) return "pieces";
  if (/^(pallets|pallet)$/.test(key)) return "pallets";
  if (/^(dimensions|dims)$/.test(key)) return "dims";
  if (/^(freight class|class)$/.test(key)) return "class";
  if (key === "email") return "email";
  return null;
}

function labeledFieldHits(raw) {
  const hits = [];
  const re = new RegExp(LABELED_FIELD_RE.source, "gi");
  let match;
  while ((match = re.exec(raw))) {
    const slot = slotForLabeledField(match[1]);
    if (!slot) continue;
    hits.push({ slot, index: match.index, end: match.index + match[0].length });
  }
  return hits;
}

function labeledSpanValue(raw, hits, index) {
  const start = hits[index].end;
  const end = index + 1 < hits.length ? hits[index + 1].index : raw.length;
  return raw
    .slice(start, end)
    .replace(/^[\s,:;.-]+/, "")
    .replace(/^(?:is\s+)+/i, "")
    .trim();
}

function placeFromLabeledValue(value) {
  let text = String(value || "")
    .replace(/^(?:is\s+)+/i, "")
    .trim();
  text = text.replace(/^(?:zip(?:\s*code)?|zipcode|postal(?:\s*code)?)\b[:\s]*/i, "");
  text = text.replace(/^(?:is\s+)+/i, "").trim();
  if (!text) return null;
  const place = takePlace(text);
  if (!place || isGarbagePlace(place)) return null;
  const cityOk = Boolean(place.city && isKnownUsCity(place.city));
  if (place.city && !cityOk) delete place.city;
  if (!place.city && !place.state && !place.postal_code) return null;
  if (!place.postal_code && !place.state && !cityOk) return null;
  return place;
}

function hasParsedLabeledLane(raw) {
  const hits = labeledFieldHits(raw);
  return hits.some((hit, index) => {
    if (hit.slot !== "origin" && hit.slot !== "dest") return false;
    return Boolean(placeFromLabeledValue(labeledSpanValue(raw, hits, index)));
  });
}

function parseLabeledCount(value, unitHint) {
  const match = String(value || "").match(
    new RegExp(String.raw`^(\d{1,4}|${COUNT_WITH_UNIT})(?:\s+(${PIECE_UNIT_WORD}))?\b`, "i"),
  );
  if (!match) return null;
  const count = parseCount(match[1]);
  if (!count) return null;
  const unit = (match[2] && mapPieceUnit(match[2])) || unitHint || null;
  return { count, unit };
}

function assignLabeledPlace(target, place) {
  if (place.city) target.city = place.city;
  if (place.state) target.state = place.state;
  if (place.postal_code) target.postal_code = place.postal_code;
}

/**
 * Stiff field dumps: "Origin Austin destination Atlanta commodity oranges weight 1000 pounds".
 * Labels name the slot. Only a parsed lane place turns the utterance into a dump,
 * so "78721 is the destination" stays on the zip path.
 */
function applyLabeledFieldDump(raw, extracted) {
  const hits = labeledFieldHits(raw);
  if (!hits.length) return;
  const spans = hits.map((hit, index) => ({
    slot: hit.slot,
    value: labeledSpanValue(raw, hits, index),
  }));
  const places = {};
  for (const span of spans) {
    if (span.slot !== "origin" && span.slot !== "dest") continue;
    const place = placeFromLabeledValue(span.value);
    if (place) places[span.slot] = place;
  }
  if (!places.origin && !places.dest) return;

  if (places.origin) assignLabeledPlace(extracted.origin, places.origin);
  if (places.dest) assignLabeledPlace(extracted.destination, places.dest);

  for (const span of spans) {
    if (span.slot === "commodity") {
      const commodity = looksLikeCommodity(span.value);
      if (commodity) extracted.freight.commodity = commodity;
    } else if (span.slot === "weight") {
      const tmp = { freight: {}, flags: {} };
      extractWeight(span.value, tmp);
      if (tmp.freight.total_weight_lbs) {
        extracted.freight.total_weight_lbs = tmp.freight.total_weight_lbs;
        if (tmp.flags.weightFromKg) {
          extracted.flags.weightFromKg = true;
          extracted.flags.weightKg = tmp.flags.weightKg;
        }
      }
    } else if (span.slot === "pieces" || span.slot === "pallets") {
      const parsed = parseLabeledCount(span.value, span.slot === "pallets" ? "pallets" : "pieces");
      if (parsed) {
        extracted.freight.pieces = parsed.count;
        if (parsed.unit) extracted.freight.piece_unit = parsed.unit;
      }
    } else if (span.slot === "dims") {
      const tmp = { freight: {} };
      extractDims(span.value, tmp);
      if (tmp.freight.dims) extracted.freight.dims = tmp.freight.dims;
    } else if (span.slot === "class") {
      const match = span.value.match(/\b(\d{2,3}(?:\.5)?)\b/);
      if (match && NMFC_CLASSES.has(match[1])) extracted.freight.freight_class = match[1];
    } else if (span.slot === "email") {
      const email = extractContactEmail(span.value);
      if (email) extracted.contact.email = email;
    }
  }
}

function extractLane(raw, extracted, awaiting, sheetCities = {}) {
  const zipOnly = /^\s*\d{5}(?:-\d{4})?\s*$/.test(raw);
  const labeledLaneZip = isLabeledLaneZipPhrase(raw);

  if (!LEADING_FILLER.test(raw) && !zipOnly && !labeledLaneZip && !hasParsedLabeledLane(raw)) {
    const leading = dropNoiseCityBeforeZip(takePlace(raw), sheetCities.originCity);
    if (leading?.postal_code && (leading.city || leading.state || awaiting === "origin_zip")) {
      Object.assign(extracted.origin, leading);
    } else if (leading?.city && isKnownUsCity(leading.city)) {
      const bits = { city: leading.city };
      if (leading.state) bits.state = leading.state;
      Object.assign(extracted.origin, bits);
    }
  }

  const fromToZips = raw.match(
    /\bfrom\s+(\d{5}(?:-\d{4})?)\s+(?:to|through)\s+(\d{5}(?:-\d{4})?)\b/i,
  );
  if (fromToZips) {
    extracted.origin.postal_code = fromToZips[1];
    extracted.destination.postal_code = fromToZips[2];
  }

  const pickedOrigin = pickRoleZip(roleZipHits(raw, "origin"));
  const pickedDest = pickRoleZip(roleZipHits(raw, "dest"));
  if (pickedOrigin.zip) extracted.origin.postal_code = pickedOrigin.zip;
  if (pickedDest.zip) extracted.destination.postal_code = pickedDest.zip;

  const partialPair = matchPartialZipPair(raw);
  if (partialPair?.originZip && !extracted.origin.postal_code) extracted.origin.postal_code = partialPair.originZip;
  if (partialPair?.destZip && !extracted.destination.postal_code) extracted.destination.postal_code = partialPair.destZip;

  const destZipAfter = raw.match(/\b(\d{5}(?:-\d{4})?)\s+is\s+(?:the\s+)?(?:destination|dest)\b/i);
  if (destZipAfter) extracted.destination.postal_code = destZipAfter[1];
  const originZipAfter = raw.match(/\b(\d{5}(?:-\d{4})?)\s+is\s+(?:the\s+)?origin\b/i);
  if (originZipAfter) extracted.origin.postal_code = originZipAfter[1];

  const destZipLocked = Boolean(
    pickedDest.zip ||
      pickedDest.short ||
      destZipAfter ||
      partialPair?.destZip ||
      partialPair?.incomplete?.role === "dest",
  );
  const originZipLocked = Boolean(
    pickedOrigin.zip ||
      pickedOrigin.short ||
      originZipAfter ||
      fromToZips ||
      partialPair?.originZip ||
      partialPair?.incomplete?.role === "origin",
  );

  const fromPlace = matchPlaceAfter(raw, /\bfrom\s+/i);
  if (fromPlace && !isGarbagePlace(fromPlace)) Object.assign(extracted.origin, fromPlace);

  assignDestinationTos(raw, extracted);
  splitCompoundFromCities(extracted);
  if (!extracted.origin.city && !extracted.destination.city) {
    const maybeLane = raw
      .replace(LEADING_FILLER, "")
      .replace(/^\s*(?:from|to)\s+/i, "")
      .trim();
    const split = splitTwoKnownCities(maybeLane);
    if (split && maybeLane.split(/\s+/).length <= 4) {
      extracted.origin.city = split[0];
      extracted.destination.city = split[1];
    }
  }

  const cityZips = extractCityLabeledZips(raw);
  const cityLabeled = applyCityLabeledZips(extracted, cityZips, sheetCities);
  if (cityLabeled) extracted.flags.cityLabeledZips = true;

  const zipTokens = [...raw.matchAll(/\b(\d{5})(-\d{4})?\b/g)].filter((m) => !inWeightContext(raw, m.index));
  const uniqueZips = uniqueLaneZips(zipTokens);
  const bareOnly = /^\s*\d{5}(?:-\d{4})?\s*$/.test(raw);

  if (zipTokens.length === 1 && !cityLabeled) {
    const zip = zipTokens[0][1] + (zipTokens[0][2] || "");
    extracted.flags.bareZip = zip;
    if (destZipLocked || originZipLocked) {
      // Dest/origin ZIP phrases stay on that side only — never mirror one ZIP to both.
    } else if (bareOnly || awaiting === "origin_zip" || awaiting === "dest_zip") {
      if (awaiting === "dest_zip") extracted.destination.postal_code = zip;
      else if (awaiting === "origin_zip") extracted.origin.postal_code = zip;
      else if (/\bdest|\bdeliver/i.test(raw)) extracted.destination.postal_code = zip;
      else extracted.origin.postal_code = zip;
    } else if (!extracted.origin.postal_code && !extracted.destination.postal_code) {
      if (/\borigin\b|\bpickup\b|\bfrom\b/i.test(raw)) extracted.origin.postal_code = zip;
      else if (/\bdest|\bdeliver|\bto\b/i.test(raw)) extracted.destination.postal_code = zip;
    }
  } else if (
    uniqueZips.length >= 2 &&
    !extracted.origin.postal_code &&
    !extracted.destination.postal_code
  ) {
    extracted.origin.postal_code = uniqueZips[0];
    extracted.destination.postal_code = uniqueZips[uniqueZips.length - 1];
  }

  if (
    extracted.origin.postal_code &&
    extracted.destination.postal_code === extracted.origin.postal_code &&
    uniqueZips.length >= 2
  ) {
    const other = uniqueZips.find((z) => z !== extracted.origin.postal_code);
    if (other) extracted.destination.postal_code = other;
  }

  applyDistinctZipPair(raw, extracted, uniqueZips, { cityLabeled, originZipLocked, destZipLocked });

  const incompleteZips = [];
  if (pickedOrigin.short && !pickedOrigin.zip) {
    incompleteZips.push({ digits: pickedOrigin.short, role: "origin", labeled: true });
  }
  if (pickedDest.short && !pickedDest.zip) {
    incompleteZips.push({ digits: pickedDest.short, role: "dest", labeled: true });
  }
  const incomplete = partialPair?.incomplete || detectIncompleteZip(raw, awaiting);
  const incompleteCovered =
    incomplete &&
    incompleteZips.some((flag) => flag.role === incomplete.role || incomplete.role === "unknown");
  const incompleteRoleHasFull =
    incomplete?.role === "dest"
      ? Boolean(pickedDest.zip)
      : incomplete?.role === "origin"
        ? Boolean(pickedOrigin.zip)
        : false;
  if (
    incomplete &&
    !incompleteCovered &&
    !incompleteRoleHasFull &&
    (incomplete.labeled || zipTokens.length === 0)
  ) {
    incompleteZips.push(incomplete);
  }
  if (incompleteZips.length > 1) extracted.flags.incompleteZips = incompleteZips;
  else if (incompleteZips.length === 1) extracted.flags.incompleteZip = incompleteZips[0];

  stripNoiseCity(extracted.origin, sheetCities.originCity);
  stripNoiseCity(extracted.destination, sheetCities.destCity);

  const loneState = normalizeState(raw.trim().replace(/[.,!?]+$/g, ""));
  if (loneState) {
    if (awaiting === "dest_zip" && !extracted.destination.state && !extracted.destination.city) {
      extracted.destination.state = loneState;
    } else if (
      (awaiting === "origin_zip" || !awaiting) &&
      !extracted.origin.state &&
      !extracted.origin.city
    ) {
      extracted.origin.state = loneState;
    }
  }
}

function zip5Of(code) {
  return String(code || "").replace(/\D/g, "").slice(0, 5);
}

/**
 * Two distinct 5-digit ZIPs in one utterance fill both ends.
 * Cues: from/to, origin/dest labels, otherwise first then second.
 * An "or" between ZIPs is a choice, not a lane, unless from/to or origin/dest is explicit.
 * City-labeled stutter pairing is left to the caller.
 */
function distinctZipPair(raw, uniqueZips) {
  const fromTo = raw.match(/\bfrom\s+(\d{5}(?:-\d{4})?)\s+(?:to|through)\s+(\d{5}(?:-\d{4})?)\b/i);
  if (fromTo && zip5Of(fromTo[1]) !== zip5Of(fromTo[2])) {
    return { origin: fromTo[1], dest: fromTo[2] };
  }

  const originLabeled = raw.match(labeledZipRe(ORIGIN_ZIP_LABEL, String.raw`\d{5}(?:-\d{4})?`));
  const destLabeled = raw.match(labeledZipRe(DEST_ZIP_LABEL, String.raw`\d{5}(?:-\d{4})?`));
  if (originLabeled && destLabeled && zip5Of(originLabeled[1]) !== zip5Of(destLabeled[1])) {
    return { origin: originLabeled[1], dest: destLabeled[1] };
  }

  const toPair = raw.match(/\b(\d{5}(?:-\d{4})?)\s+(?:to|through)\s+(\d{5}(?:-\d{4})?)\b/i);
  if (toPair && zip5Of(toPair[1]) !== zip5Of(toPair[2])) {
    return { origin: toPair[1], dest: toPair[2] };
  }

  if (/\bor\b/i.test(raw)) return null;
  if (
    uniqueZips.length >= 2 &&
    zip5Of(uniqueZips[0]) !== zip5Of(uniqueZips[uniqueZips.length - 1])
  ) {
    return { origin: uniqueZips[0], dest: uniqueZips[uniqueZips.length - 1] };
  }
  return null;
}

function applyDistinctZipPair(raw, extracted, uniqueZips, { cityLabeled, originZipLocked, destZipLocked }) {
  if (cityLabeled) return;
  const pair = distinctZipPair(raw, uniqueZips);
  if (!pair || zip5Of(pair.origin) === zip5Of(pair.dest)) return;
  if (!originZipLocked || !extracted.origin.postal_code) extracted.origin.postal_code = pair.origin;
  if (!destZipLocked || !extracted.destination.postal_code) extracted.destination.postal_code = pair.dest;
}

function isLabeledLaneZipPhrase(raw) {
  return (
    /\b(?:origin|destination|dest|pickup|pick\s*up|delivery)(?:\s+zip|\s+zipcode|\s+zip\s*code)?[:\s]+\d{3,5}/i.test(
      raw,
    ) ||
    /\b(?:origin|destination|dest|pickup|pick\s*up|delivery)(?:\s+zip|\s+zipcode|\s+zip\s*code)/i.test(raw) ||
    /\b(?:zip|zipcode|zip\s*code)\s+is\s+\d/i.test(raw) ||
    /\b\d{3,5}(?:-\d{4})?\s+is\s+(?:the\s+)?(?:destination|dest|origin)\b/i.test(raw) ||
    /\b[a-z]+(?:\s+[a-z]+)?\s+zip(?:\s*code)?\s+is\b/i.test(raw)
  );
}

function detectIncompleteZip(raw, awaiting) {
  const destShort = raw.match(labeledZipRe(DEST_ZIP_LABEL, String.raw`\d{3,4}`));
  if (destShort) return { digits: destShort[1], role: "dest", labeled: true };
  const originShort = raw.match(labeledZipRe(ORIGIN_ZIP_LABEL, String.raw`\d{3,4}`));
  if (originShort) return { digits: originShort[1], role: "origin", labeled: true };
  const zipShort = raw.match(/\b(?:zip|zipcode|zip\s*code)(?:\s+is)?[:\s]+(\d{3,4})\b/i);
  if (zipShort) {
    const role = awaiting === "dest_zip" ? "dest" : awaiting === "origin_zip" ? "origin" : "unknown";
    return { digits: zipShort[1], role };
  }
  if (awaiting === "dest_zip" || awaiting === "origin_zip") {
    const bareShort = raw.match(/^\s*(\d{3,4})\s*$/);
    if (bareShort) {
      return { digits: bareShort[1], role: awaiting === "dest_zip" ? "dest" : "origin" };
    }
  }
  return null;
}

function splitCompoundFromCities(extracted) {
  if (!extracted.origin?.city) return;
  const split = splitTwoKnownCities(extracted.origin.city);
  if (!split) return;
  extracted.origin.city = split[0];
  if (!extracted.destination.city) extracted.destination.city = split[1];
}

function matchPlaceAfter(raw, prefixRe) {
  const start = raw.search(prefixRe);
  if (start < 0) return null;
  const after = raw.slice(start).replace(prefixRe, "");
  const place = takePlace(after);
  return isGarbagePlace(place) ? null : place;
}

const LIKE_TO = /\b(like|want|need|have|trying|try|about)\s+$/i;

function assignDestinationTos(raw, extracted) {
  if (extracted.flags.incompleteTo && !/\bto\s+\S+/i.test(raw.replace(/\bto\s*$/i, ""))) {
    // Only a trailing "to" with nothing after — do not lock a dest.
    return;
  }

  const re = /\b(?:to|through)\s+/gi;
  let m;
  while ((m = re.exec(raw))) {
    const after = raw.slice(m.index + m[0].length);
    if (!after.trim()) continue;

    const before = raw.slice(0, m.index);
    const nextWord = (after.match(/^([A-Za-z']+)/) || [])[1];
    if (LIKE_TO.test(before) && isPlaceNoise(nextWord)) continue;
    if (isPlaceNoise(nextWord) && !/\bfrom\b/i.test(before.slice(-24))) {
      // "to ship 500 lb from Chicago to Dallas" — skip the verb, keep the later "to Dallas".
      continue;
    }

    const place = takePlace(after);
    if (place && !isGarbagePlace(place)) Object.assign(extracted.destination, place);
  }
}

export function isIncompleteTo(text) {
  return /\bto\s*$/i.test((text || "").trim());
}

export function isPlaceNoise(word) {
  if (!word) return false;
  return PLACE_NOISE.has(String(word).toLowerCase().replace(/[^\w]/g, ""));
}

export function isGarbagePlace(place) {
  if (!place) return false;
  if (!place.city) return false;
  const words = place.city.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (words.some((w) => isPlaceNoise(w) || PLACE_STOP.has(w.toLowerCase()))) return true;
  return false;
}

/**
 * Noise / unknown words before a ZIP must not rewrite a prior city.
 * ZIP still applies. Known US cities (Atlanta 30301) may confirm the city.
 */
export function dropNoiseCityBeforeZip(place, priorCity) {
  if (!place?.city) return place || {};
  if (isKnownUsCity(place.city)) return place;
  if (priorCity) {
    const next = { ...place };
    delete next.city;
    return next;
  }
  if (place.postal_code && !place.state) {
    const next = { ...place };
    delete next.city;
    return next;
  }
  return place;
}

function stripNoiseCity(place, priorCity) {
  if (!place) return;
  const cleaned = dropNoiseCityBeforeZip(place, priorCity);
  if (!cleaned.city) delete place.city;
}

export function hasPlaceHint(place) {
  if (!place) return false;
  return Boolean(place.city || place.state || place.postal_code);
}

export function firstBareZip(text) {
  const m = String(text || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] + (m[2] || "") : null;
}

/** Distinct 5-digit ZIPs in utterance order. A ZIP+4 stays on its 5-digit stem for uniqueness. */
export function distinctUtteranceZips(text) {
  const seen = [];
  for (const match of String(text || "").matchAll(/\b(\d{5})(?:-\d{4})?\b/g)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

/**
 * “that’s the destination” / “the ZIP I just sent is the destination”
 * → move last ZIP onto dest or origin. Does not invent ZIPs.
 * A turn that states two ZIPs is an assignment, not a move of the first one.
 * STT “origins” counts as origin so it cannot be read as dest-only.
 */
export function detectZipRoleCorrection(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  if (distinctUtteranceZips(t).length >= 2) return null;
  const mentionsDest = /\b(dest|destination)\b/.test(t);
  const mentionsOrigin = /\borigins?\b/.test(t);
  const refersToPrior =
    /\b(that|thats|that is|the zip|zip code|i just sent|just sent|just gave)\b/.test(t);
  if (mentionsDest && refersToPrior && !mentionsOrigin) return "dest";
  if (mentionsDest && /\b(that zip|destination zip|thats dest|that is dest)\b/.test(t) && !mentionsOrigin) {
    return "dest";
  }
  if (mentionsOrigin && refersToPrior && !mentionsDest) return "origin";
  return null;
}

export function applyZipRoleCorrection(sheet, role, zip, { clearOther = true } = {}) {
  if (!role || !zip || !/^\d{5}(?:-\d{4})?$/.test(zip)) return sheet;
  const next = structuredClone(sheet);
  if (role === "dest") {
    next.lanes.destination.postal_code = zip;
    fillStateFromZip(next.lanes.destination, zip);
    if (clearOther && next.lanes.origin.postal_code === zip) {
      next.lanes.origin.postal_code = null;
    }
  } else if (role === "origin") {
    next.lanes.origin.postal_code = zip;
    fillStateFromZip(next.lanes.origin, zip);
    if (clearOther && next.lanes.destination.postal_code === zip) {
      next.lanes.destination.postal_code = null;
    }
  }
  return next;
}

/**
 * Read only a leading city / state / ZIP. Stop before weight, pieces,
 * dates, accessorials, or other chat leftovers.
 */
export function takePlace(text) {
  if (!text) return null;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const cityWords = [];
  let state = null;
  let zip = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/^[,\.;:]+|[,\.;:]+$/g, "");
    if (!bare) continue;

    if (/^\d{5}(?:-\d{4})?$/.test(bare)) {
      zip = bare;
      break;
    }

    if (/^[\d,]+(?:\.\d+)?$/.test(bare)) break;
    if (bare.includes("@")) break;

    const nextBare = tokens[i + 1] ? tokens[i + 1].replace(/^[,\.;:]+|[,\.;:]+$/g, "") : "";
    const afterNext = tokens[i + 2] ? tokens[i + 2].replace(/^[,\.;:]+|[,\.;:]+$/g, "") : "";
    const twoWord = nextBare ? normalizeState(`${bare} ${nextBare}`) : null;
    if (twoWord) {
      if (isCitySuffix(afterNext)) {
        cityWords.push(bare, nextBare, afterNext);
        i += 2;
        continue;
      }
      if (isKnownUsCity(`${bare} ${nextBare}`)) {
        cityWords.push(bare, nextBare);
        i += 1;
        continue;
      }
      state = twoWord;
      i += 1;
      continue;
    }

    const st = normalizeState(bare);
    if (st) {
      if (isCitySuffix(nextBare)) {
        cityWords.push(bare, nextBare);
        i += 1;
        continue;
      }
      state = st;
      continue;
    }

    const lower = bare.toLowerCase();
    if (lower === "to" || lower === "through") break;
    if (ZIP_PREFIX_NOISE.has(lower)) continue;
    if (SPEECH_FILLERS.has(lower) || PLACE_STOP.has(lower) || isPlaceNoise(bare)) {
      if (cityWords.length) break;
      continue;
    }
    if (!/^[A-Za-z][A-Za-z.'-]*$/.test(bare)) break;

    cityWords.push(bare);
    if (cityWords.length >= 4) break;
  }

  const place = {};
  if (zip) place.postal_code = zip;
  if (state) place.state = state;
  const city = cleanCity(normalizeCityPhrase(cityWords.join(" ")));
  if (city) place.city = city;
  return Object.keys(place).length ? place : null;
}

function isCitySuffix(word) {
  return String(word || "").toLowerCase() === "city";
}

/** New York City → New York when the prefix is the known city. Keep Oklahoma City. */
export function normalizeCityPhrase(value) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  if (isKnownUsCity(cleaned)) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && isCitySuffix(words[words.length - 1])) {
    const prefix = words.slice(0, -1).join(" ");
    if (isKnownUsCity(prefix)) return prefix;
  }
  return cleaned;
}

function normalizeState(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (STATE_CODES.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
  return STATE_NAME_TO_CODE[trimmed.toLowerCase()] || null;
}

function cleanCity(value) {
  if (!value) return null;
  const cleaned = value
    .replace(/\b(zip|zipcode|code)\b/gi, "")
    .replace(/[^A-Za-z .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  if (/^(from|to|the|a|an|and|for|need|want)$/i.test(cleaned)) return null;
  const words = cleaned
    .split(/\s+/)
    .filter((w) => !PLACE_STOP.has(w.toLowerCase()) && !isPlaceNoise(w));
  if (!words.length) return null;
  if (words.every((w) => isPlaceNoise(w))) return null;
  return titleCase(words.join(" "));
}

function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function inWeightContext(raw, index) {
  if (index == null || index < 0) return false;
  const window = raw.slice(index, index + 28);
  return /^[\d,]+(?:\.\d+)?(?:\s*(?:lbs?|pounds?|lb\.|kgs?|kilograms?|kilos?))/i.test(window);
}

export const KG_TO_LB = 2.20462;

export function parseWeightPounds(token) {
  if (token == null) return null;
  const normalized = String(token)
    .replace(/[$\u00a3\u20ac]/g, "")
    .replace(/\b(usd|us\$)\b/gi, "")
    .replace(/,/g, "")
    .trim();
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function kgToPounds(kg) {
  const n = typeof kg === "number" ? kg : parseWeightPounds(kg);
  if (n == null) return null;
  return Math.round(n * KG_TO_LB);
}

const PIECE_UNIT_WORD = String.raw`(?:pallets?|skids?|pieces?|pcs|box(?:es)?|crates?|cartons?)`;

/** Web Speech homophones for a bare count. Only used while awaiting pieces. */
const STT_COUNT_ALIASES = {
  won: 1,
  too: 2,
  to: 2,
  for: 4,
  ate: 8,
};

const SPOKEN_COUNT_WORDS = Object.keys(WORD_NUMBERS)
  .filter((word) => word !== "a" && word !== "an")
  .sort((a, b) => b.length - a.length);

const COUNT_WITH_UNIT = [...SPOKEN_COUNT_WORDS, "won", "too", "ate", "a", "an"].join("|");
const AWAITING_COUNT = [...SPOKEN_COUNT_WORDS, "won", "too", "to", "for", "ate"].join("|");

function mapPieceUnit(word) {
  const w = String(word || "").toLowerCase();
  if (/^pallets?$/.test(w) || /^skids?$/.test(w)) return "pallets";
  if (/^(?:pieces?|pcs|box(?:es)?|crates?|cartons?)$/.test(w)) return "pieces";
  return null;
}

function extractPieces(raw, extracted, awaiting) {
  const unit = raw.match(
    new RegExp(
      String.raw`\b(\d{1,4}|${COUNT_WITH_UNIT})\s+(${PIECE_UNIT_WORD}|handling units?)\b`,
      "i",
    ),
  );
  if (unit) {
    extracted.freight.pieces = parseCount(unit[1]);
    const mapped = mapPieceUnit(unit[2]);
    if (mapped) extracted.freight.piece_unit = mapped;
    return;
  }
  const labeled = raw.match(/\b(?:pieces?|handling units?|qty|quantity)(?:\s+is|\s*[:=])?\s*(\d{1,4})\b/i);
  if (labeled) {
    extracted.freight.pieces = Number(labeled[1]);
    if (/^pieces?/i.test(labeled[0])) extracted.freight.piece_unit = "pieces";
    return;
  }
  const unitOnly = raw.match(
    new RegExp(
      String.raw`^\s*(?:(?:we(?:'re| are)|i(?:'m| am)|it(?:'s| is)|they(?:'re| are)|shipping|ship)\s+)?(${PIECE_UNIT_WORD})\s*[.!]?\s*$`,
      "i",
    ),
  );
  if (unitOnly) {
    const mapped = mapPieceUnit(unitOnly[1]);
    if (mapped) extracted.freight.piece_unit = mapped;
    return;
  }
  if (awaiting === "piece_unit") {
    const named = raw.match(new RegExp(String.raw`\b(${PIECE_UNIT_WORD})\b`, "i"));
    if (named) {
      const mapped = mapPieceUnit(named[1]);
      if (mapped) extracted.freight.piece_unit = mapped;
    }
    return;
  }
  if (awaiting === "pieces") {
    const loose = loosePieceCount(raw);
    if (loose) {
      extracted.freight.pieces = loose.count;
      if (loose.unit) extracted.freight.piece_unit = loose.unit;
    }
  }
}

/**
 * A short answer while awaiting pieces: "five", "5", "five.", "it's five",
 * "five pallets", plus STT "won" / "to" / "for" / "ate".
 */
function loosePieceCount(raw) {
  let loose = String(raw || "")
    .replace(/[.!?]+$/g, "")
    .trim();
  loose = loose.replace(
    /^(?:it(?:'s| is)|its|that(?:'s| is)|there(?:'s| are)|i said|just)\s+/i,
    "",
  );
  const m = loose.match(new RegExp(String.raw`^(${AWAITING_COUNT}|\d{1,4})(?:\s+(${PIECE_UNIT_WORD}))?$`, "i"));
  if (!m) return null;
  const count = parseCount(m[1]);
  if (!count) return null;
  const unit = m[2] ? mapPieceUnit(m[2]) : null;
  return { count, unit };
}

function parseCount(token) {
  const lower = String(token)
    .toLowerCase()
    .replace(/^[.,!?]+|[.,!?]+$/g, "");
  if (STT_COUNT_ALIASES[lower] != null) return STT_COUNT_ALIASES[lower];
  if (WORD_NUMBERS[lower] != null) return WORD_NUMBERS[lower];
  const n = Number(lower);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

const WEIGHT_UNIT = String.raw`(?:kgs?|kilograms?|kilos?|lbs?|pounds?)`;
const SPOKEN_NUM = String.raw`(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)`;

function spokenScaleToNumber(prefix, scale) {
  const mult = scale === "thousand" ? 1000 : 100;
  if (!prefix) return mult;
  const p = String(prefix).trim().toLowerCase();
  if (p === "a" || p === "an") return mult;
  if (WORD_NUMBERS[p] != null) return WORD_NUMBERS[p] * mult;
  const n = parseWeightPounds(p);
  return n != null ? n * mult : null;
}

function applyExtractedWeight(extracted, amount, fromKg) {
  if (amount == null || !(amount > 0)) return;
  if (fromKg) {
    const pounds = kgToPounds(amount);
    if (pounds == null) return;
    extracted.freight.total_weight_lbs = pounds;
    extracted.flags.weightFromKg = true;
    extracted.flags.weightKg = amount;
    return;
  }
  extracted.freight.total_weight_lbs = amount;
}

function extractWeight(raw, extracted) {
  const spoken = raw.match(
    new RegExp(String.raw`\b(?:(${SPOKEN_NUM}|\d[\d,]*)\s+)?(thousand|hundred)\s+${WEIGHT_UNIT}\b`, "i"),
  );
  if (spoken && !VAGUE_MEASURE.test(raw) && !/\bfew\s+(hundred|thousand)\b/i.test(raw)) {
    const amount = spokenScaleToNumber(spoken[1], spoken[2].toLowerCase());
    applyExtractedWeight(extracted, amount, /kg|kilo/i.test(spoken[0]));
    if (extracted.freight.total_weight_lbs) return;
  }

  const lb = raw.match(/(?:\$|usd\s*)?\s*([\d,]+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i);
  if (lb) {
    applyExtractedWeight(extracted, parseWeightPounds(lb[1]), false);
    return;
  }
  const kg = raw.match(/(?:\$|usd\s*)?\s*([\d,]+(?:\.\d+)?)\s*(?:kgs?|kilograms?|kilos?)\b/i);
  if (kg) {
    applyExtractedWeight(extracted, parseWeightPounds(kg[1]), true);
    return;
  }
  extractSttMangledThousandWeight(raw, extracted);
}

/**
 * John's Web Speech often mangles “thousand” → “$100” / “100” next to the
 * commodity. Choice: in a ship dump with no weight unit, `$100 oranges` or
 * `100 oranges` parks weight 1000 (thousand pounds of oranges).
 * “a thousand oranges” (no unit) is NOT weight — commodity only, ask pounds.
 */
function extractSttMangledThousandWeight(raw, extracted) {
  if (extracted.freight.total_weight_lbs) return;
  if (VAGUE_MEASURE.test(raw)) return;
  if (/\b(?:a|an|one)?\s*thousand\s+(?!pounds?|lbs?|kgs?|kilograms?|kilos?)/i.test(raw)) {
    return;
  }
  if (/\b(?:pounds?|lbs?|kgs?|kilograms?|kilos?)\b/i.test(raw)) return;
  const mangled = raw.match(/(?:\$\s*100\b|\b100\b)\s+([A-Za-z][A-Za-z\-']{2,24})\b/);
  if (!mangled) return;
  if (
    /^(pounds?|lbs?|kgs?|kilograms?|kilos?|pallets?|pieces?|pcs|skids?|boxes?|crates?|cartons?)$/i.test(
      mangled[1],
    )
  ) {
    return;
  }
  if (!looksLikeCommodity(mangled[1])) return;
  applyExtractedWeight(extracted, 1000, false);
  extracted.flags.weightFromSttThousand = true;
}

function extractDims(raw, extracted) {
  const m = raw.match(
    /\b(\d{1,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?)?\s*(?:x|by|×)\s*(\d{1,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?)?\s*(?:x|by|×)\s*(\d{1,3}(?:\.\d+)?)\s*(?:in(?:ch(?:es)?)?)?\b/i,
  );
  if (!m) return;
  const length_in = Number(m[1]);
  const width_in = Number(m[2]);
  const height_in = Number(m[3]);
  if ([length_in, width_in, height_in].every((n) => n > 0)) {
    extracted.freight.dims = { length_in, width_in, height_in, per_piece: true };
  }
}

function extractClass(raw, extracted) {
  const labeled = raw.match(/\b(?:freight\s+)?class(?:\s+is|\s*[:=])?\s*(\d{2,3}(?:\.5)?)\b/i);
  if (!labeled) return;
  const value = labeled[1];
  if (NMFC_CLASSES.has(value)) extracted.freight.freight_class = value;
}

const COMMODITY_STOP =
  /\s*(?:,|$|\b(?:from|to|weighing|weight|class|pickup|email|liftgate|residential|none|tomorrow|today|origin|destination|dest|pieces|piece|pallets|pallet|dims|dimensions)\b)/i;

function extractCommodity(raw, extracted, awaiting) {
  const labeled = raw.match(
    new RegExp(
      String.raw`\b(?:commodity|product|goods)(?:\s+is|\s*[:=])?\s+([a-z0-9][a-z0-9 \-/]{1,48}?)` +
        COMMODITY_STOP.source,
      "i",
    ),
  );
  if (labeled) {
    const commodity = sanitizeCommodity(labeled[1]);
    if (commodity) extracted.freight.commodity = commodity;
  }

  if (!extracted.freight.commodity) {
    const ofGoods = raw.match(
      new RegExp(
        String.raw`\b(?:pallets?|pieces?|skids?|boxes?|crates?|cartons?|lbs?|pounds?|kgs?|kilograms?|kilos?)\s+of\s+([a-z0-9][a-z0-9 \-/]{1,48}?)` +
          COMMODITY_STOP.source,
        "i",
      ),
    );
    const commodity = ofGoods && sanitizeCommodity(ofGoods[1]);
    if (commodity) extracted.freight.commodity = commodity;
  }

  if (!extracted.freight.commodity && awaiting === "commodity") {
    const commodity = sanitizeCommodity(raw);
    if (commodity) extracted.freight.commodity = commodity;
  }
  if (!extracted.freight.commodity) {
    const listed = raw.match(
      /(?:pallets?|pieces?|pcs|pounds?|lbs?|class\s+\d+(?:\.5)?)\s*,\s*([A-Za-z][A-Za-z0-9 \-/]{2,40}?)(?=\s*,\s*(?:pickup|on|email|lift|class|from|to|none)|(?:\s+pickup|\s+on\s+))/i,
    );
    const commodity = listed && sanitizeCommodity(listed[1]);
    if (commodity) extracted.freight.commodity = commodity;
  }
  extractDumpCommodity(raw, extracted);
}

/**
 * Hold-and-dump: park “oranges” / “thousand oranges” / “pounds of oranges”
 * even without “commodity is”. Does not invent weight.
 */
function extractDumpCommodity(raw, extracted) {
  if (extracted.freight.commodity) return;

  const shipFrom = raw.match(/\b(?:ship(?:ping)?)\s+(.+?)\s+from\b/i);
  if (shipFrom) {
    const commodity = commodityFromDumpMid(shipFrom[1]);
    if (commodity) {
      extracted.freight.commodity = commodity;
      return;
    }
  }

  const qtyGoods = raw.match(
    new RegExp(
      String.raw`\b(?:(?:a|an|one)\s+)?(?:thousand|hundred|\$?\s*\d[\d,]*)\s+(?!${WEIGHT_UNIT}\b)([A-Za-z][A-Za-z \-/]{1,40}?)` +
        COMMODITY_STOP.source,
      "i",
    ),
  );
  const fromQty = qtyGoods && looksLikeCommodity(qtyGoods[1]);
  if (fromQty) {
    extracted.freight.commodity = fromQty;
    return;
  }

  if (/\b(?:ship(?:ping)?|send)\b/i.test(raw)) {
    const produce = raw.match(/\b(oranges?|peaches?|apples?|widgets?)\b/i);
    const commodity = produce && looksLikeCommodity(produce[1]);
    if (commodity) extracted.freight.commodity = commodity;
  }
}

const DUMP_QTY_LEAD =
  /^(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d[\d,]*|\$\s*\d[\d,]*)\s+)+(?:thousand\s+|hundred\s+)?/i;

function commodityFromDumpMid(mid) {
  let s = String(mid || "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(DUMP_QTY_LEAD, "");
  s = s.replace(/^(?:thousand|hundred)\s+/i, "");
  s = s.replace(/^(?:\$\s*\d[\d,]*)\s+/i, "");
  s = s.replace(
    /^(?:pounds?|lbs?|kgs?|kilograms?|kilos?|pallets?|pieces?|pcs|skids?|boxes?|crates?|cartons?)\s+(?:of\s+)?/i,
    "",
  );
  s = s.replace(/^of\s+/i, "");
  return looksLikeCommodity(s);
}

const GOODS_WORDS = new Set(["orange", "oranges", "peach", "peaches", "apple", "apples", "widget", "widgets"]);

function looksLikeCommodity(value) {
  const commodity = sanitizeCommodity(value);
  if (!commodity) return null;
  if (isKnownUsCity(commodity)) return null;
  const words = commodity.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.some((w) => GOODS_WORDS.has(w))) return commodity;
  if (
    words.every(
      (w) =>
        PLACE_STOP.has(w) ||
        PLACE_NOISE.has(w) ||
        isKnownUsCity(w) ||
        /^(pounds?|lbs?|kgs?|kilograms?|kilos?)$/.test(w),
    )
  ) {
    return null;
  }
  return commodity;
}

function sanitizeCommodity(value) {
  let s = String(value)
    .replace(/\b(please|thanks|thank you|need a quote|get a quote)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(
    /\s+\b(from|to|weighing|weight|class|on|pickup|email|liftgate|origin|destination|dest|pieces|dims).*$/i,
    "",
  ).trim();
  s = s.replace(/[,\.;:]+$/g, "").trim();
  if (s.length < 2 || s.length > 48) return null;
  if (/^\d+$/.test(s)) return null;
  if (
    /^(yes|no|ok|okay|sure|hi|hello|zip|email|tomorrow|today|pounds|lbs|class|pallets?|pieces?)$/i.test(
      s,
    )
  ) {
    return null;
  }
  return s;
}

function hasExplicitDate(raw) {
  return (
    /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(raw) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}/i.test(raw) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(raw) ||
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(raw)
  );
}

function extractDate(raw, extracted, now) {
  const n = now ? new Date(now) : new Date();
  if (/\btoday\b/i.test(raw)) {
    extracted.pickup.date = isoDate(n);
    return;
  }
  if (/\btomorrow\b/i.test(raw)) {
    extracted.pickup.date = isoDate(addDays(n, 1));
    return;
  }
  const iso = raw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isRealIsoDate(iso[1])) {
    extracted.pickup.date = iso[1];
    return;
  }
  const mdY = raw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (mdY) {
    const year = mdY[3] ? normalizeYear(mdY[3], n.getFullYear()) : n.getFullYear();
    const d = new Date(year, Number(mdY[1]) - 1, Number(mdY[2]));
    if (!Number.isNaN(d.getTime())) extracted.pickup.date = isoDate(d);
    return;
  }
  const named = raw.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?/i,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase()];
    const year = named[3] ? Number(named[3]) : n.getFullYear();
    const d = new Date(year, month, Number(named[2]));
    if (d < startOfDay(n) && !named[3]) d.setFullYear(year + 1);
    extracted.pickup.date = isoDate(d);
    return;
  }
  const afterNext = raw.match(
    /\b(?:the\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+after\s+next\b/i,
  );
  if (afterNext) {
    extracted.pickup.date = isoDate(addDays(nextWeekday(n, WEEKDAYS[afterNext[1].toLowerCase()], true), 7));
    return;
  }
  const nFromNow = raw.match(
    /\b(?:(\d+|two|three|four)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s\s+from\s+now\b/i,
  );
  if (nFromNow) {
    const countToken = nFromNow[1];
    let count = countToken ? (WORD_NUMBERS[countToken.toLowerCase()] ?? Number(countToken)) : 2;
    if (!Number.isInteger(count) || count < 1) count = 2;
    const first = nextWeekday(n, WEEKDAYS[nFromNow[2].toLowerCase()], true);
    extracted.pickup.date = isoDate(addDays(first, (count - 1) * 7));
    return;
  }
  const nextDow = raw.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (nextDow && !/\b(after\s+next|from\s+now)\b/i.test(raw)) {
    const target = WEEKDAYS[nextDow[1].toLowerCase()];
    const soonDays = daysUntilWeekday(n, target, true);
    // "next Friday" on a Thursday is tomorrow or a week from tomorrow.
    // Within two days, do not pick silently. Offer both dates.
    if (soonDays > 0 && soonDays <= 2) {
      const soon = isoDate(addDays(startOfDay(n), soonDays));
      const later = isoDate(addDays(startOfDay(n), soonDays + 7));
      extracted.flags.ambiguousDate = {
        weekday: titleCase(nextDow[1].toLowerCase()),
        soon,
        later,
      };
      return;
    }
  }
  const dow = raw.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (dow) {
    extracted.pickup.date = isoDate(nextWeekday(n, WEEKDAYS[dow[1].toLowerCase()], /next/i.test(raw)));
  }
}

function extractTime(raw, extracted) {
  const m = raw.match(/\b(?:ready(?:\s+at)?|at)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!m) return;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return;
  extracted.pickup.ready_time_local = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

const PROTECT_SYNONYM = /\b(?:please\s+)?protect(?:ed|ing)?\b/i;

/** Side words next to "inside". No side means ask, do not assume both ends. */
function insideSideWords(raw) {
  const both = /\b(?:both(?:\s+ends)?|each|either)\b/i.test(raw);
  const pick = /\b(?:pick\s*-?\s*up|pickup|origin)\b/i.test(raw);
  const deliv = /\b(?:deliver(?:y|ed)?|destination|dest)\b/i.test(raw);
  if (both || (pick && deliv)) return "both";
  if (pick) return "pickup";
  if (deliv) return "delivery";
  return null;
}

function extractAccessorials(raw, extracted, awaiting) {
  const mentionsAccessorial =
    /lift|residential|inside|limited\s+access|appointment|notify|freeze|protect(?:ed|ing)?/i.test(raw);
  const sttNone = STT_NONE_ACCESSORIALS.test(raw) || (awaiting === "accessorials" && /^\s*num\s*$/i.test(raw));
  if ((NONE_ACCESSORIALS.test(raw) || sttNone) && !mentionsAccessorial) {
    extracted.flags.accessorialsNone = true;
    extracted.pickup.accessorials = [];
    return;
  }
  const found = [];
  for (const { re, ids } of ACCESSORIAL_PATTERNS) {
    if (re.test(raw)) {
      for (const id of ids) {
        if (ACCESSORIALS.includes(id) && !found.includes(id)) found.push(id);
      }
    }
  }
  const nearEnd =
    awaiting === "accessorials" || awaiting === "email" || awaiting === "pickup_date";
  const softProtect =
    /\bplease\s+protect(?:ed|ing)?\b/i.test(raw) ||
    (nearEnd && PROTECT_SYNONYM.test(raw)) ||
    (awaiting === "accessorials" && PROTECT_SYNONYM.test(raw));
  if (softProtect && !found.includes("protect_from_freeze") && !extracted.flags.accessorialsNone) {
    found.push("protect_from_freeze");
    extracted.flags.softProtect = true;
  }
  if (/\binside\b/i.test(raw)) {
    const side = insideSideWords(raw);
    const hasInsideSide = found.includes("inside_pickup") || found.includes("inside_delivery");
    if (side === "both") {
      if (!found.includes("inside_pickup")) found.push("inside_pickup");
      if (!found.includes("inside_delivery")) found.push("inside_delivery");
    } else if (side === "pickup" && !hasInsideSide) {
      found.push("inside_pickup");
    } else if (side === "delivery" && !hasInsideSide) {
      found.push("inside_delivery");
    } else if (!hasInsideSide) {
      extracted.flags.ambiguousInside = true;
    }
  }
  const hasLiftgateSide = found.includes("liftgate_pickup") || found.includes("liftgate_delivery");
  if (/lift\s*-?\s*gates?/i.test(raw) && !hasLiftgateSide) {
    extracted.flags.ambiguousLiftgate = true;
  }
  if (found.length) extracted.pickup.accessorials = found;
}

export function extractContactEmail(text, awaiting) {
  const raw = String(text || "").trim();
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) return email[0];
  if (awaiting === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw;
  return "";
}

function extractContact(raw, extracted, awaiting) {
  const email = extractContactEmail(raw, awaiting);
  if (email) extracted.contact.email = email;
  const phone = raw.match(/\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/);
  if (phone) extracted.contact.phone = phone[0];
  const name = raw.match(/\b(?:my name is|this is|name[:\s]+)\s*([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (name) extracted.contact.name = name[1].trim();
}

function extractHazmat(raw, extracted) {
  if (/\bhaz(?:ardous)?\s*mat|\bhazmat\b/i.test(raw)) extracted.freight.hazmat = true;
  if (/\bnot hazmat\b|\bno hazmat\b/i.test(raw)) extracted.freight.hazmat = false;
}

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntilWeekday(from, target, forceNext) {
  const d = startOfDay(from);
  let add = (target - d.getDay() + 7) % 7;
  if (add === 0 && forceNext) add = 7;
  return add;
}

function nextWeekday(from, target, forceNext) {
  return addDays(startOfDay(from), daysUntilWeekday(from, target, forceNext));
}

function normalizeYear(y, fallback) {
  const n = Number(y);
  if (n < 100) return 2000 + n;
  return n || fallback;
}

function isRealIsoDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function wouldSwapLabeledCity(incomingCity, keptThis, keptOther) {
  if (!incomingCity || !keptOther) return false;
  const incoming = cityOf({ city: incomingCity });
  const other = cityOf({ city: keptOther });
  if (!incoming || !other || incoming !== other) return false;
  const self = cityOf({ city: keptThis });
  return Boolean(self && self !== incoming);
}

/**
 * Apply every extracted slot onto the sheet. Callers must not gate this by
 * `awaiting` — a hold-and-dump utterance can fill weight, commodity, and
 * cities while the session is still asking for origin_zip.
 */
export function applyExtractedSlots(sheet, extracted) {
  return mergeExtracted(sheet, extracted);
}

/** Merge extracted slots onto a sheet. ZIP-only updates never replace the place object. */
export function mergeExtracted(sheet, extracted) {
  const next = structuredClone(sheet);
  const originKeep = { city: next.lanes.origin.city, state: next.lanes.origin.state };
  const destKeep = { city: next.lanes.destination.city, state: next.lanes.destination.state };
  if (wouldSwapLabeledCity(extracted.origin?.city, originKeep.city, destKeep.city)) {
    extracted = { ...extracted, origin: { ...extracted.origin, city: undefined, state: undefined } };
  }
  if (wouldSwapLabeledCity(extracted.destination?.city, destKeep.city, originKeep.city)) {
    extracted = {
      ...extracted,
      destination: { ...extracted.destination, city: undefined, state: undefined },
    };
  }
  if (originKeep.city && extracted.origin?.city && !isKnownUsCity(extracted.origin.city)) {
    extracted = { ...extracted, origin: { ...extracted.origin, city: undefined } };
  }
  if (destKeep.city && extracted.destination?.city && !isKnownUsCity(extracted.destination.city)) {
    extracted = { ...extracted, destination: { ...extracted.destination, city: undefined } };
  }
  if (
    extracted.origin?.state &&
    destKeep.state &&
    extracted.origin.state === destKeep.state &&
    cityOf({ city: extracted.origin.city || originKeep.city }) !== cityOf({ city: destKeep.city })
  ) {
    extracted = { ...extracted, origin: { ...extracted.origin, state: undefined } };
  }
  if (
    extracted.destination?.state &&
    originKeep.state &&
    extracted.destination.state === originKeep.state &&
    cityOf({ city: extracted.destination.city || destKeep.city }) !== cityOf({ city: originKeep.city })
  ) {
    extracted = { ...extracted, destination: { ...extracted.destination, state: undefined } };
  }
  assignPlace(next.lanes.origin, extracted.origin);
  if (extracted.flags?.incompleteTo && isGarbagePlace(extracted.destination)) {
    extracted.destination = {};
  }
  if (!isGarbagePlace(extracted.destination)) {
    assignPlace(next.lanes.destination, extracted.destination);
  } else if (extracted.destination?.postal_code) {
    next.lanes.destination.postal_code = extracted.destination.postal_code;
  }
  restorePlaceIdentity(next.lanes.origin, originKeep, extracted.origin);
  restorePlaceIdentity(next.lanes.destination, destKeep, extracted.destination);
  if (isGarbagePlace(next.lanes.origin) && originKeep.city && !isGarbagePlace({ city: originKeep.city })) {
    next.lanes.origin.city = originKeep.city;
  }
  if (isGarbagePlace(next.lanes.destination) && destKeep.city && !isGarbagePlace({ city: destKeep.city })) {
    next.lanes.destination.city = destKeep.city;
  }
  const f = extracted.freight || {};
  if (Number.isInteger(f.pieces) && f.pieces >= 1) next.freight.pieces = f.pieces;
  if (f.piece_unit === "pallets" || f.piece_unit === "pieces") next.freight.piece_unit = f.piece_unit;
  if (typeof f.total_weight_lbs === "number" && f.total_weight_lbs > 0) {
    next.freight.total_weight_lbs = f.total_weight_lbs;
  }
  if (f.dims && f.dims.length_in && f.dims.width_in && f.dims.height_in) {
    next.freight.dims = { ...f.dims };
  }
  if (typeof f.freight_class === "string" && f.freight_class) {
    next.freight.freight_class = f.freight_class;
  }
  if (typeof f.commodity === "string" && f.commodity.trim()) {
    next.freight.commodity = f.commodity.trim();
  }
  if (typeof f.hazmat === "boolean") next.freight.hazmat = f.hazmat;
  if (typeof f.stackable === "boolean") next.freight.stackable = f.stackable;
  const p = extracted.pickup || {};
  if (p.date) next.pickup.date = p.date;
  if (p.ready_time_local) next.pickup.ready_time_local = p.ready_time_local;
  if (Array.isArray(p.accessorials)) {
    next.pickup.accessorials = [...new Set([...(next.pickup.accessorials || []), ...p.accessorials])];
  }
  if (extracted.flags?.accessorialsNone) next.pickup.accessorials = [];
  const c = extracted.contact || {};
  if (c.email) next.contact.email = c.email;
  if (c.phone) next.contact.phone = c.phone;
  if (c.name) next.contact.name = c.name;
  if (c.company) next.contact.company = c.company;
  return next;
}

function assignPlace(target, src) {
  if (!src) return;
  if (src.city) target.city = src.city;
  if (src.state) target.state = src.state;
  if (src.postal_code) {
    target.postal_code = src.postal_code;
    fillStateFromZip(target, src.postal_code);
  }
  if (src.country) target.country = src.country;
}

/** ZIP-only turns must not replace {city,state} with a postal_code-only place. */
function restorePlaceIdentity(target, kept, src) {
  if (!target || !kept) return;
  const incomingCity = src?.city && !isGarbagePlace({ city: src.city });
  const incomingState = Boolean(src?.state);
  if (!incomingCity && kept.city && !target.city) target.city = kept.city;
  if (!incomingState && kept.state && !target.state) target.state = kept.state;
  if (!incomingCity && kept.city && isGarbagePlace({ city: target.city }) && !isGarbagePlace({ city: kept.city })) {
    target.city = kept.city;
  }
}
