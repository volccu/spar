// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetReadingPositions,
  MIN_REMEMBERED_PX,
  recallReadingPosition,
  rememberReadingPosition,
} from "./readingPosition";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

const DEEP = MIN_REMEMBERED_PX + 400;

describe("where you had got to in a long note", () => {
  it("gives back the offset it was given, for the same text", () => {
    rememberReadingPosition("n1", DEEP, 15_000);
    expect(recallReadingPosition("n1", 15_000)).toBe(DEEP);
  });

  it("answers 0 for a note it has never seen", () => {
    expect(recallReadingPosition("nobody", 900)).toBe(0);
  });

  /**
   * The offset counts pixels into one particular piece of text. Edit the text
   * on the other device and the number is pointing at something else — so it
   * is dropped rather than honoured, which costs a scroll instead of dropping
   * the reader somewhere arbitrary with nothing to explain it.
   */
  it("drops the position when the note's text has changed length", () => {
    rememberReadingPosition("n2", DEEP, 15_000);
    expect(recallReadingPosition("n2", 15_040)).toBe(0);
    expect(recallReadingPosition("n2", 14_960)).toBe(0);
    expect(recallReadingPosition("n2", 15_000)).toBe(DEEP);
  });

  /**
   * A short note, or the first screenful of a long one, is somewhere the
   * reader was going to start anyway — and restoring it costs the small
   * surprise of a note that does not begin at the beginning.
   */
  it("remembers nothing inside the first screenful", () => {
    rememberReadingPosition("n3", MIN_REMEMBERED_PX - 1, 15_000);
    expect(recallReadingPosition("n3", 15_000)).toBe(0);

    rememberReadingPosition("n4", MIN_REMEMBERED_PX, 15_000);
    expect(recallReadingPosition("n4", 15_000)).toBe(MIN_REMEMBERED_PX);
  });

  /**
   * Reading back to the top is a decision too. A position set earlier has to
   * be clearable by the act of undoing it, or a note you have finished and
   * scrolled back through reopens halfway down for ever.
   */
  it("forgets a note scrolled back to the top", () => {
    rememberReadingPosition("n5", DEEP, 15_000);
    rememberReadingPosition("n5", 4, 15_000);
    expect(recallReadingPosition("n5", 15_000)).toBe(0);
  });

  it("keeps one entry per note rather than a pile of them", () => {
    rememberReadingPosition("n6", DEEP, 15_000);
    rememberReadingPosition("n6", DEEP + 90, 15_000);
    expect(recallReadingPosition("n6", 15_000)).toBe(DEEP + 90);
    expect(JSON.parse(localStorage.getItem("spar.reading")!)).toHaveLength(1);
  });

  /** A cache with an end to it, dropping least-recently-read first. */
  it("keeps the list bounded, and the oldest is the one that goes", () => {
    for (let i = 0; i < 260; i++) rememberReadingPosition(`k${i}`, DEEP, 15_000);
    const stored = JSON.parse(localStorage.getItem("spar.reading")!);
    expect(stored.length).toBeLessThanOrEqual(200);
    expect(recallReadingPosition("k259", 15_000)).toBe(DEEP);
    expect(recallReadingPosition("k0", 15_000)).toBe(0);
  });

  /**
   * Handing the device to somebody else takes these with it — they are a list
   * of the previous user's note ids. `store/db.ts`'s purge calls this.
   */
  it("can be forgotten entirely", () => {
    rememberReadingPosition("n7", DEEP, 15_000);
    forgetReadingPositions();
    expect(localStorage.getItem("spar.reading")).toBeNull();
    expect(recallReadingPosition("n7", 15_000)).toBe(0);
  });

  /**
   * Nothing here is worth an error. A refused or corrupted store costs a
   * scroll; it may never cost the note.
   */
  it("survives storage that refuses, and rubbish under its own key", () => {
    localStorage.setItem("spar.reading", "{not json");
    expect(recallReadingPosition("n8", 900)).toBe(0);
    expect(() => rememberReadingPosition("n8", DEEP, 900)).not.toThrow();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => rememberReadingPosition("n9", DEEP, 900)).not.toThrow();
  });

  /**
   * It is a scroll offset and a length, and that is the whole shape. Nothing
   * about a note's own data is copied out here, and nothing written here can
   * ever be mistaken for a field on the note.
   */
  it("stores no note content, only an id, a number and a length", () => {
    rememberReadingPosition("n10", DEEP, 15_000);
    const [spot] = JSON.parse(localStorage.getItem("spar.reading")!);
    expect(Object.keys(spot).sort()).toEqual(["at", "id", "len"]);
  });
});
