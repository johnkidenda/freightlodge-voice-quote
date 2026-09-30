import { WORD_NUMBERS } from "./place-lexicon.js";

/** Inclusive inches. Outside this range we ask again. */
export const PALLET_SIZE_MIN = 1;
export const PALLET_SIZE_MAX = 120;

export const PALLET_SIZE_PROMPT = "What size are the pallets?";
export const PALLET_CUSTOM_PROMPT = "What are the length, width, and height in inches?";
export const PALLET_LENGTH_PROMPT = "What's the length in inches?";
export const PALLET_WIDTH_PROMPT = "What's the width in inches?";
export const PALLET_HEIGHT_PROMPT = "What's the height in inches?";

export function palletSizeRangePrompt() {
  return `Those dimensions should each be from ${PALLET_SIZE_MIN} to ${PALLET_SIZE_MAX} inches. ${PALLET_CUSTOM_PROMPT}`;
}

export const PALLET_PRESETS = [
  { label: "48x40x48", l: 48, w: 40, h: 48, source: "button_48x40x48", choice: "48x40x48" },
  { label: "48x48x48", l: 48, w: 48, h: 48, source: "button_48x48x48", choice: "48x48x48" },
];

export const PALLET_SIZE_CHOICES = [
  { label: "48x40x48" },
  { label: "48x48x48" },
  { label: "Custom" },
];

export function choiceForDims(l, w, h) {
  if (l === 48 && w === 40 && h === 48) return "48x40x48";
  if (l === 48 && w === 48 && h === 48) return "48x48x48";
  return "custom";
}

/**
 * Additive dims. length_in / width_in / height_in stay so older readers
 * still see a measure. choice records which size was used.
 */
export function palletDimsRecord({ l, w, h, source, choice }) {
  return {
    l,
    w,
    h,
    unit: "in",
    source,
    choice: choice || choiceForDims(l, w, h),
    length_in: l,
    width_in: w,
    height_in: h,
    per_piece: true,
  };
}

