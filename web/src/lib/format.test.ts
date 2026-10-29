import { describe, expect, it } from "vitest";
import {
  boxSelectedLines,
  cutSelection,
  fenceSelectedLines,
  insertInline,
  onSelectedLines,
  F_BOLD,
  F_EM,
  F_HEAD,
  FORMATS,
  insertOnOwnLine,
  markLine,
  pickRange,
  wrapWith,
  type Rewrite,
} from "./format";

/** What the rewrite leaves selected, which is what the user sees highlighted. */
const picked = (r: Rewrite) => r.value.slice(r.from, r.to);

describe("the format row", () => {
  it("is one heading and two emphases, and nothing else", () => {
    expect(FORMATS.map((f) => f.title)).toEqual(["Heading", "Bold", "Italic"]);
    expect(F_HEAD.mode).toBe("line");
    expect(F_BOLD.mode).toBe("wrap");
    expect(F_EM.mode).toBe("wrap");
  });
});

describe("wrapWith", () => {
  it("wraps the selection and keeps the words selected", () => {
    const r = wrapWith("milk and bread", 0, 4, "**")!;
    expect(r.value).toBe("**milk** and bread");
    expect(picked(r)).toBe("milk");
  });

  it("unwraps a selection sitting between its marks", () => {
    const r = wrapWith("**milk** and bread", 2, 6, "**")!;
    expect(r.value).toBe("milk and bread");
    expect(picked(r)).toBe("milk");
  });

  it("unwraps a selection that took its marks with it", () => {
    const r = wrapWith("**milk** and bread", 0, 8, "**")!;
    expect(r.value).toBe("milk and bread");
    expect(picked(r)).toBe("milk");
  });

  it("lays down an empty pair with the caret between them when nothing is selected", () => {
    const r = wrapWith("ab", 1, 1, "**")!;
    expect(r.value).toBe("a****b");
    expect(r.from).toBe(3);
    expect(r.to).toBe(3);
  });

  it("puts the spaces a selection caught outside the marks", () => {
    const r = wrapWith("milk and bread", 0, 5, "**")!;
    expect(r.value).toBe("**milk** and bread");
    expect(picked(r)).toBe("milk");
  });

  it("wraps each line of a selection on its own, never across the newline", () => {
    const r = wrapWith("one\n\ntwo", 0, 8, "*")!;
    expect(r.value).toBe("*one*\n\n*two*");
  });

  it("does not take one star off each end of a bold run for an italic", () => {
    const r = wrapWith("**bold**", 2, 6, "*")!;
    expect(r.value).toBe("***bold***");
  });

  it("refuses to italicise a bold run picked out with its stars", () => {
    expect(wrapWith("a **bold** b", 2, 10, "*")).toBeNull();
  });
});

describe("markLine", () => {
  it("puts a heading on the line the caret is on, and moves the caret with it", () => {
    const r = markLine("one\ntwo\nthree", 9, "# ");
    expect(r.value).toBe("one\ntwo\n# three");
    expect(r.from).toBe(11);
    expect(r.to).toBe(11);
  });

  it("takes the heading off again", () => {
    expect(markLine("# one\ntwo", 3, "# ").value).toBe("one\ntwo");
  });

  it("swaps a second-level mark for the first", () => {
    expect(markLine("## one", 4, "# ").value).toBe("# one");
  });

  it("keeps the indent in front of the mark", () => {
    expect(markLine("  one", 2, "# ").value).toBe("  # one");
  });

  it("never lands the caret before the start of its own line", () => {
    const r = markLine("# a", 0, "# ");
    expect(r.value).toBe("a");
    expect(r.from).toBe(0);
  });
});

describe("pickRange", () => {
  it("takes the field's own selection when it has one", () => {
    expect(pickRange(10, [1, 3], [4, 6])).toEqual([4, 6]);
  });

  it("prefers a remembered selection over a collapsed field — the phone case", () => {
    expect(pickRange(10, [1, 3], [5, 5])).toEqual([1, 3]);
  });

  it("keeps a collapsed field's caret when memory holds a caret too", () => {
    expect(pickRange(10, [2, 2], [5, 5])).toEqual([5, 5]);
  });

  it("ignores a remembered selection that runs past the text", () => {
    expect(pickRange(4, [1, 9], [2, 2])).toEqual([2, 2]);
  });

  it("uses the remembered selection while the note is being read", () => {
    expect(pickRange(10, [1, 3], null)).toEqual([1, 3]);
  });

  it("puts a caret at the remembered end, or at the end of the text", () => {
    expect(pickRange(10, [4, 4], null)).toEqual([4, 4]);
    expect(pickRange(10, [12, 12], null)).toEqual([10, 10]);
    expect(pickRange(10, null, null)).toEqual([10, 10]);
  });
});

