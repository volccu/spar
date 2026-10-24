import { describe, expect, it } from "vitest";
import {
  boxLine,
  clearDone,
  doneCount,
  markerOf,
  parseBlocks,
  toggleBox,
  untickAll,
  hasCode,
  type ItemBlock,
} from "./blocks";
import { archiveNotes, REAL_ARCHIVE } from "../seed/archive";

/** The invariant everything else rests on. */
function rebuild(src: string): string {
  return parseBlocks(src)
    .map((b) => b.text)
    .join("");
}

describe("parseBlocks", () => {
  it("tiles the source exactly, whatever is in it", () => {
    const cases = [
      "",
      "just a note",
      "a\nb\nc",
      "[ ] milk\n[x] bread\nand then some words",
      "intro\n```js\nconst a = 1;\n```\nafter",
      "```\nno lang\n```",
      "trailing newline\n",
      "\n\nleading blanks\n\n",
      "- [ ] dashed box\n  [x] indented",
      "fence with no close\n```\ncode-ish const a = 1;",
      "☐ old style\n☑ done one",
      "1. milk\n2. bread\n3. eggs",
      "  1) indented\n  2) numbered",
      "Recipe\n\n1. Chop it\n2. Fry it\n\nServe hot.",
    ];
    for (const src of cases) expect(rebuild(src)).toBe(src);
  });

  it("sets a numbered line as an item, marker and words apart", () => {
    const blocks = parseBlocks("1. milk\n2. bread");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "list"]);
    const [first] = blocks as ItemBlock[];
    expect(first.marker).toBe("1. ");
    expect(first.words).toBe("milk");
    expect(first.done).toBe(false);
  });

  it("says which items are counted, so only those get a marker column", () => {
    const [num] = parseBlocks("1. milk") as ItemBlock[];
    const [dash] = parseBlocks("– milk") as ItemBlock[];
    const [box] = parseBlocks("[ ] milk") as ItemBlock[];
    expect(num.numbered).toBe(true);
    expect(dash.numbered).toBe(false);
    expect(box.numbered).toBe(false);
  });

  it("leaves years, decimals and bare numbers as prose", () => {
    for (const src of ["1998. Best year of the lot", "3.14 is pi", "42"]) {
      expect(parseBlocks(src).map((b) => b.kind)).toEqual(["prose"]);
    }
  });

  it("never lets a numbered list be mistaken for code", () => {
    // Every line carries brackets and semicolons, which without the marker
    // guard is exactly the shape the detector goes looking for.
    const src = "1. call foo(a);\n2. call bar(b);\n3. call baz(c);";
    expect(hasCode(src)).toBe(false);
    expect(rebuild(src)).toBe(src);
  });

  it("reads a fenced block without showing the fences", () => {
    const [, code] = parseBlocks("intro\n```js\nconst a = 1;\n```\nafter");
    expect(code.kind).toBe("code");
    if (code.kind !== "code") return;
    expect(code.code).toBe("const a = 1;\n");
    expect(code.lang).toBe("js");
    // The fences and the newline above are kept, to be rendered hidden.
    expect(code.open).toBe("```js\n");
    expect(code.lead).toBe("\n");
  });

  it("finds unfenced code when the evidence is strong", () => {
    const src = "function add(a, b) {\n  return a + b;\n}";
    expect(hasCode(src)).toBe(true);
    expect(rebuild(src)).toBe(src);
  });

  it("boxes only the code in a note that is text, then code, then text", () => {
    const src = [
      "Tried this again on the train and it finally works.",
      "",
      "const rows = notes.filter((n) => n.status === 'active');",
      "for (const r of rows) {",
      "  console.log(r.id);",
      "}",
      "",
      "Still need to check what happens when the list is empty.",
    ].join("\n");

    const blocks = parseBlocks(src);
    const code = blocks.filter((b) => b.kind === "code");
    expect(code).toHaveLength(1);
    if (code[0].kind !== "code") return;
    expect(code[0].code).toContain("const rows");
    expect(code[0].code).toContain("}");
    expect(code[0].code).not.toContain("train");
    expect(code[0].code).not.toContain("Still need");
    expect(rebuild(src)).toBe(src);
  });

  it("takes the first line of a snippet, not the second", () => {
    // Neither of these opening lines carries a signal of its own, and a run
    // that had to start strong began one line in and left the head outside.
    const css = ".card {\n  display: flex;\n  padding: 0;\n}";
    const [block] = parseBlocks(css);
    expect(block.kind).toBe("code");
    if (block.kind !== "code") return;
    expect(block.code.startsWith(".card {")).toBe(true);
  });

  it("keeps a comment inside a snippet, and the lines above it", () => {
    // From the owner's screenshot: the comment read as a sentence, ended the
    // run, and the panel began two lines into the snippet.
    const src = [
      '<div class="braun-grid">',
      "  <!-- 3x3 array with diagonal phase delay -->",
      '  <div class="braun-disc" style="--delay: 0s"></div>',
      '  <div class="braun-disc" style="--delay: 0.12s"></div>',
      "</div>",
    ].join("\n");
    const blocks = parseBlocks(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
    expect(rebuild(src)).toBe(src);
  });

  it("takes a comment at either end of a snippet, but not across a blank", () => {
    const src = "// add two\nconst a = 1;\nconst b = a + 1;\n// done\n\n// a line of a note";
    const code = parseBlocks(src).filter((b) => b.kind === "code");
    expect(code).toHaveLength(1);
    if (code[0].kind !== "code") return;
    expect(code[0].code).toBe("// add two\nconst a = 1;\nconst b = a + 1;\n// done");
    expect(rebuild(src)).toBe(src);
  });

  it("never starts a block on comments alone", () => {
    expect(hasCode("// buy milk\n// call the bank about the card")).toBe(false);
  });

  it("starts a pasted page at its doctype", () => {
    const src = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n</head>';
    const [block] = parseBlocks(src);
    expect(block.kind).toBe("code");
    if (block.kind !== "code") return;
    expect(block.code.startsWith("<!DOCTYPE html>")).toBe(true);
  });

  it("keeps a blank line inside a pasted block", () => {
    const src =
      "import { a } from './a';\n\nexport function go() {\n  return a();\n}";
    const blocks = parseBlocks(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("code");
    expect(rebuild(src)).toBe(src);
  });

  it("takes two lines of shell as code", () => {
    const src = "npm install\nnpm run build";
    expect(hasCode(src)).toBe(true);
  });

  it("leaves a single suspicious line as prose", () => {
    // One semicolon is a note, not a program.
    expect(hasCode("ring plumber; ask about the boiler")).toBe(false);
  });

  it("never mistakes a saved link for code", () => {
    expect(hasCode("Saved link: https://example.com/a?b=1&c=2")).toBe(false);
  });

  it("lets a tick box beat the code detector", () => {
    // Found by rendering, not by reading: these lines are code-shaped, and
    // detection was swallowing them and taking the boxes with it.
    const src = "[ ] const a = 1;\n[ ] foo(a);";
    expect(hasCode(src)).toBe(false);
    expect(parseBlocks(src).every((b) => b.kind === "check")).toBe(true);
  });

  it("parses tick boxes and reports where the box sits", () => {
    const src = "shopping\n[ ] milk\n[x] bread";
    const blocks = parseBlocks(src);
    const boxes = blocks.filter((b): b is ItemBlock => b.kind === "check");
    expect(boxes).toHaveLength(2);
    expect(boxes[0].done).toBe(false);
    expect(boxes[1].done).toBe(true);
    expect(src.slice(boxes[0].markerAt, boxes[0].markerAt + 3)).toBe("[ ]");
  });

  it("treats a dash line as its own item, so it can be set tighter", () => {
    const src = "shopping\n– milk\n– bread that runs long\nafter";
    const blocks = parseBlocks(src);
    const items = blocks.filter((b) => b.kind === "list");
    expect(items).toHaveLength(2);
    // The newline above the first item is claimed by the item, because the
    // item is a block and draws its own break — otherwise every item would
    // sit a blank line below the last.
    expect(items[0].kind === "list" && items[0].lead).toBe("\n");
    expect(items[0].kind === "list" && items[0].words).toBe("milk");
    expect(rebuild(src)).toBe(src);
  });

  /**
   * A blank line between two items leaves no prose block to stand between
   * them — its newline is claimed as the second item's lead. So the lead is
   * the only thing that says the two are separate lists, and the reader's
   * grips read it (`runOf` in NoteView), the same boundary `settleChecklist`
   * draws on lines.
   */
  it("marks an item after a blank line by its lead, and one straight after an item by none", () => {
    const src = "[ ] a\n[ ] b\n\n[ ] c";
    const items = parseBlocks(src).filter((b): b is ItemBlock => b.kind === "check");
    expect(items.map((b) => b.lead)).toEqual(["", "", "\n"]);
    expect(rebuild(src)).toBe(src);
  });

  it("does not treat a bare dash or a sentence dash as an item", () => {
    expect(parseBlocks("– ").every((b) => b.kind === "prose")).toBe(true);
    expect(parseBlocks("well - maybe not").every((b) => b.kind === "prose")).toBe(true);
  });

  it("reads '- [ ] milk' as a box, not as a dash", () => {
    const [item] = parseBlocks("- [ ] milk");
    expect(item.kind).toBe("check");
  });

  it("toggles one box and nothing else", () => {
    const src = "[ ] milk\n[ ] bread";
    const [first] = parseBlocks(src).filter(
      (b): b is ItemBlock => b.kind === "check",
    );
    expect(toggleBox(src, first)).toBe("[x] milk\n[ ] bread");
  });
});

