import { describe, expect, it } from "vitest";
import {
  cardLines,
  cutDepth,
  deriveFace,
  hitScrollTop,
  isLinkNote,
  markHits,
  shiftToMatch,
} from "./face";
import { archiveNotes } from "../seed/archive";
import type { Note } from "../types";
import { note as base } from "../test/fixtures";

const note = (partial: Partial<Note>): Note =>
  base({
    id: "1",
    raw_content: "",
    body: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  });


describe("deriveFace", () => {
  it("shows the note's own text, whole, with no heading split off", () => {
    const face = deriveFace(note({ body: "Vaihda pankkitilin salasana" }));
    expect(face.kind).toBe("text");
    expect(face.body).toBe("Vaihda pankkitilin salasana");
    expect(face.remaining).toBe(0);
  });

  it("keeps a short first line in the body instead of promoting it", () => {
    const face = deriveFace(note({ body: "Pasta home\n\nsemolina 200g" }));
    expect(face.body).toBe("Pasta home\nsemolina 200g");
  });

  it("cuts long bodies and reports the hidden mass", () => {
    const face = deriveFace(note({ body: "word ".repeat(400) }), {
      lines: 2,
      charsPerLine: 50,
    });
    expect(face.remaining).toBeGreaterThan(0);
    // One line of overfill on purpose, so the clamp always has a full last
    // line to fade. Anything beyond that is text CSS will never draw.
    expect(face.body.length).toBeLessThanOrEqual(100 + 50 + 12);
    expect(face.body.length).toBeGreaterThan(100);
  });

  it("counts a short line as a whole line, not as its characters", () => {
    // Eight one-word lines fill an eight-line card even though they are only
    // 39 characters. Measuring in characters used to let all of them through
    // and then let CSS hide half the card silently.
    const body = ["milk", "eggs", "bread", "jam", "tea", "rice", "salt", "oil"].join(
      "\n",
    );
    const face = deriveFace(note({ body }), { lines: 3, charsPerLine: 40 });
    expect(face.body.startsWith("milk\neggs\nbread")).toBe(true);
    // The overfill must not swallow the remainder: three lines fit, five are
    // hidden, and the card has to still say so.
    expect(face.remaining).toBeGreaterThan(0);
  });

  it("closes up blank runs rather than spending a line on nothing", () => {
    const face = deriveFace(note({ body: "first\n\n\n\nsecond" }));
    expect(face.body).toBe("first\nsecond");
    expect(face.remaining).toBe(0);
  });

  it("reports nothing hidden when tidying was all that happened", () => {
    const face = deriveFace(note({ body: "  spaced   out  \n\n\n  words " }));
    expect(face.remaining).toBe(0);
  });

  it("renders saved links as a domain, not a URL", () => {
    const face = deriveFace(
      note({ body: "Saved link: Bread baking 101 — https://example.com/bread" }),
    );
    expect(face.kind).toBe("link");
    expect(face.domain).toBe("example.com");
    expect(face.body).toBe("Bread baking 101");
  });

  it("removes every address, not only the first", () => {
    const face = deriveFace(
      note({
        body: "Forehead\n\nhttps://youtube.com/playlist?list=AAAA\n\nSaved link: Forehead fables patreon — http://www.youtube.com/playlist?list=BBBB",
      }),
    );
    expect(face.body).not.toMatch(/http/);
    expect(face.body).toBe("Forehead\nForehead fables patreon");
  });

  it("does not leave two dashes where an address used to sit between them", () => {
    const face = deriveFace(
      note({ body: "Claude by Anthropic — https://claude.com/x — Claude learns" }),
    );
    expect(face.body).toBe("Claude by Anthropic — Claude learns");
  });

  it("parses checklists and counts what is hidden", () => {
    const body = ["[ ] milk", "[x] eggs", "[ ] bread", "[ ] jam", "[ ] tea", "[ ] rice"].join(
      "\n",
    );
    const face = deriveFace(note({ body }), { lines: 5, charsPerLine: 40 });
    expect(face.kind).toBe("checklist");
    expect(face.items).toHaveLength(5);
    expect(face.hiddenItems).toBe(1);
    expect(face.items[1]).toMatchObject({ text: "eggs", done: true });
  });

  /**
   * An item's words do not get the list's whole width: the box and the gap
   * after it take about four characters off the front of every line. Budgeted
   * on the full width, an item that wraps beside its box was counted as one
   * line, and the card sliced its second line in half at the clamp (review
   * UI-07). Counted on the narrower measure, it is shown whole or left out and
   * counted.
   */
  it("measures an item beside its box, not across the whole card", () => {
    const body = ["[ ] a jacket for evenings", "[ ] milk", "[ ] eggs"].join("\n");
    // 21 characters: one line across 22, two beside a box.
    const face = deriveFace(note({ body }), { lines: 3, charsPerLine: 22 });
    expect(face.items.map((item) => item.text)).toEqual(["a jacket for evenings", "milk"]);
    expect(face.hiddenItems).toBe(1);
  });

  /**
   * The checklist face shows the items and nothing else, so it may only be
   * taken when the items are what the note is. A page of writing that ends in a
   * couple of tick boxes was losing the writing off its card entirely.
   */
  it("does not turn a note into a checklist over two boxes at the end", () => {
    const body = [
      "Rang the letting agent about the boiler.",
      "They will send someone Thursday between eight and twelve,",
      "and the service record has to be in the flat.",
      "[ ] find the folder",
      "[ ] be in on Thursday",
    ].join("\n");
    const face = deriveFace(note({ body }), { lines: 8, charsPerLine: 40 });

    expect(face.kind).toBe("text");
    expect(face.body).toContain("letting agent");
    // Nothing is lost by falling through: the boxes are still drawn as boxes,
    // in place, and the footer still counts them.
    expect(face.checkCount).toBe(2);
    expect(cardLines(face.body).filter((l) => l.marker !== null)).toHaveLength(2);
  });

  it("keeps prose before boxes on the card", () => {
    const face = deriveFace(
      note({ body: "Shopping\n[ ] milk\n[ ] eggs\n[ ] bread" }),
      { lines: 8, charsPerLine: 40 },
    );
    expect(face.kind).toBe("text");
    expect(face.body).toContain("Shopping");
    expect(cardLines(face.body).filter((l) => l.marker !== null)).toHaveLength(3);
  });

  it("survives an empty note without throwing", () => {
    const face = deriveFace(note({ body: "" }));
    expect(face.body).toBe("");
    expect(face.remaining).toBe(0);
  });
});

