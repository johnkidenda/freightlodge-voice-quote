/**
 * App version is 0.XX where XX is the count of merged change-sets
 * (including the ship that wrote VERSION). Source of truth: /VERSION
 * at build time. Never invent a rate or ZIP here.
 */

export const APP_VERSION_PREFIX = "v";

function readDefined(name, fallback) {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env[name]) {
      return String(import.meta.env[name]).trim();
    }
  } catch {
    /* node tests */
  }
  return fallback;
}

export function getAppVersion() {
  return readDefined("VITE_APP_VERSION", "0.29") || "0.29";
}

export function getAppCommit() {
  return readDefined("VITE_APP_COMMIT", "dev") || "dev";
}

export function formatAppVersionLabel(version = getAppVersion()) {
  const raw = String(version || "").trim().replace(/^v/i, "");
  return `${APP_VERSION_PREFIX}${raw}`;
}

export function formatAppVersionTitle(version = getAppVersion(), commit = getAppCommit()) {
  const label = formatAppVersionLabel(version);
  const hash = String(commit || "").trim();
  return hash && hash !== "dev" ? `${label} (${hash})` : label;
}
