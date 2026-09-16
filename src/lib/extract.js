import { ACCESSORIALS } from "./sheet.js";

const STATE_NAME_TO_CODE = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
};

const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

const NMFC_CLASSES = new Set([
  "50",
  "55",
  "60",
  "65",
  "70",
  "77.5",
  "85",
  "92.5",
  "100",
  "110",
  "125",
  "150",
  "175",
  "200",
  "250",
  "300",
  "400",
  "500",
]);

const WORD_NUMBERS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const ACCESSORIAL_PATTERNS = [
  { re: /lift\s*-?\s*gates?\s+(?:at\s+)?pick/i, ids: ["liftgate_pickup"] },
  { re: /lift\s*-?\s*gates?\s+(?:at\s+)?deliv/i, ids: ["liftgate_delivery"] },
  { re: /inside\s+pick/i, ids: ["inside_pickup"] },
  { re: /inside\s+deliv/i, ids: ["inside_delivery"] },
  { re: /residential\s+pick/i, ids: ["residential_pickup"] },
  { re: /residential\s+deliv/i, ids: ["residential_delivery"] },
  { re: /limited\s+access\s+pick/i, ids: ["limited_access_pickup"] },
  { re: /limited\s+access\s+deliv/i, ids: ["limited_access_delivery"] },
  { re: /appointment/i, ids: ["appointment_delivery"] },
  { re: /notify/i, ids: ["notify_before_delivery"] },
  { re: /protect\s+from\s+freeze|freeze\s+protect/i, ids: ["protect_from_freeze"] },
  { re: /lift\s*-?\s*gates?/i, ids: ["liftgate_pickup", "liftgate_delivery"] },
  { re: /residential/i, ids: ["residential_pickup", "residential_delivery"] },
  { re: /limited\s+access/i, ids: ["limited_access_pickup", "limited_access_delivery"] },
  { re: /inside\s+(?:delivery|pickup|both)?/i, ids: ["inside_pickup", "inside_delivery"] },
];

const NONE_ACCESSORIALS =
  /\b(no(?:ne|pe)?(?:\s+extras?)?|no accessorials|that's all|thats all|nothing else|standard pickup|no lift\s*-?\s*gate)\b/i;

const VAGUE_MEASURE =
  /\b(standard class|whatever class|any class|usual class|about a few|a few hundred|not sure|don't know|do not know|idk|guess|around there)\b/i;

const VAGUE_DATE = /\b(asap|soon|whenever|next week sometime|flexible)\b/i;

/**
 * Extract only values the speaker stated. Never city→ZIP, commodity→class,
 * or vague measures. Callers must leave nulls alone when a field is absent.
 */
export function extractSlots(text, { now, awaiting } = {}) {
  const raw = (text || "").trim();
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
      invented: [],
    },
  };
  if (!raw) return extracted;

  extractLane(raw, extracted, awaiting);
  extractPieces(raw, extracted, awaiting);
  extractWeight(raw, extracted);
  extractDims(raw, extracted);
  extractClass(raw, extracted);
  extractCommodity(raw, extracted, awaiting);
  extractDate(raw, extracted, now);
  extractTime(raw, extracted);
  extractAccessorials(raw, extracted);
  extractContact(raw, extracted, awaiting);
  extractHazmat(raw, extracted);

  return extracted;
}

