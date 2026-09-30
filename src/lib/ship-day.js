/** Ship-day math uses the America/Chicago calendar. No holiday table. */
export const CHICAGO_TZ = "America/Chicago";

export const SHIP_DAY_OTHER_PROMPT = "What day should we pick it up?";
export const SHIP_DAY_PAST_PROMPT = "That date has already passed. What day should we pick it up?";

export const SHIP_DAY_CHOICES = [{ label: "Yes" }, { label: "Pick another day" }];

export function shipDayConfirmPrompt(spokenDate) {
  return `I can have it picked up ${spokenDate}. Does that work?`;
}

export function chicagoDateIso(now = new Date()) {
  const when = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(when);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function isoFromUtcDate(cursor) {
  const year = cursor.getUTCFullYear();
  const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
  const day = String(cursor.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The next Mon-Fri after the Chicago calendar date of `now`.
 * Friday, Saturday, and Sunday all land on Monday. Today is never proposed.
 */
export function nextBusinessDayIso(now = new Date()) {
  const [year, month, day] = chicagoDateIso(now).split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  do {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return isoFromUtcDate(cursor);
}

export function isPastShipDate(iso, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
  return String(iso) < chicagoDateIso(now);
}

export function isShipDayYes(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "");
  return /^(yes|yeah|yep|yup|sure|ok|okay|correct|that works|works for me|sounds good)\b/.test(t);
}

export function isPickAnotherDay(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "");
  if (t === "pick another day") return true;
  if (/^(no|nope|nah)\b/.test(t)) return true;
  return /\b(another day|different day|pick another|other day)\b/.test(t);
}
