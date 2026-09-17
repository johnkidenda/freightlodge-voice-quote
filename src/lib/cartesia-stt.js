import { RELEASE_TAIL_MS, preferTapToTalk } from "./speech.js";
import { fetchSttAccessToken } from "./stt-token.js";
import { cartesiaCaptureSupported, openPcmCapture } from "./cartesia-pcm.js";
import {
  buildCartesiaWsUrl,
  createAutoTurnAssembler,
  createManualAssembler,
  parseCartesiaMessage,
} from "./cartesia-transcript.js";

const FINALIZE_WAIT_MS = 2500;

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
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Cartesia STT socket failed to open."));
    };
    function cleanup() {
      ws.removeEventListener?.("open", onOpen);
      ws.removeEventListener?.("error", onError);
    }
    ws.addEventListener?.("open", onOpen);
    ws.addEventListener?.("error", onError);
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
  let committedThisHold = false;
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
      capture?.stop?.();
    } catch {
      /* ignore */
    }
    capture = null;
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

  function commitManualOnce() {
    if (committedThisHold) return;
    const text = manual.finals();
    committedThisHold = true;
    phase = "idle";
    teardownMedia();
    onEnd?.();
    if (text) onCommit?.(text);
  }

  function commitAutoText(text) {
    if (!text) return;
    onCommit?.(text);
  }

  function finishAutoSession() {
    const leftover = auto.leftover();
    phase = "idle";
    teardownMedia();
    onEnd?.();
    if (leftover) commitAutoText(leftover);
  }

  function handleManualMessage(raw) {
    const ev = parseCartesiaMessage(raw);
    if (!ev) return;
    if (ev.type === "error") {
      emitError(new Error(socketErrorMessage(ev)));
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

  function handleAutoMessage(raw) {
    const ev = parseCartesiaMessage(raw);
    if (!ev) return;
    if (ev.type === "error") {
      emitError(new Error(socketErrorMessage(ev)));
      return;
    }
    const { preview, commit } = auto.apply(ev);
    if (preview) onPreview?.(preview);
    if (commit) commitAutoText(commit);
    if (ev.type === "done" && phase === "finalizing") {
      finishAutoSession();
    }
  }

  function attachSocket(socket) {
    ws = socket;
    socket.onmessage = (event) => {
      const data = event?.data !== undefined ? event.data : event;
      if (isAuto) handleAutoMessage(data);
      else handleManualMessage(data);
    };
    socket.onerror = () => {
      if (phase === "idle") return;
      emitError(new Error("Cartesia STT socket error"));
    };
    socket.onclose = () => {
      if (phase === "finalizing") {
        if (isAuto) finishAutoSession();
        else commitManualOnce();
      }
    };
  }

  function defaultOpenSocket(url) {
    return new WebSocket(url);
  }

  async function connect(gen) {
    const { token } = await fetchToken();
    if (gen !== generation) return;
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
      return;
    }

    capture = await openCapture({
      onChunk(buf) {
        if (phase === "holding" || phase === "tailing") safeSend(ws, buf);
      },
      onError(err) {
        emitError(err);
      },
    });
    if (gen !== generation) {
      teardownMedia();
    }
  }

  function beginFinalize() {
    if (phase !== "holding" && phase !== "tailing") return;
    phase = "finalizing";
    if (isAuto) {
      safeSend(ws, JSON.stringify({ type: "close" }));
    } else {
      safeSend(ws, "finalize");
    }
    waitTimer = schedule(() => {
      waitTimer = null;
      if (phase !== "finalizing") return;
      if (isAuto) finishAutoSession();
      else commitManualOnce();
    }, finalizeWaitMs);
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
    committedThisHold = false;
    manual.reset();
    auto.reset();
    onStart?.();

    connect(gen)
      .then(() => {
        if (gen !== generation) return;
        if (phase === "starting") phase = "holding";
      })
      .catch((err) => {
        if (gen !== generation) return;
        phase = "idle";
        teardownMedia();
        onEnd?.();
        emitError(err);
      });
  }

  function stop() {
    if (phase === "starting") {
      phase = "tailing";
      onTailStart?.();
      tailTimer = schedule(() => {
        tailTimer = null;
        if (ws && ws.readyState === 1) {
          beginFinalize();
          return;
        }
        generation += 1;
        phase = "idle";
        teardownMedia();
        onEnd?.();
      }, tailMs);
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
    isTailing: () => phase === "tailing" || phase === "finalizing",
  };
}
