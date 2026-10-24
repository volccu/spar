import { beforeEach, describe, expect, it, vi } from "vitest";

/** The `meta` store, as far as this module is concerned. */
let meta: Record<string, unknown> = {};

vi.mock("./db", () => ({
  getMeta: async (key: string) => meta[key],
  setMeta: async (key: string, value: unknown) => {
    meta[key] = value;
  },
}));

import { clearRefusals, HOLD_AFTER, heldNotes, isHeld, recordRefusal } from "./held";

const STAMP = "2026-09-06T12:00:00.000Z";

async function refuse(times: number, stamp = STAMP, message = "raw_content is immutable") {
  let held = false;
  for (let i = 0; i < times; i++) held = await recordRefusal("n1", stamp, message);
  return held;
}

beforeEach(() => {
  meta = {};
});

describe("a note the server keeps refusing", () => {
  it("is offered again for the first few refusals", async () => {
    expect(await refuse(HOLD_AFTER - 1)).toBe(false);
    expect(await heldNotes()).toEqual([]);
  });

  it("is held once it has been refused enough times, with the server's own words", async () => {
    expect(await refuse(HOLD_AFTER)).toBe(true);
    expect(await heldNotes()).toEqual([
      { id: "n1", stamp: STAMP, message: "raw_content is immutable", count: HOLD_AFTER },
    ]);
  });

  /** Editing it is itself a retry: the row the server refused is gone. */
  it("starts again from zero when a newer version is written", async () => {
    await refuse(HOLD_AFTER);
    const held = await recordRefusal("n1", "2026-09-06T13:00:00.000Z", "still no");
    expect(held).toBe(false);
    expect(await heldNotes()).toEqual([]);
  });

  it("is forgotten when it finally goes up, or when the user asks again", async () => {
    await refuse(HOLD_AFTER);
    await clearRefusals(["n1"]);
    expect(await heldNotes()).toEqual([]);
    // And the count really did reset, rather than the list merely being hidden.
    expect(await refuse(1)).toBe(false);
  });

  it("answers about one exact version, not about the note in general", async () => {
    await refuse(HOLD_AFTER);
    const held = await heldNotes();
    expect(isHeld(held, "n1", STAMP)).toBe(true);
    expect(isHeld(held, "n1", "2026-09-06T13:00:00.000Z")).toBe(false);
    expect(isHeld(held, "n2", STAMP)).toBe(false);
  });

  it("writes nothing when asked to forget a note it never knew", async () => {
    meta = {};
    await clearRefusals(["never-seen"]);
    expect(meta.heldNotes).toBeUndefined();
  });
});
