// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Note, UserBoard } from "../types";
import { takeoutZip, CARRIED, FIXTURE_NOTES, TAKEOUT_DIR } from "../test/takeout";
import { buildBoards, filePatch, matchesBoard, notesForBoard } from "../lib/boards";
import {
  boardsToMake,
  chooseAll,
  makeBoards,
  offerImportUndo,
  planImport,
  resolveChoices,
  runImport,
  scanKeep,
  trashImport,
  type ImportStore,
} from "../lib/keepImport";
import { openSource } from "../lib/keepSource";
import { allNotes, dirtyEntries, getFile } from "./db";
import { useNotes } from "./useNotes";

// Unmounted after every case, so no store is left running its write and retry
// timers once the file ends: Testing Library cleans up by itself only where
// the runner's globals are on, and here they are not. A timer firing after
// jsdom was torn down sent React's scheduler looking for `window`.
afterEach(() => cleanup());

/**
 * The Keep import end to end, at the store: a synthetic Takeout zip in, the
 * real `useNotes` and IndexedDB underneath, and the boards the app would draw
 * read straight off the result — then Tidy up working through the pile, a
 * second import skipping everything, and the one undo.
 *
 * This is the phase's "done when": checklists, pictures, links, archived
 * notes and multi-label notes come in right, and the Sorter can work through
 * what came in.
 */

const KEEP = join(__dirname, "..", "..", "..", TAKEOUT_DIR);
const NOTES = Object.fromEntries(readdirSync(KEEP).map((name) => [name, readFileSync(join(KEEP, name), "utf8")]));

async function ready() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
  return hook.result;
}

function keepNotes(notes: Note[]): Note[] {
  return notes.filter((n) => n.source === "keep");
}