function extractLane(raw, extracted, awaiting) {
  const leading = raw.match(
    /^([A-Za-z .']+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)/,
  );
  if (leading && normalizeState(leading[2])) {
    extracted.origin.city = titleCase(leading[1].trim());
    extracted.origin.state = normalizeState(leading[2]);
    extracted.origin.postal_code = leading[3];
  }

  const fromToZips = raw.match(
    /\bfrom\s+(\d{5}(?:-\d{4})?)\s+(?:to|through)\s+(\d{5}(?:-\d{4})?)\b/i,
  );
  if (fromToZips) {
    extracted.origin.postal_code = fromToZips[1];
    extracted.destination.postal_code = fromToZips[2];
  }

  const labeledOrigin = raw.match(
    /\b(?:origin|pickup|pick\s*up|ship\s+from)(?:\s+zip|\s+zipcode|\s+zip\s*code)?(?:\s+is)?[:\s]+(\d{5}(?:-\d{4})?)/i,
  );
  if (labeledOrigin) extracted.origin.postal_code = labeledOrigin[1];

  const labeledDest = raw.match(
    /\b(?:destination|dest|deliver(?:y|ed)?\s+to|ship\s+to)(?:\s+zip|\s+zipcode|\s+zip\s*code)?(?:\s+is)?[:\s]+(\d{5}(?:-\d{4})?)/i,
  );
  if (labeledDest) extracted.destination.postal_code = labeledDest[1];

  const fromPlace = matchPlaceAfter(raw, /\bfrom\s+/i);
  if (fromPlace) Object.assign(extracted.origin, fromPlace);

  const toPlace = matchPlaceAfter(raw, /\b(?:to|through)\s+/i);
  if (toPlace) Object.assign(extracted.destination, toPlace);

  const zipTokens = [...raw.matchAll(/\b(\d{5})(-\d{4})?\b/g)].filter((m) => !inWeightContext(raw, m.index));

  if (!extracted.origin.postal_code && !extracted.destination.postal_code) {
    if (zipTokens.length >= 2) {
      extracted.origin.postal_code = zipTokens[0][1] + (zipTokens[0][2] || "");
      extracted.destination.postal_code = zipTokens[1][1] + (zipTokens[1][2] || "");
    } else if (zipTokens.length === 1) {
      const zip = zipTokens[0][1] + (zipTokens[0][2] || "");
      if (awaiting === "origin_zip") extracted.origin.postal_code = zip;
      else if (awaiting === "dest_zip") extracted.destination.postal_code = zip;
      else if (/\borigin\b|\bpickup\b|\bfrom\b/i.test(raw)) extracted.origin.postal_code = zip;
      else if (/\bdest|\bdeliver|\bto\b/i.test(raw)) extracted.destination.postal_code = zip;
    }
  } else if (zipTokens.length === 1) {
    const zip = zipTokens[0][1] + (zipTokens[0][2] || "");
    if (!extracted.origin.postal_code && awaiting === "origin_zip") {
      extracted.origin.postal_code = zip;
    }
    if (!extracted.destination.postal_code && awaiting === "dest_zip") {
      extracted.destination.postal_code = zip;
    }
  }
}

function matchPlaceAfter(raw, prefixRe) {
  const start = raw.search(prefixRe);
  if (start < 0) return null;
  const after = raw.slice(start).replace(prefixRe, "");
  const stop = after.search(/\b(to|through|on|for|weighing|weight|class|pickup|pieces?|pallets?)\b/i);
  const chunk = (stop >= 0 ? after.slice(0, stop) : after).trim();
  const zipMatch = chunk.match(/(\d{5}(?:-\d{4})?)/);
  const stateMatch =
    chunk.match(/,\s*([A-Za-z]{2})\b/) ||
    chunk.match(/\b([A-Za-z]{2})\s+\d{5}/) ||
    matchStateName(chunk);
  const cityMatch = chunk
    .replace(/(\d{5}(?:-\d{4})?)/, "")
    .replace(/\b[A-Za-z]{2}\b/, (abbr) => (STATE_CODES.has(abbr.toUpperCase()) ? "" : abbr))
    .replace(/,+/g, " ")
    .trim();

  const place = {};
  if (zipMatch && !inWeightContext(raw, raw.indexOf(zipMatch[1]))) {
    place.postal_code = zipMatch[1];
  }
  if (stateMatch) {
    const code = normalizeState(stateMatch[1] || stateMatch.state);
    if (code) place.state = code;
  }
  const city = cleanCity(cityMatch);
  if (city) place.city = city;
  return Object.keys(place).length ? place : null;
}

function matchStateName(chunk) {
  const lower = chunk.toLowerCase();
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE)) {
    if (lower.includes(name)) return { 1: code, state: code };
  }
  return null;
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
  if (/^(from|to|the|a|an)$/i.test(cleaned)) return null;
  return titleCase(cleaned);
}

