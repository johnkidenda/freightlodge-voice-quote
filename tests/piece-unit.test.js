import { describe, expect, it } from "vitest";
import { formatStoredPieces, SLOT_ORDER, nextRequiredSlot } from "../src/lib/completeness.js";
import { createSession, handleUtterance, piecesCountPrompt, PROMPTS } from "../src/lib/dialog.js";
import { quoteEmailFields } from "../src/lib/email.js";
import { extractSlots } from "../src/lib/extract.js";
import { composeConversationalReply, presentAgentReply } from "../src/lib/conversational.js";
import { formatSessionTranscript } from "../src/lib/transcript.js";

function zippedSession(id = "unit") {
  const session = createSession({ id });
  session.sheet.lanes.origin.postal_code = "60601";
  session.sheet.lanes.destination.postal_code = "75201";
  return session;
}

describe("piece unit then count", () => {
  it("SLOT_ORDER asks piece_unit before pieces", () => {
    expect(SLOT_ORDER.indexOf("piece_unit")).toBe(SLOT_ORDER.indexOf("pieces") - 1);
    expect(PROMPTS.piece_unit).toBe("Are you shipping pallets or pieces?");
    const sheet = zippedSession().sheet;
    expect(nextRequiredSlot(sheet)).toBe("piece_unit");
    sheet.freight.piece_unit = "pallets";
    expect(nextRequiredSlot(sheet)).toBe("pieces");
    sheet.freight.pieces = 2;
    expect(nextRequiredSlot(sheet)).not.toBe("piece_unit");
    expect(nextRequiredSlot(sheet)).not.toBe("pieces");
  });

  it("asks pallets or pieces once both ZIPs are in", () => {
    const result = handleUtterance(zippedSession("ask-unit"), "ready");
    expect(result.session.awaiting).toBe("piece_unit");
    expect(result.reply).toMatch(/Are you shipping pallets or pieces\?/);
    expect(presentAgentReply(result, true)).toMatch(/pallets or pieces/i);
  });

  it("after pallets, asks how many pallets and stores the unit", () => {
    const session = zippedSession("pallets-then-count");
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, "pallets");
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.session.sheet.freight.pieces).toBeNull();
    expect(result.session.awaiting).toBe("pieces");
    expect(result.reply).toBe("Got pallets. How many pallets?");
    expect(presentAgentReply(result, true)).toBe("Got pallets. How many pallets?");
    expect(result.reply).not.toMatch(/\u2014/);
  });

  it("after pieces, asks how many pieces", () => {
    const session = zippedSession("pieces-then-count");
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, "we're shipping pieces");
    expect(result.session.sheet.freight.piece_unit).toBe("pieces");
    expect(result.session.awaiting).toBe("pieces");
    expect(result.reply).toBe("Got pieces. How many pieces?");
    expect(presentAgentReply(result, true)).toBe("Got pieces. How many pieces?");
  });

  it.each([
    ["skids", "pallets"],
    ["skid", "pallets"],
    ["pcs", "pieces"],
    ["boxes", "pieces"],
    ["crates", "pieces"],
    ["cartons", "pieces"],
  ])("maps %s to %s", (word, unit) => {
    const session = zippedSession(`syn-${word}`);
    session.awaiting = "piece_unit";
    const result = handleUtterance(session, word);
    expect(result.session.sheet.freight.piece_unit).toBe(unit);
    expect(result.session.sheet.freight.pieces).toBeNull();
    expect(result.session.awaiting).toBe("pieces");
  });

  it("a bare count after the unit ask stores the integer and keeps the unit", () => {
    const session = zippedSession("count");
    session.sheet.freight.piece_unit = "pallets";
    session.awaiting = "pieces";
    const result = handleUtterance(session, "4");
    expect(result.session.sheet.freight.pieces).toBe(4);
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.session.awaiting).not.toBe("pieces");
    expect(result.session.awaiting).not.toBe("piece_unit");
  });

  it("combined utterances fill unit and count and skip the extra ask", () => {
    const cases = [
      ["3 pallets", 3, "pallets"],
      ["two skids", 2, "pallets"],
      ["5 pcs", 5, "pieces"],
      ["1 box", 1, "pieces"],
      ["four crates", 4, "pieces"],
      ["6 cartons", 6, "pieces"],
    ];
    for (const [text, count, unit] of cases) {
      const extracted = extractSlots(text, { awaiting: "piece_unit" });
      expect(extracted.freight.pieces, text).toBe(count);
      expect(extracted.freight.piece_unit, text).toBe(unit);

      const result = handleUtterance(zippedSession(`combo-${text}`), text);
      expect(result.session.sheet.freight.pieces, text).toBe(count);
      expect(result.session.sheet.freight.piece_unit, text).toBe(unit);
      expect(result.session.awaiting, text).not.toBe("piece_unit");
      expect(result.session.awaiting, text).not.toBe("pieces");
      expect(result.reply, text).not.toMatch(/How many (pallets|pieces)\?/);
      expect(result.reply, text).not.toMatch(/Are you shipping pallets or pieces/);
    }
  });

  it("confirms the stored unit, singular when the count is 1", () => {
    const pallets = zippedSession("ack-pallets");
    pallets.sheet.freight.piece_unit = "pallets";
    pallets.awaiting = "pieces";
    const five = handleUtterance(pallets, "five");
    expect(five.session.sheet.freight.pieces).toBe(5);
    expect(five.session.sheet.freight.piece_unit).toBe("pallets");
    expect(five.reply).toMatch(/Got 5 pallets\./);
    expect(five.reply).not.toMatch(/pieces/);
    expect(presentAgentReply(five, true)).toMatch(/Got 5 pallets\./);
    expect(presentAgentReply(five, true)).not.toMatch(/\bpcs\b/);

    const one = handleUtterance(
      { ...pallets, sheet: { ...pallets.sheet, freight: { ...pallets.sheet.freight, pieces: null } } },
      "one",
    );
    expect(one.session.sheet.freight.pieces).toBe(1);
    expect(one.reply).toMatch(/Got 1 pallet\./);
    expect(presentAgentReply(one, true)).toMatch(/Got 1 pallet\./);

    const pieces = zippedSession("ack-pieces");
    pieces.sheet.freight.piece_unit = "pieces";
    pieces.awaiting = "pieces";
    const fivePieces = handleUtterance(pieces, "5");
    expect(fivePieces.reply).toMatch(/Got 5 pieces\./);
    expect(presentAgentReply(fivePieces, true)).toMatch(/Got 5 pieces\./);
    const onePiece = handleUtterance(
      {
        ...pieces,
        sheet: { ...pieces.sheet, freight: { ...pieces.sheet.freight, pieces: null } },
      },
      "1",
    );
    expect(onePiece.reply).toMatch(/Got 1 piece\./);

    const warmUnknown = composeConversationalReply({
      extracted: { freight: { pieces: 5 }, origin: {}, destination: {}, pickup: {}, contact: {}, flags: {} },
      sheet: { freight: {}, lanes: { origin: {}, destination: {} } },
      awaiting: "measure",
    });
    expect(warmUnknown).toMatch(/Got 5 pieces\./);
    expect(warmUnknown).not.toMatch(/\bpcs\b/);
    expect(warmUnknown).not.toMatch(/pallet/);
  });

  it("echoes the stored unit in the sheet summary and the quote email", () => {
    const palletSheet = {
      freight: { pieces: 5, piece_unit: "pallets" },
      lanes: { origin: {}, destination: {} },
      pickup: {},
      contact: {},
    };
    expect(formatStoredPieces(palletSheet.freight)).toBe("5 pallets");
    expect(formatStoredPieces({ pieces: 1, piece_unit: "pallets" })).toBe("1 pallet");
    expect(formatStoredPieces({ pieces: 5, piece_unit: "pieces" })).toBe("5 pieces");
    expect(formatStoredPieces({ pieces: 1, piece_unit: "pieces" })).toBe("1 piece");
    expect(formatStoredPieces({ pieces: 5 })).toBe("5");
    expect(quoteEmailFields(palletSheet).pieces).toBe("5 pallets");
    expect(quoteEmailFields({ ...palletSheet, freight: { pieces: 1, piece_unit: "pieces" } }).pieces).toBe(
      "1 piece",
    );
    const transcript = formatSessionTranscript([], {
      sheet: palletSheet,
      awaiting: "commodity",
    });
    expect(transcript).toMatch(/Pieces: 5 pallets/);
  });
});

