import { describe, expect, it } from "vitest";
import { asChecklist, autoformat, continueList, DASH } from "./autoformat";

/** Types `text` one character at a time, the way a person does. */
function type(text: string, from = ""): string {
  let value = from;
  let caret = from.length;
  for (const ch of text) {
    value = value.slice(0, caret) + ch + value.slice(caret);
    caret += 1;
    const hit = autoformat(value, caret);
    if (hit) {
      value = hit.value;
      caret = hit.caret;
    }
  }
  return value;
}

describe("autoformat", () => {
  it("turns a leading '- ' into an en dash", () => {
    expect(type("- milk")).toBe(`${DASH} milk`);
    expect(type("* milk")).toBe(`${DASH} milk`);
  });

  it("does the same on a later line, not just the first", () => {
    expect(type("- b", `${DASH} a\n`)).toBe(`${DASH} a\n${DASH} b`);
  });

  it("leaves hyphens inside a sentence alone", () => {
    expect(type("e-post - kolla")).toBe("e-post - kolla");
    expect(type("well - maybe")).toBe("well - maybe");
  });

  it("opens a tick box from '[] '", () => {
    expect(type("[] milk")).toBe("[ ] milk");
  });

  it("collapses a marker typed on top of one the list already added", () => {
    // Enter continues the list, so the line already opens with "– ". Typing
    // "- " out of habit used to leave "– - ".
    expect(type("- milk", `${DASH} `)).toBe(`${DASH} milk`);
    expect(type("[] milk", `${DASH} `)).toBe("[ ] milk");
  });

  it("never fires when the caret is not at the trigger", () => {
    // "- " exists at the head of the line, but the caret is further along.
    expect(autoformat("- milk", 6)).toBeNull();
  });
});

describe("continueList", () => {
  it("carries the marker to the next line", () => {
    const out = continueList(`${DASH} milk`, 6);
    expect(out?.value).toBe(`${DASH} milk\n${DASH} `);
    expect(out?.caret).toBe(out?.value.length);
  });

  it("carries a box, always unticked", () => {
    expect(continueList("[x] milk", 8)?.value).toBe("[x] milk\n[ ] ");
  });

  it("keeps the indent", () => {
    expect(continueList("  [ ] milk", 10)?.value).toBe("  [ ] milk\n  [ ] ");
  });

  /**
   * A box written after a dash is one marker. Read as a dash whose words began
   * with brackets, Enter continued "– [ ] milk" as a bare "– " and the next
   * item had nothing to tick.
   */
  it("carries a box written after a dash, box and all", () => {
    const out = continueList(`${DASH} [ ] milk`, 10);
    expect(out?.value).toBe(`${DASH} [ ] milk\n${DASH} [ ] `);
    expect(out?.caret).toBe(out?.value.length);
    expect(continueList(`${DASH} [x] milk`, 10)?.value).toBe(`${DASH} [x] milk\n${DASH} [ ] `);
    expect(continueList("- [ ] milk", 10)?.value).toBe("- [ ] milk\n- [ ] ");
  });

  it("ends a dash-and-box list on an empty item", () => {
    const src = `${DASH} [ ] milk\n${DASH} [ ] `;
    const out = continueList(src, src.length);
    expect(out?.value).toBe(`${DASH} [ ] milk\n`);
    expect(out?.caret).toBe(11);
  });

  it("ends the list on an empty item rather than adding another", () => {
    const out = continueList(`${DASH} milk\n${DASH} `, 9);
    expect(out?.value).toBe(`${DASH} milk\n`);
    expect(out?.caret).toBe(7);
  });

  it("stays out of the way in ordinary prose", () => {
    expect(continueList("just a sentence", 15)).toBeNull();
  });
});

/**
 * The line is read whole, never up to the caret.
 *
 * Measured to the caret, "is this item empty?" was really "is there nothing
 * between the marker and the caret?" — so the caret parked just after the
 * marker of a *full* item said the item was empty, the list-is-over branch
 * fired, and Enter **deleted the marker** and inserted no newline at all. Every
 * keystroke is saved, so the browser's own undo could not put it back. Every
 * marker kind, and both places the caret can sit, are pinned here.
 */
