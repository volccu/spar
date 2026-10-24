// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEADS_UP_MS, HEADS_UP_SAY_MS, headsUpName, headsUpWords, nextToRing, useReminderHeadsUp } from "./useReminderHeadsUp";
import type { Note } from "../types";

const at = (ms: number) => new Date(ms).toISOString();
function note(id: string, body: string, reminder: number | null, status: Note["status"] = "active"): Note {
  return {
    id, raw_content: body, body, source: "web", created_at: at(0), updated_at: at(0), note_type: null, board_id: null,
    status, priority: 0, reminder_at: reminder === null ? null : at(reminder), done: null, merged_from: null, keep_id: null,
    attachments: [],
  } as Note;
}

describe("the reminder heads-up's words", () => {
  it("names the note by its name, else its first line, and stops short of the bubble's width", () => {
    expect(headsUpName("# Dentist\n\nmove to Thursday")).toBe("Dentist");
    expect(headsUpName("\n- [ ] call the plumber\n")).toBe("call the plumber");
    expect(headsUpName("x".repeat(80))).toMatch(/…$/);
    expect(headsUpName("")).toBe("a note");
  });

  it("says the minutes left, never zero", () => {
    expect(headsUpWords("Call the dentist", 5 * 60_000, 0)).toBe("Ding. In 5 minutes: Call the dentist");
    expect(headsUpWords("Call the dentist", 20_000, 0)).toBe("Ding. In 1 minute: Call the dentist");
  });

  it("finds the next reminder still ahead, leaving the trash out", () => {
    const now = 1_000_000;
    const notes = [note("a", "later", now + 600_000), note("b", "binned", now + 60_000, "trashed"), note("c", "soon", now + 120_000), note("d", "rang", now - 1)];
    expect(nextToRing(notes, now)?.note.id).toBe("c");
  });
});

describe("the reminder heads-up", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("speaks up five minutes before, once, for a few seconds, and opens the note", () => {
    const open = vi.fn();
    const notes = [note("n1", "Call the dentist", 1_000_000 + HEADS_UP_MS + 60_000)];
    const { result } = renderHook(() => useReminderHeadsUp(notes, open));
    expect(result.current).toBeNull();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current?.words).toBe("Ding. In 5 minutes: Call the dentist");
    act(() => result.current?.act?.run());
    expect(open).toHaveBeenCalledWith("n1");
    expect(result.current).toBeNull();
  });

  it("goes by itself and is not said twice for the same ring", () => {
    const notes = [note("n2", "Stand-up", 1_000_000 + 2 * 60_000)];
    const { result, rerender } = renderHook((p) => useReminderHeadsUp(p, () => {}), { initialProps: notes });
    expect(result.current?.words).toBe("Ding. In 2 minutes: Stand-up");
    act(() => {
      vi.advanceTimersByTime(HEADS_UP_SAY_MS);
    });
    expect(result.current).toBeNull();
    rerender([...notes]);
    expect(result.current).toBeNull();
  });
});
