// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Undo } from "../store/useUndo";

const played = vi.hoisted(() => ({ moves: [] as string[], signs: [] as number[] }));
vi.mock("../components/mascot-element", () => ({
  mascotPlay: (g: string) => played.moves.push(g),
  mascotSign: (n: number) => played.signs.push(n),
  setLateClock: () => {},
  itIsLate: () => false,
}));

// A poke answers with the weather where it is on (`useSpeech.test.tsx`); here it is the sync answer that is held.
vi.mock("./useWeatherLine", () => ({
  useWeatherLine: () => null,
  useWeatherOnPoke: () => ({ enabled: false, ask: async () => null }),
}));

import { answerTick, celebrate, emptiedTrash, hush, isMilestone, quoted, resetMoments, robotSays, tidiedUp, tidyWords } from "./mascotMoments";
import { useSpeech } from "./useSpeech";

beforeEach(() => {
  vi.useFakeTimers();
  played.moves = [];
  played.signs = [];
  localStorage.clear();
});

afterEach(() => {
  act(() => resetMoments());
  vi.useRealTimers();
});

describe("what a finished Tidy up says", () => {
  it("names only what happened", () => {
    expect(tidyWords({ moved: 12, archived: 0, binned: 0, left: 3 })).toBe("12 filed, 3 left");
    expect(tidyWords({ moved: 0, archived: 2, binned: 1, left: 0 })).toBe("2 archived, 1 deleted");
    expect(tidyWords({ moved: 0, archived: 0, binned: 0, left: 0 })).toBeNull();
    expect(tidyWords({ moved: 0, archived: 0, binned: 0, left: 0, reminded: 2 })).toBe("2 reminded");
  });

  it("hops and says it, or does nothing when nothing changed", () => {
    tidiedUp({ moved: 0, archived: 0, binned: 0, left: 0 });
    expect(played.moves).toEqual([]);
    tidiedUp({ moved: 4, archived: 0, binned: 0, left: 1 });
    expect(played.moves).toEqual(["hop"]);
  });
});

describe("the last box ticked", () => {
  it("nods only when the tick left no open box", () => {
    answerTick("[ ] milk\n[ ] eggs", "[x] milk\n[ ] eggs");
    expect(played.moves).toEqual([]);
    answerTick("[x] milk\n[ ] eggs", "[x] milk\n[x] eggs");
    expect(played.moves).toEqual(["yes"]);
    // Unticking is not finishing.
    answerTick("[x] milk\n[x] eggs", "[ ] milk\n[x] eggs");
    expect(played.moves).toEqual(["yes"]);
  });
});

describe("milestones", () => {
  it("are 100, 500 and every thousand", () => {
    expect([99, 100, 101, 250, 500, 999, 1000, 1500, 2000].filter(isMilestone)).toEqual([100, 500, 1000, 2000]);
  });

  it("hold up the sign once per milestone on this device", () => {
    expect(celebrate(500)).toBe(true);
    expect(celebrate(500)).toBe(false);
    expect(celebrate(501)).toBe(false);
    expect(played.signs).toEqual([500]);
  });
});

describe("emptying the Trash", () => {
  it("shivers and says how much went", () => {
    emptiedTrash(14);
    expect(played.moves).toEqual(["shake"]);
  });
});

it("quotes a search, cut short when long", () => {
  expect(quoted("  dentist ")).toBe('"dentist"');
  expect(quoted("a very long search that goes on and on")).toBe('"a very long search that…"');
});

describe("a moment in the bubble", () => {
  const base = {
    offer: null as Undo | null,
    onUndo: () => {},
    landed: null,
    failed: null,
    updateReady: false,
    onUpdate: () => {},
    online: true,
    syncs: true,
    working: false,
    syncedAt: null as number | null,
    unsent: async () => 0,
  };
  const undo: Undo = { key: 7, message: "Archived 1", steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }] };

  it("is said for a moment, then goes", () => {
    const { result } = renderHook(() => useSpeech(base));
    act(() => robotSays("Emptied 3 notes"));
    expect(result.current.said?.words).toBe("Emptied 3 notes");
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.said).toBeNull();
  });

  it("can be stopped early, but only while it is still the one being said", () => {
    const { result } = renderHook(() => useSpeech(base));
    let older = "";
    act(() => {
      older = robotSays("one");
      robotSays("two");
    });
    act(() => hush(older));
    expect(result.current.said?.words).toBe("two");
  });

  it("is said over an older notice, and gives way to a newer one", () => {
    const copied: Undo = { key: 6, message: "Copied 3", steps: [] };
    const { result, rerender } = renderHook((props: { offer: Undo | null }) => useSpeech({ ...base, ...props }), {
      initialProps: { offer: copied },
    });
    expect(result.current.said?.words).toBe("Copied 3 notes");
    act(() => robotSays("12 filed, 3 left"));
    expect(result.current.said?.words).toBe("12 filed, 3 left");
    rerender({ offer: { ...copied, key: 9 } });
    expect(result.current.said?.words).toBe("Copied 3 notes");
  });

  it("never takes a poke's answer", () => {
    const { result } = renderHook(() => useSpeech({ ...base, syncedAt: Date.now() }));
    act(() => result.current.onPoke());
    act(() => robotSays("Emptied 3 notes"));
    expect(result.current.said?.words).toMatch(/^Beep. All synced/);
  });

  it("never covers an offer that can still be undone", () => {
    const { result } = renderHook(() => useSpeech({ ...base, offer: undo }));
    act(() => robotSays("1 deleted"));
    expect(result.current.said?.words).toBe("Archived 1 note");
    expect(result.current.said?.act?.verb).toBe("Undo");
  });
});
