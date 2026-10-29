// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Canvas, CanvasItem, Note } from "../types";
import type { Undo } from "../store/useUndo";
import { note } from "../test/fixtures";
import { useIdeaVerbs } from "./useIdeaVerbs";

/**
 * A reminder through an idea, by the hook itself (review 2026-10-13, EH-03):
 * a note joining an idea hands it its reminder, and a note leaving takes it
 * back, so one reminder never rings from two notes at once.
 */

const SOON = "2099-01-05T09:00:00.000Z";

function setup(notes: Note[]) {
  const ref = { current: notes };
  const canvases = new Map<string, CanvasItem[]>();
  const undos: Omit<Undo, "key">[] = [];
  const update = (id: string, patch: Partial<Note>) => {
    ref.current = ref.current.map((n) => (n.id === id ? { ...n, ...patch } : n));
  };
  const { result } = renderHook(() =>
    useIdeaVerbs({
      notesRef: ref,
      update,
      create: () => null,
      merge: () => {
        throw new Error("not used");
      },
      ensureForIdea: (idea): Canvas => ({
        id: idea.id,
        idea_id: idea.id,
        items: canvases.get(idea.id) ?? [],
        strokes: [],
        image_widths: {},
        text_elements: [],
        created_at: idea.created_at,
        updated_at: idea.updated_at,
      }),
      itemAt: (canvasId, noteId) => canvases.get(canvasId)?.find((i) => i.note_id === noteId) ?? null,
      removeItem: (canvasId, noteId) =>
        canvases.set(canvasId, (canvases.get(canvasId) ?? []).filter((i) => i.note_id !== noteId)),
      restoreItem: (canvasId, item) => canvases.set(canvasId, [...(canvases.get(canvasId) ?? []), item]),
      pushUndo: (entry) => undos.push(entry),
      leaveMark: { current: null },
      canvasId: null,
      setCanvasId: () => {},
      setTraceId: () => {},
      setSelected: () => {},
      setOpenId: () => {},
      setClosing: () => {},
      here: null,
    }),
  );
  const get = (id: string) => ref.current.find((n) => n.id === id)!;
  return { result, get, undos };
}

const idea = () =>
  note({ id: "idea", source: "merge", body: "# Errands\n\nA", merged_from: ["a"] });
const a = () => note({ id: "a", status: "archived", merged_into: "idea" });
const parcel = () => note({ id: "parcel", body: "Parcel", reminder_at: SOON });

describe("a reminder through an idea's verbs", () => {
  it("goes to the idea with its note, and comes off again on undo", () => {
    const { result, get, undos } = setup([idea(), a(), parcel()]);

    act(() => result.current.mergeNotes([get("idea"), get("parcel")]));
    expect(get("idea").reminder_at).toBe(SOON);
    expect(get("parcel").status).toBe("archived");

    act(() => undos.at(-1)!.run!());
    expect(get("idea").reminder_at).toBeNull();
    expect(get("parcel").status).toBe("active");
  });

  it("goes back with its note when the note is taken out, so only one holds it", () => {
    const { result, get, undos } = setup([idea(), a(), parcel()]);
    act(() => result.current.mergeNotes([get("idea"), get("parcel")]));

    act(() => result.current.releaseNote("idea", "parcel"));
    expect(get("parcel")).toMatchObject({ status: "active", reminder_at: SOON });
    expect(get("idea").reminder_at).toBeNull();
    expect(get("idea").reminder_repeat).toBeNull();

    // Undo puts it back on the idea, exactly as it was.
    act(() => undos.at(-1)!.run!());
    expect(get("parcel").status).toBe("archived");
    expect(get("idea").reminder_at).toBe(SOON);
  });

  it("leaves an idea's own reminder when a note without that reminder leaves", () => {
    const own = { ...idea(), reminder_at: SOON };
    const b = note({ id: "b", status: "archived", merged_into: "idea", reminder_at: "2099-02-01T09:00:00.000Z" });
    const { result, get } = setup([{ ...own, merged_from: ["a", "b"] }, a(), b]);

    act(() => result.current.releaseNote("idea", "b"));
    expect(get("idea").reminder_at).toBe(SOON);
  });
});

/**
 * The sweep remembers what it rang by note id, so an occurrence the idea rang
 * would ring again from the note it goes back to. A note leaving or woken from
 * an idea therefore does not get back an occurrence that has just rung.
 */
