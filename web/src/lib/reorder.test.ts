import { describe, expect, it } from "vitest";
import { lineAt, moveLine, renumberLists, settleChecklist, tickItem } from "./reorder";
import { parseBlocks, type ItemBlock } from "./blocks";
import { archiveNotes, REAL_ARCHIVE } from "../seed/archive";

describe("moveLine", () => {
  it("renumbers both runs when a line is dragged out of one numbered run into another", () => {
    const src = "1. a\n2. b\n3. c\ntext\n5. x\n6. y";
    expect(moveLine(src, 0, 5)).toBe("1. b\n2. c\ntext\n5. x\n6. y\n7. a");
    expect(moveLine(src, 0, 4)).toBe("1. b\n2. c\ntext\n5. x\n6. a\n7. y");
  });

  it("moves an item down and leaves everything else alone", () => {
    const src = "Shopping\n– milk\n– bread\n– jam";
    expect(moveLine(src, 1, 3)).toBe("Shopping\n– bread\n– jam\n– milk");
  });

  it("moves an item up", () => {
    expect(moveLine("– a\n– b\n– c", 2, 0)).toBe("– c\n– a\n– b");
  });

  it("writes nothing at all for a drag that ends where it started", () => {
    const src = "– a\n– b";
    expect(moveLine(src, 1, 1)).toBe(src);
  });

  it("refuses a line that is not there", () => {
    const src = "– a\n– b";
    expect(moveLine(src, 5, 0)).toBe(src);
    expect(moveLine(src, 0, 9)).toBe(src);
  });

  it("keeps tick boxes and their state with the line", () => {
    expect(moveLine("[x] eggs\n[ ] milk", 1, 0)).toBe("[ ] milk\n[x] eggs");
  });

  it("carries the words of a wrapped item, which is still one line", () => {
    const long = "– a very long item that wraps on screen but is one line here";
    expect(moveLine(`${long}\n– b`, 0, 1)).toBe(`– b\n${long}`);
  });
});

/**
 * Autoformat never renumbers, on the ground that a rule which rewrites text you
 * are not currently typing will eventually rewrite something you meant. A drag
 * is not that rule: it is an instruction about this list, so the list it was
 * given about — and nothing else in the note — is put back in order.
 */
describe("renumbering after a drag", () => {
  it("counts the list again once it has been reordered", () => {
    expect(moveLine("1. a\n2. b\n3. c", 2, 0)).toBe("1. c\n2. a\n3. b");
  });

  it("keeps the number the list actually started on", () => {
    expect(moveLine("3. a\n4. b\n5. c", 0, 2)).toBe("3. b\n4. c\n5. a");
  });

  it("keeps the punctuation the list was written with", () => {
    expect(moveLine("1) a\n2) b", 1, 0)).toBe("1) b\n2) a");
  });

  it("leaves a dash list alone — it has no numbers to be wrong", () => {
    expect(moveLine("– a\n– b\n– c", 0, 2)).toBe("– b\n– c\n– a");
  });

  it("touches only the run that was dragged", () => {
    const src = "1. a\n2. b\n\nlater\n\n7. x\n8. y";
    // The second list is a separate run and must come back untouched, numbers
    // and all — including the fact that it starts at 7.
    expect(moveLine(src, 1, 0)).toBe("1. b\n2. a\n\nlater\n\n7. x\n8. y");
  });

  it("does not renumber prose that merely looks like a list", () => {
    // Four digits is not a marker — see the bound in blocks.ts. Nothing here
    // is a counted item, so nothing is rewritten but the order.
    const src = "1998. Best year\n2004. Also good";
    expect(moveLine(src, 0, 1)).toBe("2004. Also good\n1998. Best year");
  });
});