/** The boxes in a note, in the order they are written. */
function boxes(src: string): ItemBlock[] {
  return parseBlocks(src).filter((b): b is ItemBlock => b.kind === "check");
}

/**
 * Everything the user marks stays in the text, and that includes *which* of the
 * two spellings of a box they marked it with. `markerOf` has always accepted
 * "☐"/"☑" — that is how Keep wrote them and how the imported notes still read —
 * and ticking one used to answer in brackets, replacing one character of the
 * user's own text with three on the first tap.
 */
describe("toggleBox keeps the spelling it found", () => {
  it("ticks and unticks an imported box as an imported box", () => {
    const src = "☐ milk\n☐ bread";
    expect(toggleBox(src, boxes(src)[0])).toBe("☑ milk\n☐ bread");
    const ticked = "☑ milk\n☐ bread";
    expect(toggleBox(ticked, boxes(ticked)[0])).toBe("☐ milk\n☐ bread");
  });

  it("leaves a bracket box in brackets", () => {
    const src = "[x] milk";
    expect(toggleBox(src, boxes(src)[0])).toBe("[ ] milk");
  });

  /**
   * The replacement is now the same length in both spellings, which is what
   * every offset downstream rests on: `markerAt` was measured against the text
   * as it stood *before* the toggle, and so is the caret in the open note.
   */
  it("writes exactly as many characters as it took out", () => {
    for (const src of ["☐ milk", "☑ milk", "[ ] milk", "[x] milk"]) {
      expect(toggleBox(src, boxes(src)[0])).toHaveLength(src.length);
    }
  });

  it("touches nothing but the marker, on a box the user wrote after a dash", () => {
    const src = "– ☐ milk\n– ☐ bread";
    expect(toggleBox(src, boxes(src)[0])).toBe("– ☑ milk\n– ☐ bread");
  });
});

