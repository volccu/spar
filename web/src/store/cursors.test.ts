import { afterEach, describe, expect, it } from "vitest";
import {
  cappedAtServerTime,
  laterCursor,
  readCursor,
  narrowRepairWindow,
  repairStart,
  REPAIR_WINDOW_MS,
  STEADY_WINDOW_MS,
  widenRepairWindow,
} from "./cursors";
import { forgetServerClock, noteServerDate } from "./serverClock";

afterEach(() => {
  forgetServerClock();
  widenRepairWindow();
});

describe("laterCursor", () => {
  it("orders by instant, then by id", () => {
    expect(laterCursor({ at: "2026-09-21T10:00:01.000Z", id: "a" }, { at: "2026-09-21T10:00:00.000Z", id: "z" })).toBe(true);
    expect(laterCursor({ at: "2026-09-21T10:00:00.000Z", id: "b" }, { at: "2026-09-21T10:00:00.000Z", id: "a" })).toBe(true);
    expect(laterCursor({ at: "2026-09-21T10:00:00.000Z", id: "a" }, { at: "2026-09-21T10:00:00.000Z", id: "a" })).toBe(false);
  });

  /**
   * The server spells an instant `+00:00` with six digits and this device
   * writes `Z` with three. Compared as text, the same instant written both ways
   * is "later" in whichever spelling happens to sort higher — so a tie was
   * decided on the spelling and the id tiebreak never ran.
   */
  it("treats one instant spelled two ways as a tie, and lets the id decide", () => {
    const server = { at: "2026-09-21T10:00:00.000000+00:00", id: "a" };
    const local = { at: "2026-09-21T10:00:00.000Z", id: "b" };
    expect(laterCursor(local, server)).toBe(true);
    expect(laterCursor(server, local)).toBe(false);
  });
});

describe("repairStart", () => {
  it("steps back over the window and drops the id", () => {
    expect(repairStart({ at: "2026-09-21T10:00:00.000Z", id: "x" })).toEqual({
      at: new Date(Date.parse("2026-09-21T10:00:00.000Z") - REPAIR_WINDOW_MS).toISOString(),
      id: "",
    });
  });

  /**
   * Two minutes on every tick re-downloaded the note just sent, once per pause
   * in typing. A clean tick narrows the next one; a failure widens it again.
   */
  it("steps back only a few seconds after a clean tick, and the full window after a failure", () => {
    const saved = { at: "2026-09-21T10:00:00.000Z", id: "x" };
    const back = (ms: number) => new Date(Date.parse(saved.at) - ms).toISOString();
    expect(repairStart(saved).at).toBe(back(REPAIR_WINDOW_MS));
    narrowRepairWindow();
    expect(repairStart(saved).at).toBe(back(STEADY_WINDOW_MS));
    widenRepairWindow();
    expect(repairStart(saved).at).toBe(back(REPAIR_WINDOW_MS));
  });

  it("reads a legacy plain-string cursor", () => {
    expect(readCursor("2026-09-21T10:00:00.000Z")).toEqual({ at: "2026-09-21T10:00:00.000Z", id: "" });
    expect(readCursor(undefined).at).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("cappedAtServerTime", () => {
  it("stands as it is until the server has said what time it is", () => {
    const cursor = { at: "2099-01-01T00:00:00.000Z", id: "x" };
    expect(cappedAtServerTime(cursor)).toBe(cursor);
  });

  it("keeps a cursor at the server's own instant, whichever way it is spelled", () => {
    noteServerDate("Mon, 21 Sep 2026 10:00:00 GMT");
    const cursor = { at: "2026-09-21T10:00:00+00:00", id: "x" };
    expect(cappedAtServerTime(cursor)).toBe(cursor);
    expect(cappedAtServerTime({ at: "2026-09-21T11:00:00.000Z", id: "y" }).id).toBe("");
  });
});