describe("importing a Google Takeout into the store", () => {
  it("brings the archive in, files it by label, and Tidy up can work through the rest", async () => {
    const result = await ready();
    const start = result.current.notes.length;

    // The screen's first two steps: open what was picked, read every note.
    const zip = await takeoutZip(NOTES);
    const files = await openSource([
      { file: new File([zip], "takeout-20260927T000000Z-001.zip", { type: "application/zip" }), path: "takeout.zip" },
    ]);
    const scan = await scanKeep(files);
    const plan = planImport(scan, result.current.notes);
    expect(plan.fresh).toHaveLength(FIXTURE_NOTES);

    // The labels screen, answered: the one switch set to a board for every
    // label, then Someday sent back to the Inbox.
    let shelf: UserBoard[] = [];
    const undos: { message: string; run: () => void }[] = [];
    const store: ImportStore = {
      notes: () => result.current.notes,
      bulkUpdate: (ids, patch) => act(() => result.current.bulkUpdate(ids, patch)),
      editBoards: (change) => {
        shelf = change(shelf);
      },
      pushUndo: (entry) => undos.push(entry),
    };
    const choices = { ...chooseAll(plan.labels, shelf, "new"), Someday: { to: "inbox" as const } };
    const madeBoards = makeBoards(boardsToMake(choices), store);
    expect(madeBoards.map((b) => b.name)).toEqual(["Kitchen", "Errands", "House"]);
    const target = resolveChoices(choices, shelf);

    // The last step: written a chunk at a time through the store.
    const imported = await act(() => runImport(plan, target, result.current.importNotes));
    expect(imported.imported).toBe(FIXTURE_NOTES);
    offerImportUndo({ made: imported.made, boards: madeBoards }, store);
    expect(undos).toHaveLength(1);

    const notes = result.current.notes;
    expect(notes).toHaveLength(start + FIXTURE_NOTES);
    const byKeep = (id: string) => keepNotes(notes).find((n) => n.keep_id === id)!;
    const board = (name: string) => shelf.find((b) => b.name === name)!.id;

    // On the device, and in the outbox for the ordinary sync to take up.
    const stored = keepNotes(await allNotes());
    expect(stored).toHaveLength(FIXTURE_NOTES);
    const queued = new Set((await dirtyEntries()).map((entry) => entry.id));
    expect(stored.every((n) => queued.has(n.id))).toBe(true);

    // A checklist, named, pinned, filed under Kitchen — and on Todos.
    const pantry = byKeep("Pantry list");
    expect(pantry.raw_content).toBe("# Pantry list\n\n[ ] flour\n[x] rolled oats\n[ ] tinned tomatoes");
    expect(pantry.board_id).toBe(board("Kitchen"));
    expect(pantry.priority).toBe(1);

    // A note with three labels: the first that became a board wins, the rest
    // stay on its last line; its saved link is a link.
    const kettles = byKeep("2023-05-06T07_08_09.000-00_00");
    expect(kettles.board_id).toBe(board("Errands"));
    expect(kettles.body.endsWith("\n\nKeep labels: Kitchen, Someday")).toBe(true);
    expect(kettles.body).toContain("https://example.com/kettles");

    // Pictures, a drawing and a recording, carried as real files with their bytes here.
    const porch = byKeep("Porch paint");
    expect(porch.board_id).toBe(board("House"));
    expect(porch.attachments.map((a) => [a.name, a.mime])).toEqual([["swatch.jpg", "image/jpeg"]]);
    // The bytes are on the device under the attachment's id — the store the
    // upload reads from. (The test store's clone of a blob keeps its size and
    // not its methods, so the size is what is compared.)
    const bytes = await getFile(porch.attachments[0].id);
    expect(bytes).toBeDefined();
    expect(porch.attachments[0].size).toBe(new TextEncoder().encode(CARRIED["swatch.jpg"]).length);
    expect(byKeep("Doodle").attachments.map((a) => a.name)).toEqual(["doodle.png"]);
    expect(byKeep("Voice memo").attachments.map((a) => a.mime)).toEqual(["audio/3gpp"]);
    // The photograph the Takeout did not have: the note came, the file is named.
    expect(byKeep("Ferry photo").attachments).toEqual([]);
    expect(imported.leftBehind.map((f) => f.name)).toEqual(["ferry.jpg"]);

    // The shelf as the app would draw it.
    const boards = buildBoards(shelf, null);
    const on = (kind: string, name?: string) =>
      keepNotes(
        notesForBoard(
          notes,
          boards.find((b) => b.kind === kind && (!name || b.name === name))!,
        ),
      ).map((n) => n.keep_id);
    expect(on("archive")).toEqual(["Old recipe card"]);
    expect(on("folder", "Kitchen")).toEqual(["Pantry list"]);
    expect(on("todos")).toEqual(["Pantry list"]);
    expect(on("links")).toEqual(["2023-05-06T07_08_09.000-00_00"]);
    expect(on("files").sort()).toEqual(["Doodle", "Porch paint", "Voice memo"]);
    // Newest edit first, as every board is ordered — Keep's own dates.
    expect(on("inbox")).toEqual(["Ferry photo", "Voice memo", "Doodle"]);

    // Tidy up: the Inbox's pile, one note at a time, filed with one tap —
    // the same `board_id` write the Sorter makes.
    const inbox = boards[0];
    const pile = keepNotes(notesForBoard(result.current.notes, inbox));
    for (const note of pile) {
      act(() => result.current.update(note.id, filePatch(note, board("House"))));
    }
    expect(keepNotes(notesForBoard(result.current.notes, inbox))).toEqual([]);
    const house = boards.find((b) => b.name === "House")!;
    expect(
      keepNotes(result.current.notes)
        .filter((n) => matchesBoard(n, house))
        .map((n) => n.keep_id)
        .sort(),
    ).toEqual(["Doodle", "Ferry photo", "Porch paint", "Voice memo"]);
    // Filing is not editing: the board still orders them by Keep's dates.
    expect(result.current.notes.find((n) => n.keep_id === "Doodle")!.field_updated_at?.body).toBe(
      byKeep("Doodle").updated_at,
    );

    // A second import of the same Takeout brings in nothing.
    const again = planImport(await scanKeep(files), result.current.notes);
    expect(again.fresh).toEqual([]);
    expect(again.already).toBe(FIXTURE_NOTES);

    // The one undo: the whole batch to the trash — the notes Tidy up filed
    // too, since they are still active — and nothing destroyed.
    act(() => undos[0].run());
    const after = keepNotes(result.current.notes);
    expect(after).toHaveLength(FIXTURE_NOTES);
    expect(after.every((n) => n.status === "trashed")).toBe(true);
    // Everything filed in the three boards the import made went with it, so
    // each is empty and off the shelf.
    expect(shelf).toEqual([]);
    await waitFor(async () => {
      const kept = keepNotes(await allNotes());
      expect(kept.every((n) => n.status === "trashed")).toBe(true);
    });

    // And in the trash they still count as here: undoing and importing again
    // is not how a duplicate gets made.
    expect(planImport(await scanKeep(files), result.current.notes).fresh).toEqual([]);

    // Once more for `trashImport` on its own: a second run finds nothing left
    // with the status the import gave it, and moves nothing.
    expect(trashImport({ made: imported.made, boards: [] }, store).moved).toEqual([]);
  });
});