/**
 * Untick all and Clear done — one decision about a whole list, where the list
 * used to take one tap per box. Both rewrite only the ticked items, and both
 * leave every other character of the note where it was.
 */
describe("untickAll and clearDone", () => {
  const shop = "# Shop\nfor the weekend\n[ ] milk\n– [ ] bread\n[x] eggs\n☑ jam\n[X] tea\n\nafter";

  it("counts only the ticked boxes", () => {
    expect(doneCount(shop)).toBe(3);
    expect(doneCount("[ ] milk\n[ ] bread")).toBe(0);
  });

  it("unticks every box in its own spelling and changes nothing else", () => {
    const out = untickAll(shop);
    expect(out).toBe("# Shop\nfor the weekend\n[ ] milk\n– [ ] bread\n[ ] eggs\n☐ jam\n[ ] tea\n\nafter");
    expect(out).toHaveLength(shop.length);
    expect(doneCount(out)).toBe(0);
  });

  it("clears the ticked lines and keeps every other line whole", () => {
    expect(clearDone(shop)).toBe("# Shop\nfor the weekend\n[ ] milk\n– [ ] bread\n\nafter");
  });

  it("clears a ticked item on the first or the last line without leaving a gap", () => {
    expect(clearDone("[x] first\n[ ] kept")).toBe("[ ] kept");
    expect(clearDone("[ ] kept\n[x] last")).toBe("[ ] kept");
    expect(clearDone("[ ] kept\n[x] last\n")).toBe("[ ] kept\n");
    expect(clearDone("[x] only")).toBe("");
  });

  it("returns the note by identity when nothing is ticked", () => {
    const src = "[ ] milk\n[ ] bread";
    expect(untickAll(src)).toBe(src);
    expect(clearDone(src)).toBe(src);
  });

  it("leaves a ticked box inside a fence alone — that is code, not a list", () => {
    const src = "[x] done\n```\n[x] not an item\n```";
    expect(doneCount(src)).toBe(1);
    expect(untickAll(src)).toBe("[ ] done\n```\n[x] not an item\n```");
    expect(clearDone(src)).toBe("```\n[x] not an item\n```");
  });

  it("keeps the carriage returns of a body that has them", () => {
    const src = "[ ] milk\r\n[x] eggs\r\nafter";
    expect(untickAll(src)).toBe("[ ] milk\r\n[ ] eggs\r\nafter");
    expect(clearDone(src)).toBe("[ ] milk\r\nafter");
  });
});

