/** Last spoken-reply timing for Send snapshot + in-app readout. */

export function ttsEngineLabel(engine) {
  return String(engine || "").toLowerCase() === "cartesia" ? "Cartesia" : "Browser";
}

export function formatTtsMs(ms) {
  if (ms == null || ms === "") return "—";
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

/** In-app chip: “Cartesia 820 ms” / “Browser 40 ms” / “—” when silent or off. */
export function formatTtsLatencyReadout({ engine, firstAudioMs, silent } = {}) {
  if (silent) return "—";
  const n = formatTtsMs(firstAudioMs);
  if (n === "—") return "—";
  return `${ttsEngineLabel(engine)} ${n} ms`;
}

export function formatTtsSnapshotLines({ engine, firstAudioMs, durationMs } = {}) {
  return [
    `Voice: ${ttsEngineLabel(engine)}`,
    `TTS first-audio ms: ${formatTtsMs(firstAudioMs)}`,
    `TTS duration ms: ${formatTtsMs(durationMs)}`,
  ];
}

let lastUtterance = emptyUtterance();

function emptyUtterance() {
  return { engine: null, firstAudioMs: null, durationMs: null };
}

export function recordLastTtsUtterance(stats = {}) {
  lastUtterance = {
    engine: stats.engine !== undefined ? stats.engine : lastUtterance.engine,
    firstAudioMs: stats.firstAudioMs !== undefined ? stats.firstAudioMs : lastUtterance.firstAudioMs,
    durationMs: stats.durationMs !== undefined ? stats.durationMs : lastUtterance.durationMs,
  };
  return { ...lastUtterance };
}

export function getLastTtsUtterance() {
  return { ...lastUtterance };
}

export function clearLastTtsUtterance() {
  lastUtterance = emptyUtterance();
  return { ...lastUtterance };
}

export function nowMs(now) {
  if (typeof now === "function") return now();
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function elapsedMs(startedAt, now) {
  return Math.max(0, nowMs(now) - startedAt);
}
