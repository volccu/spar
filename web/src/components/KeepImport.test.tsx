// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board, Note, UserBoard } from "../types";
import { FIXTURE_NOTES, TAKEOUT_DIR, takeoutZip } from "../test/takeout";
import type { ImportChunk, ImportStore } from "../lib/keepImport";
import { forgetHeldImport, KeepImport } from "./KeepImport";
import { EmptyBoard } from "./EmptyBoard";

const KEEP = join(__dirname, "..", "..", "..", TAKEOUT_DIR);
const NOTES = Object.fromEntries(readdirSync(KEEP).map((name) => [name, readFileSync(join(KEEP, name), "utf8")]));

afterEach(() => {
  cleanup();
  forgetHeldImport();
});

/** The app around the screen: a list of notes, a shelf, an undo stack. */
function harness({
  notes = [] as Note[],
  folders = [] as UserBoard[],
  waiting = false,
  stalled = false,
  inboxSince = null as string | null,
} = {}) {
  const state = { notes, boards: folders, undos: [] as { message: string; run: () => void }[] };
  const written: ImportChunk[] = [];
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
    written.push(chunk);
    const made = chunk.map(({ note }) => note);
    state.notes = [...made, ...state.notes];
    return made;
  });
  const onClose = vi.fn();
  const onTidyNow = vi.fn();
  const onLeaveThem = vi.fn();
  const view = render(
    <KeepImport
      notes={notes}
      folders={folders}
      inboxSince={inboxSince}
      onTidyNow={onTidyNow}
      onLeaveThem={onLeaveThem}
      waiting={waiting}
      stalled={stalled}
      onImport={onImport}
      store={store}
      onClose={onClose}
      restoreTo={createRef<HTMLButtonElement>()}
    />,
  );
  return { state, store, written, onImport, onClose, onTidyNow, onLeaveThem, view };
}

async function pickZip(file: File) {
  fireEvent.change(screen.getByTestId("keep-zip"), { target: { files: [file] } });
}

async function fixtureZip(): Promise<File> {
  return new File([await takeoutZip(NOTES)], "takeout-20260927.zip", { type: "application/zip" });
}

