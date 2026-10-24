// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_KEY, hasKeyboard, hotkeyLabel, hotkeyTitle, keyCaps, SEARCH_KEY } from "./hotkeys";

/**
 * One keyboard question, asked from two places.
 *
 * The drawn hint and the capture bar's Enter are the same question — *does
 * this device have a hardware keyboard* — and they used to be two different
 * media queries, `(hover: hover) and (pointer: fine)` for the hint and
 * `(pointer: coarse)` for the bar. Two spellings of one fact is the drift this
 * repo settles everywhere else with a single exported predicate, so there is
 * now one, and `breakpoint.test.ts` holds the source to it.
 *
 * What the two callers still disagree about, correctly, is the answer where
 * the question cannot be put at all — which is every test in this suite, since
 * jsdom implements no `matchMedia` whatever. A hint must not be invented, so
 * it asks with `false`; the capture bar's Enter must go on saving, so it asks
 * with `true`. That is the whole of `whenUnasked`.
 */
const HARDWARE = "(hover: hover) and (pointer: fine)";

function stubMedia(answer: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: answer(query),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("hasKeyboard", () => {
  it("says yes to a hovering fine pointer, whatever the caller would have assumed", () => {
    stubMedia((query) => query === HARDWARE);
    expect(hasKeyboard(false)).toBe(true);
    expect(hasKeyboard(true)).toBe(true);
  });

  it("says no to a phone, whatever the caller would have assumed", () => {
    // A coarse pointer that cannot hover: neither half of the pair matches.
    stubMedia(() => false);
    expect(hasKeyboard(false)).toBe(false);
    expect(hasKeyboard(true)).toBe(false);
  });

  it("hands the caller its own assumption back where nothing will answer", () => {
    // No stub: jsdom has no matchMedia at all, which is the case the two
    // callers deliberately answer in opposite directions.
    expect(typeof window.matchMedia).toBe("undefined");
    expect(hasKeyboard(false)).toBe(false);
    expect(hasKeyboard(true)).toBe(true);
  });

  it("asks the one query and no other", () => {
    const asked: string[] = [];
    stubMedia((query) => {
      asked.push(query);
      return true;
    });
    hasKeyboard(false);
    expect(asked).toEqual([HARDWARE]);
  });
});

/**
 * The box draws the shortcut and the words say it. Both spellings exist
 * because the drawn one is a *symbol* on a Mac, which a screen reader has
 * nothing useful to make of — so the accessible name of whatever the shortcut
 * opens carries the spelled-out form instead (`App.tsx`'s search field, and
 * `Hotkey`'s `announce` inside the menu's Search row).
 */
describe("how a shortcut is written", () => {
  it("draws the modifier short and says it long", () => {
    // No Mac under the test runner, so both fall to the word.
    expect(hotkeyLabel(SEARCH_KEY)).toBe("Ctrl K");
    expect(hotkeyTitle(SEARCH_KEY)).toBe("Ctrl+K");
    expect(hotkeyLabel(CAPTURE_KEY)).toBe("Ctrl E");
    expect(hotkeyTitle(CAPTURE_KEY)).toBe("Ctrl+E");
  });

  it("draws each key as a cap of its own", () => {
    expect(keyCaps("Ctrl K")).toEqual(["Ctrl", "K"]);
    expect(keyCaps("⌘K")).toEqual(["⌘", "K"]);
    expect(keyCaps("⌘Shift K")).toEqual(["⌘", "Shift", "K"]);
    expect(keyCaps("Shift Enter")).toEqual(["Shift", "Enter"]);
    expect(keyCaps("?")).toEqual(["?"]);
    expect(keyCaps("←")).toEqual(["←"]);
  });
});
