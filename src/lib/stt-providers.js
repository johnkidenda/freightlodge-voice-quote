export const STT_PROVIDER_IDS = Object.freeze({
  WEB_SPEECH: "web-speech",
});

export const STT_PROVIDERS = Object.freeze([
  { id: STT_PROVIDER_IDS.WEB_SPEECH, label: "Web Speech", short: "Web Speech" },
]);

export const STT_PROVIDER_STORAGE_KEY = "freightlodge.stt-provider";

export const STT_TOKEN_UNCONFIGURED = "STT token proxy not configured";

export function isSttProviderId(id) {
  return STT_PROVIDERS.some((p) => p.id === id);
}

export function getSttProvider(id) {
  return STT_PROVIDERS.find((p) => p.id === id) || STT_PROVIDERS[0];
}

export function isCartesiaProvider() {
  return false;
}

export function loadSttProvider() {
  return STT_PROVIDER_IDS.WEB_SPEECH;
}

export function saveSttProvider() {
  return STT_PROVIDER_IDS.WEB_SPEECH;
}

export function getSttTokenUrl(env = typeof import.meta !== "undefined" ? import.meta.env : undefined) {
  const raw = env?.VITE_STT_TOKEN_URL;
  return raw == null ? "" : String(raw).trim();
}