describe("renumberLists", () => {
  it("closes the gap a deleted item leaves", () => {
    expect(renumberLists("1. a\n3. c\n4. d")).toBe("1. a\n2. c\n3. d");
  });

  it("counts a run straight from the number it already starts on", () => {
    // A list that begins at 3 is still a list that begins at 3. Only the gap
    // inside it is a mistake; where the user chose to start is not.
    expect(renumberLists("3. a\n5. b\n6. c")).toBe("3. a\n4. b\n5. c");
  });

  it("keeps the punctuation the list was written with", () => {
    expect(renumberLists("1) a\n3) b")).toBe("1) a\n2) b");
  });

  it("treats each run as its own list", () => {
    const src = "1. a\n3. b\n\nmiddle\n\n7. x\n9. y";
    expect(renumberLists(src)).toBe("1. a\n2. b\n\nmiddle\n\n7. x\n8. y");
  });

  it("repairs a repeat as readily as a gap", () => {
    expect(renumberLists("1. a\n1. b\n1. c")).toBe("1. a\n2. b\n3. c");
  });

  it("leaves a dash list and a tick list entirely alone", () => {
    const src = "– a\n– b\n[ ] one\n[x] two";
    expect(renumberLists(src)).toBe(src);
  });

  it("does not touch prose that merely looks like a list", () => {
    // Four digits is not a marker — see the bound in blocks.ts.
    const src = "1998. Best year\n2004. Also good";
    expect(renumberLists(src)).toBe(src);
  });

  it("leaves a numbered sub-list under an item as its own list", () => {
    const spaced = "1. a\n   1. sub\n2. b";
    expect(renumberLists(spaced)).toBe(spaced);
    const tabbed = "1. a\n\t1. sub\n2. b";
    expect(renumberLists(tabbed)).toBe(tabbed);
  });

  it("does not let an un-indented box keep the list above it open", () => {
    const src = "1. a\n- [ ] task\n1. b";
    expect(renumberLists(src)).toBe(src);
  });

  it("returns the very same string when there is nothing to repair", () => {
    // By identity, so a commit that changes nothing writes nothing and does
    // not wake the sync.
    const src = "1. a\n2. b\n3. c";
    expect(renumberLists(src)).toBe(src);
  });

  /**
   * The licence for running this on every commit.
   *
   * Renumbering is the one thing in the app allowed to rewrite a line the user
   * is not standing on, so it has to be provably inert on everything they have
   * already written. Every numbered run in all 241 real notes is already
   * counted straight, so this changes not one character of the archive — and
   * the day it stops being true is the day this rule needs re-arguing.
   */
  it("changes not one character of the real archive", () => {
    const notes = archiveNotes;
    // The size is a fact about the real archive; that renumbering changes not
    // one character is the claim being guarded, and it holds over any input.
    if (REAL_ARCHIVE) expect(notes.length).toBeGreaterThan(200);
    const changed = notes
      .map((n) => n.body ?? n.raw_content ?? "")
      .filter((body) => renumberLists(body) !== body);
    expect(changed, "renumbering must be a no-op over every real note").toEqual([]);
  });
});

describe("lineAt", () => {
  it("finds the line a character offset falls on", () => {
    const src = "one\ntwo\nthree";
    expect(lineAt(src, 0)).toBe(0);
    expect(lineAt(src, 4)).toBe(1);
    expect(lineAt(src, 8)).toBe(2);
  });
});

/**
 * A tick is a decision about one item, and the decision moves the item
 * somewhere: done boxes sink below the open ones, so what is left sits at the
 * top. These fixtures are the note *after* the box has been toggled, because
 * the settle itself never changes a box — `toggleBox` does that first.
 */