describe("cutDepth", () => {
  const face = (over: Partial<ReturnType<typeof deriveFace>>) =>
    ({ remaining: 0, hiddenItems: 0, ...over }) as ReturnType<typeof deriveFace>;

  it("says nothing when nothing is hidden", () => {
    expect(cutDepth(face({}))).toBe(0);
  });

  it("answers 'a bit / a lot' in three steps, not in characters", () => {
    expect(cutDepth(face({ remaining: 60 }))).toBe(1);
    expect(cutDepth(face({ remaining: 800 }))).toBe(2);
    expect(cutDepth(face({ remaining: 14000 }))).toBe(3);
  });

  it("counts hidden checklist items on the same three steps", () => {
    expect(cutDepth(face({ hiddenItems: 1 }))).toBe(1);
    expect(cutDepth(face({ hiddenItems: 4 }))).toBe(2);
    expect(cutDepth(face({ hiddenItems: 20 }))).toBe(3);
  });
});

describe("the file face", () => {
  const shot = {
    id: "a1",
    name: "screenshot.png",
    mime: "image/png",
    size: 12345,
    width: 1200,
    height: 800,
    thumb: "data:image/jpeg;base64,xx",
    path: null,
    added_at: "2026-08-10T00:00:00.000Z",
  };

  // The normal case now: a dropped file writes no text at all.
  it("shows the file when the note has no text", () => {
    const face = deriveFace(note({ body: "", attachments: [shot] }));
    expect(face.kind).toBe("file");
    expect(face.file?.name).toBe("screenshot.png");
  });

  // A name is drawn over the picture, not instead of it.
  it("keeps the file face when the note is only named", () => {
    const face = deriveFace(note({ body: "# Receipt", attachments: [shot] }));
    expect(face.kind).toBe("file");
    expect(deriveFace(note({ body: "# Receipt\n\nfrom the shop", attachments: [shot] })).kind)
      .toBe("text");
  });

  // And the case every file captured before that still looks like on disk.
  it("shows the file when the note's only text is the filename", () => {
    const face = deriveFace(
      note({ body: "screenshot.png", attachments: [shot] }),
    );
    expect(face.kind).toBe("file");
    expect(face.file?.name).toBe("screenshot.png");
  });

  /**
   * The filename is what a dropped file writes for itself, not the user
   * writing. The moment there are real words they win — they are worth more
   * than a picture of the file, and the file still says so in the footer.
   */
  it("gives the card back to the words as soon as there are any", () => {
    const face = deriveFace(
      note({ body: "screenshot.png\nthe error from Tuesday", attachments: [shot] }),
    );
    expect(face.kind).toBe("text");
    expect(face.fileCount).toBe(1);
    expect(face.body).toContain("the error from Tuesday");
  });

  it("counts the files even on a face that is not showing one", () => {
    const face = deriveFace(note({ body: "words", attachments: [shot, shot] }));
    expect(face.kind).toBe("text");
    expect(face.fileCount).toBe(2);
  });

  it("keeps every file for a file card preview", () => {
    const face = deriveFace(note({ body: "", attachments: [shot, { ...shot, id: "a2" }] }));
    expect(face.files).toHaveLength(2);
  });

  it("leaves every note without files exactly as it was", () => {
    expect(deriveFace(note({ body: "just a note" })).kind).toBe("text");
    expect(deriveFace(note({ body: "just a note" })).fileCount).toBe(0);
  });
});

