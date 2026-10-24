import { describe, expect, it, vi } from "vitest";
import type { Note, UserBoard } from "../types";
import { buildBoards, INBOX_ALL, isTodoNote, linksOnly, notesForBoard } from "../lib/boards";
import { isBoardColor, markSet } from "../lib/boardLook";
import { hasCode, hasOpenBox } from "../lib/blocks";
import { isCanvasIdea } from "../lib/canvas";
import { mergedPreviews } from "../lib/links";
import { buildSampleSet, loadSampleNotes, recipePdf, type SampleStore } from "./sampleNotes";

/**
 * The public demo's sample notes (`sampleNotes.ts`): what the set contains, and
 * that it goes into the store the way an import does — one write, one undo.
 *
 * The counts below are the set's promises to whoever lands on the demo and to
 * the README's screenshots: a pile worth tidying, lists for the Ticker, dressed
 * boards, links, a canvas, an important note, a repeating reminder, pictures,
 * a PDF, a code snippet, and something in Archive and in the Trash.
 */

const NOW = new Date("2026-09-27T12:00:00.000Z");

function shelf(set: ReturnType<typeof buildSampleSet>) {
  return buildBoards(set.boards, INBOX_ALL);
}

describe("the sample set", () => {
  const set = buildSampleSet(NOW);
  const boards = shelf(set);
  const on = (kind: string) => notesForBoard(set.notes, boards.find((b) => b.kind === kind)!);

  it("gives every board it makes a real mark, and a tint to Kitchen alone", () => {
    expect(set.boards.length).toBeGreaterThanOrEqual(4);
    // And no more than a phone's Tidy up draws as buttons on the Inbox's pile
    // (review UX-A-04).
    expect(set.boards.length).toBeLessThanOrEqual(4); // `DIRECT_PHONE` in Sorter.tsx
    // From the set the Look sheet offers, so Kitchen's cake is not drawn twice
    // there, once from each set (review UIB-03).
    for (const board of set.boards) expect(markSet(board.icon)).toBe("lucide");
    // The tint is the exception to a greyscale app, so the demo shows it as
    // one: a single board coloured, the rest plain (review UI-06).
    const tinted = set.boards.filter((b) => isBoardColor(b.color));
    expect(tinted.map((b) => b.name)).toEqual(["Kitchen"]);
    for (const board of set.boards) if (board.name !== "Kitchen") expect(board.color).toBeUndefined();
    // And every board holds something.
    for (const board of set.boards) {
      expect(set.notes.some((n) => n.board_id === board.id && n.status === "active")).toBe(true);
    }
  });

  it("leaves a pile worth tidying in the Inbox", () => {
    const inbox = on("inbox");
    expect(inbox.length).toBeGreaterThanOrEqual(15);
    expect(inbox.length).toBeLessThanOrEqual(30);
  });

  it("reads like somebody's notes, not a tutorial (owner, 2026-10-23)", () => {
    // What the person wrote: a merged idea carries the app's own divider.
    const said = set.notes.filter((n) => !n.merged_from).map((n) => n.body).join("\n");
    expect(said).not.toMatch(/Start here|Welcome|spår/i);
    // No polished prose: not one em dash in anything the person wrote.
    expect(said).not.toContain("—");
    // One short snippet of code, in the Inbox.
    expect(on("inbox").filter((n) => hasCode(n.body))).toHaveLength(1);
  });

  it("gives the Ticker more than one list with boxes still open, some already ticked", () => {
    const lists = on("todos").filter((n) => isTodoNote(n) && hasOpenBox(n.body));
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(lists.some((n) => n.body.includes("[x]"))).toBe(true);
  });

  it("keeps bare addresses on Links, each with a preview that needs no network", () => {
    const bare = set.notes.filter((n) => linksOnly(n, new Set(set.boards.map((b) => b.id))));
    expect(bare.length).toBeGreaterThanOrEqual(2);
    for (const note of set.notes.filter((n) => n.link_previews)) {
      const previews = mergedPreviews(note.body, note.link_previews);
      expect(previews.length).toBeGreaterThan(0);
      // The stored preview names the same address the text does, so it is the
      // one drawn — and it is complete: asked, answered, no picture to fetch.
      for (const preview of previews) {
        expect(preview.fetched_at).not.toBeNull();
        expect(preview.image).toBeNull();
        expect(preview.title).not.toBe(preview.domain);
      }
    }
  });

  it("holds two merges, one of them a canvas, with their sources archived into them", () => {
    const ideas = set.notes.filter((n) => n.merged_from && n.merged_from.length > 0);
    expect(ideas).toHaveLength(2);
    for (const idea of ideas) {
      expect(isCanvasIdea(idea)).toBe(true);
      expect(idea.body.startsWith("# ")).toBe(true);
      for (const id of idea.merged_from!) {
        const source = set.notes.find((n) => n.id === id)!;
        expect(source.status).toBe("archived");
        expect(source.merged_into).toBe(idea.id);
        // The idea's text is the sources' words, nothing invented between them.
        expect(idea.body).toContain(source.body);
      }
    }
  });

  it("puts something else in Archive and one note in the Trash", () => {
    expect(on("archive").some((n) => !n.merged_into)).toBe(true);
    const trashed = set.notes.filter((n) => n.status === "trashed");
    expect(trashed).toHaveLength(1);
    // Recent enough that the sweep leaves it for a visitor to find.
    expect(NOW.getTime() - Date.parse(trashed[0].updated_at)).toBeLessThan(86_400_000);
  });

  it("marks a note important and gives one a reminder that repeats", () => {
    expect(set.notes.some((n) => n.priority > 0 && n.status === "active")).toBe(true);
    const repeating = set.notes.filter((n) => n.reminder_repeat);
    expect(repeating).toHaveLength(1);
    expect(Date.parse(repeating[0].reminder_at!)).toBeGreaterThan(NOW.getTime());
  });

  it("stamps every note in the past, with a clock for every field it carries", () => {
    for (const note of set.notes) {
      expect(Date.parse(note.created_at)).toBeLessThanOrEqual(NOW.getTime());
      expect(note.raw_content.length).toBeGreaterThan(0);
      expect(note.field_updated_at?.body).toBeDefined();
    }
    expect(new Set(set.notes.map((n) => n.id)).size).toBe(set.notes.length);
  });

  it("carries real files on active notes: pictures and a PDF", () => {
    const kinds = [...set.files.values()];
    expect(kinds.filter((k) => k !== "pulla-pdf").length).toBeGreaterThanOrEqual(5);
    expect(kinds).toContain("pulla-pdf");
    for (const id of set.files.keys()) expect(set.notes.find((n) => n.id === id)?.status).toBe("active");
  });

  it("writes a PDF whose cross-reference table points at every object", () => {
    const pdf = new TextDecoder().decode(recipePdf());
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => expect(pdf.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
    const xref = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xref).startsWith("xref")).toBe(true);
  });

  it("files the pictures on Inspiration when there is one", () => {
    const filed = buildSampleSet(NOW, 0, "insp-1");
    const onWall = filed.notes.filter((n) => n.board_id === "insp-1");
    expect(onWall.length).toBeGreaterThanOrEqual(4);
    for (const n of onWall) expect(filed.files.has(n.id)).toBe(true);
  });
});

