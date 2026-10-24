// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/mascot-element", () => ({
  mascotPlay: () => {},
  mascotGlance: () => {},
  mascotSign: () => {},
  setLateClock: () => {},
  itIsLate: () => false,
}));

import { resetMoments, useMoment } from "./mascotMoments";
import { useMascotMoments } from "./useMascotMoments";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  resetMoments();
  vi.useRealTimers();
});

type Search = { query: string; found: number; inTrash: number; goToTrash: () => void } | null;
const hear = (search: Search) =>
  renderHook(
    ({ s }: { s: Search }) => {
      useMascotMoments({ online: true, syncs: false, unsent: async () => 0, notes: [], landed: null, search: s });
      return useMoment();
    },
    { initialProps: { s: search } },
  );

/** Review 2026-10-24, UX-04: the miss line goes as soon as the search finds something again. */
describe("the robot's line for a search that found nothing", () => {
  it("is dropped once a new word finds a note", () => {
    const miss = { query: "zebra", found: 0, inTrash: 0, goToTrash: () => {} };
    const { result, rerender } = hear(miss);
    act(() => void vi.advanceTimersByTime(1_000));
    expect(result.current?.words).toBe('Hm. Nothing for "zebra"');
    rerender({ s: { ...miss, query: "passport", found: 1 } });
    expect(result.current).toBeNull();
  });
});
