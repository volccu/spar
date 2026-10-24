import { beforeEach, describe, expect, it } from "vitest";
import { forgetSent, isOwnEcho, PREFS_ROW, rememberSent } from "./echo";

describe("the realtime echo of this device's own upsert", () => {
  beforeEach(forgetSent);

  it("is recognised by id and instant, whichever way the server spells the instant", () => {
    rememberSent("notes", [{ id: "n1", updated_at: "2026-09-06T15:30:24.123Z" }]);
    expect(isOwnEcho("notes", { id: "n1", updated_at: "2026-09-06T15:30:24.123+00:00" })).toBe(true);
    expect(isOwnEcho("notes", { id: "n1", updated_at: "2026-09-06T15:30:24.123Z" })).toBe(true);
  });

  it("is not confused with the other device writing the same note", () => {
    rememberSent("notes", [{ id: "n1", updated_at: "2026-09-06T15:30:24.123Z" }]);
    expect(isOwnEcho("notes", { id: "n1", updated_at: "2026-09-06T15:30:25.000+00:00" })).toBe(false);
    expect(isOwnEcho("notes", { id: "n2", updated_at: "2026-09-06T15:30:24.123+00:00" })).toBe(false);
  });

  /**
   * A canvas's id *is* its idea note's id (migration 0010 makes it a foreign
   * key). Keyed by id alone, pushing the canvas disarmed the note's guard and
   * the note's echo woke a tick after all — or worse, a canvas echo was taken
   * for the note's and dropped.
   */
  it("keeps a canvas and the note it arranges apart, though they share an id", () => {
    const stamp = "2026-09-06T15:30:24.123Z";
    rememberSent("notes", [{ id: "shared", updated_at: stamp }]);
    rememberSent("folders", [{ id: "shared", updated_at: "2026-09-06T16:00:00.000Z" }]);

    expect(isOwnEcho("notes", { id: "shared", updated_at: stamp })).toBe(true);
    expect(isOwnEcho("folders", { id: "shared", updated_at: "2026-09-06T16:00:00.000Z" })).toBe(true);
    // Each guard answers for its own table and says nothing about the other's.
    expect(isOwnEcho("folders", { id: "shared", updated_at: stamp })).toBe(false);
  });

  /** The prefs row is keyed by an owner the client never writes. */
  it("recognises the prefs row by the name it was remembered under", () => {
    rememberSent("prefs", [{ id: PREFS_ROW, updated_at: "2026-09-06T15:30:24.123Z" }]);
    expect(
      isOwnEcho("prefs", { owner_id: "someone", updated_at: "2026-09-06T15:30:24.123+00:00" }, PREFS_ROW),
    ).toBe(true);
    expect(
      isOwnEcho("prefs", { owner_id: "someone", updated_at: "2026-09-06T15:31:00.000+00:00" }, PREFS_ROW),
    ).toBe(false);
  });

  it("wakes on anything it cannot read", () => {
    expect(isOwnEcho("notes", undefined)).toBe(false);
    expect(isOwnEcho("notes", {})).toBe(false);
    expect(isOwnEcho("notes", { id: "n1" })).toBe(false);
  });

  it("forgets the oldest once it is holding more than it needs", () => {
    rememberSent("notes", [{ id: "first", updated_at: "2026-09-06T00:00:00.000Z" }]);
    for (let i = 0; i < 300; i++) {
      rememberSent("notes", [{ id: `n${i}`, updated_at: "2026-09-06T00:00:00.000Z" }]);
    }
    expect(isOwnEcho("notes", { id: "first", updated_at: "2026-09-06T00:00:00.000Z" })).toBe(false);
    expect(isOwnEcho("notes", { id: "n299", updated_at: "2026-09-06T00:00:00.000Z" })).toBe(true);
  });
});
