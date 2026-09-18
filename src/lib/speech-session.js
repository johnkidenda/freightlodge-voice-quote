import { createHoldToTalk, speechSupported } from "./speech.js";
import { STT_PROVIDER_IDS } from "./stt-providers.js";

export function providerSupported() {
  return speechSupported();
}

export function createSpeechSession(opts = {}) {
  const talk = createHoldToTalk(opts);
  return { ...talk, provider: STT_PROVIDER_IDS.WEB_SPEECH };
}
