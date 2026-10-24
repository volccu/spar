// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_WORDS, agoWords, reminderReceipt, spokenUndo, useSpeech } from "./useSpeech";
import type { Undo } from "../store/useUndo";
import { setTwin, twinWords } from "./twinSaid";
import type { Note } from "../types";

// The weather has its own tests (`weather.test.ts`); here a poke's answer is
// controlled: `pokeWeather.enabled` is the Settings switch, `pokeWeather.ask` the forecast.
const pokeWeather = vi.hoisted(() => ({
  enabled: false,
  ask: async (): Promise<{ words: string; strong: string[] } | null> => null,
}));
vi.mock("./useWeatherLine", () => ({
  useWeatherLine: () => null,
  useWeatherOnPoke: () => pokeWeather,
}));

describe("what the creature says about an undo", () => {
  it("gives a bare count its noun", () => {
    expect(spokenUndo("Archived 3")).toBe("Archived 3 notes");
    expect(spokenUndo("Deleted 1")).toBe("Deleted 1 note");
    expect(spokenUndo("Put back 2")).toBe("Put back 2 notes");
    expect(spokenUndo("Marked important 1")).toBe("Marked 1 note important");
    expect(spokenUndo("Marked to-do 4")).toBe("Marked 4 notes as to-do");
  });

  it("leaves a message that already names its thing as it is", () => {
    expect(spokenUndo("Moved 3 to Links")).toBe("Moved 3 to Links");
    expect(spokenUndo("Deleted Trip 2")).toBe("Deleted Trip 2");
    expect(spokenUndo("Copied 3 notes")).toBe("Copied 3 notes");
    expect(spokenUndo("Reminder set · today 20:00")).toBe("Reminder set · today 20:00");
  });

  it("says how long since the last clean sync in words", () => {
    const now = 10_000_000;
    expect(agoWords(now - 20_000, now)).toBe("just now");
    expect(agoWords(now - 60_000, now)).toBe("1 minute ago");
    expect(agoWords(now - 5 * 60_000, now)).toBe("5 minutes ago");
    expect(agoWords(now - 3 * 3_600_000, now)).toBe("3 hours ago");
    expect(agoWords(now - 2 * 86_400_000, now)).toBe("2 days ago");
  });

  it("offers a capture's reminder back, taking only the reminder off", () => {
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const receipt = reminderReceipt({ id: "n1", reminder_at: at } as Note);
    expect(receipt.message).toMatch(/^Reminder set · /);
    expect(receipt.steps).toEqual([{ id: "n1", expect: { reminder_at: at }, revert: { reminder_at: null } }]);
  });
});

