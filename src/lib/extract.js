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
  {
    re: /protect(?:ed|ing)?\s+from\s+freeze|freeze\s+protect(?:ed|ing)?|freeze\b[\s\w]{0,24}\bprotect(?:ed|ing)?|\bprotect(?:ed|ing)?\b[\s\w]{0,24}\bfreeze|\bplease\s+protect(?:ed|ing)?\b/i,
    ids: ["protect_from_freeze"],
  },
  { re: /lift\s*-?\s*gates?/i, ids: ["liftgate_pickup", "liftgate_delivery"] },
  { re: /residential/i, ids: ["residential_pickup", "residential_delivery"] },
  { re: /limited\s+access/i, ids: ["limited_access_pickup", "limited_access_delivery"] },
  { re: /inside\s+(?:delivery|pickup|both)?/i, ids: ["inside_pickup", "inside_delivery"] },
];

const NONE_ACCESSORIALS =
  /\b(no(?:ne|pe)?(?:\s+extras?)?|no accessorials|that's all|thats all|nothing else|standard pickup|no lift\s*-?\s*gate)\b/i;
const STT_NONE_ACCESSORIALS = /^\s*(num|nun|non|none|nope|no)(?:\s+extras?)?\s*[.!]?\s*$/i;

const VAGUE_MEASURE =
  /\b(standard class|whatever class|any class|usual class|about a few|a few hundred|not sure|don't know|do not know|idk|guess|around there)\b/i;

const VAGUE_DATE = /\b(asap|soon|whenever|next week sometime|flexible)\b/i;

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

  return extracted;
}

const SPEECH_FILLERS = new Set(["um", "uh", "erm", "uhh", "umm", "hmm", "ah", "er"]);

/** Drop STT filler tokens so “Uh Atlanta” is just Atlanta. */
export function stripSpeechFillers(text) {
  return String(text || "")
    .replace(/\b(?:um+|uh+|erm+|uhh+|umm+|hmm+|ahh?|er)\b[,.]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PLACE_NOISE = new Set([
  "um",
  "uh",
  "erm",
  "uhh",
  "umm",
  "hmm",
  "ah",
  "er",
  "ship",
  "shipping",
  "shipper",
  "pallet",
  "pallets",
  "crate",
  "crates",
  "box",
  "boxes",
  "drum",
  "drums",
  "skid",
  "skids",
  "freight",
  "load",
  "loads",
  "send",
  "sending",
  "deliver",
  "delivery",
  "delivered",
  "pickup",
  "pick",
  "quote",
  "quoting",
  "like",
  "want",
  "need",
  "kilogram",
  "kilograms",
  "kilo",
  "kilos",
  "kg",
  "gram",
  "grams",
  "pound",
  "pounds",
  "lb",
  "lbs",
  "oranges",
  "orange",
  "peaches",
  "peach",
  "apples",
  "apple",
  "widgets",
  "widget",
  "commodity",
  "of",
  "from",
  "hunter",
  "the",
  "a",
  "an",
  "destination",
  "dest",
  "origin",
  "zip",
  "zipcode",
  "thousand",
  "hundred",
  "actually",
  "sorry",
  "wait",
  "just",
  "maybe",
  "well",
  "yeah",
  "yes",
  "yep",
  "yup",
  "okay",
  "ok",
  "so",
  "then",
  "now",
  "really",
  "right",
]);

const PLACE_STOP = new Set([
  "to",
  "through",
  "on",
  "for",
  "weighing",
  "weight",
  "class",
  "pickup",
  "pick",
  "pieces",
  "piece",
  "pallets",
  "pallet",
  "pcs",
  "skids",
  "skid",
  "boxes",
  "box",
  "crates",
  "crate",
  "cartons",
  "carton",
  "drums",
  "drum",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "email",
  "commodity",
  "freight",
  "need",
  "want",
  "with",
  "and",
  "tomorrow",
  "today",
  "yesterday",
  "liftgate",
  "residential",
  "inside",
  "appointment",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "none",
  "hazmat",
  "quote",
  "quoting",
  "please",
  "thanks",
  "ship",
  "shipping",
  "shipper",
  "send",
  "sending",
  "deliver",
  "delivery",
  "load",
  "loads",
  "like",
  "kilogram",
  "kilograms",
  "kg",
  "gram",
  "grams",
  "oranges",
  "orange",
  "peaches",
  "peach",
  "apples",
  "apple",
  "widgets",
  "widget",
  "of",
  "from",
  "hunter",
  "the",
  "a",
  "an",
  "destination",
  "dest",
  "origin",
  "zip",
  "zipcode",
  "is",
  "kilo",
  "kilos",
  "thousand",
  "hundred",
  "actually",
  "sorry",
  "wait",
  "just",
  "maybe",
  "well",
  "yeah",
  "yes",
  "yep",
  "yup",
  "okay",
  "ok",
  "so",
  "then",
  "now",
  "really",
  "right",
]);

const ZIP_PREFIX_NOISE = new Set([
  "actually",
  "sorry",
  "wait",
  "just",
  "maybe",
  "well",
  "yeah",
  "yes",
  "yep",
  "yup",
  "okay",
  "ok",
  "so",
  "then",
  "now",
  "really",
  "right",
  "hmm",
  "please",
  "thanks",
  "thank",
]);

const LEADING_FILLER = /^(need|please|want|hi|hello|quote|ship|shipping|can|we|i|get)\b/i;

/** Common US freight cities — used only to split “from Atlanta Austin”, never to invent ZIPs. */
const US_CITIES = new Set(
  [
    "akron",
    "albuquerque",
    "alexandria",
    "allentown",
    "amarillo",
    "anaheim",
    "anchorage",
    "ann arbor",
    "arlington",
    "atlanta",
    "augusta",
    "aurora",
    "austin",
    "bakersfield",
    "baltimore",
    "baton rouge",
    "boise",
    "boston",
    "buffalo",
    "chandler",
    "charleston",
    "charlotte",
    "chattanooga",
    "chesapeake",
    "chicago",
    "chula vista",
    "cincinnati",
    "cleveland",
    "colorado springs",
    "columbus",
    "corpus christi",
    "dallas",
    "dayton",
    "denver",
    "des moines",
    "detroit",
    "durham",
    "el paso",
    "fort lauderdale",
    "fort wayne",
    "fort worth",
    "fremont",
    "fresno",
    "garland",
    "gilbert",
    "glendale",
    "grand rapids",
    "greensboro",
    "henderson",
    "hialeah",
    "honolulu",
    "houston",
    "huntington beach",
    "indianapolis",
    "irvine",
    "irving",
    "jacksonville",
    "jersey city",
    "kansas city",
    "knoxville",
    "laredo",
    "las vegas",
    "lexington",
    "lincoln",
    "little rock",
    "long beach",
    "los angeles",
    "louisville",
    "lubbock",
    "madison",
    "memphis",
    "mesa",
    "miami",
    "milwaukee",
    "minneapolis",
    "mobile",
    "modesto",
    "montgomery",
    "nashville",
    "new orleans",
    "new york",
    "newark",
    "norfolk",
    "north las vegas",
    "oakland",
    "oklahoma city",
    "omaha",
    "orlando",
    "overland park",
    "oxnard",
    "philadelphia",
    "phoenix",
    "pittsburgh",
    "plano",
    "portland",
    "providence",
    "raleigh",
    "reno",
    "richmond",
    "riverside",
    "rochester",
    "sacramento",
    "saint louis",
    "saint paul",
    "salt lake city",
    "san antonio",
    "san bernardino",
    "san diego",
    "san francisco",
    "san jose",
    "santa ana",
    "santa clarita",
    "scottsdale",
    "seattle",
    "spokane",
    "st louis",
    "st paul",
    "st petersburg",
    "stockton",
    "syracuse",
    "tacoma",
    "tampa",
    "toledo",
    "tucson",
    "tulsa",
    "virginia beach",
    "washington",
    "wichita",
    "winston-salem",
    "worcester",
  ].map((s) => s.toLowerCase()),
);

export function isKnownUsCity(name) {
  if (!name) return false;
  return US_CITIES.has(String(name).trim().toLowerCase());
}

/** First-3 ZIP prefixes for obvious metro conflicts. Never invents a ZIP. */
const ZIP_PREFIX_METRO = {
  300: { city: "Atlanta", state: "GA" },
  301: { city: "Atlanta", state: "GA" },
  302: { city: "Atlanta", state: "GA" },
  303: { city: "Atlanta", state: "GA" },
  787: { city: "Austin", state: "TX" },
  786: { city: "Austin", state: "TX" },
  606: { city: "Chicago", state: "IL" },
  607: { city: "Chicago", state: "IL" },
  752: { city: "Dallas", state: "TX" },
  753: { city: "Dallas", state: "TX" },
  750: { city: "Dallas", state: "TX" },
  770: { city: "Houston", state: "TX" },
  772: { city: "Houston", state: "TX" },
  100: { city: "New York", state: "NY" },
  101: { city: "New York", state: "NY" },
  112: { city: "New York", state: "NY" },
  900: { city: "Los Angeles", state: "CA" },
  901: { city: "Los Angeles", state: "CA" },
  941: { city: "San Francisco", state: "CA" },
  850: { city: "Phoenix", state: "AZ" },
  191: { city: "Philadelphia", state: "PA" },
  981: { city: "Seattle", state: "WA" },
  802: { city: "Denver", state: "CO" },
  "021": { city: "Boston", state: "MA" },
  331: { city: "Miami", state: "FL" },
  372: { city: "Nashville", state: "TN" },
  891: { city: "Las Vegas", state: "NV" },
  282: { city: "Charlotte", state: "NC" },
};

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

/**
 * Decide whether a ZIP can attach to the awaiting side without inverting
 * a known city/state pair (Atlanta + 78721, dest TX/Austin).
 */
export function resolveZipAttachment(sheet, zip, intendedRole) {
  const metro = metroForZip(zip);
  if (!metro || !intendedRole) return { attach: intendedRole, clarify: null };
  const origin = sheet?.lanes?.origin;
  const dest = sheet?.lanes?.destination;
  const target = intendedRole === "origin" ? origin : dest;
  const other = intendedRole === "origin" ? dest : origin;
  const otherRole = intendedRole === "origin" ? "dest" : "origin";
  const targetConflict = placeConflictsWithMetro(target, metro);
  const otherMatch = placeMatchesMetro(other, metro) || placeCityMatchesMetro(other, metro);
  if (targetConflict && otherMatch) {
    return {
      attach: null,
      clarify: { zip, attemptedRole: intendedRole, suggestedRole: otherRole, metro },
    };
  }
  if (targetConflict) {
    return {
      attach: null,
      clarify: {
        zip,
        attemptedRole: intendedRole,
        suggestedRole: otherMatch ? otherRole : otherRole,
        metro,
      },
    };
  }
  return { attach: intendedRole, clarify: null };
}

export function applyZipToRole(sheet, role, zip) {
  if (!role || !zip) return sheet;
  const next = structuredClone(sheet);
  if (role === "dest") next.lanes.destination.postal_code = zip;
  if (role === "origin") next.lanes.origin.postal_code = zip;
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

function uniqueLaneZips(zipTokens) {
  const seen = [];
  for (const m of zipTokens) {
    const zip = m[1] + (m[2] || "");
    if (!seen.includes(zip)) seen.push(zip);
  }
  return seen;
}

function extractLane(raw, extracted, awaiting, sheetCities = {}) {
  const zipOnly = /^\s*\d{5}(?:-\d{4})?\s*$/.test(raw);
  const labeledLaneZip = isLabeledLaneZipPhrase(raw);

  if (!LEADING_FILLER.test(raw) && !zipOnly && !labeledLaneZip) {
    const leading = dropNoiseCityBeforeZip(takePlace(raw), sheetCities.originCity);
    if (leading?.postal_code && (leading.city || leading.state || awaiting === "origin_zip")) {
      Object.assign(extracted.origin, leading);
    }
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

  const destZipAfter = raw.match(/\b(\d{5}(?:-\d{4})?)\s+is\s+(?:the\s+)?(?:destination|dest)\b/i);
  if (destZipAfter) extracted.destination.postal_code = destZipAfter[1];
  const originZipAfter = raw.match(/\b(\d{5}(?:-\d{4})?)\s+is\s+(?:the\s+)?origin\b/i);
  if (originZipAfter) extracted.origin.postal_code = originZipAfter[1];

  const destZipLocked = Boolean(labeledDest || destZipAfter);
  const originZipLocked = Boolean(labeledOrigin || originZipAfter || fromToZips);

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

  const incomplete = detectIncompleteZip(raw, awaiting);
  if (incomplete && zipTokens.length === 0) extracted.flags.incompleteZip = incomplete;

  stripNoiseCity(extracted.origin, sheetCities.originCity);
  stripNoiseCity(extracted.destination, sheetCities.destCity);
}

function isLabeledLaneZipPhrase(raw) {
  return (
    /\b(?:origin|destination|dest)(?:\s+zip|\s+zipcode|\s+zip\s*code)/i.test(raw) ||
    /\b(?:zip|zipcode|zip\s*code)\s+is\s+\d/i.test(raw) ||
    /\b\d{3,5}(?:-\d{4})?\s+is\s+(?:the\s+)?(?:destination|dest|origin)\b/i.test(raw) ||
    /\b[a-z]+(?:\s+[a-z]+)?\s+zip(?:\s*code)?\s+is\b/i.test(raw)
  );
}

function detectIncompleteZip(raw, awaiting) {
  const destShort = raw.match(
    /\b(?:destination|dest)(?:\s+zip|\s+zipcode|\s+zip\s*code)?(?:\s+is)?[:\s]+(\d{3,4})\b/i,
  );
  if (destShort) return { digits: destShort[1], role: "dest" };
  const originShort = raw.match(
    /\b(?:origin|pickup)(?:\s+zip|\s+zipcode|\s+zip\s*code)?(?:\s+is)?[:\s]+(\d{3,4})\b/i,
  );
  if (originShort) return { digits: originShort[1], role: "origin" };
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

/**
 * “that’s the destination” / “the ZIP I just sent is the destination”
 * → move last ZIP onto dest or origin. Does not invent ZIPs.
 */
export function detectZipRoleCorrection(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "");
  if (!t.trim()) return null;
  const mentionsDest = /\b(dest|destination)\b/.test(t);
  const mentionsOrigin = /\borigin\b/.test(t);
  const refersToPrior =
    /\b(that|thats|that is|the zip|zip code|i just sent|just sent|just gave)\b/.test(t);
  if (mentionsDest && refersToPrior && !mentionsOrigin) return "dest";
  if (mentionsDest && /\b(that zip|destination zip|thats dest|that is dest)\b/.test(t) && !mentionsOrigin) {
    return "dest";
  }
  if (mentionsOrigin && refersToPrior && !mentionsDest) return "origin";
  return null;
}

export function applyZipRoleCorrection(sheet, role, zip) {
  if (!role || !zip || !/^\d{5}(?:-\d{4})?$/.test(zip)) return sheet;
  const next = structuredClone(sheet);
  if (role === "dest") {
    next.lanes.destination.postal_code = zip;
    if (next.lanes.origin.postal_code === zip) {
      next.lanes.origin.postal_code = null;
    }
  } else if (role === "origin") {
    next.lanes.origin.postal_code = zip;
    if (next.lanes.destination.postal_code === zip) {
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
    const twoWord = nextBare ? normalizeState(`${bare} ${nextBare}`) : null;
    if (twoWord) {
      state = twoWord;
      i += 1;
      continue;
    }

    const st = normalizeState(bare);
    if (st) {
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
  const city = cleanCity(cityWords.join(" "));
  if (city) place.city = city;
  return Object.keys(place).length ? place : null;
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
  /\s*(?:,|$|\b(?:from|to|weighing|weight|class|pickup|email|liftgate|residential|none|tomorrow|today)\b)/i;

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
  s = s.replace(/\s+\b(from|to|weighing|class|on|pickup|email|liftgate).*$/i, "").trim();
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