describe("short counts while awaiting pieces", () => {
  const WORDS = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];

  function awaitingPieces(id) {
    const session = zippedSession(id);
    session.sheet.freight.piece_unit = "pallets";
    session.awaiting = "pieces";
    return session;
  }

  it.each(WORDS)("bare word %s commits the count", (word) => {
    const result = handleUtterance(awaitingPieces(`word-${word}`), word);
    expect(result.session.sheet.freight.pieces).toBe(WORDS.indexOf(word) + 1);
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.session.awaiting).not.toBe("pieces");
  });

  it.each(["1", "5", "12", "20"])("bare digits %s commit the count", (text) => {
    const result = handleUtterance(awaitingPieces(`digit-${text}`), text);
    expect(result.session.sheet.freight.pieces).toBe(Number(text));
    expect(result.session.awaiting).not.toBe("pieces");
  });

  it.each([
    ["won", 1],
    ["to", 2],
    ["too", 2],
    ["for", 4],
    ["ate", 8],
    ["five.", 5],
    ["um five", 5],
    ["it's five", 5],
    ["five pallets", 5],
    ["for pallets", 4],
    ["5", 5],
  ])("%s commits as %s pallets", (text, count) => {
    const result = handleUtterance(awaitingPieces(`stt-${text}`), text);
    expect(result.session.sheet.freight.pieces, text).toBe(count);
    expect(result.session.sheet.freight.piece_unit).toBe("pallets");
    expect(result.reply, text).toMatch(new RegExp(`Got ${count} pallet`));
  });

  it("count ask copy does not demand typing and still accepts a spoken number", () => {
    expect(PROMPTS.pieces).toBe("How many pieces or pallets?");
    expect(PROMPTS.pieces).not.toMatch(/Please type it in/);
    expect(piecesCountPrompt({ freight: { piece_unit: "pallets" } })).toBe("How many pallets?");
    expect(piecesCountPrompt({ freight: { piece_unit: "pieces" } })).toBe("How many pieces?");
    expect(PROMPTS.email).toMatch(/Please type it in/);
    const spoken = handleUtterance(awaitingPieces("spoken-four"), "4");
    expect(spoken.session.sheet.freight.pieces).toBe(4);
    expect(spoken.session.awaiting).not.toBe("pieces");
  });

  it("does not treat to/for as a count outside the pieces slot", () => {
    expect(extractSlots("for Dallas", { awaiting: "origin_zip" }).freight.pieces).toBeUndefined();
    expect(extractSlots("to Atlanta", { awaiting: "dest_zip" }).freight.pieces).toBeUndefined();
  });
});