/**
 * The footer's job is to say what is in the note that the face is not showing —
 * the same job the link count has always done. Eight lines of a fifteen-thousand
 * character note is a thin sample, and what got cut is often the part you were
 * looking for.
 */
describe("what the card footer says is inside", () => {
  it("finds a tick box the card face has no room to draw", () => {
    const body = `${"word ".repeat(80)}\n[ ] renew the passport`;
    const face = deriveFace(note({ body }), { lines: 2, charsPerLine: 40 });
    expect(face.kind).toBe("text");
    expect(face.body).not.toContain("passport");
    expect(face.checkCount).toBe(1);
  });

  it("says nothing about boxes in a note that has none", () => {
    expect(deriveFace(note({ body: "kanelipullat [not a box]" })).checkCount).toBe(0);
  });

  it("finds a fenced block wherever in the note it sits", () => {
    const face = deriveFace(
      note({ body: "to rebuild:\n```sh\nnpm run build\n```\nthen ship it" }),
    );
    expect(face.codeInside).toBe(true);
  });

  it("does not call ordinary prose code", () => {
    expect(deriveFace(note({ body: "Vaihda pankkitilin salasana" })).codeInside).toBe(
      false,
    );
  });

  /**
   * The mark is only worth having if it means something, and it only means
   * something if it is never wrong. blocks.test.ts holds unfenced detection at
   * zero false positives over the real archive; this holds the card to the same
   * line, because the card is where a wrong answer would actually be seen.
   */
  it("puts no code mark on any note in the real archive", () => {
    const notes = archiveNotes;
    const marked = notes.filter((n) =>
      deriveFace(note({ body: n.body ?? n.raw_content ?? "" })).codeInside,
    );
    expect(marked).toHaveLength(0);
  });
});

