/**
 * @vitest-environment happy-dom
 *
 * Quick replies render inside the bot bubble and submit through the typed path.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const snapshots = [];
const holds = [];

vi.mock("../src/lib/agent-speech.js", async () => {
  const actual = await vi.importActual("../src/lib/agent-speech.js");
  return {
    ...actual,
    speakAgentReply: vi.fn(async () => false),
    stopAgentSpeech: vi.fn(),
  };
});

vi.mock("../src/lib/speech-session.js", async () => {
  const actual = await vi.importActual("../src/lib/speech-session.js");
  return {
    ...actual,
    createSpeechSession(opts) {
      const hold = {
        supported: true,
        mode: "hold",
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        isActive: () => false,
        isTailing: () => false,
        opts,
      };
      holds.push(hold);
      return hold;
    },
  };
});

vi.mock("../src/lib/listen-cue.js", () => ({
  playListenCue: vi.fn(),
  primeListenCue: vi.fn(),
}));

vi.mock("../src/lib/transcript.js", async () => {
  const actual = await vi.importActual("../src/lib/transcript.js");
  return {
    ...actual,
    sendSessionTranscript: vi.fn(async (messages, session) => {
      snapshots.push(actual.formatSessionTranscript(messages, session));
      return { ok: true, mode: "formsubmit" };
    }),
  };
});

import { mountApp } from "../src/app.js";
import { presentAgentReply } from "../src/lib/conversational.js";
import { createSession, formatSpokenDate, handleUtterance, zipClarifyQuestion } from "../src/lib/dialog.js";
import { emptySheet } from "../src/lib/sheet.js";
import {
  INSIDE_CHOICES,
  LIFTGATE_CHOICES,
  PIECE_UNIT_CHOICES,
  YES_NO_CHOICES,
  ZIP_END_CHOICES,
  quickRepliesFor,
} from "../src/lib/quick-replies.js";
import { renderThread } from "../src/ui/thread.js";

/** Thu Sep 24 2026. "next Friday" is Sep 25 or Oct 2. */
const THU_SEP_24_2026 = new Date(2026, 8, 24, 20, 13, 0);

const TO_UNIT = ["78721", "30030"];
const TO_DATE = [...TO_UNIT, "pallets", "2", "500 pounds", "oranges"];
const TO_ACCESSORIALS = [...TO_DATE, "October 2"];

function mount(now = THU_SEP_24_2026) {
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  const root = document.getElementById("app");
  mountApp(root, { now });
  return root;
}

function assistants(root) {
  return [...root.querySelectorAll("#thread article.assistant")];
}

function bubbleText(article) {
  return article.querySelector("p")?.textContent || "";
}

function buttons(article) {
  return [...article.querySelectorAll("button.quick-reply")];
}

function lastAssistant(root) {
  return assistants(root).at(-1);
}

function labelsOf(article) {
  return buttons(article).map((button) => button.textContent);
}

function openButtons(root) {
  return [...root.querySelectorAll("#thread .quick-reply")].filter((button) => !button.disabled);
}

