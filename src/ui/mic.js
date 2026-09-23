import { playListenCue, primeListenCue } from "../lib/listen-cue.js";

export function bindMic(button, sessionRef) {
  const talk = () => sessionRef.current;
  const label = button.querySelector(".hold-label");
  if (talk()?.mode === "toggle") {
    if (label) label.textContent = "Tap to talk";
    button.addEventListener("click", (e) => {
      e.preventDefault();
      const session = talk();
      if (!session) return;
      if (session.isTailing?.()) return;
      if (session.isActive?.()) {
        button.setAttribute("aria-pressed", "false");
        button.classList.remove("hot");
        if (label) label.textContent = "Finishing…";
        session.stop();
      } else {
        button.setAttribute("aria-pressed", "true");
        button.classList.add("hot");
        if (label) label.textContent = "Recording… tap to send";
        primeListenCue();
        playListenCue();
        session.start();
      }
    });
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    return;
  }

  const go = (e) => {
    e.preventDefault();
    button.setPointerCapture?.(e.pointerId);
    button.setAttribute("aria-pressed", "true");
    button.classList.add("hot");
    primeListenCue();
    playListenCue();
    talk()?.start();
  };
  const stop = (e) => {
    e.preventDefault();
    button.setAttribute("aria-pressed", "false");
    button.classList.remove("hot");
    talk()?.stop();
  };
  button.addEventListener("pointerdown", go);
  button.addEventListener("pointerup", stop);
  button.addEventListener("pointercancel", stop);
  button.addEventListener("touchend", stop, { passive: false });
  button.addEventListener("lostpointercapture", () => {
    button.classList.remove("hot");
    talk()?.stop();
  });
  button.addEventListener("contextmenu", (e) => e.preventDefault());
}