describe("boxSelectedLines", () => {
  it("boxes the whole line when the selection starts partway along it", () => {
    const r = boxSelectedLines("buy milk today\nget bread", 4, 8);
    expect(r.value).toBe("[ ] buy milk today\nget bread");
  });

  it("boxes every line the selection touches, from the start of the first", () => {
    const r = boxSelectedLines("buy milk\nget bread today", 4, 12);
    expect(r.value).toBe("[ ] buy milk\n[ ] get bread today");
  });

  it("leaves a line that already carries a box alone", () => {
    const r = boxSelectedLines("[ ] milk\nbread", 0, 14);
    expect(r.value).toBe("[ ] milk\n[ ] bread");
  });

  it("puts the caret at the end of what was boxed", () => {
    const r = boxSelectedLines("a\nb\nc", 0, 3);
    expect(r.value).toBe("[ ] a\n[ ] b\nc");
    expect(r.caret).toBe(11);
  });
});

describe("fenceSelectedLines", () => {
  const note = "Spinner:\n  <div class=\"a\">\n  </div>\nThat's it.";
  const fenced = "Spinner:\n```\n  <div class=\"a\">\n  </div>\n```\nThat's it.";

  it("fences the whole lines, indent and all, when the selection starts inside one", () => {
    const r = fenceSelectedLines(note, note.indexOf("<div"), note.indexOf("</div>") + 6);
    expect(r.value).toBe(fenced);
    expect(r.value.slice(0, r.caret).endsWith("</div>\n```")).toBe(true);
  });

  it("stops at the line above when the selection ends just past a newline", () => {
    expect(fenceSelectedLines(note, note.indexOf("  <div"), note.indexOf("That's")).value).toBe(fenced);
  });

  it("fences a whole note", () => {
    expect(fenceSelectedLines("a;\nb;", 0, 5).value).toBe("```\na;\nb;\n```");
  });

  it("is what Code block and Tick box do to a selection, and nothing else's", () => {
    expect(onSelectedLines("Code block", "x", 0, 1)?.value).toBe("```\nx\n```");
    expect(onSelectedLines("Tick box", "x", 0, 1)?.value).toBe("[ ] x");
    expect(onSelectedLines("Today's date", "x", 0, 1)).toBeNull();
  });
});

describe("insertOnOwnLine", () => {
  it("adds a break on each side only where there isn't one", () => {
    expect(insertOnOwnLine("ab", 1, "[ ] ", 4)).toEqual({ value: "a\n[ ] \nb", caret: 6 });
    expect(insertOnOwnLine("a\n", 2, "[ ] ", 4)).toEqual({ value: "a\n[ ] ", caret: 6 });
    expect(insertOnOwnLine("", 0, "[ ] ", 4)).toEqual({ value: "[ ] ", caret: 4 });
  });

  it("leaves the caret inside the fences of a code block", () => {
    const r = insertOnOwnLine("x", 1, "```\n\n```", 4);
    expect(r.value).toBe("x\n```\n\n```");
    expect(r.value.slice(0, r.caret)).toBe("x\n```\n");
  });
});

describe("insertInline", () => {
  const DAY = "27 Sep 2026";

  it("goes into the sentence, never onto a line of its own", () => {
    const r = insertInline("call back on ", 13, DAY);
    expect(r.value).toBe(`call back on ${DAY}`);
    expect(r.caret).toBe(r.value.length);
  });

  it("adds the space a word needs, on the side that needs it", () => {
    expect(insertInline("due", 3, DAY).value).toBe(`due ${DAY}`);
    expect(insertInline("Done.", 5, DAY).value).toBe(`Done. ${DAY}`);
    expect(insertInline("from then", 5, DAY).value).toBe(`from ${DAY} then`);
    expect(insertInline("\n", 0, DAY).value).toBe(`${DAY}\n`);
    expect(insertInline("", 0, DAY)).toEqual({ value: DAY, caret: DAY.length });
    // Brackets hug it rather than being spaced away from it.
    expect(insertInline("()", 1, DAY).value).toBe(`(${DAY})`);
  });

  it("leaves the caret after the date, not after the space behind it", () => {
    const r = insertInline("fromthen", 4, DAY);
    expect(r.value).toBe(`from ${DAY} then`);
    expect(r.value.slice(0, r.caret)).toBe(`from ${DAY}`);
  });
});