describe("settleChecklist", () => {
  it("sinks the box you just ticked to the bottom of the run", () => {
    // Tapping the middle of three open boxes ticks it, so the settle sees
    // "[x] 2" and drops it below the two that are still open.
    expect(settleChecklist("[ ] 1\n[x] 2\n[ ] 3", 1)).toBe("[ ] 1\n[ ] 3\n[x] 2");
  });

  it("keeps the open boxes on top in the order they were written", () => {
    expect(settleChecklist("[x] a\n[x] b\n[ ] c", 0)).toBe("[ ] c\n[x] a\n[x] b");
  });

  it("brings an open box at the bottom back to the top", () => {
    expect(settleChecklist("[x] a\n[x] b\n[ ] c", 2)).toBe("[ ] c\n[x] a\n[x] b");
  });

  it("settles only the run the box belongs to", () => {
    const src = "shopping\n[x] a\n[ ] b\n\nlater\n\n[ ] x\n[x] y";
    expect(settleChecklist(src, 1)).toBe("shopping\n[ ] b\n[x] a\n\nlater\n\n[ ] x\n[x] y");
  });

  /**
   * A blank line ends a run. The reader's grips draw the same boundary — an
   * item whose `lead` is a claimed newline starts a list of its own — so a
   * drag and a tick can never disagree about which lines are one list.
   */
  it("stops at a blank line, even with no words on it", () => {
    const src = "[x] a\n\n[ ] b";
    expect(settleChecklist(src, 0)).toBe(src);
  });

  it("keeps a dash in the middle of a checklist where it was written", () => {
    expect(settleChecklist("[x] a\n– mid\n[ ] b", 0)).toBe("[ ] b\n– mid\n[x] a");
  });

  /**
   * The line that names a list is written above it, and a tick is no reason to
   * move it. The old settle partitioned the run into open + everything else +
   * done, so a dash at the head of the run was re-emitted between the two
   * groups and the title of the list jumped into the middle of it on the first
   * tick.
   */
  it("leaves a dash at the head of the run at the head of the run", () => {
    expect(settleChecklist("– Groceries\n[x] milk\n[ ] bread", 1)).toBe(
      "– Groceries\n[ ] bread\n[x] milk",
    );
  });

  it("leaves a dash at the foot of the run at the foot of the run", () => {
    expect(settleChecklist("[x] milk\n[ ] bread\n– from the market", 0)).toBe(
      "[ ] bread\n[x] milk\n– from the market",
    );
  });

  it("holds every non-box line at its own index, not just one of them", () => {
    const src = "– one\n[x] a\n1. two\n[ ] b\n– three";
    expect(settleChecklist(src, 1)).toBe("– one\n[ ] b\n1. two\n[x] a\n– three");
  });

  it("moves nothing when the boxes are already settled around a dash", () => {
    const src = "– Groceries\n[ ] milk\n[x] bread";
    expect(settleChecklist(src, 1)).toBe(src);
  });

  it("keeps a box's own writing around it, dash prefix and all", () => {
    expect(settleChecklist("- [x] a\n- [ ] b", 0)).toBe("- [ ] b\n- [x] a");
  });

  it("writes nothing when the run is already settled", () => {
    const src = "[ ] a\n[x] b";
    expect(settleChecklist(src, 0)).toBe(src);
    expect(settleChecklist(src, 1)).toBe(src);
  });

  it("does not touch a dash or numbered list — there is no box to settle", () => {
    expect(settleChecklist("– a\n– b\n– c", 0)).toBe("– a\n– b\n– c");
    expect(settleChecklist("1. a\n2. b", 0)).toBe("1. a\n2. b");
  });

  it("refuses a line that is not a box or is not there", () => {
    const src = "one\ntwo";
    expect(settleChecklist(src, 0)).toBe(src);
    expect(settleChecklist("[ ] a", 5)).toBe("[ ] a");
  });
});


/**
 * One tick, whole: the box changes and the run settles under it. Both halves
 * are asserted together here because they are one gesture — and because the
 * open note and the Ticker both reach them through this one function.
 */
describe("tickItem", () => {
  /** The block for the box on `line`, read the way both call sites read it. */
  function boxOn(src: string, line: number): ItemBlock {
    const block = parseBlocks(src)
      .filter((b): b is ItemBlock => b.kind === "check")
      .find((b) => lineAt(src, b.markerAt) === line);
    if (!block) throw new Error(`no box on line ${line}`);
    return block;
  }

  it("ticks the box and sinks it, in one move", () => {
    const src = "[ ] milk\n[ ] bread";
    expect(tickItem(src, boxOn(src, 0))).toBe("[ ] bread\n[x] milk");
  });

  it("keeps the line above the list above the list", () => {
    const src = "– Groceries\n[ ] milk\n[ ] bread";
    expect(tickItem(src, boxOn(src, 1))).toBe("– Groceries\n[ ] bread\n[x] milk");
  });

  /**
   * The imported spelling, ticked. One character for one, so `lineAt` — which
   * is measured against the text as it was *before* the toggle — still names
   * the same line afterwards.
   */
  it("ticks an imported box in its own spelling and settles it", () => {
    const src = "☐ milk\n☐ bread";
    expect(tickItem(src, boxOn(src, 0))).toBe("☐ bread\n☑ milk");
  });
});
