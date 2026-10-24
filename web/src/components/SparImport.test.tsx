// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Canvas, Note, UserBoard } from "../types";
import { planArchive, writeArchive } from "../lib/exportArchive";
import type { ImportChunk, ImportStore } from "../lib/keepImport";
import { buildZip } from "../lib/zip";
import { SparImport } from "./SparImport";

afterEach(cleanup);

/*
 * The screen of the spår download import (audit 2026-10-10, DATA-4 / UX-3),
 * driven with a download the app's own export made.
 */

const T = "2026-03-01T10:00:00.000Z";
const note = (id: string, body: string, fields: Partial<Note> = {}): Note => ({
  id,
  raw_content: body,
  body,
  source: "web",
  created_at: T,
  updated_at: T,
  note_type: null,
  board_id: null,
  status: "active",
  priority: 0,
  reminder_at: null,
  reminder_repeat: null,
  done: null,
  merged_from: null,
  keep_id: null,
  attachments: [],
  ...fields,
});

const folder: UserBoard = { id: "f-1", name: "Garden", position: 0 };

async function downloadOf(notes: Note[], folders: UserBoard[] = [folder]): Promise<File> {
  const now = new Date("2026-04-01T12:00:00.000Z");
  const made = await writeArchive(planArchive({ notes, folders, canvases: [], now }), async () => null, undefined, now);
  return new File([await made.blob.arrayBuffer()], made.fileName, { type: "application/zip" });
}

function harness(start: Note[] = []) {
  const state = { notes: start, boards: [] as UserBoard[], undos: [] as { message: string; run: () => void }[] };
  const store: ImportStore = {
    notes: () => state.notes,
    bulkUpdate: vi.fn((ids: string[], patch: Partial<Note>) => {
      const set = new Set(ids);
      state.notes = state.notes.map((n) => (set.has(n.id) ? { ...n, ...patch } : n));
    }),
    editBoards: (change) => {
      state.boards = change(state.boards);
    },
    pushUndo: (entry) => state.undos.push(entry),
  };
  const onImport = vi.fn(async (chunk: ImportChunk) => {
    const made = chunk.map(({ note: n }) => n);
    state.notes = [...made, ...state.notes];
    return made;
  });
  const onCanvases = vi.fn((c: Canvas[]) => c.length);
  const view = render(
    <SparImport
      notes={start}
      folders={[]}
      inspiration={null}
      canvases={[]}
      waiting={false}
      onImport={onImport}
      onCanvases={onCanvases}
      store={store}
      onClose={vi.fn()}
      restoreTo={createRef<HTMLButtonElement>()}
    />,
  );
  return { state, onImport, view };
}

const pick = (file: File) => fireEvent.change(screen.getByTestId("spar-zip"), { target: { files: [file] } });

describe("Import a spår download", () => {
  it("reads a download, imports it with its folder, and one Undo moves it all to the trash", async () => {
    const { state, onImport } = harness();
    pick(await downloadOf([note("a", "First", { board_id: folder.id }), note("b", "Second", { status: "archived" })]));

    const go = await screen.findByRole("button", { name: "Import 2 notes" }, { timeout: 10_000 });
    expect(screen.getByText("New boards").parentElement!.textContent).toContain("1");
    fireEvent.click(go);

    await screen.findByRole("heading", { name: "Imported" }, { timeout: 10_000 });
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(state.notes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(state.boards).toEqual([folder]);
    expect(state.undos.map((u) => u.message)).toEqual(["Imported 2 notes from a spår download"]);

    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    await waitFor(() => expect(state.notes.every((n) => n.status === "trashed")).toBe(true));
    // The folder it made holds nothing any more, so it goes too.
    expect(state.boards).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/Moved 2 notes to the trash/);
  });

  it("finds nothing to do in a download that is already here", async () => {
    const here = [note("a", "First")];
    const { onImport } = harness(here);
    pick(await downloadOf(here, []));
    expect(
      await screen.findByText(/already here, so there is nothing to import/, {}, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("refuses a zip that is not a spår download, in words", async () => {
    harness();
    pick(new File(["not a zip"], "x.zip", { type: "application/zip" }));
    expect((await screen.findByRole("alert", {}, { timeout: 10_000 })).textContent).toMatch(/Nothing was imported/);
  });

  it("keeps a parser's own words off the screen", async () => {
    harness();
    const bytes = new TextEncoder().encode("<html>not json</html>");
    const zip = buildZip([{ path: "spår.json", data: bytes }]);
    pick(new File([await zip.arrayBuffer()], "x.zip", { type: "application/zip" }));
    const alert = (await screen.findByRole("alert", {}, { timeout: 10_000 })).textContent ?? "";
    expect(alert).toBe(
      "That could not be read. Choose the zip that Download everything made. Nothing was imported.",
    );
  });
});
