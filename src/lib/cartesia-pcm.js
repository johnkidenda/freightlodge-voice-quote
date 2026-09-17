import { CARTESIA_SAMPLE_RATE } from "./cartesia-transcript.js";

/** ~100ms of pcm_s16le mono at 16 kHz. */
export const PCM_CHUNK_SAMPLES = CARTESIA_SAMPLE_RATE / 10;

export function floatToPcm16le(float32, inputRate, outputRate = CARTESIA_SAMPLE_RATE) {
  const src = float32 || new Float32Array(0);
  const inRate = inputRate || outputRate;
  let samples;
  if (inRate === outputRate) {
    samples = src;
  } else {
    const ratio = inRate / outputRate;
    const newLen = Math.floor(src.length / ratio);
    samples = new Float32Array(newLen);
    for (let i = 0; i < newLen; i += 1) {
      const idx = i * ratio;
      const i0 = Math.floor(idx);
      const frac = idx - i0;
      const a = src[i0] || 0;
      const b = src[Math.min(i0 + 1, src.length - 1)] || a;
      samples[i] = a + (b - a) * frac;
    }
  }
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function createPcmChunker({
  inputRate,
  outputRate = CARTESIA_SAMPLE_RATE,
  chunkSamples = PCM_CHUNK_SAMPLES,
  onChunk,
} = {}) {
  let pending = new Int16Array(0);

  function append(next) {
    if (!next?.length) return;
    const merged = new Int16Array(pending.length + next.length);
    merged.set(pending);
    merged.set(next, pending.length);
    pending = merged;
    while (pending.length >= chunkSamples) {
      const slice = pending.subarray(0, chunkSamples);
      pending = pending.subarray(chunkSamples);
      onChunk?.(slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength));
    }
  }

  return {
    pushFloat(float32, rate = inputRate) {
      append(floatToPcm16le(float32, rate, outputRate));
    },
    flush() {
      if (!pending.length) return;
      const leftover = pending;
      pending = new Int16Array(0);
      onChunk?.(leftover.buffer.slice(leftover.byteOffset, leftover.byteOffset + leftover.byteLength));
    },
    pendingSamples() {
      return pending.length;
    },
  };
}

const WORKLET_SRC = `
class FreightPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this.port.postMessage(ch);
    }
    return true;
  }
}
registerProcessor("freight-pcm-capture", FreightPcmCapture);
`;

function workletBlobUrl() {
  const blob = new Blob([WORKLET_SRC], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

export function cartesiaCaptureSupported() {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof AudioContext !== "undefined"
  );
}

/**
 * getUserMedia → AudioWorklet (or ScriptProcessor) → ~100ms pcm_s16le 16 kHz frames.
 */
export async function openPcmCapture({
  onChunk,
  onError,
  getUserMedia,
  AudioContextCtor,
} = {}) {
  const gum = getUserMedia || navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!gum) throw new Error("Microphone capture is not available in this browser.");
  const Ctor = AudioContextCtor || (typeof AudioContext !== "undefined" ? AudioContext : window.webkitAudioContext);
  if (!Ctor) throw new Error("Web Audio is not available in this browser.");

  const stream = await gum.call(navigator.mediaDevices || {}, {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const ctx = new Ctor();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* user gesture may already have resumed it */
    }
  }
  const source = ctx.createMediaStreamSource(stream);
  const chunker = createPcmChunker({
    inputRate: ctx.sampleRate,
    onChunk,
  });

  let node = null;
  let workletUrl = null;
  let usingWorklet = false;

  async function tryWorklet() {
    if (!ctx.audioWorklet) return false;
    workletUrl = workletBlobUrl();
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, "freight-pcm-capture");
    node.port.onmessage = (ev) => {
      const data = ev.data;
      const floats = data instanceof Float32Array ? data : new Float32Array(data);
      chunker.pushFloat(floats, ctx.sampleRate);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
    usingWorklet = true;
    return true;
  }

  function useScriptProcessor() {
    const bufferSize = 4096;
    node = ctx.createScriptProcessor(bufferSize, 1, 1);
    node.onaudioprocess = (ev) => {
      const floats = ev.inputBuffer.getChannelData(0);
      chunker.pushFloat(floats, ctx.sampleRate);
    };
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
  }

  try {
    const ok = await tryWorklet();
    if (!ok) useScriptProcessor();
  } catch (err) {
    try {
      useScriptProcessor();
    } catch (fallbackErr) {
      onError?.(fallbackErr);
      throw fallbackErr;
    }
    if (!node) {
      onError?.(err);
      throw err;
    }
  }

  function stop() {
    try {
      chunker.flush();
    } catch {
      /* ignore */
    }
    try {
      node?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((t) => t.stop());
    if (workletUrl) {
      try {
        URL.revokeObjectURL(workletUrl);
      } catch {
        /* ignore */
      }
    }
    ctx.close?.().catch?.(() => {});
  }

  return {
    stop,
    sampleRate: ctx.sampleRate,
    usingWorklet,
    context: ctx,
  };
}
