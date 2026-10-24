// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Note } from "../types";
import { DECK_PAGE } from "./useDeckGrowth";
import { GRID_FILL_AFTER_MS, GRID_FILL_COUNT } from "./useGridFill";
import { useGridContents } from "./useGridContents";

const notes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `n${i}` }) as unknown as Note);

type Props = {
  fillKey: string;
  visible: Note[];
  restored?: boolean;
  openId?: string | null;
};
const scrollRef = { current: document.createElement("main") };
const run = (initialProps: Props) =>
  renderHook(
    ({ fillKey, visible, restored = false, openId = null }: Props) =>
      useGridContents(fillKey, visible, restored, scrollRef, openId),
    { initialProps },
  );

describe("useGridContents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // An observer that never fires: growth is enabled but nothing scrolls.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("hands over the board itself when it fits", () => {
    const visible = notes(5);
    const { result } = run({ fillKey: "inbox", visible });
    expect(result.current.deck).toBe(visible);
    expect(result.current.wantsEnd).toBe(false);
  });

  it("holds a freshly paged-to big board at a screenful, then a page, with the end marker once growth is the limit", () => {
    const visible = notes(3000);
    const { result, rerender } = run({ fillKey: "inbox", visible: notes(3) });
    rerender({ fillKey: "archive", visible });
    expect(result.current.deck).toEqual(visible.slice(0, GRID_FILL_COUNT));
    // While the fill is the limit, the end marker is not drawn.
    expect(result.current.wantsEnd).toBe(false);

    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS));
    expect(result.current.deck).toHaveLength(DECK_PAGE);
    expect(result.current.wantsEnd).toBe(true);
  });

  it("mounts a remembered board whole on arrival", () => {
    const { result, rerender } = run({ fillKey: "inbox", visible: notes(3) });
    const visible = notes(300);
    rerender({ fillKey: "archive", visible, restored: true });
    expect(result.current.deck).toBe(visible);
    expect(result.current.wantsEnd).toBe(false);
  });

  it("is never short of the open note's card", () => {
    const visible = notes(400);
    const { result, rerender } = run({ fillKey: "inbox", visible: notes(3) });
    rerender({ fillKey: "archive", visible, openId: "n250" });
    act(() => vi.advanceTimersByTime(GRID_FILL_AFTER_MS));
    expect(result.current.deck.length).toBeGreaterThanOrEqual(251);
    expect(result.current.deck.some((n) => n.id === "n250")).toBe(true);
  });

  it("mounts the first view of a back-from-a-link boot whole, and only that one", () => {
    const nav = vi
      .spyOn(performance, "getEntriesByType")
      .mockReturnValue([{ type: "back_forward" } as unknown as PerformanceEntry]);
    const first = notes(500);
    const { result, rerender } = run({ fillKey: "inbox", visible: first });
    expect(result.current.deck).toBe(first);
    rerender({ fillKey: "archive", visible: notes(500) });
    expect(result.current.deck).toHaveLength(GRID_FILL_COUNT);
    nav.mockRestore();
  });
});