/**
 * `boxLine` is the insert panel's Tick box row, given a selection: it is what
 * the line-by-line `"[ ] " + line` map should have been. Boxing a box is the
 * one thing it must not do — "[ ] [ ] milk" is a single box whose *words* are
 * "[ ] milk", so the note ends up saying something nobody wrote.
 */
describe("boxLine", () => {
  it("puts a box on an ordinary line", () => {
    expect(boxLine("milk")).toBe("[ ] milk");
  });

  it("leaves a line that already has one exactly as it was", () => {
    for (const line of ["[ ] milk", "[x] milk", "☐ milk", "☑ milk", "- [ ] milk"]) {
      expect(boxLine(line)).toBe(line);
    }
  });

  it("keeps the indent in front of the box", () => {
    expect(boxLine("  milk")).toBe("  [ ] milk");
    expect(boxLine("\tmilk")).toBe("\t[ ] milk");
  });

  it("puts the box after a dash, which is the shape a box may be written in", () => {
    expect(boxLine("– milk")).toBe("– [ ] milk");
    expect(markerOf("– [ ] milk")?.kind).toBe("check");
  });

  it("keeps a number as words rather than losing it", () => {
    // A number cannot sit in front of a box and still be one, so the box goes
    // in front of the number and the number survives as the item's words.
    expect(boxLine("1. milk")).toBe("[ ] 1. milk");
    expect(markerOf("[ ] 1. milk")?.words.trim()).toBe("1. milk");
  });

  it("leaves a blank line blank — a marker with no words is a dangling marker", () => {
    expect(boxLine("")).toBe("");
    expect(boxLine("   ")).toBe("   ");
  });

  it("boxes every line of a selection exactly once", () => {
    const selected = "milk\n[ ] bread\n– jam";
    expect(selected.split("\n").map(boxLine).join("\n")).toBe(
      "[ ] milk\n[ ] bread\n– [ ] jam",
    );
  });
});

/**
 * A body whose lines end "\r\n" — from a share sheet, a merge, an import, or a
 * device that never normalised — used to match none of the line patterns, so a
 * note full of tick boxes drew as one grey paragraph. `composeShared` fixes the
 * entry point; this is the floor under the routes we do not know about.
 */
describe("a body that still carries carriage returns", () => {
  it("still reads the marks that are in it", () => {
    const src = "# Errands\r\n[ ] milk\r\n– jam\r\n1. bread";
    expect(parseBlocks(src).map((b) => b.kind)).toEqual([
      "heading",
      "check",
      "list",
      "list",
    ]);
  });

  it("keeps the carriage return in the words, so the round trip is exact", () => {
    const src = "[ ] milk\r\n[x] bread\r\n";
    expect(rebuild(src)).toBe(src);
    const [first] = boxes(src);
    expect(first.words).toBe(" milk\r");
  });

  it("does not make an item out of a line that is only a marker and a return", () => {
    expect(parseBlocks("– \r\nnext").every((b) => b.kind === "prose")).toBe(true);
  });

  it("ticks one box in a CRLF note without disturbing a character around it", () => {
    const src = "[ ] milk\r\n[ ] bread";
    expect(toggleBox(src, boxes(src)[0])).toBe("[x] milk\r\n[ ] bread");
  });
});