describe("Import from Google Keep", () => {
  it("says what comes across and, plainly, what does not", () => {
    harness();
    expect(screen.getByRole("dialog", { name: "Import from Google Keep" })).toBeTruthy();
    const page = screen.getByRole("dialog").textContent ?? "";
    expect(page).toContain("read here, on this device");
    expect(page).toMatch(/Colours, because spår has none/);
    expect(page).toMatch(/Reminders, because Takeout does not include them/);
    expect(page).toMatch(/Who a note was shared with/);
    expect(page).toMatch(/pinned ones are marked important/);
  });

  it("waits for the server before it will read anything, and says why", () => {
    harness({ waiting: true });
    for (const name of ["Choose the zip", "Choose the Keep folder"]) {
      expect((screen.getByRole("button", { name: new RegExp(name) }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole("status").textContent).toMatch(/so that nothing is imported twice/);
  });

  it("says so when the wait is because the server is not answering", () => {
    harness({ waiting: true, stalled: true });
    expect(screen.getByRole("status").textContent).toMatch(/Your server has not answered yet. Check the connection/);
  });

  it("says so when the wait is because the device is offline", () => {
    vi.stubGlobal("navigator", Object.create(navigator, { onLine: { value: false } }));
    try {
      harness({ waiting: true });
      expect(screen.getByRole("status").textContent).toMatch(/Your server has not answered yet. Check the connection/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses something that is not a Takeout, in words, and imports nothing", async () => {
    const { onImport } = harness();
    await pickZip(new File(["not a zip at all"], "notes.zip", { type: "application/zip" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/This is not a zip file\. Nothing was imported\./);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("reads the zip, lists each label once with its count, and imports where it is told", async () => {
    const kitchen: UserBoard = { id: "b-kitchen", name: "Kitchen", position: 0 };
    const { state, written, onImport } = harness({ folders: [kitchen] });
    await pickZip(await fixtureZip());

    await screen.findByRole("heading", { name: "Labels" });
    const found = screen.getByText("To import").parentElement!;
    expect(found.textContent).toContain(String(FIXTURE_NOTES));
    expect(screen.getByText("In Keep's trash, left behind").parentElement!.textContent).toContain("1");

    // Kitchen already exists, so it is the default; the others are on one
    // note each, so they start in the Inbox and nothing new is made.
    const where = (label: string) =>
      screen.getByRole("combobox", { name: `Where the notes labelled ${label} go` }) as HTMLSelectElement;
    const every = () => screen.getByRole("combobox", { name: "Where every label goes" }) as HTMLSelectElement;
    expect(where("Kitchen").value).toBe("board:b-kitchen");
    expect(where("House").value).toBe("inbox");
    expect(every().value).toBe("mixed");
    expect(screen.getByText("No new boards")).toBeTruthy();
    const kitchenRow = where("Kitchen").closest(".keep-label") as HTMLElement;
    expect(within(kitchenRow).getByText("3")).toBeTruthy();

    // The one switch sends every label to a board of its own — Kitchen to the
    // one already called that — and says what that adds up to.
    fireEvent.change(every(), { target: { value: "new" } });
    expect(where("Kitchen").value).toBe("board:b-kitchen");
    expect(where("House").value).toBe("new");
    expect(every().value).toBe("new");
    expect(screen.getByText("3 new boards")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Name of the new board for House" }) as HTMLInputElement).value).toBe("House");

    // Emptied, the field still says what it will be called.
    expect(
      (screen.getByRole("textbox", { name: "Name of the new board for House" }) as HTMLInputElement).placeholder,
    ).toBe("House");

    // Someday stays in the Inbox; House gets a name of the person's choosing.
    fireEvent.change(where("Someday"), { target: { value: "inbox" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Name of the new board for House" }), {
      target: { value: "Home" },
    });
    expect(screen.queryByRole("textbox", { name: "Name of the new board for Someday" })).toBeNull();
    expect(screen.getByText("2 new boards")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Imported" });

    expect(onImport).toHaveBeenCalled();
    expect(state.boards.map((b) => b.name)).toEqual(["Kitchen", "Errands", "Home"]);
    const notes = written.flat().map((c) => c.note);
    expect(notes).toHaveLength(FIXTURE_NOTES);
    const home = state.boards.find((b) => b.name === "Home")!;
    expect(notes.find((n) => n.keep_id === "Porch paint")!.board_id).toBe(home.id);
    expect(notes.find((n) => n.keep_id === "Pantry list")!.board_id).toBe("b-kitchen");

    // The report: counted, the missing photograph named, and the one undo.
    expect(screen.getByText("Imported", { selector: "dt" }).parentElement!.textContent).toContain(
      String(FIXTURE_NOTES),
    );
    expect(screen.getByText("ferry.jpg").parentElement!.textContent).toMatch(
      /ferry\.jpg: not in the Takeout, from “The view from the ferry deck”/,
    );
    expect(state.undos.map((u) => u.message)).toEqual([`Imported ${FIXTURE_NOTES} notes from Google Keep`]);

    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    expect(screen.getByRole("status").textContent).toMatch(
      new RegExp(`Moved ${FIXTURE_NOTES} notes to the trash, where they wait 30 days`),
    );
    expect(state.notes.every((n) => n.status === "trashed")).toBe(true);
    // The boards it made are empty now and off the shelf; Kitchen was not its.
    expect(state.boards.map((b) => b.name)).toEqual(["Kitchen"]);
    expect(screen.queryByRole("button", { name: "Undo this import" })).toBeNull();
  });

  it("says there is nothing to import when every note is already here", async () => {
    const zip = await fixtureZip();
    const first = harness();
    await pickZip(zip);
    fireEvent.click(await screen.findByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Imported" });
    const already = first.state.notes;
    cleanup();
    forgetHeldImport();

    harness({ notes: already });
    await pickZip(zip);
    await screen.findByText(/already here, so there is nothing to import/);
    expect(screen.getByText("Already here").parentElement!.textContent).toContain(String(FIXTURE_NOTES));
    expect(screen.queryByRole("button", { name: /^Import \d/ })).toBeNull();
  });

  it("takes a dropped zip and keeps the drop from the window, which would make it a note", async () => {
    const { onImport } = harness();
    const onWindowDrop = vi.fn();
    window.addEventListener("drop", onWindowDrop);
    const zip = await fixtureZip();
    fireEvent.drop(screen.getByRole("dialog"), {
      dataTransfer: {
        types: ["Files"],
        files: [zip],
        items: [{ kind: "file", getAsFile: () => zip }],
      },
    });
    await screen.findByRole("heading", { name: "Labels" });
    expect(onWindowDrop).not.toHaveBeenCalled();
    window.removeEventListener("drop", onWindowDrop);
    expect(onImport).not.toHaveBeenCalled();
  });

  it("takes a picked folder of loose Keep files", async () => {
    harness();
    const files = ["Pantry list.json", "Old recipe card.json"].map(
      (name) => new File([NOTES[name]], name, { type: "application/json" }),
    );
    fireEvent.change(screen.getByTestId("keep-folder"), { target: { files } });
    await screen.findByRole("heading", { name: "Labels" });
    expect(screen.getByText("To import").parentElement!.textContent).toContain("2");
  });

  it("closes on Escape", () => {
    const { onClose } = harness();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the empty Inbox's offer", () => {
  const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };
  function empty(over: { freshArchive?: boolean; board?: Board; onImportKeep?: () => void }) {
    return render(
      <EmptyBoard
        fetching={false}
        searching={false}
        remindersOpen={false}
        headerMood="idle"
        board={over.board ?? inbox}
        freshArchive={over.freshArchive ?? true}
        oldNotesOut={0}
        onImportKeep={over.onImportKeep ?? (() => {})}
      />,
    );
  }

  it("is made on the Inbox of an archive nothing was ever written in, under the menu row's name", () => {
    const onImportKeep = vi.fn();
    empty({ onImportKeep });
    // The words the empty Inbox always had are still there, unchanged.
    expect(screen.getByText(/^A notes app where you just write/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Import from Google Keep" }));
    expect(onImportKeep).toHaveBeenCalledOnce();
    // The public demo's offer and sentence are its build's alone
    // (`demo/SampleOffer.test.tsx`); this build has neither.
    expect(screen.queryByRole("button", { name: "Try it with sample notes" })).toBeNull();
    expect(screen.queryByText(/stay in this browser/)).toBeNull();
  });

  it("is not made once anything has been written, nor on any other board", () => {
    empty({ freshArchive: false });
    expect(screen.queryByRole("button", { name: "Import from Google Keep" })).toBeNull();
    cleanup();
    empty({ board: { id: "archive", name: "Archive", kind: "archive" } });
    expect(screen.queryByRole("button", { name: "Import from Google Keep" })).toBeNull();
  });
});


/* --- review round r6 ------------------------------------------------------------- */

/** A Takeout of `n` plain notes, none of them with a label. */
async function plainZip(n: number): Promise<File> {
  const notes = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [
      `Plain ${i}.json`,
      JSON.stringify({
        color: "DEFAULT",
        isTrashed: false,
        isPinned: false,
        isArchived: false,
        textContent: `plain note ${i}`,
        title: `Plain ${i}`,
        userEditedTimestampUsec: 1_698_000_000_000_000 + i * 1000,
        createdTimestampUsec: 1_698_000_000_000_000 + i * 1000,
      }),
    ]),
  );
  return new File([await takeoutZip(notes)], "takeout.zip", { type: "application/zip" });
}

describe("closing the import part-way (GAP-01)", () => {
  it("reopens onto the running import, and refuses a second one until it ends", async () => {
    const zip = await fixtureZip();
    const first = harness();
    let finish: () => void = () => {};
    const hold = new Promise<void>((resolve) => (finish = resolve));
    first.onImport.mockImplementation(async (chunk: ImportChunk) => {
      await hold;
      const made = chunk.map(({ note }) => note);
      first.state.notes = [...made, ...first.state.notes];
      return made;
    });
    await pickZip(zip);
    fireEvent.click(await screen.findByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Importing" });

    // Closed mid-way, then opened again: the same import, not a new picker.
    first.view.unmount();
    const second = harness({ notes: first.state.notes });
    expect(screen.getByRole("heading", { name: "Importing" })).toBeTruthy();
    expect(screen.queryByTestId("keep-zip")).toBeNull();
    expect(second.onImport).not.toHaveBeenCalled();

    // It finishes while the screen is open, and the summary is the first run's.
    await act(async () => finish());
    await screen.findByRole("heading", { name: "Imported" });
    expect(screen.getByText("Imported", { selector: "dt" }).parentElement!.textContent).toContain(
      String(FIXTURE_NOTES),
    );
  });

  it("shows the summary of an import that finished while the screen was shut", async () => {
    const zip = await fixtureZip();
    const first = harness();
    let finish: () => void = () => {};
    const hold = new Promise<void>((resolve) => (finish = resolve));
    first.onImport.mockImplementation(async (chunk: ImportChunk) => {
      await hold;
      return chunk.map(({ note }) => note);
    });
    await pickZip(zip);
    fireEvent.click(await screen.findByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Importing" });
    first.view.unmount();
    await act(async () => finish());
    await waitFor(() => expect(first.state.undos).toHaveLength(1));
    harness();
    expect(screen.getByRole("heading", { name: "Imported" })).toBeTruthy();
  });
});

describe("a big batch in the Inbox (GAP-02)", () => {
  it("offers the first-open question's two answers, and keeps its promise", async () => {
    const { onTidyNow, onLeaveThem } = harness({ inboxSince: "1970-01-01T00:00:00.000Z" });
    await pickZip(await plainZip(25));
    fireEvent.click(await screen.findByRole("button", { name: "Import 25 notes" }));
    await screen.findByRole("heading", { name: "Imported" });
    expect(screen.getByText(/25 notes are in your Inbox now/).textContent).toMatch(
      /You can change this from the menu/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start the Inbox today" }));
    expect(onLeaveThem).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toMatch(/The Inbox starts today\. 25 notes stay on All/);
    expect(screen.queryByRole("button", { name: "Tidy them up" })).toBeNull();
    expect(onTidyNow).not.toHaveBeenCalled();
  });

  it("can send the batch straight to Tidy up", async () => {
    const { onTidyNow } = harness({ inboxSince: "1970-01-01T00:00:00.000Z" });
    await pickZip(await plainZip(25));
    fireEvent.click(await screen.findByRole("button", { name: "Import 25 notes" }));
    await screen.findByRole("heading", { name: "Imported" });
    fireEvent.click(screen.getByRole("button", { name: "Tidy them up" }));
    expect(onTidyNow).toHaveBeenCalledOnce();
  });

  it("asks nothing of a small batch, or of an Inbox that already starts today", async () => {
    harness({ inboxSince: "1970-01-01T00:00:00.000Z" });
    await pickZip(await plainZip(5));
    fireEvent.click(await screen.findByRole("button", { name: "Import 5 notes" }));
    await screen.findByRole("heading", { name: "Imported" });
    expect(screen.queryByRole("button", { name: "Start the Inbox today" })).toBeNull();
    cleanup();
    forgetHeldImport();
    harness({ inboxSince: "2100-01-01T00:00:00.000Z" });
    await pickZip(await plainZip(25));
    fireEvent.click(await screen.findByRole("button", { name: "Import 25 notes" }));
    await screen.findByRole("heading", { name: "Imported" });
    expect(screen.queryByRole("button", { name: "Start the Inbox today" })).toBeNull();
  });
});

describe("importing again after Undo (GAP-03)", () => {
  it("counts the trashed matches apart and brings them back under the new choices", async () => {
    const zip = await fixtureZip();
    const first = harness();
    await pickZip(zip);
    fireEvent.click(await screen.findByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Imported" });
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    const trashed = first.state.notes;
    expect(trashed.every((n) => n.status === "trashed")).toBe(true);
    cleanup();
    forgetHeldImport();

    const second = harness({ notes: trashed });
    second.state.notes = trashed;
    await pickZip(zip);
    await screen.findByRole("heading", { name: "Labels" });
    expect(screen.getByText("In the trash here").parentElement!.textContent).toContain(String(FIXTURE_NOTES));
    expect(screen.queryByText("Already here")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Import ${FIXTURE_NOTES} notes` }));
    await screen.findByRole("heading", { name: "Imported" });
    expect(
      screen.getByText("Brought back from the trash", { selector: "dt" }).parentElement!.textContent,
    ).toContain(String(FIXTURE_NOTES));
    expect(second.onImport).toHaveBeenCalledTimes(0);
    expect(second.state.notes.some((n) => n.status === "trashed")).toBe(false);
    expect(second.state.notes).toHaveLength(trashed.length);
  });

  it("lists a note with nothing to bring in up front, as empty and left behind", async () => {
    harness();
    const notes = {
      "Blank.json": JSON.stringify({
        isTrashed: false,
        isPinned: false,
        isArchived: false,
        textContent: "",
        title: "",
        userEditedTimestampUsec: 1_698_000_000_000_000,
        createdTimestampUsec: 1_698_000_000_000_000,
        attachments: [{ filePath: "gone.jpg", mimetype: "image/jpeg" }],
      }),
      "Real.json": JSON.stringify({
        isTrashed: false,
        isPinned: false,
        isArchived: false,
        textContent: "words",
        title: "",
        userEditedTimestampUsec: 1_698_000_001_000_000,
        createdTimestampUsec: 1_698_000_001_000_000,
      }),
    };
    await pickZip(new File([await takeoutZip(notes)], "takeout.zip", { type: "application/zip" }));
    await screen.findByRole("heading", { name: "What was found" });
    expect(screen.getByText("Empty, left behind").parentElement!.textContent).toContain("1");
    expect(screen.getByRole("button", { name: "Import 1 note" })).toBeTruthy();
  });
});

describe("a label named like a board (GAP-04)", () => {
  it("says a name already on the shelf files there, and a lookalike still makes its own board", async () => {
    harness({ folders: [{ id: "b-house", name: "House", position: 0 }] });
    await pickZip(await fixtureZip());
    await screen.findByRole("heading", { name: "Labels" });
    const where = (label: string) =>
      screen.getByRole("combobox", { name: `Where the notes labelled ${label} go` }) as HTMLSelectElement;
    fireEvent.change(where("Errands"), { target: { value: "new" } });
    const name = () => screen.getByRole("textbox", { name: "Name of the new board for Errands" });
    fireEvent.change(name(), { target: { value: " house " } });
    expect(screen.getByText("You already have a board called House, so these notes go into it.")).toBeTruthy();
    // Kitchen, on three notes, is the one board still to be made.
    expect(screen.getByText("1 new board")).toBeTruthy();
    fireEvent.change(name(), { target: { value: "Todo" } });
    expect(
      screen.getByText(
        "This name looks like the Todos board. A board of its own is still made, so you will have both.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 new boards")).toBeTruthy();
  });
});

describe("keeping focus inside the layer (GAP-05)", () => {
  it("takes focus back after each stage, so Escape still closes it", async () => {
    const { onClose } = harness();
    await pickZip(await fixtureZip());
    await screen.findByRole("heading", { name: "Labels" });
    const layer = screen.getByRole("dialog");
    expect(layer.contains(document.activeElement)).toBe(true);
    const importButton = screen.getByRole("button", { name: `Import ${FIXTURE_NOTES} notes` });
    importButton.focus();
    fireEvent.click(importButton);
    await screen.findByRole("heading", { name: "Imported" });
    expect(document.activeElement).toBe(layer);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
