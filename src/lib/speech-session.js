import { createHoldToTalk, speechSupported } from "./speech.js";
import { createCartesiaHoldToTalk } from "./cartesia-stt.js";
import { cartesiaCaptureSupported } from "./cartesia-pcm.js";
import {
  STT_PROVIDER_IDS,
  getSttProvider,
  isCartesiaProvider,
} from "./stt-providers.js";

export function providerSupported(providerId) {
  if (isCartesiaProvider(providerId)) return cartesiaCaptureSupported();
  return speechSupported();
}

export function createSpeechSession({
  provider = STT_PROVIDER_IDS.WEB_SPEECH,
  ...opts
} = {}) {
  const id = getSttProvider(provider).id;
  if (id === STT_PROVIDER_IDS.CARTESIA_AUTO) {
    return createCartesiaHoldToTalk({ variant: "auto", ...opts });
  }
  if (id === STT_PROVIDER_IDS.CARTESIA_MANUAL) {
    return createCartesiaHoldToTalk({ variant: "manual", ...opts });
  }
  const talk = createHoldToTalk(opts);
  return { ...talk, provider: STT_PROVIDER_IDS.WEB_SPEECH };
}