describe("continueList, with the caret inside the line", () => {
  it("breaks the line instead of eating the marker, just after a dash", () => {
    // "– milk", Home, right, right. The old code returned "milk".
    const out = continueList(`${DASH} milk`, 2);
    expect(out?.value).toBe(`${DASH} \n${DASH} milk`);
    expect(out?.caret).toBe(5);
  });

  it("breaks the line just after a box", () => {
    expect(continueList("[ ] milk", 4)?.value).toBe("[ ] \n[ ] milk");
  });

  it("breaks the line just after a number, counting up as it goes", () => {
    expect(continueList("1. milk", 3)?.value).toBe("1. \n2. milk");
  });

  it("splits the words where the caret actually is", () => {
    expect(continueList("[ ] milk", 6)?.value).toBe("[ ] mi\n[ ] lk");
    expect(continueList(`${DASH} milk`, 4)?.value).toBe(`${DASH} mi\n${DASH} lk`);
    expect(continueList("3) milk", 5)?.value).toBe("3) mi\n4) lk");
  });

  it("does the same on a line with items under it", () => {
    const src = `${DASH} milk\n${DASH} bread`;
    expect(continueList(src, 2)?.value).toBe(`${DASH} \n${DASH} milk\n${DASH} bread`);
  });

  /**
   * Nothing in front of the caret to continue, so the browser's own newline is
   * the only honest answer — Enter at the very start of an item pushes the item
   * down, it does not lay a second marker on top of it.
   */
  it("says nothing at all when the caret is before or inside the marker", () => {
    expect(continueList(`${DASH} milk`, 0)).toBeNull();
    expect(continueList(`${DASH} milk`, 1)).toBeNull();
    expect(continueList("[ ] milk", 0)).toBeNull();
    expect(continueList("[ ] milk", 2)).toBeNull();
    expect(continueList("1. milk", 0)).toBeNull();
    expect(continueList("1. milk", 2)).toBeNull();
    expect(continueList("  [ ] milk", 1)).toBeNull();
  });

  it("still ends the list from the end of an empty item", () => {
    expect(continueList(`${DASH} milk\n${DASH} `, 9)?.value).toBe(`${DASH} milk\n`);
    expect(continueList("[ ] milk\n[ ] ", 13)?.value).toBe("[ ] milk\n");
    expect(continueList("1. milk\n2. ", 11)?.value).toBe("1. milk\n");
  });

  it("ends it from an empty item with items under it too, and takes only that line", () => {
    // The end of the *line* is what the rule asks for, not the end of the note.
    const src = `${DASH} \n${DASH} milk`;
    const out = continueList(src, 2);
    expect(out?.value).toBe(`\n${DASH} milk`);
    expect(out?.caret).toBe(0);
  });

  it("reads a line that still carries a carriage return as an item", () => {
    // Nothing typed can produce this — a textarea normalises its own value —
    // but a body that arrived from somewhere that did not can.
    const out = continueList("[ ] milk\r\nnext", 8);
    expect(out?.value).toBe("[ ] milk\n[ ] \r\nnext");
  });
});

describe("continueList, numbered", () => {
  it("counts up", () => {
    const out = continueList("1. milk", 7);
    expect(out?.value).toBe("1. milk\n2. ");
    expect(out?.caret).toBe(out?.value.length);
  });

  it("keeps counting, and rolls into two digits", () => {
    expect(continueList("2. bread", 8)?.value).toBe("2. bread\n3. ");
    expect(continueList("9. eggs", 7)?.value).toBe("9. eggs\n10. ");
  });

  it("keeps the writer's bracket style and indent", () => {
    expect(continueList("1) milk", 7)?.value).toBe("1) milk\n2) ");
    expect(continueList("  3. milk", 9)?.value).toBe("  3. milk\n  4. ");
  });

  it("ends the list on an empty item", () => {
    const out = continueList("1. milk\n2. ", 11);
    expect(out?.value).toBe("1. milk\n");
    expect(out?.caret).toBe(8);
  });

  it("leaves a year at the head of a sentence alone", () => {
    expect(continueList("1998. Best year of the lot", 26)).toBeNull();
    expect(continueList("2024. It rained", 15)).toBeNull();
  });

  it("needs the space, so a decimal is never a list", () => {
    expect(continueList("3.14 is pi", 10)).toBeNull();
  });

  /**
   * The one thing it deliberately does not do. Renumbering the items below
   * would mean rewriting lines the caret is nowhere near, and this file never
   * touches text the user is not currently typing.
   */
  it("does not renumber the items below an insertion", () => {
    const src = "1. milk\n2. bread\n3. eggs";
    expect(continueList(src, 7)?.value).toBe("1. milk\n2. \n2. bread\n3. eggs");
  });
});