function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function inWeightContext(raw, index) {
  if (index == null || index < 0) return false;
  const window = raw.slice(index, index + 18);
  return /^\d[\d,.]*(?:\s*(?:lbs?|pounds?|lb\.))/i.test(window);
}

function extractPieces(raw, extracted, awaiting) {
  const unit = raw.match(
    /\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a|an)\s+(pallets?|pieces?|pcs|skids?|boxes?|crates?|cartons?|handling units?)\b/i,
  );
  if (unit) {
    extracted.freight.pieces = parseCount(unit[1]);
    return;
  }
  const labeled = raw.match(/\b(?:pieces?|handling units?|qty|quantity)(?:\s+is|\s*[:=])?\s*(\d{1,4})\b/i);
  if (labeled) {
    extracted.freight.pieces = Number(labeled[1]);
    return;
  }
  if (awaiting === "pieces") {
    const lone = raw.match(/^\s*(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i);
    if (lone) extracted.freight.pieces = parseCount(lone[1]);
  }
}

function parseCount(token) {
  const lower = String(token).toLowerCase();
  if (WORD_NUMBERS[lower] != null) return WORD_NUMBERS[lower];
  const n = Number(token);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function extractWeight(raw, extracted) {
  const m = raw.match(/\b(\d{1,6}(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i);
  if (!m) return;
  const n = Number(m[1]);
  if (Number.isFinite(n) && n > 0) extracted.freight.total_weight_lbs = n;
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

function extractCommodity(raw, extracted, awaiting) {
  const labeled = raw.match(
    /\b(?:commodity|product|freight|goods|shipping|it's|its|of)\s+(?:is\s+)?([a-z0-9][a-z0-9 \-/]{1,48})/i,
  );
  if (labeled) {
    const commodity = sanitizeCommodity(labeled[1]);
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
}

function sanitizeCommodity(value) {
  let s = String(value)
    .replace(/\b(please|thanks|thank you|need a quote|get a quote)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\s+\b(from|to|weighing|class|on|pickup).*$/i, "").trim();
  if (s.length < 2 || s.length > 48) return null;
  if (/^\d+$/.test(s)) return null;
  if (
    /^(yes|no|ok|okay|sure|hi|hello|zip|email|tomorrow|today|pounds|lbs|class)$/i.test(s)
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

function extractAccessorials(raw, extracted) {
  const mentionsAccessorial =
    /lift|residential|inside|limited\s+access|appointment|notify|freeze/i.test(raw);
  if (NONE_ACCESSORIALS.test(raw) && !mentionsAccessorial) {
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
  if (found.length) extracted.pickup.accessorials = found;
}

function extractContact(raw, extracted, awaiting) {
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) extracted.contact.email = email[0];
  const phone = raw.match(/\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/);
  if (phone) extracted.contact.phone = phone[0];
  const name = raw.match(/\b(?:my name is|this is|name[:\s]+)\s*([A-Za-z][A-Za-z .'-]{1,40})/i);
  if (name) extracted.contact.name = name[1].trim();
  if (!extracted.contact.email && awaiting === "email") {
    const maybe = raw.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(maybe)) extracted.contact.email = maybe;
  }
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

function nextWeekday(from, target, forceNext) {
  const d = startOfDay(from);
  let add = (target - d.getDay() + 7) % 7;
  if (add === 0) add = forceNext ? 7 : 0;
  if (forceNext && add === 0) add = 7;
  return addDays(d, add);
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

/** Merge extracted slots onto a sheet. Null / missing extract fields are left unchanged. */
export function mergeExtracted(sheet, extracted) {
  const next = structuredClone(sheet);
  assignPlace(next.lanes.origin, extracted.origin);
  assignPlace(next.lanes.destination, extracted.destination);
  const f = extracted.freight || {};
  if (Number.isInteger(f.pieces) && f.pieces >= 1) next.freight.pieces = f.pieces;
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
  if (src.postal_code) target.postal_code = src.postal_code;
  if (src.country) target.country = src.country;
}
