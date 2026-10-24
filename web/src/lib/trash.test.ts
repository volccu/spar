import { describe, expect, it } from "vitest";
import { closeToSweep, daysLeftInTrash, expiredInTrash, sortTrash, trashedAt, TRASH_DAYS, TRASH_WARN_DAYS } from "./trash";
import type { Note } from "../types";
import { note as base } from "../test/fixtures";

const note = (partial: Partial<Note>): Note =>
  base({
    id: crypto.randomUUID(),
    raw_content: "",
    body: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  });

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-06T12:00:00Z");


function trashedDaysAgo(days: number): Note {
  return note({
    status: "trashed",
    updated_at: new Date(NOW - days * DAY).toISOString(),
  });
}

describe("expiredInTrash", () => {
  it("keeps a note that still has time left", () => {
    expect(expiredInTrash([trashedDaysAgo(TRASH_DAYS - 1)], NOW)).toHaveLength(0);
  });

  it("takes a note whose month is up", () => {
    expect(expiredInTrash([trashedDaysAgo(TRASH_DAYS + 1)], NOW)).toHaveLength(1);
  });

  it("never takes a note that is not in the trash, however old", () => {
    const ancient = note({
      status: "archived",
      updated_at: new Date(NOW - 900 * DAY).toISOString(),
    });
    const active = note({
      status: "active",
      updated_at: new Date(NOW - 900 * DAY).toISOString(),
    });
    expect(expiredInTrash([ancient, active], NOW)).toHaveLength(0);
  });
});

describe("daysLeftInTrash", () => {
  it("counts down from the full term", () => {
    expect(daysLeftInTrash(trashedDaysAgo(0), NOW)).toBe(TRASH_DAYS);
    expect(daysLeftInTrash(trashedDaysAgo(29), NOW)).toBe(1);
  });

  it("rounds up, so the last day reads as a day and not as zero", () => {
    const almost = note({
      status: "trashed",
      updated_at: new Date(NOW - (TRASH_DAYS * DAY - 60_000)).toISOString(),
    });
    expect(daysLeftInTrash(almost, NOW)).toBe(1);
  });

  it("never goes negative once the term is past", () => {
    expect(daysLeftInTrash(trashedDaysAgo(400), NOW)).toBe(0);
  });
});

describe("closeToSweep", () => {
  it("says nothing about a note that just entered the trash", () => {
    expect(closeToSweep([trashedDaysAgo(0)], NOW)).toHaveLength(0);
  });

  it("mentions a note right at the warning threshold", () => {
    expect(
      closeToSweep([trashedDaysAgo(TRASH_DAYS - TRASH_WARN_DAYS)], NOW),
    ).toHaveLength(1);
  });

  it("mentions a note that has already gone past its term", () => {
    expect(closeToSweep([trashedDaysAgo(TRASH_DAYS + 5)], NOW)).toHaveLength(1);
  });

  it("never mentions a note that is not in the trash", () => {
    const active = note({
      status: "active",
      updated_at: new Date(NOW - 900 * DAY).toISOString(),
    });
    expect(closeToSweep([active], NOW)).toHaveLength(0);
  });

  it("counts every note close enough, not just the oldest", () => {
    const notes = [trashedDaysAgo(0), trashedDaysAgo(TRASH_DAYS - 1), trashedDaysAgo(TRASH_DAYS)];
    expect(closeToSweep(notes, NOW)).toHaveLength(2);
  });
});

describe("sortTrash", () => {
  const at = (days: number) => new Date(NOW - days * DAY).toISOString();

  it("puts the note deleted last first, by the status clock", () => {
    const old = note({ status: "trashed", updated_at: at(1), field_updated_at: { status: at(20) } });
    const fresh = note({ status: "trashed", updated_at: at(9), field_updated_at: { status: at(2) } });
    const middle = note({ status: "trashed", updated_at: at(3), field_updated_at: { status: at(10) } });
    expect(sortTrash([old, middle, fresh]).map((n) => n.id)).toEqual([fresh.id, middle.id, old.id]);
  });

  it("falls back to the last write for a note with no clocks", () => {
    const clockless = note({ status: "trashed", updated_at: at(5) });
    const clocked = note({ status: "trashed", updated_at: at(1), field_updated_at: { status: at(8) } });
    expect(trashedAt(clockless)).toBe(at(5));
    expect(sortTrash([clocked, clockless]).map((n) => n.id)).toEqual([clockless.id, clocked.id]);
  });

  it("breaks a tie on the last write, then the creation date", () => {
    const a = note({ status: "trashed", updated_at: at(4), created_at: at(30), field_updated_at: { status: at(4) } });
    const b = note({ status: "trashed", updated_at: at(4), created_at: at(20), field_updated_at: { status: at(4) } });
    expect(sortTrash([a, b]).map((n) => n.id)).toEqual([b.id, a.id]);
  });
});
