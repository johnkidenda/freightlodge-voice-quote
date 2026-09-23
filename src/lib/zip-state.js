/**
 * Compact client-side US ZIP → state lookup.
 * ZIP3 ranges (USPS prefixes) plus a few ZIP5s that sit on a state line.
 * Used only to verify / fill state — never invents a city or a ZIP.
 */

/** USPS ZIP3 prefix ranges. One line per contiguous block: `start[-end] ST`. */
export const ZIP3_RANGE_SOURCE = `
005 NY
010-027 MA
028-029 RI
030-038 NH
039-049 ME
050-054 VT
055 MA
056-059 VT
060-069 CT
070-089 NJ
100-149 NY
150-196 PA
197-199 DE
200 DC
201 VA
202-205 DC
206-212 MD
214-219 MD
220-246 VA
247-268 WV
270-289 NC
290-299 SC
300-319 GA
320-339 FL
341-349 FL
350-352 AL
354-369 AL
370-385 TN
386-397 MS
398-399 GA
400-427 KY
430-459 OH
460-479 IN
480-499 MI
500-516 IA
520-528 IA
530-532 WI
534-535 WI
537-549 WI
550-551 MN
553-567 MN
570-577 SD
580-588 ND
590-599 MT
600-620 IL
622-629 IL
630-631 MO
633-641 MO
644-658 MO
660-662 KS
664-679 KS
680-681 NE
683-693 NE
700-701 LA
703-708 LA
710-714 LA
716-729 AR
730-731 OK
733 TX
734-741 OK
743-749 OK
750-770 TX
772-799 TX
800-816 CO
820-831 WY
832-838 ID
840-847 UT
850-853 AZ
855-857 AZ
859-860 AZ
863-865 AZ
870-871 NM
873-875 NM
877-884 NM
885 TX
889-891 NV
893-895 NV
897-898 NV
900-908 CA
910-928 CA
930-961 CA
967-968 HI
970-979 OR
980-986 WA
988-994 WA
995-999 AK
`.trim();

/** ZIP5s whose state is not the ZIP3’s primary state (border / island exceptions). */
export const ZIP5_EXCEPTION_SOURCE = `
06390 NY
83414 WY
97635 CA
`.trim();

export const STATE_CODE_TO_NAME = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DC: "the District of Columbia",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

/**
 * Known freight cities with one usual state. Ambiguous names (Portland,
 * Columbus, Kansas City, Arlington, …) are omitted so we never false-mismatch.
 */
const CITY_TO_STATE = {
  akron: "OH",
  albuquerque: "NM",
  allentown: "PA",
  amarillo: "TX",
  anaheim: "CA",
  anchorage: "AK",
  "ann arbor": "MI",
  atlanta: "GA",
  austin: "TX",
  bakersfield: "CA",
  baltimore: "MD",
  "baton rouge": "LA",
  boise: "ID",
  boston: "MA",
  buffalo: "NY",
  chandler: "AZ",
  charlotte: "NC",
  chattanooga: "TN",
  chesapeake: "VA",
  chicago: "IL",
  "chula vista": "CA",
  cincinnati: "OH",
  cleveland: "OH",
  "colorado springs": "CO",
  "corpus christi": "TX",
  dallas: "TX",
  dayton: "OH",
  denver: "CO",
  "des moines": "IA",
  detroit: "MI",
  durham: "NC",
  "el paso": "TX",
  "fort lauderdale": "FL",
  "fort wayne": "IN",
  "fort worth": "TX",
  fremont: "CA",
  fresno: "CA",
  garland: "TX",
  gilbert: "AZ",
  "grand rapids": "MI",
  greensboro: "NC",
  henderson: "NV",
  hialeah: "FL",
  honolulu: "HI",
  houston: "TX",
  "huntington beach": "CA",
  indianapolis: "IN",
  irvine: "CA",
  irving: "TX",
  jacksonville: "FL",
  "jersey city": "NJ",
  knoxville: "TN",
  laredo: "TX",
  "las vegas": "NV",
  lincoln: "NE",
  "little rock": "AR",
  "long beach": "CA",
  "los angeles": "CA",
  louisville: "KY",
  lubbock: "TX",
  madison: "WI",
  memphis: "TN",
  mesa: "AZ",
  miami: "FL",
  milwaukee: "WI",
  minneapolis: "MN",
  mobile: "AL",
  modesto: "CA",
  montgomery: "AL",
  nashville: "TN",
  "new orleans": "LA",
  "new york": "NY",
  "new york city": "NY",
  norfolk: "VA",
  "north las vegas": "NV",
  oakland: "CA",
  "oklahoma city": "OK",
  omaha: "NE",
  orlando: "FL",
  "overland park": "KS",
  oxnard: "CA",
  philadelphia: "PA",
  phoenix: "AZ",
  pittsburgh: "PA",
  plano: "TX",
  providence: "RI",
  raleigh: "NC",
  reno: "NV",
  riverside: "CA",
  sacramento: "CA",
  "saint louis": "MO",
  "saint paul": "MN",
  "salt lake city": "UT",
  "san antonio": "TX",
  "san bernardino": "CA",
  "san diego": "CA",
  "san francisco": "CA",
  "san jose": "CA",
  "santa ana": "CA",
  "santa clarita": "CA",
  scottsdale: "AZ",
  seattle: "WA",
  spokane: "WA",
  "st louis": "MO",
  "st paul": "MN",
  "st petersburg": "FL",
  stockton: "CA",
  syracuse: "NY",
  tacoma: "WA",
  tampa: "FL",
  toledo: "OH",
  tucson: "AZ",
  tulsa: "OK",
  "virginia beach": "VA",
  wichita: "KS",
  "winston-salem": "NC",
  worcester: "MA",
};

