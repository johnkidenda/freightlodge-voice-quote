import { RELEASE_TAIL_MS, preferTapToTalk } from "./speech.js";
import { fetchSttAccessToken } from "./stt-token.js";
import { cartesiaCaptureSupported, openPcmCapture, toPcmBinaryFrame } from "./cartesia-pcm.js";
import {
  buildCartesiaWsUrl,
  createAutoTurnAssembler,
  createManualAssembler,
  parseCartesiaMessage,
} from "./cartesia-transcript.js";

const FINALIZE_WAIT_MS = 2500;

export const EMPTY_TRANSCRIPT_ERROR = "Cartesia returned an empty transcript. Try again or type instead.";
export const NO_AUDIO_ERROR = "Microphone produced no audio. Check the mic and try again.";
export const SOCKET_OPEN_ERROR = "Cartesia STT socket failed to open.";
export const SOCKET_CLOSED_ERROR = "Cartesia STT socket closed unexpectedly.";

function defaultSchedule(fn, ms) {
  return setTimeout(fn, ms);
}

function defaultUnschedule(id) {
  clearTimeout(id);
}

function waitSocketOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === 1) {
      resolve();
      return;
    }
    if (ws.readyState === 2 || ws.readyState === 3) {
      reject(new Error(SOCKET_OPEN_ERROR));
      return;
    }
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(SOCKET_OPEN_ERROR));
    };
    const onClose = () => {
      cleanup();
      reject(new Error(SOCKET_OPEN_ERROR));
    };
    function cleanup() {
      ws.removeEventListener?.("open", onOpen);
      ws.removeEventListener?.("error", onError);
      ws.removeEventListener?.("close", onClose);
    }
    ws.addEventListener?.("open", onOpen);
    ws.addEventListener?.("error", onError);
    ws.addEventListener?.("close", onClose);
  });
}

function safeSend(ws, data) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(data);
    return true;
  } catch {
    return false;
  }
}

function socketErrorMessage(ev) {
  if (ev?.type === "error" && ev.message) return ev.message;
  if (typeof ev?.error === "string") return ev.error;
  if (typeof ev?.message === "string" && ev.message) return ev.message;
  return "Cartesia STT error";
}