describe("loading it", () => {
  function fakeStore() {
    let notes: Note[] = [];
    let shelfNow: UserBoard[] = [{ id: "mine", name: "Mine", position: 0 }];
    const undo: { message: string; run: () => void }[] = [];
    const store: SampleStore = {
      importNotes: vi.fn(async (chunk) => {
        const made = chunk.map(({ note, files }) =>
          files.length > 0 ? { ...note, attachments: files.map((f) => ({ id: f.name }) as never) } : note,
        );
        notes = [...made, ...notes];
        return made;
      }),
      notes: () => notes,
      bulkUpdate: (ids, patch) => {
        notes = notes.map((n) => (ids.includes(n.id) ? { ...n, ...patch } : n));
      },
      editBoards: (change) => {
        shelfNow = change(shelfNow);
      },
      pushUndo: (entry) => undo.push(entry),
      inspirationId: () => "insp-1",
    };
    return { store, undo, notes: () => notes, shelf: () => shelfNow };
  }

  it("writes the whole set in one import, after the boards already there, with its files", async () => {
    const fake = fakeStore();
    const picture = new File([new Uint8Array([1, 2, 3])], "x.jpg", { type: "image/jpeg" });
    const made = await loadSampleNotes(fake.store, { now: NOW, file: async () => picture });

    expect(fake.store.importNotes).toHaveBeenCalledTimes(1);
    expect(made).toBe(fake.notes().length);
    expect(fake.shelf()[0].id).toBe("mine");
    expect(fake.shelf().slice(1).map((b) => b.position)).toEqual([1, 2, 3, 4]);
    expect(fake.notes().filter((n) => n.attachments.length > 0)).toHaveLength(6);
    expect(fake.notes().filter((n) => n.board_id === "insp-1").length).toBeGreaterThanOrEqual(4);
  });

  it("leaves a note out rather than keep words about a missing file", async () => {
    const fake = fakeStore();
    await loadSampleNotes(fake.store, { now: NOW, file: async () => null });
    expect(fake.notes().some((n) => n.body.includes("tomatoes!!"))).toBe(false);
    expect(fake.notes().length).toBeGreaterThan(30);
  });

  it("offers the whole set back as one undo, which trashes it and takes its boards off", async () => {
    const fake = fakeStore();
    const made = await loadSampleNotes(fake.store, { now: NOW, file: async () => null });

    expect(fake.undo).toHaveLength(1);
    expect(fake.undo[0].message).toBe(`Added ${made} sample notes`);
    fake.undo[0].run();
    expect(fake.notes().every((n) => n.status === "trashed")).toBe(true);
    expect(fake.shelf().map((b) => b.id)).toEqual(["mine"]);
  });
});