async function send(root, text) {
  const input = root.querySelector("#typed");
  input.value = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  root.querySelector("#composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await Promise.resolve();
}

async function drive(root, lines) {
  for (const line of lines) await send(root, line);
}

function clickLabel(root, label) {
  const button = openButtons(root).find((el) => el.textContent === label);
  expect(button, label).toBeTruthy();
  button.click();
}

function replay(lines, now = THU_SEP_24_2026) {
  let session = createSession({ id: "replay" });
  let result = null;
  for (const line of lines) {
    result = handleUtterance(session, line, { now });
    session = result.session;
  }
  return result;
}

function expectTypedResult(root, lines) {
  const result = replay(lines);
  expect(bubbleText(lastAssistant(root))).toBe(presentAgentReply(result, false));
  return result;
}

function bubbleFor(root, pattern) {
  const found = assistants(root).find((article) => pattern.test(bubbleText(article)));
  expect(found, String(pattern)).toBeTruthy();
  return found;
}

afterEach(() => {
  snapshots.length = 0;
  holds.length = 0;
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("quick reply catalog", () => {
  it("maps each fixed-choice ask and skips open-ended asks", () => {
    const unit = replay(TO_UNIT);
    expect(unit.reply).toMatch(/pallets or pieces\?/);
    expect(quickRepliesFor(unit).map((choice) => choice.label)).toEqual(["Pallets", "Pieces"]);

    const role = replay(["Atlanta to Texas", "78721"]);
    expect(role.reply).toBe("78721 looks like Austin. Is that the destination zip code?");
    expect(quickRepliesFor(role).map((choice) => choice.label)).toEqual(["Yes", "No"]);

    const same = replay(["origin zip 30301", "Atlanta", "destination zip 30301"]);
    expect(same.reply).toMatch(/Is that right\?$/);
    expect(quickRepliesFor(same).map((choice) => choice.label)).toEqual(["Yes", "No"]);

    const state = replay(["from Texas", "origin zip 30301"]);
    expect(state.reply).toBe("30301 looks like Georgia, but origin is Texas. Which is right?");
    expect(quickRepliesFor(state).map((choice) => choice.label)).toEqual(["Georgia", "Texas"]);

    const metro = replay(["New York City to Austin Texas", "30301"]);
    expect(metro.reply).toBe("You said New York but 30301 looks like Atlanta. Which is right, New York or 30301?");
    expect(quickRepliesFor(metro).map((choice) => choice.label)).toEqual(["New York", "30301"]);

    const originZip = createSession({ id: "origin-ask" });
    originZip.sheet.lanes.origin = { city: "Atlanta", state: "GA", postal_code: "99999", country: "US" };
    originZip.sheet.lanes.destination = { city: "Austin", state: "TX", postal_code: null, country: "US" };
    originZip.awaiting = "dest_zip";
    const originAsk = handleUtterance(originZip, "30301");
    expect(originAsk.reply).toBe("30301 looks like Atlanta. Dest is Austin. Is 30301 the origin zip code?");
    expect(quickRepliesFor(originAsk).map((choice) => choice.label)).toEqual(["Yes", "No"]);

    const lift = replay([...TO_ACCESSORIALS, "liftgate"]);
    expect(lift.reply).toBe("Liftgate at pickup, delivery, or both?");
    expect(quickRepliesFor(lift).map((choice) => choice.label)).toEqual(["Pickup", "Delivery", "Both", "No"]);
    expect(quickRepliesFor(lift, presentAgentReply(lift, true)).map((choice) => choice.label)).toEqual([
      "Pickup",
      "Delivery",
      "Both",
      "No",
    ]);

    const inside = replay([...TO_ACCESSORIALS, "inside"]);
    expect(inside.reply).toBe("Inside pickup, inside delivery, or both?");
    expect(quickRepliesFor(inside).map((choice) => choice.label)).toEqual([
      "Inside pickup",
      "Inside delivery",
      "Both",
    ]);

    const dated = replay([...TO_DATE, "next Friday"]);
    expect(dated.reply).toBe("Friday, September 25, or Friday, October 2?");
    expect(dated.session.dateClarify.soon).toBe("2026-09-25");
    expect(dated.session.dateClarify.later).toBe("2026-10-02");
    expect(quickRepliesFor(dated).map((choice) => choice.label)).toEqual([
      formatSpokenDate("2026-09-25"),
      formatSpokenDate("2026-10-02"),
    ]);

    const open = [
      replay(["hello"]),
      replay(TO_UNIT.slice(0, 1)),
      replay([...TO_UNIT, "pallets"]),
      replay([...TO_UNIT, "pallets", "2"]),
      replay([...TO_UNIT, "pallets", "2", "500 pounds"]),
      replay(TO_DATE),
      replay(TO_ACCESSORIALS),
      replay([...TO_ACCESSORIALS, "no"]),
    ];
    for (const result of open) expect(quickRepliesFor(result), result.reply).toBeNull();
  });

  it("yes/no and origin or destination labels use the same parser as typed text", () => {
    const sheet = emptySheet({ id: "did-mean" });
    sheet.lanes.origin.city = "Austin";
    sheet.lanes.destination.city = "Dallas";
    const did = {
      kind: "role",
      zip: "30301",
      altZip: "75201",
      metro: { city: "Atlanta" },
      attemptedRole: "origin",
      suggestedRole: "dest",
    };
    const didReply = zipClarifyQuestion(did, sheet);
    expect(didReply).toBe("30301 looks like Atlanta. Did you mean Dallas 75201?");
    const didResult = {
      reply: didReply,
      extracted: { flags: { zipClarify: did } },
      session: { sheet },
    };
    expect(quickRepliesFor(didResult).map((choice) => choice.label)).toEqual(["Yes", "No"]);

    const pending = createSession({ id: "did-pending" });
    pending.sheet = structuredClone(sheet);
    pending.zipClarify = did;
    pending.awaiting = "origin_zip";
    const pendingNo = structuredClone(pending);
    const yes = handleUtterance(pending, "Yes");
    expect(yes.session.sheet.lanes.destination.postal_code).toBe("30301");
    expect(yes.session.zipClarify).toBeNull();
    const no = handleUtterance(pendingNo, "No");
    expect(no.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(no.session.zipClarify).toBeNull();

    const ends = {
      kind: "role",
      zip: "30301",
      metro: { city: "Atlanta" },
      attemptedRole: "origin",
      suggestedRole: null,
    };
    const endsSheet = emptySheet({ id: "ends" });
    const endsReply = zipClarifyQuestion(ends, endsSheet);
    expect(endsReply).toBe("30301 looks like Atlanta. Origin zip code or destination zip code?");
    expect(
      quickRepliesFor({
        reply: endsReply,
        extracted: { flags: { zipClarify: ends } },
        session: { sheet: endsSheet },
      }).map((choice) => choice.label),
    ).toEqual(["Origin", "Destination"]);

    const endsPending = createSession({ id: "ends-pending" });
    endsPending.zipClarify = ends;
    endsPending.awaiting = "origin_zip";
    const endsOrigin = structuredClone(endsPending);
    expect(handleUtterance(endsPending, "Destination").session.sheet.lanes.destination.postal_code).toBe("30301");
    expect(handleUtterance(endsOrigin, "Origin").session.sheet.lanes.origin.postal_code).toBe("30301");

    expect(PIECE_UNIT_CHOICES.map((choice) => choice.label)).toEqual(["Pallets", "Pieces"]);
    expect(YES_NO_CHOICES.map((choice) => choice.label)).toEqual(["Yes", "No"]);
    expect(LIFTGATE_CHOICES.map((choice) => choice.label)).toEqual(["Pickup", "Delivery", "Both", "No"]);
    expect(INSIDE_CHOICES.map((choice) => choice.label)).toEqual(["Inside pickup", "Inside delivery", "Both"]);
    expect(ZIP_END_CHOICES.map((choice) => choice.label)).toEqual(["Origin", "Destination"]);
  });
});

describe("quick reply buttons in the thread", () => {
  it("renders each live prompt's buttons inside that bubble and none on open-ended prompts", async () => {
    const root = mount();
    expect(root.querySelector("#choice-row")).toBeNull();
    expect(root.querySelector("#hold .hold-label").textContent).toBe("Hold to talk");
    expect(bubbleText(lastAssistant(root))).toMatch(/What’s the origin zip code\?/);
    expect(buttons(lastAssistant(root))).toHaveLength(0);

    await send(root, "78721");
    expect(bubbleText(lastAssistant(root))).toMatch(/destination/i);
    expect(buttons(lastAssistant(root))).toHaveLength(0);

    await send(root, "30030");
    const unit = lastAssistant(root);
    expect(bubbleText(unit)).toMatch(/pallets or pieces\?/);
    expect(unit.querySelector("p").contains(unit.querySelector(".quick-replies"))).toBe(false);
    expect(labelsOf(unit)).toEqual(["Pallets", "Pieces"]);
    for (const button of buttons(unit)) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("aria-label")).toBe(`Answer ${button.textContent}`);
      expect(button.disabled).toBe(false);
    }

    await send(root, "pallets");
    expect(buttons(bubbleFor(root, /How many pallets\?/))).toHaveLength(0);
    expect(buttons(bubbleFor(root, /pallets or pieces\?/)).every((button) => button.disabled)).toBe(true);

    await send(root, "2");
    expect(buttons(bubbleFor(root, /total weight in pounds/))).toHaveLength(0);
    await send(root, "500 pounds");
    expect(buttons(bubbleFor(root, /What’s the commodity\?/))).toHaveLength(0);
    await send(root, "oranges");
    expect(buttons(bubbleFor(root, /What pickup date works\?/))).toHaveLength(0);
    await send(root, "October 2");
    expect(buttons(bubbleFor(root, /Any accessorials\?/))).toHaveLength(0);

    await send(root, "liftgate");
    expect(labelsOf(lastAssistant(root))).toEqual(["Pickup", "Delivery", "Both", "No"]);
    expect(lastAssistant(root).querySelector(".quick-replies")).toBeTruthy();

    const insideRoot = mount();
    await drive(insideRoot, [...TO_ACCESSORIALS, "inside"]);
    expect(labelsOf(lastAssistant(insideRoot))).toEqual(["Inside pickup", "Inside delivery", "Both"]);

    const yesRoot = mount();
    await drive(yesRoot, ["Atlanta to Texas", "78721"]);
    expect(bubbleText(lastAssistant(yesRoot))).toBe("78721 looks like Austin. Is that the destination zip code?");
    expect(labelsOf(lastAssistant(yesRoot))).toEqual(["Yes", "No"]);

    const sameRoot = mount();
    await drive(sameRoot, ["origin zip 30301", "Atlanta", "destination zip 30301"]);
    expect(labelsOf(lastAssistant(sameRoot))).toEqual(["Yes", "No"]);

    const stateRoot = mount();
    await drive(stateRoot, ["from Texas", "origin zip 30301"]);
    expect(labelsOf(lastAssistant(stateRoot))).toEqual(["Georgia", "Texas"]);

    const metroRoot = mount();
    await drive(metroRoot, ["New York City to Austin Texas", "30301"]);
    expect(labelsOf(lastAssistant(metroRoot))).toEqual(["New York", "30301"]);

    const dateRoot = mount();
    await drive(dateRoot, [...TO_DATE, "next Friday"]);
    const dated = replay([...TO_DATE, "next Friday"]);
    expect(labelsOf(lastAssistant(dateRoot))).toEqual([
      formatSpokenDate(dated.session.dateClarify.soon),
      formatSpokenDate(dated.session.dateClarify.later),
    ]);
    expect(labelsOf(lastAssistant(dateRoot))).toEqual(["Friday, September 25", "Friday, October 2"]);

    const emailRoot = mount();
    await drive(emailRoot, [...TO_ACCESSORIALS, "no"]);
    expect(bubbleText(lastAssistant(emailRoot))).toMatch(/What email should I put on the sheet/);
    expect(buttons(lastAssistant(emailRoot))).toHaveLength(0);
  });

  it("renders did-you-mean and origin-or-destination choices inside the asking bubble", () => {
    const sheet = emptySheet({ id: "rare" });
    sheet.lanes.destination.city = "Dallas";
    const did = {
      kind: "role",
      zip: "30301",
      altZip: "75201",
      metro: { city: "Atlanta" },
      attemptedRole: "origin",
      suggestedRole: "dest",
    };
    const didReply = zipClarifyQuestion(did, sheet);
    const ends = {
      kind: "role",
      zip: "30301",
      metro: { city: "Atlanta" },
      attemptedRole: "origin",
      suggestedRole: null,
    };
    const endsReply = zipClarifyQuestion(ends, emptySheet({ id: "ends-render" }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderThread(host, [
      {
        role: "assistant",
        text: didReply,
        choices: quickRepliesFor({
          reply: didReply,
          extracted: { flags: { zipClarify: did } },
          session: { sheet },
        }),
        choicesOpen: true,
      },
      {
        role: "assistant",
        text: endsReply,
        choices: quickRepliesFor({
          reply: endsReply,
          extracted: { flags: { zipClarify: ends } },
          session: { sheet: emptySheet({ id: "ends-render" }) },
        }),
        choicesOpen: true,
      },
    ]);
    const articles = [...host.querySelectorAll("article.assistant")];
    expect(articles[0].querySelector("p").textContent).toBe(didReply);
    expect(labelsOf(articles[0])).toEqual(["Yes", "No"]);
    expect(articles[0].querySelector(".quick-replies")).toBeTruthy();
    expect(labelsOf(articles[1])).toEqual(["Origin", "Destination"]);
  });

  it("tapping a button matches typing that label, including the transcript snapshot", async () => {
    const root = mount();
    await drive(root, TO_UNIT);
    const usersBefore = root.querySelectorAll("#thread article.user").length;
    clickLabel(root, "Pallets");
    await Promise.resolve();

    const typed = expectTypedResult(root, [...TO_UNIT, "Pallets"]);
    expect(typed.session.sheet.freight.piece_unit).toBe("pallets");
    expect(typed.session.sheet.freight.pieces).toBeNull();
    expect(typed.session.awaiting).toBe("pieces");
    const users = [...root.querySelectorAll("#thread article.user")];
    expect(users).toHaveLength(usersBefore + 1);
    expect(bubbleText(users.at(-1))).toBe("Pallets");
    expect(buttons(bubbleFor(root, /pallets or pieces\?/)).every((button) => button.disabled)).toBe(true);

    root.querySelector("#send-transcript").click();
    await vi.waitFor(() => expect(snapshots).toHaveLength(1));
    expect(snapshots[0]).toContain("User [tap]: Pallets");
    expect(snapshots[0]).toContain("Version: v0.41");
    expect(snapshots[0]).toMatch(/pallets or pieces/);
  });

  it("typing or voice answers the same question and leaves those buttons inert across redraws", async () => {
    const typedRoot = mount();
    await drive(typedRoot, TO_UNIT);
    const unit = lastAssistant(typedRoot);
    expect(buttons(unit).every((button) => !button.disabled)).toBe(true);

    const input = typedRoot.querySelector("#typed");
    input.value = "still thinking";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const redrawn = bubbleFor(typedRoot, /pallets or pieces\?/);
    expect(labelsOf(redrawn)).toEqual(["Pallets", "Pieces"]);
    expect(buttons(redrawn).every((button) => !button.disabled)).toBe(true);

    await send(typedRoot, "Pieces");
    const typed = expectTypedResult(typedRoot, [...TO_UNIT, "Pieces"]);
    expect(typed.session.sheet.freight.piece_unit).toBe("pieces");
    expect(bubbleText([...typedRoot.querySelectorAll("#thread article.user")].at(-1))).toBe("Pieces");
    expect(buttons(bubbleFor(typedRoot, /pallets or pieces\?/)).every((button) => button.disabled)).toBe(true);

    input.value = "4";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const afterRedraw = buttons(bubbleFor(typedRoot, /pallets or pieces\?/));
    expect(afterRedraw.every((button) => button.disabled)).toBe(true);
    expect(afterRedraw.every((button) => button.getAttribute("aria-disabled") === "true")).toBe(true);
    const userCount = typedRoot.querySelectorAll("#thread article.user").length;
    afterRedraw[0].click();
    await Promise.resolve();
    expect(typedRoot.querySelectorAll("#thread article.user")).toHaveLength(userCount);

    const voiceRoot = mount();
    await drive(voiceRoot, TO_UNIT);
    holds.at(-1).opts.onCommit("   ");
    expect(openButtons(voiceRoot).map((button) => button.textContent)).toEqual(["Pallets", "Pieces"]);
    holds.at(-1).opts.onCommit("Pallets");
    await Promise.resolve();
    const voiced = expectTypedResult(voiceRoot, [...TO_UNIT, "Pallets"]);
    expect(voiced.session.sheet.freight.piece_unit).toBe("pallets");
    expect(bubbleText([...voiceRoot.querySelectorAll("#thread article.user")].at(-1))).toBe("Pallets");
    expect(buttons(bubbleFor(voiceRoot, /pallets or pieces\?/)).every((button) => button.disabled)).toBe(true);
    expect(voiceRoot.querySelector("#hold .hold-label").textContent).toBe("Hold to talk");
    expect(voiceRoot.querySelector("#typed")).toBeTruthy();
  });

  it("date, yes/no, liftgate, inside, state, and metro taps match the typed answer", async () => {
    const dateRoot = mount();
    await drive(dateRoot, [...TO_DATE, "next Friday"]);
    clickLabel(dateRoot, "Friday, September 25");
    await Promise.resolve();
    const sooner = expectTypedResult(dateRoot, [...TO_DATE, "next Friday", "Friday, September 25"]);
    expect(sooner.session.sheet.pickup.date).toBe("2026-09-25");
    expect(buttons(bubbleFor(dateRoot, /Friday, September 25, or Friday, October 2\?/)).every((button) => button.disabled)).toBe(
      true,
    );

    const laterRoot = mount();
    await drive(laterRoot, [...TO_DATE, "next Friday"]);
    await send(laterRoot, "Friday Oct 2");
    const later = expectTypedResult(laterRoot, [...TO_DATE, "next Friday", "Friday Oct 2"]);
    expect(later.session.sheet.pickup.date).toBe("2026-10-02");
    expect(buttons(bubbleFor(laterRoot, /Friday, September 25, or Friday, October 2\?/)).every((button) => button.disabled)).toBe(
      true,
    );

    const yesRoot = mount();
    await drive(yesRoot, ["Atlanta to Texas", "78721"]);
    clickLabel(yesRoot, "Yes");
    await Promise.resolve();
    const yes = expectTypedResult(yesRoot, ["Atlanta to Texas", "78721", "Yes"]);
    expect(yes.session.sheet.lanes.destination.postal_code).toBe("78721");

    const liftRoot = mount();
    await drive(liftRoot, [...TO_ACCESSORIALS, "liftgate"]);
    clickLabel(liftRoot, "Delivery");
    await Promise.resolve();
    const lift = expectTypedResult(liftRoot, [...TO_ACCESSORIALS, "liftgate", "Delivery"]);
    expect(lift.session.sheet.pickup.accessorials).toEqual(["liftgate_delivery"]);

    const noRoot = mount();
    await drive(noRoot, [...TO_ACCESSORIALS, "liftgate"]);
    clickLabel(noRoot, "No");
    await Promise.resolve();
    const none = expectTypedResult(noRoot, [...TO_ACCESSORIALS, "liftgate", "No"]);
    expect(none.session.sheet.pickup.accessorials).toEqual([]);
    expect(none.session.awaiting).toBe("email");

    const insideRoot = mount();
    await drive(insideRoot, [...TO_ACCESSORIALS, "inside"]);
    clickLabel(insideRoot, "Inside pickup");
    await Promise.resolve();
    const inside = expectTypedResult(insideRoot, [...TO_ACCESSORIALS, "inside", "Inside pickup"]);
    expect(inside.session.sheet.pickup.accessorials).toEqual(["inside_pickup"]);

    const stateRoot = mount();
    await drive(stateRoot, ["from Texas", "origin zip 30301"]);
    clickLabel(stateRoot, "Georgia");
    await Promise.resolve();
    const georgia = expectTypedResult(stateRoot, ["from Texas", "origin zip 30301", "Georgia"]);
    expect(georgia.session.sheet.lanes.origin.postal_code).toBe("30301");
    expect(georgia.session.sheet.lanes.origin.state).toBe("GA");

    const metroRoot = mount();
    await drive(metroRoot, ["New York City to Austin Texas", "30301"]);
    clickLabel(metroRoot, "30301");
    await Promise.resolve();
    const metro = expectTypedResult(metroRoot, ["New York City to Austin Texas", "30301", "30301"]);
    expect(metro.session.sheet.lanes.origin.postal_code).toBe("30301");
  });

  it("keeps buttons in conversational mode and keeps the mic available", async () => {
    const root = mount();
    root.querySelector("#conversational").click();
    await drive(root, TO_UNIT);
    expect(bubbleText(lastAssistant(root))).toMatch(/pallets or pieces\?/);
    expect(labelsOf(lastAssistant(root))).toEqual(["Pallets", "Pieces"]);
    expect(root.querySelector("#hold").disabled).toBe(false);
    clickLabel(root, "Pallets");
    await Promise.resolve();
    const typed = replay([...TO_UNIT, "Pallets"]);
    expect(bubbleText(lastAssistant(root))).toBe(presentAgentReply(typed, true));
    expect(typed.session.sheet.freight.piece_unit).toBe("pallets");
  });

  it("uses 44px wrapping tap targets", () => {
    const css = readFileSync("src/style.css", "utf8");
    expect(css).toMatch(/\.quick-reply\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.quick-replies\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/\u2014/);
    expect(readFileSync("src/lib/quick-replies.js", "utf8")).not.toMatch(/\u2014/);
    expect(readFileSync("src/ui/thread.js", "utf8")).not.toMatch(/\u2014/);
  });
});