export function createCartesiaHoldToTalk({
  variant = "manual",
  onPreview,
  onCommit,
  onError,
  onStart,
  onEnd,
  onTailStart,
  tailMs = RELEASE_TAIL_MS,
  finalizeWaitMs = FINALIZE_WAIT_MS,
  schedule = defaultSchedule,
  unschedule = defaultUnschedule,
  fetchToken = fetchSttAccessToken,
  openSocket,
  openCapture = openPcmCapture,
} = {}) {
  const mode = preferTapToTalk() ? "toggle" : "hold";
  const isAuto = variant === "auto";
  const supported = cartesiaCaptureSupported() || Boolean(openSocket && openCapture);

  let phase = "idle";
  let ws = null;
  let capture = null;
  let tailTimer = null;
  let waitTimer = null;
  let generation = 0;
  let pendingStop = false;
  let finishedThisHold = false;
  let autoCommitted = false;
  let audioBytes = 0;
  const pendingChunks = [];
  const manual = createManualAssembler();
  const auto = createAutoTurnAssembler();

  function emitError(err) {
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }

  function clearTimers() {
    if (tailTimer != null) {
      unschedule(tailTimer);
      tailTimer = null;
    }
    if (waitTimer != null) {
      unschedule(waitTimer);
      waitTimer = null;
    }
  }

  function teardownMedia() {
    try {
      capture?.flush?.();
    } catch {
      /* ignore */
    }
    try {
      capture?.stop?.();
    } catch {
      /* ignore */
    }
    capture = null;
    pendingChunks.length = 0;
    if (ws) {
      try {
        if (ws.readyState === 1) {
          if (isAuto) safeSend(ws, JSON.stringify({ type: "close" }));
          else safeSend(ws, "close");
        }
        ws.close?.();
      } catch {
        /* ignore */
      }
    }
    ws = null;
  }

  function sendAudio(buf) {
    const frame = toPcmBinaryFrame(buf) || buf;
    if (!frame || (frame.byteLength !== undefined && frame.byteLength === 0)) return false;
    if (phase === "idle" || phase === "finalizing") return false;
    const bytes = frame.byteLength ?? (ArrayBuffer.isView(frame) ? frame.byteLength : 0);
    if (ws && ws.readyState === 1) {
      const ok = safeSend(ws, frame);
      if (ok) audioBytes += bytes;
      return ok;
    }
    pendingChunks.push(frame);
    audioBytes += bytes;
    return true;
  }

  function flushPendingChunks() {
    if (!ws || ws.readyState !== 1) return;
    while (pendingChunks.length) {
      const frame = pendingChunks.shift();
      safeSend(ws, frame);
    }
  }

  function finishHold({ error, text } = {}) {
    if (finishedThisHold) return;
    finishedThisHold = true;
    pendingStop = false;
    clearTimers();
    phase = "idle";
    teardownMedia();
    onEnd?.();
    if (error) {
      emitError(error);
      return;
    }
    const spoken = typeof text === "string" ? text : "";
    if (spoken.trim()) {
      onCommit?.(spoken);
      return;
    }
    emitError(new Error(EMPTY_TRANSCRIPT_ERROR));
  }

  function commitManualOnce() {
    const text = manual.finals() || manual.preview();
    finishHold({ text });
  }

  function commitAutoText(text) {
    if (!text) return;
    autoCommitted = true;
    onCommit?.(text);
  }

  function endQuietly() {
    if (finishedThisHold) return;
    finishedThisHold = true;
    pendingStop = false;
    clearTimers();
    phase = "idle";
    teardownMedia();
    onEnd?.();
  }

  function finishAutoSession() {
    const leftover = auto.leftover();
    if (leftover) {
      finishHold({ text: leftover });
      return;
    }
    if (autoCommitted) {
      endQuietly();
      return;
    }
    finishHold({ error: new Error(EMPTY_TRANSCRIPT_ERROR) });
  }

  function ingestEvent(ev) {
    if (!ev) return;
    if (ev.type === "error") {
      finishHold({ error: new Error(socketErrorMessage(ev)) });
      return;
    }
    if (isAuto) {
      const { preview, commit } = auto.apply(ev);
      if (preview) onPreview?.(preview);
      if (commit) commitAutoText(commit);
      if (ev.type === "done" && phase === "finalizing") {
        finishAutoSession();
      }
      return;
    }
    if (ev.type === "transcript") {
      onPreview?.(manual.push(ev));
      return;
    }
    if (ev.type === "flush_done" || ev.type === "done") {
      commitManualOnce();
    }
  }

  function ingestRaw(raw) {
    const ev = parseCartesiaMessage(raw);
    if (!ev) return;
    if (ev.type === "blob" && ev.blob?.text) {
      ev.blob
        .text()
        .then((text) => ingestRaw(text))
        .catch((err) => finishHold({ error: err }));
      return;
    }
    ingestEvent(ev);
  }

  function attachSocket(socket) {
    ws = socket;
    try {
      socket.binaryType = "arraybuffer";
    } catch {
      /* ignore */
    }
    socket.onmessage = (event) => {
      const data = event?.data !== undefined ? event.data : event;
      ingestRaw(data);
    };
    socket.onerror = () => {
      if (phase === "idle" || finishedThisHold) return;
      finishHold({ error: new Error("Cartesia STT socket error") });
    };
    socket.onclose = () => {
      if (finishedThisHold || phase === "idle") return;
      if (phase === "finalizing") {
        if (isAuto) finishAutoSession();
        else commitManualOnce();
        return;
      }
      finishHold({ error: new Error(SOCKET_CLOSED_ERROR) });
    };
  }

  function defaultOpenSocket(url) {
    const socket = new WebSocket(url);
    try {
      socket.binaryType = "arraybuffer";
    } catch {
      /* ignore */
    }
    return socket;
  }

  async function connect(gen) {
    // Start the mic on the hold gesture (in parallel with the token mint) so
    // iOS can unlock AudioContext / getUserMedia before the gesture expires.
    const capturePromise = Promise.resolve()
      .then(() =>
        openCapture({
          onChunk(buf) {
            sendAudio(buf);
          },
          onError(err) {
            if (gen !== generation || finishedThisHold) return;
            finishHold({ error: err instanceof Error ? err : new Error(String(err)) });
          },
        }),
      )
      .then((cap) => {
        capture = cap;
        return cap;
      });

    let token;
    try {
      ({ token } = await fetchToken());
    } catch (err) {
      try {
        (await capturePromise.catch(() => null))?.stop?.();
      } catch {
        /* ignore */
      }
      capture = null;
      throw err;
    }
    if (gen !== generation) {
      try {
        (await capturePromise.catch(() => null))?.stop?.();
      } catch {
        /* ignore */
      }
      capture = null;
      return;
    }

    const url = buildCartesiaWsUrl({ variant: isAuto ? "auto" : "manual", accessToken: token });
    const socket = (openSocket || defaultOpenSocket)(url);
    attachSocket(socket);
    await waitSocketOpen(socket);
    if (gen !== generation) {
      try {
        socket.close?.();
      } catch {
        /* ignore */
      }
      try {
        (await capturePromise.catch(() => null))?.stop?.();
      } catch {
        /* ignore */
      }
      capture = null;
      return;
    }

    await capturePromise;
    if (gen !== generation) {
      teardownMedia();
      return;
    }
    flushPendingChunks();
    if (gen !== generation || finishedThisHold) return;
    armListening();
  }

  function beginFinalize() {
    if (phase !== "holding" && phase !== "tailing") return;
    phase = "finalizing";
    try {
      capture?.flush?.();
    } catch {
      /* ignore */
    }
    flushPendingChunks();
    try {
      capture?.stop?.();
    } catch {
      /* ignore */
    }
    capture = null;

    const heard = autoCommitted || Boolean(manual.finals() || manual.preview());
    if (audioBytes === 0 && !heard) {
      finishHold({ error: new Error(NO_AUDIO_ERROR) });
      return;
    }

    const sent = isAuto
      ? safeSend(ws, JSON.stringify({ type: "close" }))
      : safeSend(ws, "finalize");
    if (!sent) {
      finishHold({ error: new Error("Cartesia STT socket closed before finalize.") });
      return;
    }
    waitTimer = schedule(() => {
      waitTimer = null;
      if (phase !== "finalizing") return;
      if (isAuto) finishAutoSession();
      else commitManualOnce();
    }, finalizeWaitMs);
  }

  function armListening() {
    if (phase !== "starting") return;
    phase = "holding";
    onStart?.();
    if (pendingStop) {
      pendingStop = false;
      stop();
    }
  }

  function start() {
    if (phase === "holding" || phase === "starting") return;
    if (phase === "tailing") {
      clearTimers();
      phase = "holding";
      onStart?.();
      return;
    }
    if (phase === "finalizing") return;

    generation += 1;
    const gen = generation;
    phase = "starting";
    pendingStop = false;
    finishedThisHold = false;
    autoCommitted = false;
    audioBytes = 0;
    pendingChunks.length = 0;
    manual.reset();
    auto.reset();

    connect(gen).catch((err) => {
      if (gen !== generation) return;
      finishHold({ error: err instanceof Error ? err : new Error(String(err)) });
    });
  }

  function stop() {
    if (phase === "starting") {
      pendingStop = true;
      return;
    }
    if (phase !== "holding") return;
    phase = "tailing";
    onTailStart?.();
    tailTimer = schedule(() => {
      tailTimer = null;
      beginFinalize();
    }, tailMs);
  }

  function abort() {
    generation += 1;
    finishedThisHold = true;
    pendingStop = false;
    clearTimers();
    phase = "idle";
    manual.reset();
    auto.reset();
    teardownMedia();
  }

  if (!supported && !openSocket) {
    return {
      supported: false,
      provider: isAuto ? "cartesia-auto" : "cartesia-manual",
      mode,
      start() {
        emitError(new Error("Microphone capture is not available in this browser."));
      },
      stop() {},
      abort() {},
      isActive: () => false,
      isTailing: () => false,
    };
  }

  return {
    supported: true,
    provider: isAuto ? "cartesia-auto" : "cartesia-manual",
    mode,
    start,
    stop,
    abort,
    isActive: () => phase === "starting" || phase === "holding" || phase === "tailing" || phase === "finalizing",
    isTailing: () => phase === "tailing" || phase === "finalizing" || (phase === "starting" && pendingStop),
  };
}