describe("cardLines", () => {
  it("marks the items and leaves the rest alone", () => {
    const lines = cardLines("Shopping\n1. milk\n2. bread\nafter");
    expect(lines.map((l) => l.marker)).toEqual([null, "1. ", "2. ", null]);
    expect(lines.map((l) => l.numbered)).toEqual([false, true, true, false]);
    expect(lines[1].words).toBe("milk");
    expect(lines[0].text).toBe("Shopping");
  });

  it("knows a dash and a box are items too, and which is counted", () => {
    const lines = cardLines("– milk\n[x] bread");
    expect(lines.map((l) => l.marker)).toEqual(["– ", "[x]"]);
    expect(lines.map((l) => l.numbered)).toEqual([false, false]);
    expect(lines[1].done).toBe(true);
  });

  /**
   * A card is display-only, but it still stands for the note. Losing or
   * inventing a character here would mean the card said something the note
   * does not — the same rule parseBlocks lives under, for a different reason.
   */
  it("puts every line back exactly, marker and words together", () => {
    const notes = archiveNotes;
    for (const n of notes) {
      const src = n.body ?? n.raw_content ?? "";
      if (src === "") continue;
      const back = cardLines(src)
        .map((l) => (l.marker === null ? l.text : l.marker + l.words))
        .join("\n");
      expect(back).toBe(src);
    }
  });
});

describe("what a card does with the marks", () => {
  it("draws a heading's words and drops its hashes", () => {
    const [line] = cardLines("## Shopping");
    expect(line.heading).toBe(true);
    expect(line.segs.map((s) => s.text).join("")).toBe("Shopping");
    // The whole line is still there, so the round trip above still holds.
    expect(line.text).toBe("## Shopping");
  });

  it("sets emphasis and drops its delimiters", () => {
    const [line] = cardLines("a **b** c");
    expect(line.segs.map((s) => s.text).join("")).toBe("a b c");
    expect(line.segs.find((s) => s.strong)?.text).toBe("b");
    expect(line.segs.some((s) => s.hidden)).toBe(false);
  });

  it("keeps a list item's marker and marks its words", () => {
    const [line] = cardLines("1. buy **milk**");
    expect(line.marker).toBe("1. ");
    expect(line.numbered).toBe(true);
    expect(line.segs.map((s) => s.text).join("")).toBe("buy milk");
  });
});

/**
 * The two questions this file used to answer differently from the rest of the
 * app. Both had drifted, and both are visible on a card.
 */
describe("one definition of a link, shared with lib/links.ts", () => {
  it("counts a bare www. address, which the old pattern could not see", () => {
    const face = deriveFace(note({ body: "Fables patreon — www.patreon.com/fables" }));
    expect(face.linkCount).toBe(1);
  });

  it("draws the link face for one, rather than reserving three lines and drawing nothing", () => {
    // NoteCard surrendered three of its eight body lines on the strength of
    // links.ts finding this address, and face.ts then declined to draw a link
    // face because its own pattern required a scheme. The card came out three
    // lines short with blank space where the preview should have been.
    const saved = note({ body: "www.example.com/a-good-read" });
    expect(isLinkNote(saved)).toBe(true);
    const face = deriveFace(saved);
    expect(face.kind).toBe("link");
    expect(face.domain).toBe("example.com");
  });

  it("still leaves a long note with an address as a text note", () => {
    const wordy = note({ body: `${"word ".repeat(120)} https://example.com` });
    expect(isLinkNote(wordy)).toBe(false);
    expect(deriveFace(wordy).kind).toBe("text");
  });
});

