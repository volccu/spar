// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Note } from "../types";
import { note as base } from "../test/fixtures";
import { SPENT_AFTER_MS } from "../lib/reminders";

vi.mock("./push", () => ({
  disablePush: vi.fn(async () => "off"),
  enablePush: vi.fn(async () => "on"),
  pushState: vi.fn(async () => "on"),
  refreshPush: vi.fn(async () => undefined),
  ringingOff: () => false,
  setRingingOff: vi.fn(),
}));
const answers = vi.hoisted(() => ({ waiting: [] as { note_id: string }[] }));
vi.mock("../lib/reminderActions", () => ({
  // A stand-in snooze: any answer moves the reminder an hour on from now.
  answerPatch: () => ({ reminder_at: new Date(Date.now() + 3_600_000).toISOString() }),
  takeReminderAnswers: async () => answers.waiting.splice(0),
}));

import { enablePush } from "./push";
import { resetMoments } from "../lib/mascotMoments";
import { useReminders } from "./useReminders";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const at = (ms: number) => new Date(ms).toISOString();

/**
 * A reminder that rings once clears itself once it has rung (2026-10-14, the
 * owner's ask) — but only where something rings at all.
 */
describe("a one-off reminder clearing itself", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const notes = (): Note[] => [
    base({ id: "rang", reminder_at: at(NOW - SPENT_AFTER_MS - 1) }),
    base({ id: "soon", reminder_at: at(NOW + 60_000) }),
    base({ id: "daily", reminder_at: at(NOW - 3 * SPENT_AFTER_MS), reminder_repeat: "daily" }),
  ];

  function mount(over: Partial<Parameters<typeof useReminders>[0]> = {}) {
    const update = vi.fn();
    const notesRef = { current: notes() };
    renderHook(() =>
      useReminders({
        update,
        notesRef,
        loading: false,
        syncConfigured: true,
        deviceOnly: false,
        pulledOnce: true,
        onOpen: () => {},
        ...over,
      }),
    );
    return update;
  }

  it("clears one that has rung, after the answers are in, and leaves the rest", async () => {
    const update = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("rang", { reminder_at: null });
  });

  /*
   * The notes it reads are the board's, and the board has not drawn the snooze
   * yet when the clear runs straight after the answers: it still sees the old,
   * spent time. A Later pressed in the shade and collected late was snoozed
   * and then wiped in the same breath (bughunt 2026-10-15).
   */
  it("does not wipe a reminder a Later has just moved on", async () => {
    answers.waiting.push({ note_id: "rang" });
    const update = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalledWith("rang", { reminder_at: null });
  });

  it("clears one that rings while the app stays open", async () => {
    const update = mount();
    await vi.advanceTimersByTimeAsync(0);
    update.mockClear();
    await vi.advanceTimersByTimeAsync(60_000 + SPENT_AFTER_MS + 60_000);
    expect(update).toHaveBeenCalledWith("soon", { reminder_at: null });
  });

  it("clears nothing where nothing rings, or before the first word from the server", async () => {
    for (const over of [{ syncConfigured: false }, { deviceOnly: true }, { pulledOnce: false }]) {
      const update = mount(over);
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(update).not.toHaveBeenCalled();
    }
  });
});

describe("turning this device on for reminders", () => {
  afterEach(() => {
    cleanup();
    resetMoments();
    vi.mocked(enablePush).mockResolvedValue("on");
  });

  it("does not leave a thrown failure unheard", async () => {
    vi.mocked(enablePush).mockRejectedValue(new Error("offline"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useReminders({
        update: vi.fn(),
        notesRef: { current: [] },
        loading: false,
        syncConfigured: true,
        deviceOnly: false,
        pulledOnce: true,
        onOpen: () => {},
      }),
    );
    await act(async () => {
      result.current.enableRing();
    });
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });
});