describe("which sentence it says", () => {
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
  const undo: Undo = {
    key: 4,
    message: "Archived 2",
    steps: [{ id: "a", expect: { status: "archived" }, revert: { status: "active" } }],
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("says nothing when nothing is happening", () => {
    const { result } = renderHook(() => useSpeech(base));
    expect(result.current.said).toBeNull();
  });

  it("asks about the undo first, over everything that is merely true", () => {
    const { result } = renderHook(() =>
      useSpeech({ ...base, offer: undo, updateReady: true, failed: { label: "x", open: () => {} } }),
    );
    const said = result.current.said!;
    expect(said.words).toBe("Archived 2 notes");
    expect(said.act?.verb).toBe("Undo");
    expect(said.ask).toBe(true);
    expect(said.clockMs).toBe(8000);
  });

  it("tells a notice without a button", () => {
    const { result } = renderHook(() => useSpeech({ ...base, offer: { key: 1, message: "Copied 3", steps: [] } }));
    expect(result.current.said?.words).toBe("Copied 3 notes");
    expect(result.current.said?.act).toBeUndefined();
    expect(result.current.said?.ask).toBe(false);
  });

  it("names where a capture went, with Go", () => {
    const act = vi.fn();
    const { result } = renderHook(() =>
      useSpeech({ ...base, landed: { key: "landed:x", said: "In Inbox", place: "Inbox", verb: "Go", act } }),
    );
    expect(result.current.said?.words).toBe("Tucked into Inbox");
    result.current.said?.act?.run();
    expect(act).toHaveBeenCalled();
  });

  it("says a capture's receipt over an older offer, and a newer offer over the receipt", () => {
    const receipt = { key: "landed:x", said: "In Work", place: "Work", verb: "Go", act: () => {} };
    const { result, rerender } = renderHook((p) => useSpeech(p), { initialProps: { ...base, offer: undo } });
    expect(result.current.said?.words).toBe("Archived 2 notes");
    rerender({ ...base, offer: undo, landed: receipt });
    expect(result.current.said?.words).toBe("Tucked into Work");
    rerender({ ...base, offer: { ...undo, key: 5 }, landed: receipt });
    expect(result.current.said?.words).toBe("Archived 2 notes");
  });

  it("names where a capture went over the reminder it carried, arriving together", () => {
    const receipt = { key: "landed:y", said: "In Work", place: "Work", verb: "Go", act: () => {} };
    const reminder: Undo = { key: 9, message: "Reminder set · today 20:00", steps: [{ id: "y", expect: {}, revert: {} }] };
    const { result } = renderHook(() => useSpeech({ ...base, offer: reminder, landed: receipt }));
    expect(result.current.said?.words).toBe("Tucked into Work");
  });

  it("keeps saying a failed sync, and a waiting version, until they end", () => {
    const { result, rerender } = renderHook((p) => useSpeech(p), {
      initialProps: { ...base, failed: { label: "Sync failed: why", open: () => {} }, updateReady: true },
    });
    expect(result.current.said?.words).toBe("Uh-oh. Didn't sync");
    expect(result.current.said?.act?.verb).toBe("Details");
    // The button's name starts with the word on it.
    expect(result.current.said?.act?.label).toBe("Details: Sync failed: why");
    rerender({ ...base, updateReady: true });
    expect(result.current.said?.words).toBe("Ooh. A new version is ready");
    expect(result.current.said?.act?.verb).toBe("Reload");
  });

  it("answers a poke with how sync stands, for a moment", () => {
    const syncedAt = Date.now() - 2 * 60_000;
    const { result } = renderHook(() => useSpeech({ ...base, syncedAt }));
    act(() => result.current.onPoke());
    expect(result.current.said?.words).toBe("Beep. All synced · 2 minutes ago");
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(result.current.said).toBeNull();
  });

  it("answers a poke on a device that syncs nowhere, and while offline", () => {
    const { result, rerender } = renderHook((p) => useSpeech(p), { initialProps: { ...base, syncs: false } });
    act(() => result.current.onPoke());
    expect(result.current.said?.words).toBe("Beep. Your notes are kept on this device.");
    rerender({ ...base, online: false });
    expect(result.current.said?.words).toBe(OFFLINE_WORDS);
  });

  it("says the connection going and coming back, once each", async () => {
    const { result, rerender } = renderHook((p) => useSpeech(p), { initialProps: base });
    rerender({ ...base, online: false });
    expect(result.current.said?.words).toBe(OFFLINE_WORDS);
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current.said).toBeNull();
    rerender({ ...base, online: true, unsent: async () => 3 });
    await act(async () => {});
    expect(result.current.said?.words).toBe("Beep. Back online. Sending 3 changes…");
  });

  it("syncs on a double tap, says so while it runs, and says when it is done", () => {
    const syncNow = vi.fn();
    const { result, rerender } = renderHook((p) => useSpeech(p), { initialProps: { ...base, syncNow, syncedAt: 1 } });
    act(() => result.current.onPoke());
    act(() => result.current.onPoke());
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(result.current.said?.words).toBe("Whirr. Syncing…");
    rerender({ ...base, syncNow, syncedAt: Date.now() + 1 });
    expect(result.current.said?.words).toBe("Beep. All synced · just now");
  });

  it("answers a double tap as a poke where there is no server to sync to", () => {
    const syncNow = vi.fn();
    const { result } = renderHook(() => useSpeech({ ...base, syncNow, syncs: false }));
    act(() => result.current.onPoke());
    act(() => result.current.onPoke());
    expect(syncNow).not.toHaveBeenCalled();
    expect(result.current.said?.words).toBe("Beep. Your notes are kept on this device.");
  });

  it("points out a link that is already saved, with Open", () => {
    const open = vi.fn();
    const { result } = renderHook(() => useSpeech(base));
    act(() => setTwin({ key: "saved:x", said: "Saved 3 days ago", verb: "Open", act: open }));
    expect(result.current.said?.words).toBe("Hm. You saved this 3 days ago");
    result.current.said?.act?.run();
    expect(open).toHaveBeenCalled();
    act(() => setTwin(null));
    expect(result.current.said).toBeNull();
  });

  it("says an archived twin is in the Archive", () => {
    expect(twinWords("Saved on 5 Aug, archived")).toBe("Hm. You saved this on 5 Aug, it's in the Archive");
    expect(twinWords("Already saved")).toBe("Hm. You already saved this");
  });

  it("answers a poke with the weather now, and hums until it comes", async () => {
    let arrive: (line: { words: string; strong: string[] } | null) => void = () => {};
    pokeWeather.enabled = true;
    pokeWeather.ask = () => new Promise((r) => (arrive = r));
    try {
      const { result } = renderHook(() => useSpeech({ ...base, syncedAt: Date.now() }));
      act(() => result.current.onPoke());
      expect(result.current.said?.words).toBe("Hm…");
      expect(result.current.said?.busy).toBe(true);
      await act(async () => arrive({ words: "Beep. 12° and cloudy out.", strong: ["12°", "cloudy"] }));
      expect(result.current.said?.words).toBe("Beep. 12° and cloudy out.");
      expect(result.current.said?.strong).toEqual(["12°", "cloudy"]);
      expect(result.current.said?.busy).toBeUndefined();
    } finally {
      pokeWeather.enabled = false;
    }
  });

  it("falls back to how sync stands where the weather is not to be had", async () => {
    pokeWeather.enabled = true;
    pokeWeather.ask = async () => null;
    try {
      const { result } = renderHook(() => useSpeech({ ...base, syncedAt: Date.now() }));
      await act(async () => result.current.onPoke());
      expect(result.current.said?.words).toBe("Beep. All synced · just now");
    } finally {
      pokeWeather.enabled = false;
    }
  });

  it("says nothing about the connection on a device that does not sync", () => {
    const { result, rerender } = renderHook((p) => useSpeech(p), { initialProps: { ...base, syncs: false } });
    rerender({ ...base, syncs: false, online: false });
    expect(result.current.said).toBeNull();
  });
});
