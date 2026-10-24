import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as hotkeys from "./hotkeys";
import { chordLabel, chordWords, SHORTCUTS, type Chord } from "./shortcuts";
import { GRID_KEYS } from "./useGridKeyboard";

/**
 * The About page's list of keys is only worth having if it is the whole list.
 * Every key here was once a shortcut for whoever wrote it; a list that has
 * quietly fallen behind the code is the same failure with a page drawn over
 * it. So the list is held to the code from three sides.
 *
 * Read in a plain Node environment, for the reason `breakpoint.test.ts` gives:
 * `import.meta.url` is only a real file URL outside jsdom.
 */

const every: Chord[] = SHORTCUTS.flatMap((group) => group.shortcuts.flatMap((s) => s.keys));
const listed = new Set(every.map((chord) => chord.key.toLowerCase()));

describe("the list of keys", () => {
  it("names every shortcut constant in lib/hotkeys.ts", () => {
    const constants = Object.entries(hotkeys)
      .filter(([name, value]) => name.endsWith("_KEY") && typeof value === "string")
      .map(([name, value]) => [name, value as string] as const);
    // The seven there are when this was written; an eighth must be listed too.
    expect(constants.length).toBeGreaterThanOrEqual(7);
    for (const [name, value] of constants) {
      expect(listed.has(value.toLowerCase()), `${name} ("${value}") is not listed`).toBe(true);
    }
  });

  it("names every key the grid answers to, under the cards", () => {
    const cards = SHORTCUTS.find((group) => group.where === "The cards");
    const keys = new Set(cards?.shortcuts.flatMap((s) => s.keys.map((chord) => chord.key)));
    for (const key of GRID_KEYS) expect(keys.has(key), key).toBe(true);
  });

  /**
   * The drift test. Every key a component compares `KeyboardEvent.key`
   * against, read out of the source — `e.key === "ArrowRight"`,
   * `key !== "Enter"`, `e.key.toLowerCase() !== UNDO_KEY` is a constant and is
   * the test above's business. A binding added anywhere with a key this list
   * has never heard of fails here until it is written down, or until it is
   * named below as the browser's own.
   */
  it("mentions every key a component actually listens for", () => {
    // Not shortcuts: Tab moving the focus (kept inside a dialog, never
    // changed), and Space pressing the focused control, as every button does.
    const browsersOwn = new Set(["tab", " "]);
    const root = fileURLToPath(new URL("..", import.meta.url));
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "seed" ? [] : sources(full);
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
        return [full];
      });

    const found = new Map<string, string>();
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/(typeof\s+)?\bkey(?:\.toLowerCase\(\))?\s*[!=]==\s*"([^"]*)"/g)) {
        if (m[1]) continue; // `typeof key === "string"` is a type check, not a key.
        found.set(m[2].toLowerCase(), path.relative(root, file));
      }
    }
    // The scan has to be finding something, or it proves nothing.
    expect(found.has("arrowright")).toBe(true);
    expect(found.has("escape")).toBe(true);
    for (const [key, file] of found) {
      if (browsersOwn.has(key)) continue;
      expect(listed.has(key), `"${key}" (in ${file}) is not in lib/shortcuts.ts`).toBe(true);
    }
  });

  it("gives every line something to press and something it does", () => {
    for (const group of SHORTCUTS) {
      expect(group.shortcuts.length, group.where).toBeGreaterThan(0);
      for (const s of group.shortcuts) {
        expect(s.keys.length, s.does).toBeGreaterThan(0);
        expect(s.does.trim()).not.toBe("");
      }
    }
  });
});

describe("how a key is written", () => {
  it("draws the modifier the way the hints do, and says it in words", () => {
    // No Mac under the test runner, so both fall to the word.
    expect(chordLabel({ key: hotkeys.SEARCH_KEY, mod: true })).toBe(
      hotkeys.hotkeyLabel(hotkeys.SEARCH_KEY),
    );
    expect(chordWords({ key: hotkeys.SEARCH_KEY, mod: true })).toBe(
      hotkeys.hotkeyTitle(hotkeys.SEARCH_KEY),
    );
    expect(chordLabel({ key: "Enter", mod: true })).toBe("Ctrl Enter");
    expect(chordWords({ key: "Enter", mod: true })).toBe("Ctrl+Enter");
  });

  it("draws arrows as arrows and says them as words", () => {
    expect(chordLabel({ key: "ArrowLeft" })).toBe("←");
    expect(chordWords({ key: "ArrowLeft" })).toBe("Left arrow");
    expect(chordLabel({ key: "Escape" })).toBe("Esc");
    expect(chordLabel({ key: "Enter", shift: true })).toBe("Shift Enter");
    expect(chordWords({ key: "?" })).toBe("Question mark");
    expect(chordLabel({ key: "ContextMenu" })).toBe("Menu");
    expect(chordWords({ key: "F10", shift: true })).toBe("Shift+F10");
  });
});
