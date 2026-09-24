const INTERNATIONAL_RE =
  /\b(international|overseas|canada|canadian|mexico|mexican|europe|uk|united kingdom|england|london|paris|germany|china|ocean\s*freight|container\s*ship|air\s*freight|fcl|lcl|ocean\s*lcl|ocean\s*fcl)\b/i;

const NON_US_PLACES = [
  "toronto",
  "vancouver",
  "montreal",
  "calgary",
  "ottawa",
  "mexico city",
  "guadalajara",
  "monterrey",
  "london",
  "manchester",
  "paris",
  "berlin",
  "hamburg",
  "rotterdam",
  "shanghai",
  "shenzhen",
  "hong kong",
  "tokyo",
  "osaka",
  "seoul",
  "mumbai",
  "delhi",
  "sydney",
  "melbourne",
];

const NON_US_COUNTRY = new Set([
  "CA",
  "MX",
  "GB",
  "UK",
  "CN",
  "DE",
  "FR",
  "NL",
  "JP",
  "KR",
  "IN",
  "AU",
]);

export function detectOutOfScope(text, sheet) {
  const raw = (text || "").trim();
  if (INTERNATIONAL_RE.test(raw)) {
    return hit("Hard international / non-domestic mode is out of scope for this LTL quote MVP.");
  }
  const lower = raw.toLowerCase();
  for (const place of NON_US_PLACES) {
    if (lower.includes(place)) {
      return hit(`Lane mentions ${place}, which is treated as international. Out of scope for domestic LTL.`);
    }
  }
  const originCountry = sheet?.lanes?.origin?.country;
  const destCountry = sheet?.lanes?.destination?.country;
  if (originCountry && originCountry !== "US") {
    return hit(`Origin country ${originCountry} is out of scope for domestic LTL.`);
  }
  if (destCountry && destCountry !== "US" && NON_US_COUNTRY.has(destCountry)) {
    return hit(`Destination country ${destCountry} is out of scope for domestic LTL.`);
  }
  if (destCountry && destCountry !== "US" && destCountry !== null) {
    return hit(`Destination country ${destCountry} is out of scope for domestic LTL.`);
  }
  return { outOfScope: false, reason: null, message: null };
}

function hit(reason) {
  return {
    outOfScope: true,
    reason,
    message: `${reason} I can take a US domestic LTL lane (origin ZIP, dest ZIP, pieces, weight or dims or class, commodity, pickup date, and email). No fake rate.`,
  };
}
