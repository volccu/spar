import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UserBoard } from "../types";
import {
  BOARD_COLORS,
  boardLook,
  boardTint,
  orderMarks,
  SUGGESTED_MARKS,
  iconWords,
  isBoardColor,
  isBoardIcon,
  lucideMark,
  markSet,
} from "./boardLook";
import { setBoardLook } from "./boards";
import { EVERYDAY_MARKS, LUCIDE_NODES, searchOnly } from "./lucideSet";
import { filterMarks, LUCIDE_TAGS, SYNONYM_MARKS } from "./markSearch";

/** Every Lucide mark as the picker stores it, in the set's own order. */
const LUCIDE = Object.keys(LUCIDE_NODES).map(lucideMark);

const board = (extra: Partial<UserBoard> = {}): UserBoard => ({
  id: "b1",
  name: "Recipes",
  position: 0,
  ...extra,
});

describe("the palette", () => {
  it("is exactly sixteen, with no repeats in key or name", () => {
    expect(BOARD_COLORS).toHaveLength(16);
    expect(new Set(BOARD_COLORS.map((c) => c.key)).size).toBe(16);
    expect(new Set(BOARD_COLORS.map((c) => c.name)).size).toBe(16);
  });

  it("keeps the eight keys a synced board may already hold, each on its nearest colour", () => {
    // A key is what a board stores; renaming one strips the colour off every
    // board that wears it. Only the display name may move.
    const shown = (key: string) => BOARD_COLORS.find((c) => c.key === key)?.name;
    expect(shown("ember")).toBe("Rust");
    expect(shown("ochre")).toBe("Ochre");
    expect(shown("moss")).toBe("Moss");
    expect(shown("sage")).toBe("Fern");
    expect(shown("teal")).toBe("Forest");
    expect(shown("steel")).toBe("Slate");
    expect(shown("iris")).toBe("Dusk");
    expect(shown("plum")).toBe("Plum");
    for (const key of ["ember", "ochre", "moss", "sage", "teal", "steel", "iris", "plum"]) {
      expect(isBoardColor(key), key).toBe(true);
    }
  });

  it("offers the eight new keys as well", () => {
    for (const key of ["bone", "oat", "sand", "stone", "clay", "khaki", "olive", "salvia"]) {
      expect(isBoardColor(key), key).toBe(true);
    }
  });

  it("names a token per key, and the two agree", () => {
    for (const c of BOARD_COLORS) {
      expect(c.token).toBe(`--board-${c.key}`);
    }
  });
});

describe("reading a board's look back", () => {
  it("takes the sixteen and refuses everything else", () => {
    expect(isBoardColor("teal")).toBe(true);
    expect(isBoardColor("bone")).toBe(true);
    expect(isBoardColor("hotpink")).toBe(false);
    expect(isBoardColor(undefined)).toBe(false);
    // The failure that matters: an unknown key must not reach the stylesheet,
    // where `var(--board-)` resolves to nothing and paints the mark invisible.
    expect(boardTint(board({ color: "hotpink" }))).toBeNull();
  });

  it("gives the mark tint from the colour", () => {
    expect(boardTint(board({ color: "teal" }))).toBe("var(--board-teal)");
  });

  it("says nothing at all about a board with no colour", () => {
    expect(boardTint(board())).toBeNull();
  });

  it("accepts an icon name shaped like either set's own", () => {
    // A Heroicons export, which is what every folder dressed before
    // 2026-10-12 stores, and must keep drawing.
    expect(isBoardIcon("BookOpenIcon")).toBe(true);
    expect(markSet("BookOpenIcon")).toBe("heroicons");
    expect(isBoardIcon("bookOpenIcon")).toBe(false);
    expect(isBoardIcon("BookOpen")).toBe(false);
    // A Lucide name, behind a prefix no Heroicons export can spell.
    expect(isBoardIcon("lucide:fishing-rod")).toBe(true);
    expect(markSet("lucide:fishing-rod")).toBe("lucide");
    expect(isBoardIcon("lucide:Fish")).toBe(false);
    expect(isBoardIcon("lucide:")).toBe(false);
    expect(isBoardIcon("fishing-rod")).toBe(false);
    // Nothing that could be read as an expression, a path or a selector.
    expect(isBoardIcon("../../etc/Icon")).toBe(false);
    expect(isBoardIcon("lucide:../fish")).toBe(false);
    expect(isBoardIcon("")).toBe(false);
  });

  it("cleans a board written by something else on the way out", () => {
    expect(boardLook(board({ icon: "BookOpenIcon", color: "moss" }))).toEqual({
      icon: "BookOpenIcon",
      color: "moss",
    });
    expect(boardLook(board({ icon: "lucide:fish", color: "moss" })).icon).toBe("lucide:fish");
    expect(boardLook(board({ icon: "<script>", color: "#ff0000" }))).toEqual({
      icon: null,
      color: null,
    });
    expect(boardLook(undefined)).toEqual({ icon: null, color: null });
  });
});