describe("one definition of a tick box, shared with markerOf", () => {
  it("reads the en dash the app's own typing help produces", () => {
    // autoformat.ts rewrites "- " to "– " as you type, so this is a checklist
    // the app helped write. The old pattern here accepted a hyphen or an
    // asterisk and not an en dash, so it counted zero items: no checklist
    // face, no footer count, and missing from the Todos board — while the open
    // note drew every line as a tickable box.
    const list = note({ body: ["– [ ] milk", "– [x] bread"].join("\n") });
    const face = deriveFace(list);
    expect(face.checkCount).toBe(2);
    expect(face.kind).toBe("checklist");
    expect(face.items.map((i) => i.text)).toEqual(["milk", "bread"]);
    expect(face.items.map((i) => i.done)).toEqual([false, true]);
  });

  it("still reads the plain forms it always did", () => {
    const face = deriveFace(note({ body: ["[ ] one", "- [x] two", "☑ three"].join("\n") }));
    expect(face.checkCount).toBe(3);
  });

  /** The footer's `done/total` — both halves from the one walk over the boxes. */
  it("counts the ticked boxes beside the total, in every spelling", () => {
    const face = deriveFace(
      note({ body: ["[ ] one", "- [x] two", "☑ three", "– [X] four", "☐ five"].join("\n") }),
    );
    expect(face.checkCount).toBe(5);
    expect(face.checkDone).toBe(3);
    expect(deriveFace(note({ body: "only words" })).checkDone).toBe(0);
  });
});

/**
 * A card normally shows the note from its first character, which for a hit
 * two hundred lines down showed an opening that need not contain the query at
 * all — a result you had to open to understand, which is the one job the board
 * exists to save you.
 */