describe("cutSelection", () => {
  const cut = (value: string, picked: string) => {
    const from = value.indexOf(picked);
    return cutSelection(value, from, from + picked.length);
  };

  it("moves the words out and leaves one blank line between the paragraphs", () => {
    const r = cut("one\n\ntwo\n\nthree", "two")!;
    expect(r.moved).toBe("two");
    expect(r.rest).toBe("one\n\nthree");
    expect(r.rest.slice(0, r.caret)).toBe("one\n\n");
  });

  it("takes a list line without leaving a gap in the list", () => {
    expect(cut("- a\n- b\n- c", "- b")!.rest).toBe("- a\n- c");
    // The same line picked up with its newline, on either side, is the same cut.
    expect(cut("- a\n- b\n- c", "- b\n")!.rest).toBe("- a\n- c");
    expect(cut("- a\n- b\n- c", "\n- b")!.rest).toBe("- a\n- c");
    expect(cut("- a\n- b\n- c", "\n- b\n")!.rest).toBe("- a\n- c");
  });

  it("never invents a blank line the note did not already have", () => {
    // A blank line on one side and a plain break on the other keeps the
    // blank line — the larger — and not the three breaks they add up to.
    expect(cut("one\n\ntwo\nthree", "two")!.rest).toBe("one\n\nthree");
  });

  it("closes a phrase up to one space", () => {
    expect(cut("buy milk and bread today", "and bread")!.rest).toBe("buy milk today");
    // A double-click takes the word and the space after it.
    expect(cut("buy milk and bread today", "bread ")!.rest).toBe("buy milk and today");
    expect(cut("buy milk", "buy ")!.rest).toBe("milk");
    expect(cut("buy milk", " milk")!.rest).toBe("buy");
  });

  it("leaves no separator at the top or the bottom of the note", () => {
    expect(cut("head\n\nbody", "head")!.rest).toBe("body");
    expect(cut("body\n\ntail\n", "tail")!.rest).toBe("body");
  });

  it("keeps the indentation of the line after the cut", () => {
    expect(cut("a\n  b\n  c", "b")!.rest).toBe("a\n  c");
    expect(cut("top\n\nmiddle\n    code", "middle")!.rest).toBe("top\n\n    code");
  });

  it("does not trim the words it moves beyond their blank ends", () => {
    const r = cut("x\n\n\n  indented\n  more\n\n\ny", "\n\n  indented\n  more\n\n")!;
    expect(r.moved).toBe("  indented\n  more");
    expect(r.rest).toBe("x\n\n\ny");
  });

  it("refuses a selection with nothing in it, and the whole note", () => {
    expect(cutSelection("a  b", 1, 3)).toBeNull();
    expect(cutSelection("all of it", 0, 9)).toBeNull();
    expect(cutSelection("\n all of it \n", 0, 13)).toBeNull();
  });

  it("does not care which way round the ends were given", () => {
    expect(cutSelection("one two", 7, 4)).toEqual(cutSelection("one two", 4, 7));
  });

  it("touches nothing outside the cut but the whitespace at the join", () => {
    const note = "# Plan\n\n1. first\n1. second\n\n  **bold** stays";
    const r = cut(note, "1. second")!;
    expect(r.rest).toBe("# Plan\n\n1. first\n\n  **bold** stays");
  });
});

describe("a caret at the very start of an empty first line", () => {
  it("marks, boxes and fences that line, not the one below", () => {
    expect(markLine("\nabc", 0, "# ").value).toBe("# \nabc");
    expect(boxSelectedLines("\nabc", 0, 0).value.endsWith("\nabc")).toBe(true);
    expect(fenceSelectedLines("\nabc", 0, 0).value).toBe("```\n\n```\nabc");
  });
});
