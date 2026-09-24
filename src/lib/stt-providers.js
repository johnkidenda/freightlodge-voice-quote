/** Mic capture is browser Web Speech only. */

export const STT_PROVIDER_IDS = Object.freeze({
  WEB_SPEECH: "web-speech",
});

export const STT_PROVIDERS = Object.freeze([
  { id: STT_PROVIDER_IDS.WEB_SPEECH, label: "Web Speech", short: "Web Speech" },
]);

export const STT_PROVIDER_STORAGE_KEY = "freightlodge.stt-provider";

export function isSttProviderId(id) {
  return STT_PROVIDERS.some((p) => p.id === id);
}

export function getSttProvider(id) {
  return STT_PROVIDERS.find((p) => p.id === id) || STT_PROVIDERS[0];
}

export function loadSttProvider() {
  return STT_PROVIDER_IDS.WEB_SPEECH;
}

export function saveSttProvider() {
  return STT_PROVIDER_IDS.WEB_SPEECH;
}