describe("a card face while a search is running", () => {
  it("winds forward to the line the match is on, keeping one line of lead-in", () => {
    const body = ["alpha", "beta", "gamma", "delta", "kanelipullat", "epsilon"].join("\n");
    expect(shiftToMatch(body, ["kanelipulla"])).toBe(
      ["delta", "kanelipullat", "epsilon"].join("\n"),
    );
  });

  it("leaves a match already at the top exactly where it is", () => {
    // Nothing to gain by winding on, and winding would lose the opening.
    const body = ["kanelipullat", "beta", "gamma"].join("\n");
    expect(shiftToMatch(body, ["kanelipulla"])).toBe(body);
    const second = ["alpha", "kanelipullat", "gamma"].join("\n");
    expect(shiftToMatch(second, ["kanelipulla"])).toBe(second);
  });

  it("leaves the text alone when the hit was somewhere the card cannot draw", () => {
    // A filename match, most likely: searchNotes ranks on those too.
    const body = ["alpha", "beta", "gamma"].join("\n");
    expect(shiftToMatch(body, ["screenshot"])).toBe(body);
    expect(shiftToMatch(body, [])).toBe(body);
  });

  // Review 2026-10-04, UI-A-11: "number 50" opened a long note at line 1,
  // where "number" was, though the one line holding both words was far down.
  it("opens a search of several words at the first line holding all of them", () => {
    const body = ["number one", "alpha", "beta", "gamma", "number 50 here", "50 again"].join("\n");
    expect(shiftToMatch(body, ["number", "50"])).toBe(
      ["gamma", "number 50 here", "50 again"].join("\n"),
    );
  });

  it("takes the line holding the most of the words when none holds them all", () => {
    const body = ["milk", "a", "b", "milk and bread", "c", "milk bread eggs"].join("\n");
    expect(shiftToMatch(body, ["milk", "bread", "eggs", "jam"])).toBe(
      ["c", "milk bread eggs"].join("\n"),
    );
  });

  it("lights the words on that line most strongly, and only for several words", () => {
    const lines = cardLines(["number one", "number 50 here"].join("\n"), ["number", "50"]);
    const best = (i: number) => lines[i].segs.filter((s) => s.hit).map((s) => s.best ?? false);
    expect(best(0)).toEqual([false]);
    expect(best(1)).toEqual([true, true]);
    // One word has no line to prefer: every hit is the same hit.
    const one = cardLines(["number one", "number 50"].join("\n"), ["number"]);
    expect(one.flatMap((l) => l.segs).some((s) => s.best)).toBe(false);
    // Several words never found together on a line: nothing is singled out.
    const apart = cardLines(["number one", "fifty 50"].join("\n"), ["number", "50"]);
    expect(apart.flatMap((l) => l.segs).some((s) => s.best)).toBe(false);
  });

  it("starts a checklist at the item holding every word, and lights it", () => {
    const body = ["[ ] milk", "[ ] bread", "[ ] eggs", "[ ] oat milk", "[ ] milk bread"].join("\n");
    const face = deriveFace(note({ body }), undefined, ["milk", "bread"]);
    expect(face.kind).toBe("checklist");
    expect(face.items[0].text).toBe("oat milk");
    const lit = face.items.flatMap((it) => it.segs).filter((s) => s.best).map((s) => s.text);
    expect(lit).toEqual(["milk", "bread"]);
  });

  it("marks the matched run and nothing else", () => {
    const segs = markHits([{ text: "kanelipullat sunnuntaina" }], ["kanelipulla"]);
    expect(segs.map((s) => s.text)).toEqual(["kanelipulla", "t sunnuntaina"]);
    expect(segs.map((s) => s.hit ?? false)).toEqual([true, false]);
  });

  it("merges overlapping terms so one word is never drawn as two", () => {
    // "an" inside "and" would otherwise emit two segments for one word, and
    // the card would draw the join between them.
    const segs = markHits([{ text: "and then" }], ["an", "and"]);
    expect(segs.map((s) => s.text)).toEqual(["and", " then"]);
    expect(segs[0].hit).toBe(true);
  });

  it("keeps the emphasis a segment already carried", () => {
    const segs = markHits([{ text: "kanelipullat", strong: true }], ["pulla"]);
    expect(segs.every((s) => s.strong)).toBe(true);
    expect(segs.find((s) => s.hit)?.text).toBe("pulla");
  });

  it("never touches a delimiter the reader is keeping honest", () => {
    const segs = markHits([{ text: "**", hidden: true }], ["*"]);
    expect(segs).toHaveLength(1);
    expect(segs[0].hit).toBeUndefined();
  });

  it("changes nothing at all when nothing is being searched", () => {
    const body = ["alpha", "beta", "gamma", "delta", "kanelipullat"].join("\n");
    const plain = deriveFace(note({ body }));
    const searched = deriveFace(note({ body }), undefined, []);
    expect(searched.body).toBe(plain.body);
    expect(cardLines(plain.body).every((l) => l.segs.every((s) => !s.hit))).toBe(true);
  });

  it("draws the hit on the card's own lines", () => {
    const lines = cardLines("kanelipullat sunnuntaina", ["sunnu"]);
    const hit = lines[0].segs.find((s) => s.hit);
    expect(hit?.text).toBe("sunnu");
  });

  /**
   * A wound-forward face is a cut face. The four surviving lines of a
   * three-hundred-line note fit the budget with room to spare, so nothing was
   * *truncated* — and the remainder, which only counted what fell off the
   * bottom, came out zero. The card then drew a fragment of a long note with no
   * cut mark and no fade, which is the one thing the mark exists to prevent.
   */
  it("counts the lines it wound past, so a shifted card still says it is cut", () => {
    const rows = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    rows[297] = "kanelipullat";
    const face = deriveFace(note({ body: rows.join("\n") }), undefined, ["kanelipulla"]);
    expect(face.body.startsWith("line 296")).toBe(true);
    expect(face.remaining).toBeGreaterThan(0);
    expect(cutDepth(face)).toBeGreaterThan(0);
  });

  it("still reports nothing hidden on a short note it did not have to wind", () => {
    const face = deriveFace(note({ body: "kanelipullat sunnuntaina" }), undefined, [
      "kanelipulla",
    ]);
    expect(face.remaining).toBe(0);
    expect(cutDepth(face)).toBe(0);
  });

  it("winds a checklist forward to the item the match is on, and marks it", () => {
    // The checklist face used to be returned before `shiftToMatch` was reached,
    // so a forty-item list found by a word on item thirty drew items one to
    // eight with nothing marked in any of them.
    const rows = Array.from({ length: 40 }, (_, i) => `[ ] item ${i}`);
    rows[29] = "[ ] kanelipullat";
    const face = deriveFace(note({ body: rows.join("\n") }), undefined, ["kanelipulla"]);
    expect(face.kind).toBe("checklist");
    expect(face.items[0].text).toBe("item 28");
    expect(
      face.items
        .flatMap((item) => item.segs)
        .filter((seg) => seg.hit)
        .map((seg) => seg.text),
    ).toEqual(["kanelipulla"]);
    // Items wound past at the top are hidden exactly as the ones below the
    // budget are, so the cut level counts both.
    expect(face.hiddenItems).toBe(40 - face.items.length);
  });

  it("leaves a checklist on its first item when nothing is being searched", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `[ ] item ${i}`);
    const face = deriveFace(note({ body: rows.join("\n") }));
    expect(face.items[0].text).toBe("item 0");
    expect(face.items.every((item) => item.segs.every((seg) => !seg.hit))).toBe(true);
  });

  /**
   * `cardLines` re-reads the shifted text for its code blocks, and a fence only
   * makes a block when a close follows an open. Opened inside a block, the
   * window left the closing fence stranded as a literal line of prose — and in
   * a note with two blocks that stray close paired with the next block's open
   * and set the ordinary writing between them in the machine face.
   */
  it("opens the window on a code block's own fence rather than inside it", () => {
    const body = [
      "intro",
      "more intro",
      "```",
      "const a = 1;",
      "const kanelipulla = 2;",
      "```",
      "after the block",
      "```",
      "const b = 3;",
      "```",
    ].join("\n");
    const shown = shiftToMatch(body, ["kanelipulla"]);
    expect(shown.split("\n")[0]).toBe("```");
    // No fence is left without its partner.
    expect(shown.split("\n").filter((line) => line.trim() === "```").length % 2).toBe(0);
    // And the prose between the two blocks is still prose.
    const after = cardLines(shown, ["kanelipulla"]).find((l) => l.text === "after the block");
    expect(after?.code).toBe(false);
  });

  it("winds forward normally in a note whose fences are nowhere near the match", () => {
    const body = [
      "```",
      "const a = 1;",
      "```",
      "alpha",
      "beta",
      "gamma",
      "kanelipullat",
    ].join("\n");
    expect(shiftToMatch(body, ["kanelipulla"])).toBe(["gamma", "kanelipullat"].join("\n"));
  });

  it("ignores an empty term rather than looping on it", () => {
    // `indexOf("")` answers 0 and the walk never advances, so an empty term
    // used to hang the tab. `searchTerms` drops empties and so the running app
    // never produced one — but both of these are exported and called directly,
    // which left the invariant being kept by a module that merely happened to
    // satisfy it.
    const plain = [{ text: "kanelipullat" }];
    expect(markHits(plain, [""])).toEqual(plain);
    expect(
      markHits(plain, ["", "pulla"])
        .filter((seg) => seg.hit)
        .map((seg) => seg.text),
    ).toEqual(["pulla"]);
    const body = ["alpha", "beta", "gamma", "delta"].join("\n");
    expect(shiftToMatch(body, [""])).toBe(body);
  });
});