describe("a reminder that rang from the idea", () => {
  const RANG = "2099-01-05T09:00:00.000Z";
  const DAILY_NEXT = "2099-01-06T09:00:00.000Z";
  const LATER = "2099-01-07T09:00:00.000Z";
  const ideaHolding = (at: string, repeat: Note["reminder_repeat"] = null) =>
    note({
      id: "idea",
      source: "merge",
      body: "# Errands",
      merged_from: ["a", "parcel"],
      reminder_at: at,
      reminder_repeat: repeat,
    });
  const inside = (at: string, repeat: Note["reminder_repeat"] = null) =>
    note({ id: "parcel", status: "archived", merged_into: "idea", reminder_at: at, reminder_repeat: repeat });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-01-05T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not rung again by a note taken out, and comes back whole on undo", () => {
    const { result, get, undos } = setup([ideaHolding(RANG), a(), inside(RANG)]);

    act(() => result.current.releaseNote("idea", "parcel"));
    expect(get("parcel")).toMatchObject({ status: "active", reminder_at: null, reminder_repeat: null });
    expect(get("idea").reminder_at).toBeNull();

    act(() => undos.at(-1)!.run!());
    expect(get("parcel")).toMatchObject({ status: "archived", reminder_at: RANG, reminder_repeat: null });
    expect(get("idea").reminder_at).toBe(RANG);
  });

  it("moves a series on to its next time on a note taken out", () => {
    const { result, get, undos } = setup([ideaHolding(RANG, "daily"), a(), inside(RANG, "daily")]);

    act(() => result.current.releaseNote("idea", "parcel"));
    expect(get("parcel")).toMatchObject({ reminder_at: DAILY_NEXT, reminder_repeat: "daily" });

    act(() => undos.at(-1)!.run!());
    expect(get("parcel")).toMatchObject({ reminder_at: RANG, reminder_repeat: "daily" });
  });

  it("is not rung again by notes a dissolve wakes, nor by the idea out of the trash", () => {
    const { result, get, undos } = setup([ideaHolding(RANG), a(), inside(RANG)]);

    act(() => result.current.dissolveIdea("idea"));
    expect(get("parcel")).toMatchObject({ status: "active", reminder_at: null });
    expect(get("idea")).toMatchObject({ status: "trashed", reminder_at: null, reminder_repeat: null });

    act(() => undos.at(-1)!.run!());
    expect(get("parcel")).toMatchObject({ status: "archived", reminder_at: RANG });
    expect(get("idea")).toMatchObject({ status: "active", reminder_at: RANG });
  });

  it("is not rung again by notes an un-merge wakes, nor by the idea out of the archive", () => {
    const { result, get, undos } = setup([ideaHolding(RANG, "daily"), a(), inside(RANG, "daily")]);

    act(() => result.current.unmergeIdea("idea"));
    expect(get("parcel")).toMatchObject({ status: "active", reminder_at: DAILY_NEXT, reminder_repeat: "daily" });
    expect(get("idea")).toMatchObject({ status: "archived", reminder_at: null, reminder_repeat: null });

    act(() => undos.at(-1)!.run!());
    expect(get("parcel")).toMatchObject({ status: "archived", reminder_at: RANG, reminder_repeat: "daily" });
    expect(get("idea")).toMatchObject({ status: "active", reminder_at: RANG, reminder_repeat: "daily" });
  });

  it("is left alone on a note whose reminder is still to come", () => {
    const { result, get } = setup([ideaHolding(LATER), a(), inside(LATER)]);

    act(() => result.current.releaseNote("idea", "parcel"));
    expect(get("parcel").reminder_at).toBe(LATER);
  });
});

/**
 * An undo stays on the stack past its eight-second offer, so a later Ctrl+Z
 * may meet notes that have moved on. Each verb's undo now puts back only what
 * is still as the verb left it (bughunt 2026-10-24).
 */
describe("an idea verb undone after the notes moved on", () => {
  it("keeps words typed into the idea after notes were added to it", () => {
    const { result, get, undos } = setup([idea(), a(), parcel()]);
    act(() => result.current.mergeNotes([get("idea"), get("parcel")]));
    const typed = get("idea").body + "\n\nWritten afterwards";
    act(() => {
      // The user typing into the idea after the merge.
      (get("idea") as Note).body = typed;
    });
    act(() => undos.at(-1)!.run!());
    expect(get("idea").body).toBe(typed);
    expect(get("idea").merged_from).toEqual(["a"]);
    expect(get("parcel").status).toBe("active");
  });

  it("does not pull a released note back out of the trash", () => {
    const { result, get, undos } = setup([{ ...idea(), merged_from: ["a", "b"] }, a(), note({ id: "b", status: "archived", merged_into: "idea" })]);
    act(() => result.current.releaseNote("idea", "b"));
    act(() => {
      (get("b") as Note).status = "trashed";
    });
    act(() => undos.at(-1)!.run!());
    expect(get("b").status).toBe("trashed");
    expect(get("idea").merged_from).toEqual(["a"]);
  });

  it("leaves a source trashed since a dissolve in the trash, and brings the rest back", () => {
    const b = note({ id: "b", status: "archived", merged_into: "idea" });
    const { result, get, undos } = setup([{ ...idea(), merged_from: ["a", "b"] }, a(), b]);
    act(() => result.current.dissolveIdea("idea"));
    act(() => {
      (get("b") as Note).status = "trashed";
    });
    act(() => undos.at(-1)!.run!());
    expect(get("b").status).toBe("trashed");
    expect(get("a")).toMatchObject({ status: "archived", merged_into: "idea" });
    expect(get("idea")).toMatchObject({ status: "active", merged_from: ["a"] });
  });
});

describe("adding notes to an idea, undone after one moved on", () => {
  it("does not put a trashed note back into the idea it left", () => {
    const other = note({ id: "other", source: "merge", body: "# Other\n\nX", merged_from: ["n", "x"] });
    const n = note({ id: "n", status: "archived", merged_into: "other" });
    const x = note({ id: "x", status: "archived", merged_into: "other" });
    const m = note({ id: "m", body: "Plain" });
    const { result, get, undos } = setup([idea(), a(), other, n, x, m]);
    act(() => result.current.mergeNotes([get("idea"), get("n"), get("m")]));
    expect(get("other").merged_from).toEqual(["x"]);
    act(() => {
      (get("n") as Note).status = "trashed";
    });
    act(() => undos.at(-1)!.run!());
    expect(get("other").merged_from).toEqual(["x"]);
  });
});
