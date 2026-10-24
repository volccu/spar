import { describe, expect, it } from "vitest";
import {
  appendToIdeaBody,
  buildMerge,
  carriedPreviews,
  composeMergedBody,
  isUnmergeable,
  reminderJoiningIdea,
  sectionFor,
  unmergeSources,
} from "./merge";
import type { Note } from "../types";
import { note as base } from "../test/fixtures";
import { isTodoNote } from "./boards";

const note = (partial: Partial<Note>): Note =>
  base({
    id: crypto.randomUUID(),
    raw_content: "",
    body: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  });


describe("sectionFor", () => {
  it("keeps the note's words exactly, adding no heading", () => {
    const section = sectionFor(note({ body: "Pasta home\n\nsemolina 200g" }));
    expect(section).toBe("Pasta home\n\nsemolina 200g");
    expect(section).not.toMatch(/#/);
  });

  it("tidies stray whitespace and blank-line runs", () => {
    expect(sectionFor(note({ body: "  a  \n\n\n\nb\n\n" }))).toBe("a\n\nb");
  });
});

describe("composeMergedBody", () => {
  it("joins sources with a rule and collapses blank-line runs", () => {
    const body = composeMergedBody([
      note({ body: "Kebab\n\n\n\nsauce recipe" }),
      note({ body: "Kebab extra\n\nyoghurt" }),
    ]);
    expect(body).toBe(
      "Kebab\n\nsauce recipe\n\n———\n\nKebab extra\n\nyoghurt",
    );
    expect(body).not.toMatch(/\n{3,}/);
  });

  it("leaves no dangling rule when a source is empty", () => {
    const body = composeMergedBody([note({ body: "only this" }), note({ body: "   " })]);
    expect(body).toBe("only this");
  });
});

describe("buildMerge", () => {
  it("refuses fewer than two notes", () => {
    expect(() => buildMerge([note({})])).toThrow(/at least two/);
  });

  it("takes the highest priority, records provenance, and lands unfiled", () => {
    const a = note({ body: "A", priority: 0, board_id: "work" });
    const b = note({ body: "B", priority: 1, board_id: "recipes" });
    const { merged, archivedSourceIds } = buildMerge([a, b]);

    expect(merged.priority).toBe(1);
    expect(merged.board_id).toBeNull();
    expect(merged.merged_from).toEqual([a.id, b.id]);
    expect(archivedSourceIds).toEqual([a.id, b.id]);
    expect(merged.source).toBe("merge");
  });

  it("keeps the earliest creation date so the merge doesn't jump the feed", () => {
    const old = note({ body: "old", created_at: "2024-03-02T00:00:00Z" });
    const recent = note({ body: "new", created_at: "2026-05-05T00:00:00Z" });
    expect(buildMerge([recent, old]).merged.created_at).toBe("2024-03-02T00:00:00Z");
  });

  it("preserves selection order in the composed text", () => {
    const one = note({ body: "First" });
    const two = note({ body: "Second" });
    expect(buildMerge([two, one]).merged.body).toBe("Second\n\n———\n\nFirst");
  });

  it("starts the merged note's immutable original as the composition itself", () => {
    const { merged } = buildMerge([note({ body: "A" }), note({ body: "B" })]);
    expect(merged.raw_content).toBe(merged.body);
  });

  // Review 2026-10-13, UX-07: two shopping lists merged to tick one.
  it("files the idea in the board every source shares, and nowhere when they differ", () => {
    const a = note({ body: "A", board_id: "trip" });
    const b = note({ body: "B", board_id: "trip" });
    expect(buildMerge([a, b]).merged.board_id).toBe("trip");
    expect(buildMerge([a, note({ body: "C" })]).merged.board_id).toBeNull();
  });

  it("keeps a merge of to-do lists on Todos, and nothing else", () => {
    const milk = note({ body: "[ ] milk\n[ ] eggs" });
    const pack = note({ body: "pack", note_type: "todo" });
    const merged = buildMerge([milk, pack]).merged;
    expect(merged.note_type).toBe("todo");
    expect(isTodoNote(merged)).toBe(true);
    expect(buildMerge([milk, note({ body: "just words" })]).merged.note_type).toBeNull();
  });
});

/**
 * A reminder through a merge (review 2026-10-13, EH-03): handed to the idea,
 * never rung twice for one occurrence, never lost.
 */
describe("reminders through a merge", () => {
  const NOW = new Date("2026-08-10T12:00:00Z");
  const soon = "2026-08-10T15:00:00.000Z";
  const rang = "2026-08-10T11:55:00.000Z";

  it("hands the first reminder still to come to a composed idea, both halves", () => {
    const a = note({ body: "A", reminder_at: rang });
    const b = note({ body: "B", reminder_at: soon, reminder_repeat: "weekly" });
    const c = note({ body: "C", reminder_at: "2026-08-11T09:00:00.000Z" });
    const { merged } = buildMerge([a, b, c], NOW);
    expect(merged.reminder_at).toBe(soon);
    expect(merged.reminder_repeat).toBe("weekly");
  });

  it("gives a composed idea no reminder that has just rung", () => {
    const { merged } = buildMerge([note({ body: "A", reminder_at: rang }), note({ body: "B" })], NOW);
    expect(merged.reminder_at).toBeNull();
    expect(merged.reminder_repeat).toBeNull();
  });

  it("lets an idea take the reminder of a note joining it", () => {
    const idea = note({ body: "# Errands", source: "merge", merged_from: ["x"] });
    const parcel = note({ body: "Parcel", reminder_at: soon });
    expect(reminderJoiningIdea(idea, [note({ body: "B" }), parcel], NOW.getTime())).toEqual({
      reminder_at: soon,
      reminder_repeat: null,
    });
  });

  it("leaves an idea's own reminder, and gives it none that has just rung", () => {
    const own = note({ body: "# Errands", source: "merge", merged_from: ["x"], reminder_at: soon });
    const parcel = note({ body: "Parcel", reminder_at: "2026-08-12T09:00:00.000Z" });
    expect(reminderJoiningIdea(own, [parcel], NOW.getTime())).toBeNull();
    const bare = { ...own, reminder_at: null };
    expect(reminderJoiningIdea(bare, [note({ body: "A", reminder_at: rang })], NOW.getTime())).toBeNull();
  });
});

describe("appendToIdeaBody", () => {
  it("keeps the idea's own name on line 0 and appends after it", () => {
    const body = appendToIdeaBody("# Dinner plans\n\nsome notes", [
      note({ body: "bring wine" }),
    ]);
    expect(body.split("\n")[0]).toBe("# Dinner plans");
    expect(body).toBe("# Dinner plans\n\nsome notes\n\n———\n\nbring wine");
  });

  it("separates each incoming note with the same rule and adds no heading", () => {
    const body = appendToIdeaBody("Idea body", [
      note({ body: "first addition" }),
      note({ body: "second addition" }),
    ]);
    expect(body).toBe("Idea body\n\n———\n\nfirst addition\n\n———\n\nsecond addition");
    expect(body).not.toMatch(/^#/m);
  });

  it("collapses blank-line runs on both sides", () => {
    const body = appendToIdeaBody("Idea\n\n\n\nbody", [note({ body: "  more  \n\n\n\nhere" })]);
    expect(body).toBe("Idea\n\nbody\n\n———\n\nmore\n\nhere");
  });

  it("drops an empty incoming note without leaving a dangling rule", () => {
    expect(appendToIdeaBody("Idea body", [note({ body: "   " })])).toBe("Idea body");
  });

  it("returns the idea's own text tidied when there is nothing to add", () => {
    expect(appendToIdeaBody("  Idea body  ", [])).toBe("Idea body");
  });
});

describe("un-merge", () => {
  it("is offered on a composed idea, and on nothing else", () => {
    expect(isUnmergeable(note({ source: "merge", merged_from: ["a", "b"] }))).toBe(true);
    // Dissolved or emptied: nothing left to put back.
    expect(isUnmergeable(note({ source: "merge", merged_from: [] }))).toBe(false);
    // A sketch that absorbed a note is still somebody's drawing, not a merge.
    expect(isUnmergeable(note({ source: "draw", merged_from: ["a"] }))).toBe(false);
    expect(isUnmergeable(note({ source: "web" }))).toBe(false);
  });

  /**
   * Only what the merge left exactly as it left it comes back. Anything named
   * in `merged_from` that has since been moved on — taken out by hand, put in
   * the trash, restored on the other device, absorbed into another idea — was
   * a later decision, and an un-merge must not overwrite it with an earlier one.
   */
  it("puts back only the sources still archived into this idea", () => {
    const idea = note({ id: "idea", source: "merge", merged_from: ["a", "b", "c", "d", "e"] });
    const notes = [
      idea,
      note({ id: "a", status: "archived", merged_into: "idea", board_id: "folder" }),
      note({ id: "b", status: "trashed", merged_into: "idea" }),
      note({ id: "c", status: "active", merged_into: null }),
      note({ id: "d", status: "archived", merged_into: "other-idea" }),
      // "e" is gone from this device altogether.
    ];
    expect(unmergeSources(idea, notes).map((n) => n.id)).toEqual(["a"]);
  });
});

describe("hidden link previews through a merge", () => {
  const entry = (href: string, hidden?: boolean) => ({
    href,
    domain: "example.com",
    title: "T",
    description: null,
    image: null,
    fetched_at: "2026-09-01T00:00:00.000Z",
    ...(hidden ? { hidden } : {}),
  });

  it("carries the hidden entries of every source into the new note, once each", () => {
    const a = note({
      body: "https://example.com/a",
      link_previews: [entry("https://example.com/a", true), entry("https://example.com/x")],
    });
    const b = note({
      body: "https://example.com/a https://example.com/b",
      link_previews: [entry("https://example.com/a", true), entry("https://example.com/b", true)],
    });
    const { merged } = buildMerge([a, b]);
    expect(merged.link_previews?.map((p) => p.href)).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(merged.link_previews?.every((p) => p.hidden === true)).toBe(true);
    // The clock is stamped with the entries, so the other device takes them.
    expect(merged.field_updated_at?.link_previews).toBeTruthy();
  });

  it("writes no list at all when nothing was hidden", () => {
    const a = note({ link_previews: [entry("https://example.com/a")] });
    const { merged } = buildMerge([a, note({})]);
    expect(merged.link_previews).toBeUndefined();
    expect(merged.field_updated_at?.link_previews).toBeUndefined();
  });

  it("adds a note's hidden entries to the idea it is absorbed into, keeping the idea's own", () => {
    const own = entry("https://example.com/own");
    const hidden = entry("https://example.com/h", true);
    const next = carriedPreviews([own], [note({ link_previews: [hidden, entry("https://example.com/shown")] })]);
    expect(next).toEqual([own, hidden]);
    expect(carriedPreviews([own], [note({})])).toBeNull();
  });
});
