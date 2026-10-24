// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRID_FILL_AFTER_MS, GRID_FILL_COUNT, useGridFill } from "./useGridFill";

/**
 * The bargain under test: a freshly arrived view mounts a screenful, the rest
 * lands after the slide-in — and the first view of a boot is exempt, because
 * the back-from-a-link restore needs the whole scroll height on frame one.
 */
describe("useGridFill", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the first view whole, however big it is", () => {
    const { result } = renderHook(() => useGridFill("inbox", 200));
    expect(result.current).toBe(200);
  });

  it("holds a freshly paged-to big board at a screenful, then fills it", () => {
    const { result, rerender } = renderHook(
      ({ view, total }) => useGridFill(view, total),
      { initialProps: { view: "inbox", total: 3 } },
    );

    rerender({ view: "archive", total: 176 });
    expect(result.current).toBe(GRID_FILL_COUNT);

    // The rest arrives only once the slide-in has had its full run.
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS - 1));
    expect(result.current).toBe(GRID_FILL_COUNT);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(176);
  });

  it("never withholds a board that already fits in the first commit", () => {
    const { result, rerender } = renderHook(
      ({ view, total }) => useGridFill(view, total),
      { initialProps: { view: "inbox", total: 3 } },
    );

    rerender({ view: "todos", total: GRID_FILL_COUNT });
    expect(result.current).toBe(GRID_FILL_COUNT);
    // Nothing pending: no timer has anything left to add.
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS));
    expect(result.current).toBe(GRID_FILL_COUNT);
  });

  it("restarts the bargain when the view changes mid-fill", () => {
    const { result, rerender } = renderHook(
      ({ view, total }) => useGridFill(view, total),
      { initialProps: { view: "inbox", total: 2 } },
    );

    rerender({ view: "archive", total: 176 });
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS / 2));
    // Paged on before the fill landed — the old board's timer must not fill
    // the new one early.
    rerender({ view: "all", total: 59 });
    expect(result.current).toBe(GRID_FILL_COUNT);
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS - 1));
    expect(result.current).toBe(GRID_FILL_COUNT);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(59);
  });

  it("keeps holding while the total moves under a still-filling view", () => {
    const { result, rerender } = renderHook(
      ({ view, total }) => useGridFill(view, total),
      { initialProps: { view: "inbox", total: 2 } },
    );

    rerender({ view: "archive", total: 176 });
    // A sync pulls one more note in while the fill is pending: still a
    // screenful, and the same timer still finishes the job.
    rerender({ view: "archive", total: 177 });
    expect(result.current).toBe(GRID_FILL_COUNT);
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS));
    expect(result.current).toBe(177);
  });

  it("arrives whole when asked, for a board coming back to a place down its length", () => {
    // `useBoardScroll` puts a board back at its offset in the arrival commit;
    // forty cards would clamp that offset and land the reader somewhere else.
    const { result, rerender } = renderHook(
      ({ view, total, whole }) => useGridFill(view, total, whole),
      { initialProps: { view: "inbox", total: 2, whole: false } },
    );

    rerender({ view: "archive", total: 176, whole: true });
    expect(result.current).toBe(176);

    // Read on arrival only: a view already on screen is not re-chunked when
    // the flag drops, nor filled early when it rises.
    rerender({ view: "archive", total: 176, whole: false });
    expect(result.current).toBe(176);
    rerender({ view: "all", total: 59, whole: false });
    expect(result.current).toBe(GRID_FILL_COUNT);
    rerender({ view: "all", total: 59, whole: true });
    expect(result.current).toBe(GRID_FILL_COUNT);
  });
});