describe("the Lucide set", () => {
  it("draws and searches from the same version of Lucide", () => {
    // The drawings come from `lucide-react`'s renderer and `lucide-static`'s
    // path data, the search words from `lucide-static` too: one version, or a
    // name the picker offers could have no drawing, or no words.
    const version = (name: string) =>
      (JSON.parse(readFileSync(join(__dirname, "..", "..", "node_modules", name, "package.json"), "utf8")) as {
        version: string;
      }).version;
    expect(version("lucide-react")).toBe(version("lucide-static"));
    const pinned = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pinned.dependencies["lucide-react"]).toBe(pinned.dependencies["lucide-static"]);
    expect(pinned.dependencies["lucide-react"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the whole set, every mark with its words", () => {
    // Some 1,850 in 1.48. The exact number is the package's business — what
    // matters is that this is the set, not a curated handful.
    expect(LUCIDE.length).toBeGreaterThan(1500);
    for (const name of Object.keys(LUCIDE_NODES)) expect(LUCIDE_TAGS[name], name).toBeDefined();
  });

  it("names nothing in the suggestions or the synonyms that the set does not have", () => {
    const have = new Set(LUCIDE);
    for (const mark of [...SUGGESTED_MARKS, ...SYNONYM_MARKS]) expect(have.has(mark), mark).toBe(true);
  });
});

describe("finding a mark", () => {
  it("says a mark's name in English", () => {
    expect(iconWords("lucide:fishing-rod")).toBe("fishing rod");
    expect(iconWords("lucide:arrow-down-0-1")).toBe("arrow down 0 1");
    // The older set's export names, for a folder still wearing one.
    expect(iconWords("AcademicCapIcon")).toBe("academic cap");
    expect(iconWords("ArrowDownTrayIcon")).toBe("arrow down tray");
    // The set has runs of capitals in it, and they must not split per letter.
    expect(iconWords("QrCodeIcon")).toBe("qr code");
  });

  it("narrows on every word typed, in any order", () => {
    const names = ["lucide:book-open", "lucide:bookmark", "lucide:arrow-down", "lucide:beaker"];
    expect(filterMarks(names, "book")).toEqual(["lucide:book-open", "lucide:bookmark"]);
    expect(filterMarks(names, "open book")).toEqual(["lucide:book-open"]);
    expect(filterMarks(names, "")).toEqual(names);
    expect(filterMarks(names, "   ")).toEqual(names);
    expect(filterMarks(names, "zzz")).toEqual([]);
  });

  it("finds fishing gear for a folder called Fishing (the owner's example)", () => {
    const found = filterMarks(LUCIDE, "fishing");
    // The rod and the hook are named for it, so they lead; the fish follows.
    expect(found.slice(0, 2).sort()).toEqual(["lucide:fishing-hook", "lucide:fishing-rod"]);
    expect(found).toContain("lucide:fish");
  });

  it("finds a mark by what a folder is about, for the everyday subjects (review GAP-06)", () => {
    const first = (query: string, n = 5) => filterMarks(LUCIDE, query).slice(0, n);
    // Through Lucide's own tags.
    expect(first("car")).toContain("lucide:car");
    expect(first("baby")).toContain("lucide:baby");
    expect(first("money")).toContain("lucide:wallet");
    expect(first("music")).toContain("lucide:music");
    expect(first("cooking")).toContain("lucide:cooking-pot");
    expect(first("pet")).toEqual(expect.arrayContaining(["lucide:cat", "lucide:dog"]));
    // Through the short synonym list, where the tags are empty or odd.
    expect(first("gym", 1)).toEqual(["lucide:dumbbell"]);
    expect(first("garden")).toContain("lucide:sprout");
    expect(first("travel")).toContain("lucide:plane");
    expect(first("home", 1)).toEqual(["lucide:house"]);
    expect(first("games")).toContain("lucide:gamepad-2");
    // As it is typed, a few letters in, the word already finds its marks.
    expect(first("trav")).toContain("lucide:plane");
    // A plural or an -ing is the same word.
    expect(first("Recipes")).toContain("lucide:chef-hat");
    expect(first("pets")).toContain("lucide:dog");
  });

  it("ranks a mark's own name over a word merely in its tags", () => {
    const found = filterMarks(LUCIDE, "car");
    expect(found[0]).toBe("lucide:car");
    // "carrot" begins with the word and is still found — below every car.
    expect(found.indexOf("lucide:car-front")).toBeLessThan(found.indexOf("lucide:carrot"));
  });

  it("keeps every word typed a condition, never a way past the others", () => {
    expect(filterMarks(LUCIDE, "money cake")).toEqual([]);
    // Two letters is not yet a word: no synonym hit for "gy".
    expect(filterMarks(["lucide:dumbbell"], "gy")).toEqual([]);
  });

  it("searches an older Heroicons name by its words alone", () => {
    expect(filterMarks(["BookOpenIcon", "CakeIcon"], "book")).toEqual(["BookOpenIcon"]);
  });
});

describe("dressing a board", () => {
  const shelf: UserBoard[] = [board(), board({ id: "b2", name: "Work", position: 1 })];

  it("changes one board and leaves the rest alone", () => {
    const next = setBoardLook(shelf, "b2", { icon: "BriefcaseIcon", color: "steel" });
    expect(next[0]).toEqual(shelf[0]);
    expect(next[1]).toMatchObject({ icon: "BriefcaseIcon", color: "steel", name: "Work" });
  });

  it("leaves the field it was not asked about", () => {
    const dressed = setBoardLook(shelf, "b1", { icon: "CakeIcon", color: "plum" });
    const recoloured = setBoardLook(dressed, "b1", { color: "sage" });
    expect(recoloured[0].icon).toBe("CakeIcon");
    expect(recoloured[0].color).toBe("sage");
  });

  it("deletes the field rather than storing a null", () => {
    // The board list is synced whole as JSON. A board back at its default has
    // to be byte-identical to one written before any of this existed, or every
    // shelf grows a column of nulls on the wire.
    const dressed = setBoardLook(shelf, "b1", { icon: "CakeIcon", color: "plum" });
    const bare = setBoardLook(dressed, "b1", { icon: null, color: null });
    expect(Object.hasOwn(bare[0], "icon")).toBe(false);
    expect(Object.hasOwn(bare[0], "color")).toBe(false);
    expect(bare[0]).toEqual(shelf[0]);
  });

  it("does not mutate the list it was given", () => {
    setBoardLook(shelf, "b1", { color: "iris" });
    expect(shelf[0].color).toBeUndefined();
  });
});

describe("orderMarks", () => {
  const names = ["lucide:a-arrow-up", "lucide:arrow-down", "lucide:book-open", "lucide:house", "lucide:zoom-in"];
  const browse = { everyday: EVERYDAY_MARKS, searchOnly };

  it("puts the suggested marks first and leaves them out of the rest", () => {
    const { suggested, rest } = orderMarks(names, "", undefined, browse);
    expect(suggested).toEqual(["lucide:house", "lucide:book-open"]);
    expect(rest).toEqual(["lucide:zoom-in"]);
  });

  it("follows the picks with everyday topics, and leaves arrows, alignment and tools to search (review UIB-03)", () => {
    const { suggested, rest } = orderMarks(LUCIDE, "", undefined, browse);
    expect(rest.slice(0, EVERYDAY_MARKS.length)).toEqual(EVERYDAY_MARKS.filter((n) => !suggested.includes(n)));
    // The first page the sheet draws (96 cells) holds no arrow, alignment or text tool.
    const page = rest.slice(0, 96).map((n) => n.slice("lucide:".length));
    expect(page.filter((n) => /^(arrow|align|text|chevron|square|circle)/.test(n))).toEqual([]);
    for (const name of ["lucide:arrow-down", "lucide:align-start-vertical", "lucide:git-branch", "lucide:pilcrow"]) {
      expect(rest).not.toContain(name);
      // Still found by a search.
      expect(orderMarks(LUCIDE, iconWords(name), filterMarks).rest).toContain(name);
    }
    // Nothing is lost from the set: every mark is browsable or searchable.
    expect(new Set([...suggested, ...rest, ...LUCIDE.filter(searchOnly)]).size).toBe(LUCIDE.length);
  });

  it("names everyday marks the set really has, none of them twice or search-only", () => {
    const have = new Set(LUCIDE);
    for (const name of EVERYDAY_MARKS) {
      expect(have.has(name), name).toBe(true);
      expect(searchOnly(name), name).toBe(false);
    }
    expect(new Set(EVERYDAY_MARKS).size).toBe(EVERYDAY_MARKS.length);
  });

  it("offers no suggestions to a search, which reaches the whole set", () => {
    expect(orderMarks(names, "book", filterMarks)).toEqual({ suggested: [], rest: ["lucide:book-open"] });
  });

  it("finds nothing yet for a search whose words have not landed", () => {
    // The sheet says it is loading meanwhile, rather than "no mark".
    expect(orderMarks(names, "book")).toEqual({ suggested: [], rest: [] });
  });

  it("suggests fifteen, which with the folder fill two rows of eight", () => {
    expect(SUGGESTED_MARKS).toHaveLength(15);
    expect(new Set(SUGGESTED_MARKS).size).toBe(15);
  });
});
