// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { forgetServerClock, noteServerDate } from "./store/serverClock";
import type { Note } from "./types";

// jsdom has no Cache Storage, so a share never arrives on its own. Every open
// finds nothing waiting, as the real one does here, unless a test hands it one.
vi.mock("./lib/shareTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/shareTarget")>()),
  takeShared: vi.fn(async () => null),
}));

/**
 * The other side of the dialog wiring.
 *
 * `components/Overlays.test.tsx` proves each button inside a dialog reaches the
 * right handler — that is the boundary the extraction moved. What it does not
 * prove is who *opens* each dialog. `App.tsx` decides, in three places:
 *
 *   1. `askToDestroy(ids, what)` is the permanent-delete confirmation. The
 *      only paths that open it are the trash selection's Delete and the menu's
 *      "Empty trash" — both of them live in the trash. A selection's Delete
 *      anywhere else is `doTrash`, which puts notes in the trash and never
 *      raises the question. If the gates ever get crossed, the destroy dialog
 *      appears over an unrelated board (catastrophic) or it does not appear
 *      where it should (silent).
 *   2. `askToDeleteBoard(board)` is the folder-deletion confirmation. The only
 *      caller is the board menu's Delete row, and it must carry the board the
 *      menu was opened on — not a stale closure, not a neighbouring tab.
 *
 * These are end-to-end on purpose: a refactor that re-routed the selection's
 * Delete to `doTrash` and a call to `askToDestroy` in the wrong place would
 * still leave `Overlays.test.tsx` green, because that file does not own the
 * wiring that decides whether the dialog appears.
 */
describe("dialog callers in App", () => {
  function note(id: string, body: string, status: Note["status"] = "active"): Note {
    const now = new Date().toISOString();
    return {
      id,
      raw_content: body,
      body,
      source: "web",
      created_at: now,
      updated_at: now,
      note_type: null,
      board_id: null,
      status,
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    };
  }

  beforeEach(async () => {
    forgetServerClock();
    noteServerDate(new Date().toUTCString());
    localStorage.setItem("spar.deviceOnly", "1");
    sessionStorage.clear();
    await setMeta("inboxSince", INBOX_ALL);
    await writeCaptureDraft("");
  });

  afterEach(cleanup);

  /** Renders and waits until the board is up. */
  async function renderApp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  /** "+ New board" → field → Enter. */
  async function makeBoard(name: string) {
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: name } });
    fireEvent.keyDown(field, { key: "Enter" });
    return await screen.findByRole("tab", { name: new RegExp(name, "i") });
  }

  it("opens the destroy dialog from Empty trash, naming every trashed note", async () => {
    await putNote(note("zzz-dialog-bin-1", "trashed first", "trashed"));
    await putNote(note("zzz-dialog-bin-2", "trashed second", "trashed"));
    await putNote(note("zzz-dialog-bin-3", "still active"));

    await renderApp();

    // Stand in the trash so Empty trash is offered.
    fireEvent.click(await screen.findByRole("tab", { name: /^trash/i }));
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^empty trash/i }));

    // The "what" string the dialog receives is the one App.tsx built from
    // trashCount, which counts every trashed note — never the active one.
// Two trashed notes reads "both notes in the trash"; one or three or more
// reads the count. Both are spelled here, the wiring pinned. The "here and on
// the server" line is `sendsFiles`-gated and not asserted in this device-only
// build (`Overlays.test.tsx` covers the synced branch on its own).
    const found = await screen.findByRole("alertdialog", { name: "Delete for good?" });
    expect(found.textContent).toContain("deletes both notes in the trash");
    expect(found.textContent).not.toContain("here and on the server");
  });

  it("opens the destroy dialog from a trash selection's Delete", async () => {
    await putNote(note("zzz-dialog-sel-1", "trashed for selection", "trashed"));

    await renderApp();

    fireEvent.click(await screen.findByRole("tab", { name: /^trash/i }));
    const card = await screen.findByRole("button", { name: /trashed for selection/i });
    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));

    fireEvent.click(await screen.findByRole("button", { name: /^delete/i }));

    // The single-note phrasing reads "1 note" (selection panel's own wording —
// not "1 note in the trash", which is the Empty trash button's). Both phrasings
// reach the same dialog, and the wiring from the selection panel is the half
// that had no coverage.
    const dialog = await screen.findByRole("alertdialog", { name: "Delete for good?" });
    expect(dialog.textContent).toContain("deletes 1 note for good");
  });

  it("does not open the destroy dialog from a non-trash selection's Delete", async () => {
    // The negative case: a selection outside the trash goes through `doTrash`,
    // not `askToDestroy`. The note lands in the trash, the destroy dialog
    // never appears, and nothing about the screen invites the user to
    // confirm what was never a question.
    await putNote(note("zzz-dialog-nobin", "active and selected"));

    await renderApp();

    const card = await screen.findByRole("button", { name: /active and selected/i });
    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));

    fireEvent.click(await screen.findByRole("button", { name: /^delete/i }));

    // No destroy dialog. The selection cleared (doTrash ends with
    // setSelected([])) and the note is now in the trash, findable by id.
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: /deletes .* for good/i })).toBeNull(),
    );
    expect((await allNotes()).find((n) => n.id === "zzz-dialog-nobin")?.status).toBe("trashed");
  });

  it("opens the delete-board dialog from the board menu's Delete, naming the board", async () => {
    // Two folders so a wrong `askToDeleteBoard` call — pointed at the wrong
    // tab — is visible. A transposition sends the dialog's headline to the
    // neighbouring board's name rather than the one the menu was opened on.
    await renderApp();

    const first = await makeBoard("zzz-dialog-bd-a");
    await makeBoard("zzz-dialog-bd-b");

    fireEvent.contextMenu(first);
    fireEvent.click(await screen.findByRole("button", { name: /^delete/i }));

    // The headline names the board the menu was opened on. A crossed handler
    // would name B, or no board, and this test fails.
    await screen.findByRole("alertdialog", { name: /Delete .zzz-dialog-bd-a./i });
  });
});