describe("hitScrollTop: the open note opened at its first hit", () => {
  // A 600px window onto the note, with a 26px line of lead-in.
  const at = (hitTop: number, scrollTop = 0) => hitScrollTop(hitTop, 26, scrollTop, 600, 26);

  it("leaves a hit that is already on screen exactly where it is", () => {
    expect(at(120)).toBeNull();
    expect(at(574)).toBeNull();
    // Opened at a remembered place that already shows it: that place stands.
    expect(at(2100, 1800)).toBeNull();
  });

  it("brings a hit below the fold up to one line under the top edge", () => {
    expect(at(2400)).toBe(2374);
    // Half on screen is not on screen.
    expect(at(590)).toBe(564);
  });

  it("brings a hit above a remembered place back down, never past the top", () => {
    expect(at(300, 1800)).toBe(274);
    expect(at(10, 1800)).toBe(0);
  });
});

describe("a named checklist", () => {
  // Naming a list used to turn it into prose: the `# ` line counted as a line
  // that is not a box, so the face fell to text and the note left Todos.
  it("keeps the checklist face, with a line given back for the name", () => {
    const items = Array.from({ length: 20 }, (_, i) => `[ ] item ${i}`).join("\n");
    const plain = deriveFace(note({ body: items }));
    const named = deriveFace(note({ body: `# Shopping\n\n${items}` }));
    expect(named.kind).toBe("checklist");
    expect(named.items.length).toBe(plain.items.length - 1);
    expect(named.checkCount).toBe(20);
  });

  it("still falls to text when there is prose beside the boxes", () => {
    const face = deriveFace(note({ body: "# Shopping\n\nremember\n[ ] milk\n[ ] eggs" }));
    expect(face.kind).toBe("text");
  });
});