/**
 * The detector runs against the user's real archive, which is 241 notes of
 * Swedish and English prose, recipes and saved links — and almost no code. A
 * paragraph wrongly set in a monospace box is far more damage than a snippet
 * left as prose, so this asserts the false-positive rate stays near zero.
 * If a change here makes this number climb, the change is wrong.
 */
describe("code detection against the real archive", () => {
  it("claims almost nothing", () => {
    const notes = archiveNotes;
    const hits = notes.filter((n) => hasCode(n.body ?? n.raw_content ?? ""));
    expect(hits.length).toBeLessThanOrEqual(4);
  });

  it("still reproduces every note exactly", () => {
    const notes = archiveNotes;
    for (const n of notes) {
      const src = n.body ?? n.raw_content ?? "";
      expect(rebuild(src)).toBe(src);
    }
  });

  /**
   * Numbered items carry the same risk as code detection and the same guard: a
   * date, a price or a year set as a list item is a paragraph the app has
   * quietly restructured. The archive holds 95 of these across 20 notes and
   * every marker is a single digit, so anything reaching double figures — let
   * alone four — means the pattern has started claiming prose.
   */
  it("numbers only what a person numbered", () => {
    const notes = archiveNotes;
    const markers: number[] = [];
    for (const n of notes) {
      for (const b of parseBlocks(n.body ?? n.raw_content ?? "")) {
        if (b.kind === "list" && /^\d/.test(b.marker)) {
          markers.push(Number.parseInt(b.marker, 10));
        }
      }
    }
    // How many there are is a fact about the real archive; that none of them
    // reached double figures is a claim about the pattern, and holds anywhere.
    if (REAL_ARCHIVE) expect(markers.length).toBeGreaterThan(50);
    expect(Math.max(...markers)).toBeLessThanOrEqual(20);
  });
});

describe("headings", () => {
  it("tiles the source exactly, headings and all", () => {
    const cases = [
      "# Title",
      "# Title\nand words under it",
      "words\n# Title\nmore words",
      "## Second level\n",
      "  ## indented\n- and a list",
      "# one\n## two\n# three",
      "#no space",
      "#",
      "### three is not a heading",
    ];
    for (const src of cases) expect(rebuild(src)).toBe(src);
  });

  it("splits the hashes off the words and keeps both", () => {
    const [block] = parseBlocks("## Shopping");
    expect(block.kind).toBe("heading");
    if (block.kind !== "heading") return;
    expect(block.marker).toBe("## ");
    expect(block.words).toBe("Shopping");
  });

  it("reads both spellings as the one heading there is", () => {
    // A second level was built and withdrawn: at reading size in the bold cut
    // it was indistinguishable from inline bold. "##" is pasted in constantly
    // and three lines of the archive use it, so it is still read — it simply
    // has nothing separate to say.
    const kinds = parseBlocks("# One\n## Two").map((b) => b.kind);
    expect(kinds).toEqual(["heading", "heading"]);
  });

  it("needs a hash, a space and words — all three", () => {
    for (const src of ["#include <stdio.h>", "#1 pick", "#", "# ", "#### deep"]) {
      expect(parseBlocks(src).some((b) => b.kind === "heading")).toBe(false);
    }
  });

  it("never claims a line inside a fenced block", () => {
    const blocks = parseBlocks("```sh\n# install it\nnpm i\n```");
    expect(blocks.map((b) => b.kind)).toEqual(["code"]);
  });

  /**
   * The same guard the numbered marker and unfenced code carry. Four lines in
   * 241 notes is what a mark should cost before anyone has started using it; a
   * number climbing here means the pattern has begun claiming prose — a shell
   * comment, or a line that merely opens with a hash.
   */
  it.runIf(REAL_ARCHIVE)("finds only what a person marked, across the real archive", () => {
    const notes = archiveNotes;
    let found = 0;
    for (const n of notes) {
      for (const b of parseBlocks(n.body ?? n.raw_content ?? "")) {
        if (b.kind === "heading") found++;
      }
    }
    expect(found).toBe(4);
  });
});
