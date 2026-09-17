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

/** Copy a pcm_s16le view into a standalone ArrayBuffer for ws.send (binary). */
export function toPcmBinaryFrame(data) {
  if (data instanceof ArrayBuffer) return data.slice(0);
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
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
      onChunk?.(toPcmBinaryFrame(slice));
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
      onChunk?.(toPcmBinaryFrame(leftover));
    },
    pendingSamples() {
      return pending.length;
    },
  };
}

/**
 * Copy the process() input — that buffer is reused. Transfer the copy so the
 * main thread always sees real samples, not a later silent overwrite.
 */
export const WORKLET_SRC = `
class FreightPcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      const copy = new Float32Array(ch.length);
      copy.set(ch);
      this.port.postMessage(copy, [copy.buffer]);
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
 * AudioContext is created/resumed first so the hold gesture can unlock Web Audio on iOS.
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

  const ctx = new Ctor();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* try again after the stream is live */
    }
  }

  const stream = await gum.call(navigator.mediaDevices || {}, {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("Microphone is locked. Tap hold-to-talk again to unlock audio.");
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
  let sink = null;
  let keepAlive = null;

  function attachGraph(processor) {
    // MediaStreamDestination + a near-silent tap keep the node in the render
    // graph. gain=0 → destination is optimized away on some mobile browsers.
    sink = ctx.createMediaStreamDestination();
    keepAlive = ctx.createGain();
    keepAlive.gain.value = 0.0001;
    source.connect(processor);
    processor.connect(sink);
    processor.connect(keepAlive);
    keepAlive.connect(ctx.destination);
  }

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
    attachGraph(node);
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
    attachGraph(node);
  }

  try {
    const ok = await tryWorklet();
    if (!ok) useScriptProcessor();
  } catch (err) {
    try {
      useScriptProcessor();
    } catch (fallbackErr) {
      stream.getTracks().forEach((t) => t.stop());
      onError?.(fallbackErr);
      throw fallbackErr;
    }
    if (!node) {
      stream.getTracks().forEach((t) => t.stop());
      onError?.(err);
      throw err;
    }
  }

  function flush() {
    try {
      chunker.flush();
    } catch {
      /* ignore */
    }
  }

  function stop() {
    flush();
    try {
      node?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      keepAlive?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      sink?.disconnect();
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
    flush,
    sampleRate: ctx.sampleRate,
    usingWorklet,
    context: ctx,
  };
}
