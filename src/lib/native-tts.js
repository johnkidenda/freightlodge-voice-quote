const FEMALE_CS_HINT =
  /samantha|susan|victoria|karen|moira|fiona|tessa|zira|aria|jenny|sara|linda|michelle|siri|female|google us english|microsoft (zira|aria)/i;

/**
 * Prefer a clear, neutral en-US voice. When the OS lists a female /
 * customer-service-leaning one (Samantha, Zira, Aria, …), pick that.
 */
export function pickBrowserVoice(voices) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (!list.length) return null;
  const enUs = list.filter((v) => /en-US/i.test(v.lang || ""));
  const en = list.filter((v) => /^en([-_]|$)/i.test(v.lang || ""));
  const pool = enUs.length ? enUs : en.length ? en : list;
  let best = pool[0];
  let bestScore = -1;
  for (const voice of pool) {
    const name = `${voice.name || ""} ${voice.voiceURI || ""}`;
    let score = 0;
    if (FEMALE_CS_HINT.test(name)) score += 5;
    if (/en-US/i.test(voice.lang || "")) score += 2;
    if (voice.localService) score += 1;
    if (/premium|enhanced|neural|natural/i.test(name)) score += 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best || null;
}

export function getSpeechSynthesis(synth) {
  if (synth) return synth;
  if (typeof globalThis !== "undefined" && globalThis.speechSynthesis) return globalThis.speechSynthesis;
  return null;
}

export function cancelBrowserSpeech(synth) {
  const speech = getSpeechSynthesis(synth);
  if (!speech) return false;
  try {
    speech.cancel();
    return true;
  } catch {
    return false;
  }
}

/**
 * Speak with the browser Web Speech API. No cloud key.
 * Caller owns the speaking-wave hook via onStart / onEnd.
 */
export function speakBrowserReply(
  transcript,
  { synth, voices, pickVoice = pickBrowserVoice, onStart, onEnd, utteranceClass } = {},
) {
  const text = String(transcript || "").trim();
  const speech = getSpeechSynthesis(synth);
  if (!text || !speech) return false;
  cancelBrowserSpeech(speech);
  const Ctor = utteranceClass || (typeof SpeechSynthesisUtterance !== "undefined" ? SpeechSynthesisUtterance : null);
  if (!Ctor) return false;
  const utterance = new Ctor(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  const list = voices || (typeof speech.getVoices === "function" ? speech.getVoices() : []);
  const voice = pickVoice(list);
  if (voice) utterance.voice = voice;
  utterance.onstart = () => {
    try {
      onStart?.();
    } catch {
      /* UI hook */
    }
  };
  const finish = () => {
    try {
      onEnd?.();
    } catch {
      /* UI hook */
    }
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  speech.speak(utterance);
  return true;
}