/**
 * The to-do mark on a capture of several lines makes a list to tick (review
 * 2026-10-01, UX-05). The user asked for it by pressing To-do; nothing here
 * runs on the words of a plain capture.
 */
describe("asChecklist", () => {
  it("boxes a single line only when asked to (a capture on Todos), and never names it", () => {
    expect(asChecklist("bread")).toBe("bread");
    expect(asChecklist("bread", true)).toBe("[ ] bread");
    expect(asChecklist("buy stamps.", true)).toBe("[ ] buy stamps.");
    expect(asChecklist("– bread", true)).toBe("[ ] bread");
    expect(asChecklist("[ ] bread", true)).toBe("[ ] bread");
    expect(asChecklist("# Errands", true)).toBe("# Errands");
  });

  it("makes every line a tick box", () => {
    expect(asChecklist("- screws\n- sandpaper\n- glue")).toBe("[ ] screws\n[ ] sandpaper\n[ ] glue");
  });

  it("boxes every line of a plain list, its first item too", () => {
    expect(asChecklist("Milk\nEggs\nBread")).toBe("[ ] Milk\n[ ] Eggs\n[ ] Bread");
    expect(asChecklist("Shopping\nmilk\neggs\nbread")).toBe("[ ] Shopping\n[ ] milk\n[ ] eggs\n[ ] bread");
    expect(asChecklist("milk\neggs")).toBe("[ ] milk\n[ ] eggs");
  });

  it("makes a first line ending with a colon the note's name", () => {
    expect(asChecklist("Shopping:\nmilk\neggs\nbread")).toBe("# Shopping\n[ ] milk\n[ ] eggs\n[ ] bread");
    expect(asChecklist("Shopping :\nmilk\neggs")).toBe("# Shopping\n[ ] milk\n[ ] eggs");
    expect(asChecklist("Shopping:\n\nmilk\neggs")).toBe("# Shopping\n\n[ ] milk\n[ ] eggs");
  });

  it("makes a first line with a blank line right under it the note's name", () => {
    expect(asChecklist("Shopping\n\nmilk\neggs")).toBe("# Shopping\n\n[ ] milk\n[ ] eggs");
    expect(asChecklist("Shopping\n\nmilk")).toBe("# Shopping\n\n[ ] milk");
  });

  it("names a list over a single item, but never a lone line", () => {
    expect(asChecklist("Shopping:\nmilk")).toBe("# Shopping\n[ ] milk");
    expect(asChecklist("Shopping:")).toBe("Shopping:");
    expect(asChecklist("Shopping:\n\n")).toBe("Shopping:\n\n");
  });

  it("does not name a first line that is long, a marker, or a sentence", () => {
    const long = "Everything we need from the shop on the way home:";
    expect(asChecklist(`${long}\nmilk\neggs`)).toBe(`[ ] ${long}\n[ ] milk\n[ ] eggs`);
    expect(asChecklist("- Shopping:\nmilk\neggs")).toBe("[ ] Shopping:\n[ ] milk\n[ ] eggs");
    expect(asChecklist("Call the dentist about the crown.\nbook\nbuy")).toBe(
      "[ ] Call the dentist about the crown.\n[ ] book\n[ ] buy",
    );
    expect(asChecklist("Call mom.\n\nbuy milk")).toBe("[ ] Call mom.\n\n[ ] buy milk");
  });

  it("does not name a first line whose blank line is further down", () => {
    expect(asChecklist("Milk\nEggs\n\nBread")).toBe("[ ] Milk\n[ ] Eggs\n\n[ ] Bread");
  });

  it("leaves a single line alone", () => {
    expect(asChecklist("call the dentist")).toBe("call the dentist");
    expect(asChecklist("call the dentist\n\n")).toBe("call the dentist\n\n");
  });

  it("keeps blank lines blank and indentation where it was", () => {
    expect(asChecklist("a\nb\n\n  c")).toBe("[ ] a\n[ ] b\n\n  [ ] c");
  });

  it("lets a box take over from a dash or a number", () => {
    expect(asChecklist("– milk\n- eggs\n3. bread")).toBe("[ ] milk\n[ ] eggs\n[ ] bread");
  });

  it("leaves a list the writer already boxed exactly as written", () => {
    const own = "Shopping\n[ ] milk\n[x] eggs";
    expect(asChecklist(own)).toBe(own);
  });

  it("keeps a name on the first line as the name", () => {
    expect(asChecklist("# Hardware\nscrews\nsandpaper")).toBe("# Hardware\n[ ] screws\n[ ] sandpaper");
  });
});