describe("a checklist with a title line", () => {
  // The To-do mark writes a first line ended with ':' as the title (`asChecklist`),
  // and a person types the same thing by hand; the card draws both lists alike.
  it("keeps the checklist face when the first line ends with a colon", () => {
    const face = deriveFace(note({ body: "Packing:\n[ ] passport\n[x] sunglasses\n[ ] charger" }));
    expect(face.kind).toBe("checklist");
    expect(face.title).toBe("Packing");
    expect(face.items).toHaveLength(3);
    expect(face.checkDone).toBe(1);
  });

  it("keeps it when a blank line sets the first line off", () => {
    const face = deriveFace(note({ body: "Packing\n\n[ ] passport\n[ ] charger" }));
    expect(face.kind).toBe("checklist");
    expect(face.title).toBe("Packing");
  });

  it("gives the title a line out of the items' budget", () => {
    const items = Array.from({ length: 20 }, (_, i) => `[ ] item ${i}`).join("\n");
    const plain = deriveFace(note({ body: items }));
    const titled = deriveFace(note({ body: `Packing:\n${items}` }));
    expect(titled.items.length).toBe(plain.items.length - 1);
  });

  it("is still text when there is more than a title above the boxes", () => {
    expect(deriveFace(note({ body: "Packing:\nremember\n[ ] milk\n[ ] eggs" })).kind).toBe("text");
    expect(deriveFace(note({ body: "Packing\n[ ] milk\n[ ] eggs" })).kind).toBe("text");
  });

  it("does not read a box as a title, nor a sentence set off by a blank line", () => {
    expect(deriveFace(note({ body: "[ ] pack:\n[ ] milk" })).title).toBeNull();
    expect(deriveFace(note({ body: "It is all done.\n\n[ ] milk\n[ ] eggs" })).kind).toBe("text");
  });
});

describe("code on a card (design review 2026-10-23)", () => {
  const html = [
    "Nav fix",
    "```html",
    '<nav class="site-nav">',
    '  <a href="/" class="logo">Home</a>',
    "  <ul>",
    '    <li><a href="/shop?category=ceramics&sort=new" class="menu-link is-active">Ceramics</a></li>',
    "  </ul>",
    "</nav>",
    "```",
    "check it on the phone",
  ].join("\n");

  it("keeps a code line's indentation, and tidies the words around it", () => {
    const face = deriveFace(note({ body: html.replace("Nav fix", "Nav   fix  ") }));
    expect(face.body.split("\n")).toContain("    <li><a href=\"/shop?category=ceramics&sort=new\" class=\"menu-link is-active\">Ceramics</a></li>");
    expect(face.body.startsWith("Nav fix\n")).toBe(true);
  });

  it("charges a long code line one card line, and a fence none", () => {
    // Eight lines at 20 characters: the long <li> would cost five lines as words.
    const face = deriveFace(note({ body: html }), { lines: 8, charsPerLine: 20 });
    expect(face.body).toContain("check it on the phone");
  });

  it("reads a block the cut left open as code, fence and all", () => {
    const cut = html.split("\n").slice(0, 5).join("\n");
    const lines = cardLines(cut);
    expect(lines[1].code).toBe("fence");
    expect(lines.slice(2).every((line) => line.code === "body")).toBe(true);
  });
});