function parseRangeLine(line) {
  const m = String(line || "")
    .trim()
    .match(/^(\d{3})(?:-(\d{3}))?\s+([A-Z]{2})$/);
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2] || m[1]), state: m[3] };
}

function parseExceptionLine(line) {
  const m = String(line || "")
    .trim()
    .match(/^(\d{5})\s+([A-Z]{2})$/);
  if (!m) return null;
  return { zip: m[1], state: m[2] };
}

export const ZIP3_RANGES = ZIP3_RANGE_SOURCE.split("\n")
  .map(parseRangeLine)
  .filter(Boolean);

export const ZIP5_EXCEPTIONS = Object.fromEntries(
  ZIP5_EXCEPTION_SOURCE.split("\n")
    .map(parseExceptionLine)
    .filter(Boolean)
    .map((row) => [row.zip, row.state]),
);

/** 1000-slot ZIP3 → state, built once from the range table. */
const ZIP3_STATE = new Array(1000).fill(null);
for (const { start, end, state } of ZIP3_RANGES) {
  for (let n = start; n <= end; n += 1) ZIP3_STATE[n] = state;
}

export function zipDigits(zip) {
  return String(zip || "").replace(/\D/g, "");
}

/** State for a 5-digit ZIP (or ZIP+4). Null if unknown / incomplete. */
export function stateForZip(zip) {
  const digits = zipDigits(zip);
  if (digits.length < 5) return null;
  const zip5 = digits.slice(0, 5);
  if (ZIP5_EXCEPTIONS[zip5]) return ZIP5_EXCEPTIONS[zip5];
  const prefix = Number(zip5.slice(0, 3));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 999) return null;
  return ZIP3_STATE[prefix] || null;
}

export function impliedStateForCity(city) {
  if (!city) return null;
  const key = String(city)
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
  return CITY_TO_STATE[key] || null;
}

/** Explicit sheet/spoken state, or the city’s usual state when the field is empty. */
export function placeState(place) {
  const explicit = String(place?.state || "")
    .trim()
    .toUpperCase();
  if (explicit && STATE_CODE_TO_NAME[explicit]) return explicit;
  return impliedStateForCity(place?.city);
}

export function stateDisplayName(code) {
  const key = String(code || "").trim().toUpperCase();
  return STATE_CODE_TO_NAME[key] || key || "";
}

/**
 * ZIP vs known/implied state on the SAME side only.
 * Origin ZIP vs origin city/state; dest ZIP vs dest city/state.
 * Never compare a dest ZIP to the origin place (or the reverse).
 * No place state → not a mismatch (ZIP-only).
 */
export function zipStateClarify(place, zip, role) {
  const zipState = stateForZip(zip);
  const implied = placeState(place);
  if (!zipState || !implied) return null;
  if (zipState === implied) return null;
  return {
    kind: "state",
    zip: zipDigits(zip).slice(0, 5),
    attemptedRole: role,
    zipState,
    placeState: implied,
  };
}

export function fillStateFromZip(place, zip) {
  if (!place || place.state) return place;
  const st = stateForZip(zip || place.postal_code);
  if (st) place.state = st;
  return place;
}

export const ZIP_STATE_STATS = {
  rangeLines: ZIP3_RANGES.length,
  exceptionEntries: Object.keys(ZIP5_EXCEPTIONS).length,
  sourceBytes: new TextEncoder().encode(`${ZIP3_RANGE_SOURCE}\n${ZIP5_EXCEPTION_SOURCE}`).length,
};
