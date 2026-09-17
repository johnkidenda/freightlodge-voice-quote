export const STT_PROVIDER_IDS = Object.freeze({
  WEB_SPEECH: "web-speech",
  CARTESIA_MANUAL: "cartesia-manual",
  CARTESIA_AUTO: "cartesia-auto",
});

export const STT_PROVIDERS = Object.freeze([
  { id: STT_PROVIDER_IDS.WEB_SPEECH, label: "Web Speech", short: "Web Speech" },
  { id: STT_PROVIDER_IDS.CARTESIA_MANUAL, label: "Cartesia manual", short: "Cartesia manual" },
  { id: STT_PROVIDER_IDS.CARTESIA_AUTO, label: "Cartesia auto", short: "Cartesia auto" },
]);

export const STT_PROVIDER_STORAGE_KEY = "freightlodge.stt-provider";

export const STT_TOKEN_UNCONFIGURED = "STT token proxy not configured";

export function isSttProviderId(id) {
  return STT_PROVIDERS.some((p) => p.id === id);
}

export function getSttProvider(id) {
  return STT_PROVIDERS.find((p) => p.id === id) || STT_PROVIDERS[0];
}

export function isCartesiaProvider(id) {
  return id === STT_PROVIDER_IDS.CARTESIA_MANUAL || id === STT_PROVIDER_IDS.CARTESIA_AUTO;
}

export function loadSttProvider(storage) {
  try {
    const raw = storage?.getItem?.(STT_PROVIDER_STORAGE_KEY);
    if (isSttProviderId(raw)) return raw;
  } catch {
    /* private mode / SSR */
  }
  return STT_PROVIDER_IDS.WEB_SPEECH;
}

export function saveSttProvider(id, storage) {
  if (!isSttProviderId(id)) return loadSttProvider(storage);
  try {
    storage?.setItem?.(STT_PROVIDER_STORAGE_KEY, id);
  } catch {
    /* ignore quota / private mode */
  }
  return id;
}

export function getSttTokenUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const raw = env?.VITE_STT_TOKEN_URL;
  return raw == null ? "" : String(raw).trim();
}