function displayNum(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

/** "48 x 40 x 48 in". Empty when dims are missing. */
export function formatPalletSize(dims) {
  if (!dims || typeof dims !== "object") return "";
  const l = dims.l ?? dims.length_in;
  const w = dims.w ?? dims.width_in;
  const h = dims.h ?? dims.height_in;
  if (![l, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) return "";
  return `${displayNum(l)} x ${displayNum(w)} x ${displayNum(h)} in`;
}

export function formatPalletSizeLine(dims) {
  const size = formatPalletSize(dims);
  return size ? `Pallet size: ${size}` : "";
}

function inRange(n) {
  return Number.isInteger(n) && n >= PALLET_SIZE_MIN && n <= PALLET_SIZE_MAX;
}

export function hasPalletSize(dims) {
  if (!dims || typeof dims !== "object") return false;
  const l = dims.l ?? dims.length_in;
  const w = dims.w ?? dims.width_in;
  const h = dims.h ?? dims.height_in;
  return [l, w, h].every(inRange);
}

export function needsPalletSize(sheet) {
  return sheet?.freight?.piece_unit === "pallets" && !hasPalletSize(sheet?.freight?.dims);
}

/** Stamp spoken LxWxH onto the additive dims shape. Null when out of range. */
export function normalizeSpokenDims(dims, { source = "voice" } = {}) {
  if (!dims || typeof dims !== "object") return null;
  if (dims.choice && dims.source && hasPalletSize(dims)) return dims;
  const l = dims.l ?? dims.length_in;
  const w = dims.w ?? dims.width_in;
  const h = dims.h ?? dims.height_in;
  if (![l, w, h].every(inRange)) return null;
  return palletDimsRecord({
    l,
    w,
    h,
    source: dims.source || source,
    choice: dims.choice || choiceForDims(l, w, h),
  });
}

function normalizeUtterance(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .trim();
}

function parseInchNumber(phrase) {
  let s = String(phrase || "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/\b(inches|inch|in)\b/g, "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^\d{1,3}$/.test(s)) return Number(s);
  const hundred = s.match(
    /^(?:(a|an|one|two|three|four|five|six|seven|eight|nine)\s+)?hundred(?:\s+(?:and\s+)?(.+))?$/,
  );
  if (hundred) {
    const base = hundred[1] ? WORD_NUMBERS[hundred[1]] * 100 : 100;
    if (!hundred[2]) return base;
    const rest = parseInchNumber(hundred[2]);
    if (rest == null || rest >= 100) return null;
    return base + rest;
  }
  if (WORD_NUMBERS[s] != null) return WORD_NUMBERS[s];
  const parts = s.split(" ");
  if (
    parts.length === 2 &&
    WORD_NUMBERS[parts[0]] >= 20 &&
    WORD_NUMBERS[parts[0]] % 10 === 0 &&
    WORD_NUMBERS[parts[1]] >= 1 &&
    WORD_NUMBERS[parts[1]] <= 9
  ) {
    return WORD_NUMBERS[parts[0]] + WORD_NUMBERS[parts[1]];
  }
  return null;
}

function parseDimList(text) {
  const parts = String(text || "")
    .split(/\s*(?:x|by|,)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const nums = [];
  for (const part of parts) {
    const n = parseInchNumber(part);
    if (n == null) return null;
    nums.push(n);
  }
  return nums;
}

function presetVoice(preset) {
  return { l: preset.l, w: preset.w, h: preset.h, source: "voice", choice: preset.choice };
}

/**
 * Read a pallet-size answer.
 * kind: dims | custom | partial | invalid | unrecognized
 */
export function interpretPalletSize(raw, { phase = null } = {}) {
  const t = normalizeUtterance(raw);
  if (!t) return { kind: "unrecognized" };

  if (/^(?:the\s+)?first(?:\s+one)?$/.test(t) || /^(?:option|number|choice)\s*(?:1|one)$/.test(t)) {
    return { kind: "dims", ...presetVoice(PALLET_PRESETS[0]) };
  }
  if (/^(?:the\s+)?second(?:\s+one)?$/.test(t) || /^(?:option|number|choice)\s*(?:2|two)$/.test(t)) {
    return { kind: "dims", ...presetVoice(PALLET_PRESETS[1]) };
  }

  const customOnly =
    /^(?:custom|something else|other size|different size)$/.test(t) ||
    (/\bcustom\b/.test(t) && parseDimList(t.replace(/\bcustom\b/g, " ")) == null);
  if (customOnly && !/\d/.test(t)) {
    const stripped = t.replace(/\bcustom\b/g, " ").replace(/\s+/g, " ").trim();
    if (!stripped || /^(?:something else|other size|different size)$/.test(t)) {
      return { kind: "custom" };
    }
  }

  if (/^(?:custom|something else|other size|different size)\b/.test(t)) {
    const rest = t
      .replace(/^(?:custom|something else|other size|different size)\b/, "")
      .replace(/^[\s,:-]+/, "")
      .trim();
    if (!rest) return { kind: "custom" };
    const listed = parseDimList(rest);
    if (!listed) return { kind: "invalid" };
    return dimsOrPartial(listed, { source: "custom", choice: "custom", phase: "custom" });
  }

  const compact = t.replace(/\s+/g, "").replace(/\binches?\b|\bin\b/g, "");
  if (compact === "48x40x48") {
    return { kind: "dims", l: 48, w: 40, h: 48, source: "button_48x40x48", choice: "48x40x48" };
  }
  if (compact === "48x48x48") {
    return { kind: "dims", l: 48, w: 48, h: 48, source: "button_48x48x48", choice: "48x48x48" };
  }

  const hasJoin = /\b(?:by|x)\b/.test(t) || (t.match(/x/g) || []).length >= 2;
  const listed = hasJoin || phase === "custom" ? parseDimList(t) : null;
  if (listed) {
    const source = phase === "custom" ? "custom" : "voice";
    const choice = phase === "custom" ? "custom" : null;
    return dimsOrPartial(listed, { source, choice, phase });
  }

  if (phase === "custom") {
    const one = parseInchNumber(t);
    if (one == null) return { kind: "invalid" };
    return dimsOrPartial([one], { source: "custom", choice: "custom", phase: "custom" });
  }

  return { kind: "unrecognized" };
}

function dimsOrPartial(listed, { source, choice, phase }) {
  if (!listed.length || listed.length > 3) return { kind: "invalid" };
  if (!listed.every(inRange)) return { kind: "invalid" };
  if (listed.length === 3) {
    const [l, w, h] = listed;
    return {
      kind: "dims",
      l,
      w,
      h,
      source,
      choice: choice || choiceForDims(l, w, h),
    };
  }
  if (phase === "custom" || listed.length === 2) {
    return { kind: "partial", values: listed, source, choice: choice || "custom" };
  }
  return { kind: "unrecognized" };
}

export function advancePalletDraft(draft, values) {
  const next = {
    l: draft?.l ?? null,
    w: draft?.w ?? null,
    h: draft?.h ?? null,
    source: draft?.source || null,
    choice: draft?.choice || null,
  };
  const queue = [...values];
  if (next.l == null && queue.length) next.l = queue.shift();
  if (next.w == null && queue.length) next.w = queue.shift();
  if (next.h == null && queue.length) next.h = queue.shift();
  if (queue.length) return { error: true, draft: next };
  if (next.l != null && next.w != null && next.h != null) return { done: next };
  return { draft: next };
}

export function promptForPalletDraft(draft) {
  if (draft?.l == null) return PALLET_CUSTOM_PROMPT;
  if (draft?.w == null) return PALLET_WIDTH_PROMPT;
  if (draft?.h == null) return PALLET_HEIGHT_PROMPT;
  return PALLET_CUSTOM_PROMPT;
}

export function resolvePalletSizeTurn(session, interpreted) {
  if (interpreted.kind === "custom") {
    return {
      done: false,
      draft: { l: null, w: null, h: null, source: "custom", choice: "custom" },
      reply: PALLET_CUSTOM_PROMPT,
      phase: "custom",
    };
  }
  if (interpreted.kind === "invalid") {
    const custom = session?.palletSizePhase === "custom";
    return {
      done: false,
      draft: custom ? session.palletDraft || null : null,
      reply: palletSizeRangePrompt(),
      phase: custom ? "custom" : null,
    };
  }
  if (interpreted.kind === "dims") {
    return { done: true, dims: palletDimsRecord(interpreted), phase: null, draft: null };
  }
  if (interpreted.kind === "partial") {
    const source = session?.palletDraft?.source || interpreted.source || "custom";
    const advanced = advancePalletDraft(
      {
        ...(session?.palletDraft || {}),
        source,
        choice: source === "voice" ? "custom" : interpreted.choice || session?.palletDraft?.choice || "custom",
      },
      interpreted.values,
    );
    if (advanced.error) {
      return {
        done: false,
        draft: session?.palletDraft || null,
        reply: palletSizeRangePrompt(),
        phase: "custom",
      };
    }
    if (advanced.done) {
      const choice = source === "custom" ? "custom" : choiceForDims(advanced.done.l, advanced.done.w, advanced.done.h);
      return {
        done: true,
        dims: palletDimsRecord({
          l: advanced.done.l,
          w: advanced.done.w,
          h: advanced.done.h,
          source,
          choice,
        }),
        phase: null,
        draft: null,
      };
    }
    return {
      done: false,
      draft: advanced.draft,
      reply: promptForPalletDraft(advanced.draft),
      phase: "custom",
    };
  }
  return { done: false, draft: session?.palletDraft || null, reply: PALLET_SIZE_PROMPT, phase: session?.palletSizePhase || null };
}
