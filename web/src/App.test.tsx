// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import App from "./App";
import { allNotes, getMeta, putNote, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { MAX_FILE_BYTES } from "./lib/files";
import { takeShared } from "./lib/shareTarget";
import { forgetServerClock, noteServerDate } from "./store/serverClock";
import type { Note } from "./types";

// jsdom has no Cache Storage, so a share never arrives on its own. Every open
// finds nothing waiting, as the real one does here, unless a test hands it one.
vi.mock("./lib/shareTarget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/shareTarget")>()),
  takeShared: vi.fn(async () => null),
}));

// Auto-cleanup only registers when vitest runs with globals; do it explicitly
// so a second render doesn't stack a whole second app into the document.
afterEach(cleanup);

// Exercise the device-only path: these tests are about the app itself, and
// sign-in gates nothing but sync.
beforeEach(async () => {
  // The trash sweep destroys nothing on a clock no server has confirmed
  // (`store/serverClock.ts`). An app that has ever synced has had one
  // confirmed, which is the state these cases mean to be in.
  forgetServerClock();
  noteServerDate(new Date().toUTCString());
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  // The capture bar keeps an unsaved draft in this same store, and these tests
  // share one database between them, so without this a sentence typed in an
  // earlier test is restored into the next one's freshly mounted app. Every
  // test here means "open the app with nothing half-written in it".
  await writeCaptureDraft("");
});

/**
 * These render at jsdom's default 1024, where the shelf is the tab strip — so
 * changing board is one click on its tab, with nothing to open first. The phone
 * shape of the same shelf (a burger and a drawer) is exercised in
 * `components/Shelf.test.tsx`, which sets a phone viewport to reach it.
 */
async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

/** One tap and a name, from the "+" tab at the end of the strip, then back to the Inbox. */
async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  const tab = await screen.findByRole("tab", { name: new RegExp(name, "i") });
  // The new board opens; most tests want to stay on the Inbox's notes.
  fireEvent.click(await screen.findByRole("tab", { name: /^inbox/i }));
  return tab;
}

/** Which board the strip says you are standing on. */
const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

/**
 * The folders the user made, in the order the strip draws them: everything
 * between the Inbox at index 0 and Archive, which closes the run of places.
 * Read off the DOM rather than assumed, because every test in this file leaves
 * its own boards behind in the one shared store.
 */
const folderTabs = () => {
  const tabs = [...document.querySelectorAll<HTMLElement>('div.boards [role="tab"]')];
  const archive = tabs.findIndex((tab) => /^archive/i.test(tab.textContent ?? ""));
  return tabs.slice(1, archive < 0 ? tabs.length : archive);
};

const folderIndex = (name: string) =>
  folderTabs().findIndex((tab) => new RegExp(name, "i").test(tab.textContent ?? ""));


/**
 * Smoke test over the whole shell against the real seeded archive. Catches the
 * failure mode unit tests miss: the app mounting to a blank screen.
 */
/**
 * A selection puts nothing on screen but the selection; its verbs are behind
 * the capture bar's burger, which carries the count while anything is picked.
 * Every test below that acts on a selection taps it first.
 */
function openSelection() {
  fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
}

describe("App", () => {
  it("loads the archive, captures a note, and searches", async () => {
    render(<App />);

    // Seeds from web/src/seed/notes.json on first run, then renders cards.
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
    // On a board the corner says nothing: the board's own tab in the row
    // below already carries its count, and one fact twice is one of them
    // going stale (2026-09-19).
    expect(document.querySelector(".count")).toBeNull();

    const before = document.querySelectorAll(".card").length;

    // Capture is optimistic — the card must exist before anything is persisted.
    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "kanelipullat sunnuntaina" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(document.querySelectorAll(".card").length).toBe(before + 1);

    // Search is tucked into the menu now, not resident across the top.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /search/i }));

    // Prefix matching, so Finnish inflection does not break recall.
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "kanelipulla" },
    });
    // The note is on the board. Its words are drawn as several elements now
    // rather than one: a search face marks the words that actually matched
    // (`markHits`), so the sentence reads whole but is split around the hit.
    await waitFor(() => {
      const body = document.querySelector(".card[data-search='true'] .card-body");
      expect(body?.textContent).toMatch(/kanelipullat sunnuntaina/i);
    });
    // ...and the marked part is the query, not the whole line. This is the
    // half that makes a hit two hundred lines into a note legible from the
    // board instead of something you have to open the note to find.
    expect(
      document.querySelector(".card-body [data-hit='true']")?.textContent?.toLowerCase(),
    ).toBe("kanelipulla");

    // Enter hands the keyboard to the results: the first card takes focus,
    // and the grid's own keys go on from there.
    fireEvent.keyDown(screen.getByLabelText("Search notes"), { key: "Enter" });
    expect(document.activeElement).toBe(document.querySelector(".card[data-id]"));
  });

  it("closes the bottom menus when tapped outside", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu", { name: "Menu" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("menu", { name: "Menu" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("menu", { name: "Add" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Attachment" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close add menu" }));
    expect(screen.queryByRole("menu", { name: "Add" })).toBeNull();
  });

  /**
   * A selection puts nothing on screen but the selection. The panel of verbs
   * used to arrive the moment a card was held — under the hand that was still
   * picking cards out, and on a phone as a strip of nine unlabelled marks that
   * ran off the edge. Now the cards invert, the header counts them, the burger
   * carries the number, and the panel is one tap on that burger away — the
   * same corner and the same shape as the menu, which the burger opens when
   * nothing is picked.
   */
  it("keeps the selection's verbs behind the burger", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    // Nothing opened on its own...
    expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull();
    // ...and the burger says what it now opens.
    const burger = screen.getByRole("button", { name: "Menu, 1 selected" });
    expect(burger.getAttribute("data-selecting")).toBe("true");
    expect(burger.textContent).toBe("1");

    fireEvent.click(burger);
    const panel = await screen.findByRole("group", { name: "Selected notes" });
    expect(within(panel).getByRole("button", { name: "Move" })).toBeTruthy();
    // The ordinary menu is not this panel, and is not also open.
    expect(screen.queryByRole("menu", { name: "Menu" })).toBeNull();

    // Outside: the panel goes and the selection stays.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull(),
    );
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    // A verb closes the panel with the selection it acted on — and the menu
    // does not appear in its place.
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Important" }));
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
    expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull();
    expect(screen.queryByRole("menu", { name: "Menu" })).toBeNull();

    // With nothing picked the same burger is the menu again.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("menu", { name: "Menu" })).toBeTruthy();
  });

  /**
   * The panel draws E, M, F and Delete beside four rows, and the grid stands
   * down under it — so the keys had to be answered by the panel itself, or the
   * box named a key that did nothing until the panel was closed.
   */
  it("answers the keys drawn in the selection's panel while it is open", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    fireEvent.contextMenu(document.querySelector<HTMLElement>(".card")!);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    // M swaps the panel's rows for the Move chooser, as its row does.
    openSelection();
    fireEvent.keyDown(await screen.findByRole("group", { name: "Selected notes" }), { key: "m" });
    await screen.findByRole("group", { name: "Move to a board" });
    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByRole("group", { name: "Selected notes" });

    // F is Important: it closes the panel and ends the selection, as its row does.
    fireEvent.keyDown(screen.getByRole("group", { name: "Selected notes" }), { key: "f" });
    await waitFor(() => expect(screen.queryByText(/selected/)).toBeNull());
    expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull();
  });

  /**
   * A right-click with a mouse is a desktop's ask for a menu where it
   * clicked: the card is picked and the same panel opens beside the pointer
   * (review 2026-10-01, UX-11). A right-click with no mouse press before it —
   * a phone's long press fires `contextmenu` too — stays the long press.
   */
  it("opens the selection's verbs at the pointer on a mouse right-click", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

    fireEvent.pointerDown(cards()[0], { pointerId: 1, pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(cards()[0], { button: 2, clientX: 120, clientY: 140 });
    const panel = await screen.findByRole("group", { name: "Selected notes" });
    expect(within(panel).getByText("1 selected")).toBeTruthy();
    expect(panel.style.left).toBe("120px");
    expect(panel.style.top).toBe("140px");
    expect(within(panel).getByRole("button", { name: "Move" })).toBeTruthy();

    // A second card right-clicked joins the selection; the first stays picked.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    fireEvent.pointerDown(cards()[1], { pointerId: 1, pointerType: "mouse", button: 2 });
    fireEvent.contextMenu(cards()[1], { button: 2, clientX: 300, clientY: 160 });
    const second = await screen.findByRole("group", { name: "Selected notes" });
    expect(within(second).getByText("2 selected")).toBeTruthy();
    expect(second.style.left).toBe("300px");

    // The burger still opens it in the corner, with no pointer position.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Menu, 2 selected" }));
    expect(screen.getByRole("group", { name: "Selected notes" }).style.left).toBe("");
  });

  it("merges two selected notes into one and can undo it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const beforeCount = cards().length;

    // Right-click is the desktop sibling of long-press; both enter selection.
    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    // Merge must refuse a single note rather than silently doing nothing.
    openSelection();
    expect(
      screen.getByRole("button", { name: /pick 2 to merge/i }).hasAttribute("disabled"),
    ).toBe(true);
    // Back out to the board to pick the rest; the selection stays.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));

    fireEvent.click(cards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(cards()[2]);
    await waitFor(() => expect(screen.getByText(/3 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 3/i }));

    // The merged idea opens as a folder, with the original notes still separate.
    // The canvas is a lazy chunk, and under a whole-suite run its first load
    // has taken longer than waitFor's one-second default (once, 2026-09-04,
    // on an otherwise green suite) — so this waits the way the seed does.
    await waitFor(
      () => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(),
      { timeout: 10_000 },
    );
    // The folder names itself the way a board tab does: the place in the
    // display face, the count beside it in the machine face.
    expect(document.querySelector(".canvas-title")?.textContent).toBe("notes");
    expect(document.querySelector(".canvas-count")?.textContent).toBe("3");
    expect(document.querySelectorAll(".spatial-note")).toHaveLength(3);
    // A fresh merge says what happened and where the way back is (UX-26).
    expect(document.querySelector(".canvas-merged")?.textContent).toBe(
      "Joined 3 notes. They are now one idea in Inbox. Hold an empty spot to separate them.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    // Three sources archived, one merged note added -> net two fewer on "All".
    await waitFor(() => expect(cards().length).toBe(beforeCount - 2));

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(cards().length).toBe(beforeCount));
  });

  /**
   * The + panel's Draw row: a sketch is an idea born empty. It opens its
   * canvas at once with the pen already in hand, and backing out having
   * drawn nothing sweeps the sketch away again — no blank card the user
   * never wrote is left standing on the board.
   */
  it("starts a sketch from the + panel and sweeps it away if nothing was drawn", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const cards = () => document.querySelectorAll(".card").length;
    const before = cards();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Draw" }));

    // The canvas opens at once (lazy chunk, so wait), named by its seed
    // heading, with the pen selected rather than Move.
    await waitFor(
      () => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(),
      { timeout: 10_000 },
    );
    expect(document.querySelector(".canvas-title")?.textContent).toBe("Sketch");
    expect(document.querySelector<HTMLElement>(".canvas-surface")!.dataset.tool).toBe("draw");
    expect(cards()).toBe(before + 1);

    // Nothing drawn, nothing renamed, nothing absorbed: closing takes the
    // sketch back out of existence.
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));
    await waitFor(() => expect(cards()).toBe(before));
  });

  it("keeps a sketch once a stroke exists, and its card reopens the canvas", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;
    // A priority note from the archive outranks a fresh capture in the sort,
    // so the sketch is not necessarily cards()[0] — track it by id instead,
    // the same defence the last-note-in-an-idea test uses.
    const beforeIds = new Set(cards().map((c) => c.dataset.id));

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Draw" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });

    // One stroke — the pen is already in hand, so drawing is just drawing.
    const surface = document.querySelector<HTMLElement>(".canvas-surface")!;
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 40, clientY: 40, pointerType: "mouse" });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 90, clientY: 70, pointerType: "mouse" });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 140, clientY: 60, pointerType: "mouse" });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 140, clientY: 60, pointerType: "mouse" });

    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    // The sketch is a real note now and stays; its card opens the canvas
    // again, still holding the pen.
    await waitFor(() => expect(cards().length).toBe(before + 1));
    const sketch = cards().find((c) => !beforeIds.has(c.dataset.id))!;
    fireEvent.click(sketch);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    expect(document.querySelector(".canvas-title")?.textContent).toBe("Sketch");
    expect(document.querySelector<HTMLElement>(".canvas-surface")!.dataset.tool).toBe("draw");
  });

  /**
   * Deleting a note straight out of a canvas used to leave it stranded there:
   * `status` went to `trashed` but `merged_from`, `merged_into` and the
   * folder item were all left exactly as they were, so the card kept showing
   * on the canvas pointing at a note that was now in the bin.
   */
  it("deletes one note out of an idea, taking it off the canvas too, and undo restores it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const spatialNotes = () => document.querySelectorAll<HTMLElement>(".spatial-note");
    // Earlier tests can leave an idea of their own behind on the board (the
    // kept sketch), and merging an idea in absorbs rather than composes — so
    // pick plain notes explicitly and track the composed idea by id, the same
    // defence the last-note test below uses.
    const plainCards = () => cards().filter((c) => c.dataset.idea !== "true");
    const beforeIds = new Set(cards().map((c) => c.dataset.id));

    fireEvent.contextMenu(plainCards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(plainCards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(plainCards()[2]);
    await waitFor(() => expect(screen.getByText(/3 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 3/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    expect(spatialNotes()).toHaveLength(3);

    // Delete one note from the canvas menu, the same row a note on the board
    // gets from Selection > Delete.
    fireEvent.contextMenu(spatialNotes()[0], { clientX: 40, clientY: 40 });
    fireEvent.click(
      within(document.querySelector<HTMLElement>(".ctx-menu")!).getByRole("menuitem", {
        name: "Delete",
      }),
    );

    // Two sources left — not emptied, so the canvas stays open and its count
    // agrees with what is actually still drawn on it.
    await waitFor(() => expect(spatialNotes()).toHaveLength(2));
    expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy();
    expect(document.querySelector(".canvas-count")?.textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: /^Undo: / }));
    // Undo closes whatever is open, the same rule merge's own undo follows.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());

    // Reopen the idea: the released note and its place on the canvas both
    // came back — merged_from and the folder item, not just one of them.
    const ideaCard = cards().find(
      (c) => c.dataset.idea === "true" && !beforeIds.has(c.dataset.id),
    )!;
    fireEvent.click(ideaCard);
    await waitFor(() => expect(spatialNotes()).toHaveLength(3));

    // merged_into came back too: opening any of the restored notes still
    // reads as part of the idea, not as a plain note that happens to sit on
    // its canvas.
    fireEvent.contextMenu(spatialNotes()[0], { clientX: 40, clientY: 40 });
    fireEvent.click(
      within(document.querySelector<HTMLElement>(".ctx-menu")!).getByRole("menuitem", {
        name: "Open note",
      }),
    );
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Note" })).toBeTruthy());
    expect(screen.getByText("part of an idea")).toBeTruthy();
  });

  it("deleting the last note in an idea trashes the idea and closes the canvas, and undo restores it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    // Earlier tests in this file can leave an idea of their own behind, active
    // on the board, in the shared fake-indexeddb store, and priority can put
    // it anywhere in the list — so this test tracks its own idea by id
    // (`.card[data-id]`, the same attribute the keyboard grid reads) rather
    // than trusting position, and picks plain notes to merge explicitly
    // rather than trusting the first two cards on the board.
    const plainCards = () => cards().filter((c) => c.dataset.idea !== "true");
    const spatialNotes = () => document.querySelectorAll<HTMLElement>(".spatial-note");
    const deleteFirstOnCanvas = () => {
      fireEvent.contextMenu(spatialNotes()[0], { clientX: 40, clientY: 40 });
      fireEvent.click(
        within(document.querySelector<HTMLElement>(".ctx-menu")!).getByRole("menuitem", {
          name: "Delete",
        }),
      );
    };

    const beforeIds = new Set(cards().map((c) => c.dataset.id));
    const srcIds = [plainCards()[0].dataset.id!, plainCards()[1].dataset.id!];
    fireEvent.contextMenu(plainCards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(plainCards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    expect(spatialNotes()).toHaveLength(2);
    const myIdeaId = cards().find(
      (c) => c.dataset.idea === "true" && !beforeIds.has(c.dataset.id),
    )!.dataset.id!;

    deleteFirstOnCanvas();
    await waitFor(() => expect(spatialNotes()).toHaveLength(1));

    deleteFirstOnCanvas();
    // Nothing left in it — the idea goes to the trash too, exactly as
    // releasing the last source has always done, and the canvas closes
    // behind it rather than falling through to a composition it was never
    // meant to show.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
    expect(cards().some((c) => c.dataset.id === myIdeaId)).toBe(false);

    // Two deletes, each its own undo entry. The toast only ever offers the
    // most recent one, so the second reversal goes through Ctrl+Z — the same
    // path a person reaching for "undo, undo" would use.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() =>
      expect(cards().some((c) => c.dataset.id === myIdeaId)).toBe(true),
    );
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });

    // Both sources and the idea itself are back exactly as they stood —
    // nothing left stranded in the trash.
    const ideaCard = await waitFor(() => {
      const found = cards().find((c) => c.dataset.id === myIdeaId);
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(ideaCard);
    await waitFor(() => expect(spatialNotes()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^trash/i }));
    // The bin may hold another test's residue (the swept sketch), so the
    // claim is that nothing of *ours* is stranded there — not that it is
    // empty. Our ids are still on the board until the view switches, which
    // is what makes this wait self-synchronising.
    await waitFor(() => {
      const inTrash = new Set(cards().map((c) => c.dataset.id));
      for (const id of [...srcIds, myIdeaId]) expect(inTrash.has(id)).toBe(false);
    });
  });

  /**
   * Merging a note onto an existing idea used to compose a brand-new idea
   * around it instead — the old idea's card became a child of the new one,
   * and its canvas, drawings and labels were stranded on a note that was now
   * archived. Absorbing joins the idea that was already there.
   */
  it("merges a note into an existing idea instead of composing a second one", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    // Earlier tests in this file can leave an idea of their own behind, active
    // on the board, in the shared fake-indexeddb store, and priority can put
    // it anywhere in the list — so this test tracks its own idea by id
    // (`.card[data-id]`, the same attribute the keyboard grid reads) rather
    // than trusting position, and picks plain notes to merge explicitly
    // rather than trusting the first cards on the board.
    const plainCards = () => cards().filter((c) => c.dataset.idea !== "true");
    const spatialNotes = () => document.querySelectorAll<HTMLElement>(".spatial-note");
    const beforeCount = cards().length;

    // First, an ordinary merge — two plain notes compose idea A.
    const beforeIds = new Set(cards().map((c) => c.dataset.id));
    fireEvent.contextMenu(plainCards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(plainCards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    const ideaAId = cards().find(
      (c) => c.dataset.idea === "true" && !beforeIds.has(c.dataset.id),
    )!.dataset.id!;
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    await waitFor(() => expect(cards().length).toBe(beforeCount - 1));
    const findIdeaA = () => cards().find((c) => c.dataset.id === ideaAId)!;

    // Now merge a third, plain note onto that idea — dragging a card onto an
    // idea card and the selection panel's Merge both funnel through the same
    // `mergeNotes`, so exercising it through selection covers both.
    fireEvent.contextMenu(findIdeaA());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(plainCards()[0]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));

    // Still the same idea's canvas — no second idea was created — and it now
    // holds all three sources.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    expect(document.querySelector(".canvas-count")?.textContent).toBe("3");
    expect(spatialNotes()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    // One more source archived, no new idea note added: one fewer than after
    // the first merge, and still the same one idea, not a second one.
    await waitFor(() => expect(cards().length).toBe(beforeCount - 2));
    expect(findIdeaA()).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    // Undo closes the canvas, the same rule every other reversal here follows.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
    await waitFor(() => expect(cards().length).toBe(beforeCount - 1));

    // The idea itself is back to its original two sources.
    fireEvent.click(findIdeaA());
    await waitFor(() => expect(spatialNotes()).toHaveLength(2));
  });

  /**
   * Two ideas among the sources still compose a third, unchanged from before
   * this feature: nobody can safely choose which canvas survives, so
   * inventing an answer would be worse than composing one.
   */
  it("still composes a brand-new idea when two sources are already ideas", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const ideaCards = () => cards().filter((c) => c.dataset.idea === "true");
    const plainCards = () => cards().filter((c) => c.dataset.idea !== "true");

    // Earlier tests in this file leave their own ideas behind in the shared
    // fake-indexeddb store, and priority can put any of them anywhere in the
    // list — so each idea this test makes is tracked by id
    // (`.card[data-id]`, the same attribute the keyboard grid reads) rather
    // than by trusting position, and counts stay relative, never absolute.
    const mergeTwoPlainNotes = async (): Promise<string> => {
      const beforeIds = new Set(cards().map((c) => c.dataset.id));
      const pool = plainCards();
      fireEvent.contextMenu(pool[0]);
      await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
      fireEvent.click(pool[1]);
      await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
      openSelection();
      fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(),
      );
      const ideaId = cards().find(
        (c) => c.dataset.idea === "true" && !beforeIds.has(c.dataset.id),
      )!.dataset.id!;
      fireEvent.click(screen.getByRole("button", { name: "Close idea" }));
      return ideaId;
    };

    const startIdeas = ideaCards().length;

    const ideaAId = await mergeTwoPlainNotes();
    await waitFor(() => expect(ideaCards()).toHaveLength(startIdeas + 1));
    const ideaBId = await mergeTwoPlainNotes();
    await waitFor(() => expect(ideaCards()).toHaveLength(startIdeas + 2));

    const ideaA = cards().find((c) => c.dataset.id === ideaAId)!;
    const ideaB = cards().find((c) => c.dataset.id === ideaBId)!;
    fireEvent.contextMenu(ideaA);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(ideaB);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    // The new idea's two children are the old ideas themselves, not their
    // sources laid bare — proof this is a fresh composition, not an absorb.
    expect(document.querySelectorAll(".spatial-note")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));

    // Both old ideas archived into the new one: one net idea, not two, and
    // neither of the two old ids is on the board any more.
    await waitFor(() => expect(ideaCards()).toHaveLength(startIdeas + 1));
    expect(cards().some((c) => c.dataset.id === ideaAId || c.dataset.id === ideaBId)).toBe(
      false,
    );
  });

  it("ticks a box in an open note without rewriting the note", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "[ ] Hämtä mjölk" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(await screen.findByRole("button", { name: /hämtä mjölk/i }));
    const reader = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".reader");
      if (!el) throw new Error("no reader");
      return el;
    });

    // The box is the note's own characters, not a glyph substituted for them.
    // If that ever stops being true, tap-to-caret starts landing in the wrong
    // place, so assert the rendered text is the stored text exactly.
    expect(reader.textContent).toBe("[ ] Hämtä mjölk");

    fireEvent.click(document.querySelector<HTMLElement>(".check-hit")!);
    await waitFor(() =>
      expect(document.querySelector(".reader")?.textContent).toBe("[x] Hämtä mjölk"),
    );
  });

  it("turns a typed '- ' into an en dash as you capture", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "- " } });
    expect(input.value).toBe("– ");

    // Mid-sentence hyphens are left alone — the rule is the head of a line.
    fireEvent.change(input, { target: { value: "e-post - kolla" } });
    expect(input.value).toBe("e-post - kolla");
  });

  it("closes an open note on back, instead of leaving the app", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const ordinaryCard = Array.from(document.querySelectorAll<HTMLElement>(".card")).find(
      (card) => card.dataset.idea !== "true",
    );
    expect(ordinaryCard).toBeTruthy();
    fireEvent.click(ordinaryCard!);
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());

    // Opening a note has to change what the browser thinks the page is, or
    // back walks straight out of the app — blank screen on Android.
    expect((window.history.state as { spar?: string } | null)?.spar).toBe("layer");

    fireEvent.popState(window);
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    expect(document.querySelectorAll(".card").length).toBeGreaterThan(0);
  });

  it("takes the board out of the tab order while a note covers it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    // Read the reflected attribute rather than the `inert` IDL property —
    // jsdom does not implement the property, only the attribute React writes.
    // The board's landmark carries `inert`; the tab panel stands inside it.
    const board = document.querySelector<HTMLElement>("main")!;
    expect(board.hasAttribute("inert")).toBe(false);

    const ordinaryCard = Array.from(document.querySelectorAll<HTMLElement>(".card")).find(
      (card) => card.dataset.idea !== "true",
    )!;
    fireEvent.click(ordinaryCard);
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());
    // A keyboard user tabbing through the open note must never reach a card
    // behind it — NoteView's own focus trap is the other half of this.
    expect(board.hasAttribute("inert")).toBe(true);

    fireEvent.popState(window);
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    expect(board.hasAttribute("inert")).toBe(false);
  });

  it("cancels a selection on back", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.contextMenu(document.querySelectorAll<HTMLElement>(".card")[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());
  });

  it("uses shift-click to select a note instead of opening it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.click(document.querySelectorAll<HTMLElement>(".card")[0], {
      shiftKey: true,
    });

    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    expect(document.querySelector(".sheet")).toBeNull();
  });

  it("deletes to the trash, keeps the note whole, and puts it back", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    // Earlier tests leave their own trash behind (the swept sketch), so this
    // test follows its one note by id rather than expecting the bin to hold
    // exactly one thing.
    const myId = cards()[0].dataset.id!;
    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    // Gone from the board, but not destroyed.
    await waitFor(() => expect(cards().length).toBe(before - 1));

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const trash = await screen.findByRole("menuitem", { name: /^trash/i });
    fireEvent.click(trash);

    const mine = await waitFor(() => {
      const found = cards().find((c) => c.dataset.id === myId);
      expect(found).toBeTruthy();
      return found!;
    });

    // And it comes back whole.
    fireEvent.contextMenu(mine);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(await screen.findByRole("button", { name: /put back/i }));
    await waitFor(() => expect(cards().some((c) => c.dataset.id === myId)).toBe(false));
  });

  it("empties a note and it goes to the trash when it closes", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const before = document.querySelectorAll(".card").length;
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "throw this away" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBe(before + 1),
    );

    fireEvent.click(await screen.findByRole("button", { name: /throw this away/i }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());

    // Cut every word, then walk away: the empty note is not a note any more.
    fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>(".reader")!));
    const editor = screen.getByLabelText("Note text") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());

    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBe(before),
    );
  });

  it("bins an emptied note again after undo brought its empty shell back", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const before = document.querySelectorAll(".card").length;
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "empty me, then bring me back" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBe(before + 1),
    );

    // Empty it and close: trashed.
    fireEvent.click(
      await screen.findByRole("button", { name: /empty me, then bring me back/i }),
    );
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());
    fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>(".reader")!));
    const editor = screen.getByLabelText("Note text") as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBe(before));

    // Undo brings the note back whole — but it is whole as the empty shell it
    // was trashed as. Walking away from it again must bin it again, or one
    // undo turns the feature off for that note forever.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBe(before + 1),
    );

    fireEvent.click(await screen.findByRole("button", { name: /empty note/i }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBe(before),
    );
  });

  it("walks the grid with the arrow keys and deletes with Delete", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    // Nothing focused: the first arrow picks up the first card rather than
    // doing nothing and leaving you wondering whether the keys work.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards()[0]);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cards()[1]);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cards()[0]);

    // Down moves by a whole row, not by one card.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(document.activeElement).not.toBe(cards()[1]);

    fireEvent.keyDown(window, { key: "Home" });
    expect(document.activeElement).toBe(cards()[0]);

    // Delete trashes the focused card, and offers it straight back.
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(cards().length).toBe(before - 1));
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(cards().length).toBe(before));
  });

  // Review 2026-10-04, UX-B-08: focus arriving in the strip keeps the board
  // you are on in view, wherever in the strip it landed.
  it("scrolls the selected board tab into view when focus enters the strip", async () => {
    const scrolled = vi.fn();
    const native = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      );
      scrolled.mockClear();
      const selected = document.querySelector('[role="tab"][aria-selected="true"]')!;
      fireEvent.focus(screen.getByRole("button", { name: "New board" }));
      expect(scrolled.mock.contexts).toContain(selected);
      // Moving within the strip is not entering it.
      scrolled.mockClear();
      fireEvent.focus(selected, { relatedTarget: screen.getByRole("button", { name: "New board" }) });
      expect(scrolled).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = native;
    }
  });

  // Review 2026-10-04, FX-A-05: E archives, F flags, M opens Move — on the
  // focused card, with the usual undo.
  it("archives with E, flags with F and opens Move with M on the focused card", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    // Nothing focused, nothing selected: the letters do nothing at all.
    fireEvent.keyDown(window, { key: "e" });
    expect(cards().length).toBe(before);

    fireEvent.keyDown(window, { key: "Home" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const id = cards()[0].dataset.id!;
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(cards().length).toBe(before - 1));
    expect(screen.getByText(/archived 1 note/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(cards().length).toBe(before));

    const card = cards().find((c) => c.dataset.id === id)!;
    card.focus();
    fireEvent.keyDown(window, { key: "f" });
    // The first card may already be marked, so it is marked or unmarked —
    // in the words every other priority path uses (review CD-02).
    await waitFor(() =>
      expect(screen.getByText(/^(marked important|unmarked) 1$/i)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() =>
      expect(screen.queryByText(/^(marked important|unmarked) 1$/i)).toBeNull(),
    );

    cards().find((c) => c.dataset.id === id)!.focus();
    fireEvent.keyDown(window, { key: "m" });
    await screen.findByLabelText("Search boards or name a new one");
    // Shift is a different key, and a modifier hands the letter back.
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(cards().length).toBe(before);
  });


  /**
   * The mark drawn over a leaving card says what happened to it, and it is a
   * one-shot: set by the action doing the leaving, spent the moment it is
   * drawn. Both halves matter and this pins both.
   *
   * Held rather than spent, the last action's mark stayed permanently ready to
   * explain the *next* disappearance with whatever had happened last — and at
   * startup that was the `"trash"` the ref was initialised with. So a board
   * losing its cards to something nobody did, which is what the Inbox's own
   * filter arriving a beat after first paint looks like, reported every note on
   * screen as deleted. On a phone that was the whole archive playing the delete
   * animation on open.
   *
   * jsdom measures every element as a zero rect, and the grid skips a card it
   * measured off-screen — so nothing here is visible to the vanish layer at all
   * without a real rect to work from.
   */
  it("draws a mark for a note it was told about, and none for one that just went", async () => {
    const original = Element.prototype.getBoundingClientRect;
    let n = 0;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (!(this as HTMLElement).classList?.contains("card")) {
        return original.call(this);
      }
      const top = (n++ % 4) * 210 + 60;
      return { left: 0, top, right: 300, bottom: top + 200, width: 300, height: 200,
        x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };

    try {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      );

      // Loading a board is not an event. Nothing left, so nothing is announced.
      expect(document.querySelectorAll(".vanish").length).toBe(0);

      const cards = () => document.querySelectorAll(".card:not(.vanish-card)");
      const before = cards().length;

      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "Delete" });
      await waitFor(() => expect(cards().length).toBe(before - 1));

      // A note the user actually deleted still shrinks into its own mark.
      const ghost = await waitFor(() => {
        const el = document.querySelector(".vanish");
        expect(el).toBeTruthy();
        return el!;
      });
      expect(ghost.querySelector(".vanish-mark")).toBeTruthy();
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  /**
   * The one layout shift a person actually reported, held by a test.
   *
   * The Sort line is the first thing in the scroller on the landing board, and
   * it used to be drawn on `!searching` — so typing the first character into
   * the search field took a 40px row out from under the grid and the whole
   * board jumped up, then dropped back when the query was cleared. The row now
   * keeps its box for as long as you are standing on the Inbox and only loses
   * what is in it.
   */
  it("puts nothing above the grid, so a search moves no card", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    /**
     * **This test used to be "keeps the Inbox's Sort row in the layout while a
     * search runs."** There was a 40px line at the top of the board offering
     * the mode, and drawn on `!searching` it left the flow the moment a
     * character was typed — every card jumped up by forty pixels and dropped
     * back when the query was cleared. The fix was to keep its box and empty
     * it (`data-hidden`), and this test held that.
     *
     * On 2026-09-25 the owner asked for that line in the menu, so there is no
     * row above the grid at all any more and the shift it guarded against
     * cannot happen. What is worth keeping is the **claim**, not the
     * mechanism: nothing between the board row and the first card, before a
     * search and during one.
     */
    /** What stands between the scroller and the cards. jsdom lays nothing
     *  out, so a pixel assertion here would pass whatever the markup said;
     *  the honest check is that the deck is the scroller's first child. */
    const aboveTheGrid = () => {
      // The deck stands in the tab panel inside the scroller (review QA-02).
      const scroller = document.querySelector(".scroll > .board-panel")!;
      return [...scroller.children]
        .filter((el) => !el.classList.contains("deck"))
        .map((el) => el.className);
    };
    expect(aboveTheGrid()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByLabelText("Search notes"), {
      target: { value: "zzzznotathing" },
    });

    expect(aboveTheGrid()).toEqual([]);

    // And the menu never offers to tidy the search results, which are a mode
    // over every board at once rather than a pile.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(
      screen.queryByRole("menuitem", { name: /^tidy up \d+ notes?$/i }),
    ).toBeNull();
  });

  it("draws the countdown from the same window the offer expires on", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Delete" });

    // The header's creature says it, in the bubble where the wordmark stood
    // (2026-10-16): what happened, with Undo beside it — not a cell of the
    // capture bar any more.
    const bubble = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".topbar .speech");
      if (!el) throw new Error("no undo offer");
      return el;
    });
    expect(document.querySelector("form.capture .undo-slot")).toBeNull();
    expect(bubble.querySelector(".speech-words")?.textContent).toBe("Poof. Deleted 1 note");
    // The length of the window is handed to CSS from the one constant, so the
    // countdown cannot outlast the offer.
    expect(bubble.style.getPropertyValue("--undo-ms")).toBe("8000ms");
    expect(bubble.querySelector(".speech-clock")).not.toBeNull();
    const button = bubble.querySelector<HTMLElement>("button.speech-act");
    expect(button?.textContent).toMatch(/^Undo/);
    expect(button?.getAttribute("aria-label")).toBe("Undo: Deleted 1 note");
    // The creature turns to what it is asking.
    expect(document.querySelector(".topbar spar-mascot")?.getAttribute("speaking")).toBe("ask");
    // The words are announced from the header's permanently-mounted region,
    // not from the bubble: a live region that arrives with its content already
    // in it is the case assistive technology misses.
    expect(bubble.querySelector('[role="status"]')).toBeNull();
    const said = [...document.querySelectorAll<HTMLElement>('.sr-only[role="status"]')].map(
      (el) => el.textContent,
    );
    expect(said).toContain("Deleted 1");

    fireEvent.click(button!);
    await waitFor(() => expect(document.querySelector(".speech-act")).toBeNull());
  });

  it("says a notice without offering to undo whatever came before it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    // Copy is the one action that pushes an entry with nothing of its own to
    // reverse. It keeps its words and the same clock, and it must never carry
    // a button: an Undo there would reverse the action before it.
    const card = document.querySelector<HTMLElement>(".card")!;
    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    const copy = await screen.findByRole("button", { name: /^copy$/i });
    fireEvent.click(copy);

    const bubble = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".topbar .speech");
      if (!el) throw new Error("no notice");
      return el;
    });
    expect(bubble.querySelector("button")).toBeNull();
    // Either answer the copy can give — jsdom has no clipboard, so here it is
    // the refusal. Both are notices, and neither grows an Undo button.
    expect(bubble.querySelector(".speech-words")?.textContent).toMatch(/cop(ied|y)/i);
    expect(bubble.querySelector(".speech-clock")).not.toBeNull();
    expect(document.querySelector(".topbar spar-mascot")?.getAttribute("speaking")).toBe("say");
  });

  it("walks the last action back with Ctrl+Z, and stops when there is nothing left", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(cards().length).toBe(before - 1));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(cards().length).toBe(before));

    // An empty stack does nothing at all — it must never wrap around and start
    // undoing things a second time.
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(cards().length).toBe(before);
  });

  it("walks back further than the offer that has already gone", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(cards().length).toBe(before - 1));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(cards().length).toBe(before - 2));

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(cards().length).toBe(before - 1));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(cards().length).toBe(before));
  });

  /**
   * The one rule that keeps the two undos from fighting: inside a field, Ctrl+Z
   * belongs to the browser and undoes typing, which is what it does in every
   * other app on the machine.
   */
  it("leaves Ctrl+Z alone inside a field being typed into", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const before = cards().length;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() => expect(cards().length).toBe(before - 1));

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "mid-sentence" } });
    fireEvent.keyDown(input, { key: "z", ctrlKey: true });

    expect(cards().length).toBe(before - 1);
  });

  it("never takes a key away from a field being typed into", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const before = document.querySelectorAll(".card").length;
    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "still typing" } });
    // Backspace in the capture bar must delete a character, not a note.
    fireEvent.keyDown(input, { key: "Backspace" });
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(document.querySelectorAll(".card").length).toBe(before);
    expect(document.activeElement).not.toHaveProperty("dataset.id");
  });

  it("clears the capture field without saving anything", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const before = document.querySelectorAll(".card").length;
    const input = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();

    fireEvent.change(input, { target: { value: "never mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(input.value).toBe("");
    expect(document.querySelectorAll(".card").length).toBe(before);
    // Empty field, nothing to clear: the mark goes away with the text.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("puts a tick box in at the caret from the insert panel", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "Handla\nsen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(await screen.findByRole("button", { name: /handla/i }));
    fireEvent.click(await waitFor(() => document.querySelector<HTMLElement>(".reader")!));

    const editor = screen.getByLabelText("Note text") as HTMLTextAreaElement;
    editor.setSelectionRange(6, 6); // end of the first line
    fireEvent.select(editor);

    fireEvent.click(screen.getByRole("button", { name: "Insert" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Tick box" }));

    // On its own line, at the caret — not appended to the end of the note.
    expect(editor.value).toBe("Handla\n[ ] \nsen");
  });

  it("moves a selection into a new board, and undo restores it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "alpha move test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(input, { target: { value: "beta move test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const alphaCard = () => screen.getByRole("button", { name: /alpha move test/i });
    const betaCard = () => screen.getByRole("button", { name: /beta move test/i });

    fireEvent.contextMenu(alphaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(betaCard());
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());

    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    const nameInput = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(nameInput, { target: { value: "zzzmovetest" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    // A brand-new name makes the board and files both notes into it in one
    // motion, and the panel closes straight back to the board.
    await waitFor(() => expect(screen.getAllByText(/moved 2 to zzzmovetest/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/selected/)).toBeNull();

    await goToBoard(/zzzmovetest/i);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /alpha move test/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /beta move test/i })).toBeTruthy();
    });

    // Undo takes the notes out and the board it made with them — and, as
    // deleting the folder you stand on does, takes you to the Inbox, where the
    // notes now are, rather than leaving you on whatever slid into the seat.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(screen.queryByRole("tab", { name: /zzzmovetest/i })).toBeNull());
    await waitFor(() => expect(boardName()).toMatch(/^inbox/i));
    expect(screen.getByRole("button", { name: /alpha move test/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /beta move test/i })).toBeTruthy();
  });

  /**
   * The open note's Todo-toggle said over a whole selection: same write, same
   * switch in both directions, and it files the notes onto the Todos board
   * without touching a word of any of them.
   */
  it("marks a selection as todos, flips the row when they all are, and undoes both ways", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    // Plain prose, deliberately: a note full of tick boxes is on the Todos
    // board on the strength of its own text (`deriveFace`), which would prove
    // nothing about the row being tested.
    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "alpha todo test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(input, { target: { value: "beta todo test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const alphaCard = () => screen.getByRole("button", { name: /alpha todo test/i });
    const betaCard = () => screen.getByRole("button", { name: /beta todo test/i });

    // The panel is the row's only home: with nothing selected there is no row.
    expect(screen.queryByRole("button", { name: "To-do" })).toBeNull();

    fireEvent.contextMenu(alphaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(betaCard());
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());

    // Neither is a todo yet, so the row offers to make them both one.
    openSelection();
    expect(screen.getByRole("button", { name: "To-do" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    await waitFor(() => expect(screen.getByText(/marked 2 notes as to-do/i)).toBeTruthy());
    expect(screen.queryByText(/selected/)).toBeNull();

    // Which is what puts them on the Todos board.
    await goToBoard(/^todos/i);
    await waitFor(() => {
      expect(alphaCard()).toBeTruthy();
      expect(betaCard()).toBeTruthy();
    });

    // Both are todos now, so the same row reads the other way round and clears
    // the type instead of setting it.
    fireEvent.contextMenu(alphaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(betaCard());
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    // The same name both ways; pressed says the next press clears (CD-02).
    expect(screen.getByRole("button", { name: "To-do" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    await waitFor(() => expect(screen.getByText(/unmarked 2 notes/i)).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /alpha todo test/i })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: /beta todo test/i })).toBeNull();

    // Undo puts each note's own previous type back, so both return.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(alphaCard()).toBeTruthy());
    expect(betaCard()).toBeTruthy();
  });

  /**
   * A mixed selection marks everything rather than toggling note by note — the
   * rule Archive already follows — and undo has to put each note back to the
   * type it personally had, not to one blanket value.
   */
  it("marks a mixed selection all as todos, and undo restores each note's own type", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "gamma mixed test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(input, { target: { value: "delta mixed test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const gammaCard = () => screen.getByRole("button", { name: /gamma mixed test/i });
    const deltaCard = () => screen.getByRole("button", { name: /delta mixed test/i });

    // Make just one of them a todo first.
    fireEvent.contextMenu(gammaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    await waitFor(() => expect(screen.getByText(/marked 1 note as to-do/i)).toBeTruthy());

    // Marking gamma as a todo took it out of the Inbox — a to-do's place is the
    // Todos board. All is where the two meet again.
    await goToBoard(/^all/i);

    // Now both: one already marked, one not. The row still offers to mark.
    fireEvent.contextMenu(gammaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(deltaCard());
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "To-do" }));
    await waitFor(() => expect(screen.getByText(/marked 2 notes as to-do/i)).toBeTruthy());

    await goToBoard(/^todos/i);
    await waitFor(() => {
      expect(gammaCard()).toBeTruthy();
      expect(deltaCard()).toBeTruthy();
    });

    // Undoing takes delta back to no type at all and leaves gamma the todo it
    // already was before the selection — the reversal is per note.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /delta mixed test/i })).toBeNull(),
    );
    expect(gammaCard()).toBeTruthy();
  });

  /**
   * A selection can be emptied back into the Inbox, and the reversal is per
   * note.
   *
   * The chooser's Inbox row was refused to multi-select for as long as it was
   * called "Unfiled" — a word with no one honest thing to say about a mixed
   * selection. It is a destination like every other row now, so the row is
   * offered; and without it there is no way to empty a folder back into the
   * pile at all, since the only other exit is deleting the folder, which
   * archives everything filed there.
   *
   * The two notes are deliberately in **different** folders. A blanket revert
   * — one `board_id` for the whole selection — passes a test where they share
   * one, and is wrong for the ordinary case.
   */
  it("moves a selection to the Inbox and undo returns each note to its own folder", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "zzzunfile alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(input, { target: { value: "zzzunfile beta" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const alphaCard = () => screen.getByRole("button", { name: /zzzunfile alpha/i });
    const betaCard = () => screen.getByRole("button", { name: /zzzunfile beta/i });

    /** Long-press one card, then file it into a board named on the spot. */
    async function fileAlone(card: HTMLElement, board: string) {
      fireEvent.contextMenu(card);
      await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
      openSelection();
      fireEvent.click(screen.getByRole("button", { name: "Move" }));
      const field = await screen.findByLabelText("Search boards or name a new one");
      fireEvent.change(field, { target: { value: board } });
      fireEvent.keyDown(field, { key: "Enter" });
      await waitFor(() => expect(screen.getAllByText(/moved 1 to /i).length).toBeGreaterThan(0));
    }

    await fileAlone(alphaCard(), "zzzunfileone");
    await fileAlone(betaCard(), "zzzunfiletwo");

    // Gathered by a search rather than on All: the two are in different
    // folders, and a query is the cheapest screen that holds both at once.
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "zzzunfile" },
    });
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBe(2));
    // Search is one of the three places a card says where it is filed, so the
    // folder mark is the cheapest reading of "these two are on a board".
    const filed = () => document.querySelectorAll('.card[data-filed="true"]').length;
    expect(filed()).toBe(2);

    fireEvent.contextMenu(alphaCard());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(betaCard());
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());

    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    const chooser = await screen.findByRole("group", { name: "Move to a board" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Inbox" }));
    await waitFor(() => expect(screen.getAllByText(/moved 2 to /i).length).toBeGreaterThan(0));
    // Both are off their boards and back in the pile: no card in the results
    // is filed anywhere any more.
    await waitFor(() => expect(filed()).toBe(0));

    // Undo, and then read the answer off the folder alpha came from: a blanket
    // revert — one board_id for the whole selection — would put *both* notes
    // back into whichever folder it happened to pick, which is exactly why the
    // two started in different ones.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    await goToBoard(/zzzunfileone/i);
    await waitFor(() => expect(alphaCard()).toBeTruthy());
    expect(screen.queryByRole("button", { name: /zzzunfile beta/i })).toBeNull();
  });

  /**
   * Review UX-B-03: Move from the open note sent a note away with no offer
   * back, while Move from a selection and Archive from the same note both
   * offered one. The offer is made when the note closes — the board is where
   * it can be seen — and reverses every move made while it was open.
   */
  it("offers a note moved from the open note back once it closes", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "zzzopenmove note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // Wait for the save to settle into the grid before opening it: a click
    // landing while the new card is still arriving can go unanswered under
    // load (the sibling tests wait on the card count the same way).
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /zzzopenmove note/i }).length).toBe(1),
    );
    await waitFor(
      () => {
        if (!document.querySelector(".sheet")) {
          fireEvent.click(screen.getByRole("button", { name: /zzzopenmove note/i }));
        }
        expect(document.querySelector(".sheet")).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Move to a board" }));
    const field = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(field, { target: { value: "zzzopenmovefolder" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(screen.queryByLabelText("Search boards or name a new one")).toBeNull(),
    );
    // Nothing is offered over the open note: the offer is the board's.
    expect(screen.queryByRole("button", { name: /^Undo: Moved/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    // Filed away, so off the Inbox it was opened from...
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /zzzopenmove note/i })).toBeNull(),
    );
    // ...and offered back.
    fireEvent.click(await screen.findByRole("button", { name: /^Undo: Moved 1/ }));
    expect(await screen.findByRole("button", { name: /zzzopenmove note/i })).toBeTruthy();
  });

  /**
   * Select all takes what is on screen and nothing wider — `visible`, which on
   * a board is that board. The archive behind it is nearly three hundred notes,
   * and none of them are what the word "all" means when it is read off a screen
   * showing two.
   */
  it("picks exactly the notes visible on a board, and not the archive behind it", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "alpha selectall test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.change(input, { target: { value: "beta selectall test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // Into a folder of their own, so the board has a known and small size.
    fireEvent.contextMenu(screen.getByRole("button", { name: /alpha selectall test/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /beta selectall test/i }));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    const field = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(field, { target: { value: "zzzselectall" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getAllByText(/moved 2 to /i).length).toBeGreaterThan(0));

    await goToBoard(/zzzselectall/i);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBe(2));

    // With no selection at all, the key is what enters selection mode — which
    // is what "select all" means everywhere else.
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());

    // The panel exists only once a selection does, and its cross ends it.
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/2 selected/)).toBeNull());
    fireEvent.contextMenu(screen.getByRole("button", { name: /alpha selectall test/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
  });

  /**
   * In a search the honest scope is the results, which is what `visible`
   * already means while a query runs. Search is deliberately the one layer
   * this does not stand down for — it does not cover the grid, it changes what
   * the grid holds.
   */
  it("picks the search results, and not the whole archive, while a query runs", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    for (const text of ["zzzqueryable one", "zzzqueryable two", "unrelated words here"]) {
      fireEvent.change(input, { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    }

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /search/i }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "zzzqueryable" },
    });
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBe(2));

    // Fired from the board rather than from the field: the caret is in the
    // field for most of a search, and there the key belongs to the text.
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
  });

  /**
   * The guard every shortcut here carries. A Ctrl+A while writing must select
   * the text being written and never touch the board — the same trade Ctrl+Z
   * makes with the browser's own undo — and it must stand down under any layer
   * over the grid.
   */
  it("stands Ctrl+A down inside a text field and under an open note", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "zzz guarded capture" } });
    fireEvent.keyDown(input, { key: "a", ctrlKey: true });
    expect(screen.queryByText(/selected/)).toBeNull();
    // And the words are still in the field: nothing was taken from the caret.
    expect(input.value).toBe("zzz guarded capture");
    fireEvent.change(input, { target: { value: "" } });

    // An open note is a layer over the grid, so the key stands down whatever
    // holds focus — including the board behind the sheet.
    fireEvent.click(document.querySelectorAll<HTMLElement>(".card")[0]);
    await waitFor(() => expect(screen.getByLabelText("Close note")).toBeTruthy());
    fireEvent.keyDown(document.body, { key: "a", ctrlKey: true });
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  /**
   * The chooser is a face the selection panel wears, not a layer of its own
   * — so Back has to spend one step getting out of it before it spends one
   * clearing the selection underneath.
   */
  it("steps back out of the Move chooser without losing the selection", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    fireEvent.contextMenu(document.querySelectorAll<HTMLElement>(".card")[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByLabelText("Search boards or name a new one")).toBeTruthy();

    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByLabelText("Search boards or name a new one")).toBeNull());
    // Out of the chooser and back on the panel's rows, selection intact.
    expect(screen.getByRole("group", { name: "Selected notes" })).toBeTruthy();

    // The panel is a face the selection wears, so Back closes it first...
    fireEvent.popState(window);
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Selected notes" })).toBeNull(),
    );
    expect(screen.getByText(/1 selected/)).toBeTruthy();

    // ...and the selection itself second.
    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());
  });

  /**
   * The shelf is a line, and a horizontal swipe walks it (SPEC §6's gesture
   * budget). The strip scrolls on its own axis and the deck of cards pages on
   * another, and nothing but this keeps them in step — so the tab marked "on"
   * has to follow the board a swipe landed on.
   */
  it("pages boards on a swipe, and the strip keeps up", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    expect(boardName()).toMatch(/inbox/i);

    const deck = document.querySelector("#board-panel")!;
    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(deck, { touches: [{ clientX: from, clientY: 300 }] });
      fireEvent.touchMove(deck, { touches: [{ clientX: to, clientY: 300 }] });
      fireEvent.touchEnd(deck, { changedTouches: [{ clientX: to, clientY: 300 }] });
    };

    // Leftwards is forwards along the shelf — to whatever is standing next on
    // it. Which board that is depends on whether a folder exists, since the
    // places run first now and a folder is one, so the destination is read off
    // the strip rather than named: what is being tested is that the tab marked
    // "on" follows the deck, not which board is second.
    const next = document.querySelectorAll('[role="tab"]')[1].textContent;
    swipe(300, 100);
    await waitFor(() => expect(boardName()).toBe(next));

    // And back again, which is the whole point of a line.
    swipe(100, 300);
    await waitFor(() => expect(boardName()).toMatch(/inbox/i));
  });

  it("switches boards without losing the archive", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    await goToBoard(/^links/i);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
  });

  /**
   * The Links board is the one board with a geometry of its own: a single
   * column of full-width rows rather than the card grid, because a link's name
   * and the user's own words could not both fit in a ~160px phone column. It is
   * not a view the user can switch, and no other board changes — "no list/grid
   * toggle" still stands.
   */
  describe("the Links board's rows", () => {
    async function openLinks() {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      );
      await goToBoard(/^links/i);
      await waitFor(() =>
        expect(document.querySelectorAll('.card[data-row="true"]').length).toBeGreaterThan(1),
      );
    }

    it("lists rows there and leaves every other board on the card grid", async () => {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      );
      expect(document.querySelector(".grid")?.getAttribute("data-rows")).toBe("false");
      expect(document.querySelectorAll('.card[data-row="true"]')).toHaveLength(0);

      // A saved link with something of the user's own written beside it — the
      // exact note the Links board used to have to throw half of away.
      fireEvent.change(screen.getByLabelText("Write a note"), {
        target: { value: "Row fit test https://example.com/spar and a line of my own" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));

      await goToBoard(/^links/i);
      await waitFor(() =>
        expect(document.querySelectorAll('.card[data-row="true"]').length).toBeGreaterThan(0),
      );
      expect(document.querySelector(".grid")?.getAttribute("data-rows")).toBe("true");
      // One row per *note*, never one per link — every gesture on this board
      // counts elements, and there has to go on being exactly one each.
      expect(document.querySelectorAll(".card-row-face").length).toBe(
        document.querySelectorAll(".card[data-id]").length,
      );
      // The note's own words are back on this board. That is the whole change:
      // the old fix dropped them because they did not fit.
      const fresh = Array.from(
        document.querySelectorAll<HTMLElement>('.card[data-row="true"]'),
      ).find((r) => r.querySelector(".card-row-title")?.textContent === "Row fit test");
      expect(fresh, "the captured link should be on the Links board").toBeTruthy();
      expect(fresh!.querySelector(".card-row-domain")?.textContent).toBe("example.com");
      expect(fresh!.querySelector(".card-body")?.textContent).toBe("and a line of my own");

      await goToBoard(/^all/i);
      await waitFor(() =>
        expect(document.querySelector(".grid")?.getAttribute("data-rows")).toBe("false"),
      );
      expect(document.querySelectorAll('.card[data-row="true"]')).toHaveLength(0);
      expect(document.querySelectorAll(".card-row-face")).toHaveLength(0);
    });

    it("still picks a row out into a selection, the way a card is picked out", async () => {
      await openLinks();
      const rows = document.querySelectorAll<HTMLElement>('.card[data-row="true"]');
      fireEvent.contextMenu(rows[0]);
      await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
      expect(rows[0].getAttribute("data-selected")).toBe("true");
      fireEvent.click(rows[1]);
      await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    });

    /**
     * The grid walk counts columns from the cards' own
     * `getBoundingClientRect().top`, which jsdom never lays out — so the rows
     * are given the geometry they really have, stacked one per row. One column
     * is a legitimate input to that count, and this is what proves it: down
     * means the next note rather than a jump to the end of the list.
     */
    it("walks one row at a time from the keyboard", async () => {
      await openLinks();
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('.card[data-row="true"]'),
      );
      rows.forEach((el, i) => {
        el.getBoundingClientRect = () =>
          ({
            left: 0,
            top: i * 106,
            right: 528,
            bottom: i * 106 + 106,
            width: 528,
            height: 106,
            x: 0,
            y: i * 106,
            toJSON: () => ({}),
          }) as DOMRect;
      });

      rows[0].focus();
      fireEvent.keyDown(rows[0], { key: "ArrowDown" });
      expect(document.activeElement).toBe(rows[1]);
      fireEvent.keyDown(rows[1], { key: "ArrowUp" });
      expect(document.activeElement).toBe(rows[0]);
    });
  });

  /** The fast second way into search, beside the board tabs. The menu entry
   *  is untouched — this only has to prove the new one also works. */
  it("opens search from the icon beside the board tabs", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    expect(screen.queryByLabelText("Search notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByLabelText("Search notes")).toBeTruthy();
  });

  /**
   * The hint drawn in the row is `aria-hidden` and `pointer-events: none`, so
   * the only way the shortcut reaches a reader who cannot see the box is the
   * field's own name. On a device with no such key it is left out entirely —
   * "Ctrl+K" announced to a phone names a modifier there is no key for, which
   * is the very thing the drawn hint refuses to do, and jsdom (which answers
   * no media query at all) is that device unless a test says otherwise.
   */
  it("says the search shortcut in the field's own name where there is a key to press", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      render(<App />);
      await waitFor(() =>
        expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      );
      fireEvent.click(screen.getByRole("button", { name: "Search" }));
      expect(await screen.findByLabelText("Search notes, Ctrl+K")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers a past search as a chip, and remembers only one that found something", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzchipfound" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = await screen.findByLabelText("Search notes");
    fireEvent.change(field, { target: { value: "zzzchipfound" } });
    await waitFor(() =>
      expect(document.querySelector(".card[data-search='true']")).toBeTruthy(),
    );
    // The ✕ clears a query, and remembers it by the same rule closing search
    // does: only if it found something.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.change(field, { target: { value: "zzzchipnothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(screen.queryByLabelText("Search notes")).toBeNull();

    // Reopened on a blank query, the term that found something comes back as
    // a tappable chip; the one that found nothing does not.
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const chip = await screen.findByRole("button", { name: "zzzchipfound" });
    expect(screen.queryByRole("button", { name: "zzzchipnothing" })).toBeNull();
    fireEvent.click(chip);
    expect((screen.getByLabelText("Search notes") as HTMLInputElement).value).toBe(
      "zzzchipfound",
    );
  });

  /**
   * The shelf divides on what a board *does*, and the hairline is where it
   * says so: to its left is everywhere a note can be put — the Inbox, your
   * folders, Archive — and to its right only ways of looking at notes that are
   * already somewhere. It used to fall where the user's own folders began,
   * which answered a question nobody navigating an app asks.
   *
   * There is still exactly **one**. The line moved rather than multiplying, and
   * a second one appearing is the shelf having grown a third run nobody argued
   * for.
   */
  it("marks where the lenses begin with the lifted band, and no rule", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    await makeBoard("zzzsplittest");

    expect(document.querySelectorAll(".boards .board-split")).toHaveLength(0);

    // The last place is on one side of the band and the app's own boards on the
    // other: Inspiration first (its id is minted per account), then the lenses.
    const first = document.querySelector<HTMLElement>('.boards [data-lens="true"]')!;
    expect(first.previousElementSibling?.id).toBe("board-tab-archive");
    expect(first.textContent).toMatch(/^Inspiration/);
    expect(first.nextElementSibling?.id).toBe("board-tab-todos");

    // And the run either side of it is what the divider claims: the Inbox
    // lands first, every folder sits inside the places, and the four lenses
    // close the strip.
    const ids = Array.from(document.querySelectorAll('.boards [role="tab"]')).map((t) => t.id);
    expect(ids[0]).toBe("board-tab-inbox");
    expect(ids.slice(-4)).toEqual([
      "board-tab-todos",
      "board-tab-links",
      "board-tab-files",
      "board-tab-recent",
    ]);
    const archive = ids.indexOf("board-tab-archive");
    // Archive, Inspiration, then the four lenses.
    expect(archive).toBe(ids.length - 6);
    // Everything between the Inbox and Archive is a folder — those tabs carry
    // the folder's own id, so none of them is one of the app's fixed boards.
    const fixed = ["inbox", "recent", "todos", "links", "files", "archive", "trash"];
    const between = ids.slice(1, archive);
    expect(between.length).toBeGreaterThan(0);
    expect(between.some((id) => fixed.includes(id.replace("board-tab-", "")))).toBe(false);
  });

  /**
   * A board made from the Shelf, exercised end to end: filing takes the note
   * out of the Inbox, All still shows it (marked as filed, since it's the
   * safety net), the note's own folder reads at full strength, the Move panel
   * offers it as a one-tap destination ahead of typing a new name, and search
   * offers to jump straight to it rather than only listing it as a result.
   */
  it("creates a board from the Shelf and carries it through All, Move and search", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await makeBoard("zzzworktest");

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "team meeting" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const cardBtn = () => screen.getByRole("button", { name: /team meeting/i });

    fireEvent.contextMenu(cardBtn());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(await screen.findByRole("button", { name: /^zzzworktest/ }));
    await waitFor(() => expect(screen.getAllByText(/moved 1 to zzzworktest/i).length).toBeGreaterThan(0));

    // Filing takes it out of the Inbox — that is what makes the Inbox a pile
    // with an end to it — and All keeps it, marked, as the safety net.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /team meeting/i })).toBeNull(),
    );
    await goToBoard(/^all/i);
    await waitFor(() => expect(cardBtn().getAttribute("data-filed")).toBe("true"));

    // On its own board it carries no mark — it is All's, and search's.
    await goToBoard(/zzzworktest/i);
    await waitFor(() => expect(cardBtn().getAttribute("data-filed")).toBe("false"));

    // The Move panel lists it as a one-tap board, ahead of typing a new name.
    fireEvent.contextMenu(cardBtn());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(await screen.findByRole("button", { name: /^zzzworktest/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Searching the board's own name offers to jump straight to it.
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "zzzworktest" },
    });
    fireEvent.click(await screen.findByText(/jump to the zzzworktest board/i));
    // The header row is where "which board am I on" is answered now.
    await waitFor(() => expect(boardName()).toMatch(/zzzworktest/i));
  });

  /**
   * Search covers everything, and on a folder it offers — one tap, in the
   * row it already occupies — to look only there. Off each time search opens,
   * never offered on the Inbox, and the query survives the toggle.
   */
  it("searches only the folder it was opened on, when asked", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const input = screen.getByLabelText("Write a note");
    for (const words of ["zzzscopeword filed", "zzzscopeword loose"]) {
      fireEvent.change(input, { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    }
    // Filed into a folder named on the spot: the chooser's one-tap rows stop
    // at a few, and the shared store holds every other test's folders too.
    fireEvent.contextMenu(screen.getByRole("button", { name: /zzzscopeword filed/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    const chooser = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(chooser, { target: { value: "zzzscopeboard" } });
    fireEvent.keyDown(chooser, { key: "Enter" });
    await waitFor(() => expect(screen.getAllByText(/moved 1 to /i).length).toBeGreaterThan(0));

    // The Inbox is not offered the scope.
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Search notes");
    expect(screen.queryByRole("button", { name: /^Only here/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));

    await goToBoard(/zzzscopeboard/i);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = (await screen.findByLabelText("Search notes")) as HTMLInputElement;
    expect(field.placeholder).toBe("Search everything");
    const scope = screen.getByRole("button", { name: "Only here, in zzzscopeboard" });
    expect(scope.getAttribute("aria-pressed")).toBe("false");

    // Everywhere, by default.
    fireEvent.change(field, { target: { value: "zzzscopeword" } });
    expect(await screen.findByText("2 found")).toBeTruthy();
    // On a desktop the count stands in the search row, beside the field, and
    // not a screen's width away in the header (review UI-30).
    expect(screen.getByText("2 found").closest(".board-row")).toBeTruthy();
    expect(document.querySelector(".topbar .count")).toBeNull();

    // One tap: only the folder, and the query is still the query.
    fireEvent.click(scope);
    expect(scope.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("1 found")).toBeTruthy();
    expect(screen.getByRole("button", { name: /zzzscopeword filed/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /zzzscopeword loose/i })).toBeNull();
    expect(screen.getByLabelText("Search notes in zzzscopeboard")).toBe(field);
    expect(field.value).toBe("zzzscopeword");

    // And back.
    fireEvent.click(scope);
    expect(await screen.findByText("2 found")).toBeTruthy();

    // Closed with the scope on, it opens again searching everything.
    fireEvent.click(scope);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Search notes");
    expect(
      screen.getByRole("button", { name: "Only here, in zzzscopeboard" }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  // "That article about X" is a saved page; on Links the same one-tap switch
  // narrows to the board's own set (review FX-A-06).
  it("searches only Links when asked, from the Links board", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    const input = screen.getByLabelText("Write a note");
    for (const words of ["https://zzzlinkscope.example.com/page", "zzzlinkscope said in words"]) {
      fireEvent.change(input, { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    }
    await goToBoard(/^Links/i);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = (await screen.findByLabelText("Search notes")) as HTMLInputElement;
    expect(field.placeholder).toBe("Search everything");
    const scope = screen.getByRole("button", { name: "Only here, in Links" });
    expect(scope.getAttribute("aria-pressed")).toBe("false");
    fireEvent.change(field, { target: { value: "zzzlinkscope" } });
    expect(await screen.findByText("2 found")).toBeTruthy();
    fireEvent.click(scope);
    expect(await screen.findByText("1 found")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /zzzlinkscope said in words/i })).toBeNull();
  });

  it("renames a board via its Shelf row's own menu", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const row = await makeBoard("zzzrenametest");

    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const renameInput = screen.getByLabelText("Board name");
    fireEvent.change(renameInput, { target: { value: "zzzrenamed" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(await screen.findByRole("tab", { name: /zzzrenamed/i })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /zzzrenametest/i })).toBeNull();
  });

  it("gives a board a mark and a hue from its own menu, and the shelf takes them", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const tab = await makeBoard("zzzlooktest");
    // A folder starts on the folder mark, with no tint at all — the same
    // attribute-free tab every board has always drawn.
    expect(tab.style.getPropertyValue("--board-tint")).toBe("");

    // The sheet draws Lucide a page at a time as its grid scrolls, and with no
    // observer at all (jsdom) it draws all ~1,850 marks — a second of this
    // test spent on cells it never looks at. One that never fires keeps it to
    // the first page; the board behind is only asked for its tab.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    fireEvent.contextMenu(tab);
    fireEvent.click(await screen.findByRole("button", { name: "Look" }));

    // The set arrives in a chunk of its own, so nothing below is true until it
    // has landed.
    await waitFor(() =>
      expect(document.querySelectorAll("button.look-icon").length).toBeGreaterThan(50),
    );
    fireEvent.change(screen.getByLabelText("Find a mark"), { target: { value: "beaker" } });
    // The search is a chunk of its own too, so the cell is there once it answers.
    fireEvent.click(await screen.findByRole("button", { name: "beaker" }));
    fireEvent.click(screen.getByRole("button", { name: "Fern" }));

    // Written straight through, with no Save to press: the strip behind the
    // sheet is already wearing them.
    const dressed = await screen.findByRole("tab", { name: /zzzlooktest/i });
    await waitFor(() =>
      expect(dressed.style.getPropertyValue("--board-tint")).toBe("var(--board-sage)"),
    );
    // The chosen mark, not the folder. Both are one <svg class="icon">, so the
    // test asks the drawing rather than the element: the folder is the app's
    // own drawing (`FolderMark`), a Lucide mark wears Lucide's own class.
    await waitFor(() => expect(dressed.querySelector("svg.icon.lucide")).toBeTruthy());

    // And the tint reaches the mark only — never the tab's own fill or its
    // name, which is the whole of what the exception was granted for.
    expect(dressed.style.background).toBe("");
    expect(dressed.style.color).toBe("");
  });

  it("deletes a board via right-click on its tab, archives its notes, and lands back on the Inbox", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await makeBoard("zzzdeletetest");

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "delete test note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    const cardBtn = () => screen.getByRole("button", { name: /delete test note/i });

    fireEvent.contextMenu(cardBtn());
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    // Narrowed by name before it is clicked: this file makes a new folder in
    // almost every test, so where this one stands in the resting list is a
    // fact about the tests above it rather than about this one.
    const deleteField = await screen.findByLabelText("Search boards or name a new one");
    fireEvent.change(deleteField, { target: { value: "zzzdeletetest" } });
    fireEvent.click(await screen.findByRole("button", { name: /^zzzdeletetest/ }));
    await waitFor(() => expect(screen.getAllByText(/moved 1 to /i).length).toBeGreaterThan(0));

    // Stand on the board about to be removed, so landing back on board 0 is a
    // real move and not just "nothing changed".
    await goToBoard(/zzzdeletetest/i);
    await waitFor(() => expect(boardName()).toMatch(/zzzdeletetest/i));

    fireEvent.contextMenu(await screen.findByRole("tab", { name: /zzzdeletetest/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alertdialog", { name: /Delete .zzzdeletetest./ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: /zzzdeletetest/i })).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /^inbox/i }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );

    // The note wasn't destroyed — it archived.
    await goToBoard(/^archive/i);
    expect(await screen.findByRole("button", { name: /delete test note/i })).toBeTruthy();

    // And the whole thing is offered back: the folder under its own name, and
    // the note filed in it and active again, not merely unarchived.
    fireEvent.click(screen.getByRole("button", { name: /^Undo: Deleted zzzdeletetest/ }));
    const back = await screen.findByRole("tab", { name: /zzzdeletetest/i });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /delete test note/i })).toBeNull(),
    );
    fireEvent.click(back);
    expect(await screen.findByRole("button", { name: /delete test note/i })).toBeTruthy();
  });

  /**
   * `UserBoard.position` existed, synced and sorted the shelf from the day
   * folders did, and until now nothing anywhere could change it: `createBoard`
   * appended, and that was the order for the life of the folder. Two rows in
   * the folder's own menu move it one step each — the path that needs no
   * pointer, beside holding the tab and carrying it (`App.shelf.test.tsx`).
   *
   * The rows are named for the shelf that is on screen. These tests run at
   * jsdom's default 1024, which is the strip, so the words are left and right;
   * the drawer's up and down are `Shelf.test.tsx`'s, at a phone viewport.
   */
  it("moves a folder along the strip from its own menu, and the order survives a reload", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await makeBoard("zzzordera");
    const later = await makeBoard("zzzorderb");
    // Created in that order, so they start in it — which is the whole
    // complaint this fixes.
    expect(folderIndex("zzzordera")).toBeLessThan(folderIndex("zzzorderb"));

    fireEvent.contextMenu(later);
    fireEvent.click(await screen.findByRole("button", { name: "Move left" }));
    await waitFor(() =>
      expect(folderIndex("zzzorderb")).toBeLessThan(folderIndex("zzzordera")),
    );

    // Queued for the other device exactly as a rename is: one flag on the one
    // synced preferences row, never a store or a migration of its own.
    await waitFor(async () => expect(await getMeta<boolean>("boardsDirty")).toBe(true));

    // And it is on this device for good, not just in React state.
    cleanup();
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );
    expect(folderIndex("zzzorderb")).toBeLessThan(folderIndex("zzzordera"));
  });

  /**
   * "Do not draw a row that has nowhere to go" — the same rule the open note's
   * list-item grip follows, where a run of one is not a list. A disabled row
   * would be thumb-sized, legible and inert, and the only way to learn that is
   * to tap it.
   */
  it("draws no move row past either end of the folder run", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    // At least two folders, so "first" and "last" are different boards. Earlier
    // tests in this file leave their own behind, so the ends are found in the
    // strip rather than assumed to be these two.
    await makeBoard("zzzendsa");
    await makeBoard("zzzendsb");
    const folders = folderTabs();
    expect(folders.length).toBeGreaterThan(1);

    fireEvent.contextMenu(folders[0]);
    expect(await screen.findByRole("button", { name: "Move right" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move left" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Archive closes the run now (it is carried among the folders, 2026-10-23),
    // so it is the board with nowhere further right to go.
    fireEvent.contextMenu(document.querySelector<HTMLElement>('.boards [data-board-id="archive"]')!);
    expect(await screen.findByRole("button", { name: "Move left" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move right" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  /**
   * The sweep destroys a month-old trashed note on open, quietly: no notice,
   * no receipt. The month in the trash is the warning, and the Trash board
   * says so; nothing is announced when the notes go.
   */
  it("takes a month-old trashed note on open without saying anything", async () => {
    const at = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    for (const [id, days] of [["zzzsweep1", 40], ["zzzsweep2", 55]] as const) {
      await putNote({
        id,
        raw_content: id,
        body: id,
        source: "web",
        created_at: at(days),
        updated_at: at(days),
        note_type: null,
        board_id: null,
        status: "trashed",
        priority: 0,
        reminder_at: null,
        done: null,
        merged_from: null,
        keep_id: null,
        attachments: [],
      });
    }

    render(<App />);
    // A cold open: the archive is read, then the sweep asks for the clock and
    // destroys. The notes being gone from the store is the only sign it ran.
    await waitFor(
      async () => {
        const left = await allNotes();
        expect(left.some((n) => n.id === "zzzsweep1")).toBe(false);
        expect(left.some((n) => n.id === "zzzsweep2")).toBe(false);
      },
      { timeout: 5_000 },
    );
    // Silent: no notice, and no Undo offered for something that cannot be undone.
    await new Promise((done) => setTimeout(done, 50));
    expect(document.querySelector(".speech")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
  });

  /**
   * Capturing while standing in a folder you made should land the note there
   * directly, not in the Inbox waiting for a manual Move.
   */
  it("files a note straight into the folder it was captured on", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await makeBoard("zzzcapturefolder");
    await goToBoard(/zzzcapturefolder/i);

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "captured straight into folder" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const cardBtn = () => screen.getByRole("button", { name: /captured straight into folder/i });
    // On its own board a filed note reads at full strength (not dimmed).
    await waitFor(() => expect(cardBtn().getAttribute("data-filed")).toBe("false"));

    // On All the same note now carries the filed mark — proof it was actually
    // filed, not left unfiled and only visible here by coincidence.
    await goToBoard(/^all/i);
    await waitFor(() => expect(cardBtn().getAttribute("data-filed")).toBe("true"));
  });

  /**
   * A capture whose card lands in front of you says nothing in words: the
   * card's own border trace and the mascot's nod are the receipt, and a line
   * under the bar there would be the redundant "Kept in …" pill that was
   * withdrawn (e72c850). Only where the card cannot be seen does the bar say
   * where it went — the owner's call of 2026-09-27.
   */
  it("says nothing in words about a capture that lands on screen", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await goToBoard(/^inbox/i);
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzcapturehere" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(await screen.findByRole("button", { name: /zzzcapturehere/i })).toBeTruthy();
    expect(document.querySelector(".capture-line")).toBeNull();
    expect(document.querySelector(".speech")).toBeNull();
  });

  /**
   * ...and on a lens it does. What the old pill stood for is still true — a
   * capture on a lens lands in the Inbox — and it is now said only in the case
   * the pill genuinely covered: Links is content-derived, so a note with no
   * address in it cannot appear there however it was written, and the card is
   * nowhere the eye can check. The line names the Inbox and goes there.
   */
  it("captures on a lens into the Inbox, and says so with a way there", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await goToBoard(/^links/i);
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzcapturelens" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // Waited for longer than the default second: under the deploy's full-suite
    // load on the server this line once took longer to arrive (2026-10-14).
    const line = await waitFor(
      () => {
        // Said by the header's creature now (2026-10-16), not the bar.
        const found = document.querySelector<HTMLElement>(".topbar .speech");
        expect(found).toBeTruthy();
        return found!;
      },
      { timeout: 5_000 },
    );
    expect(line.textContent).toMatch(/Tucked into Inbox/);
    // A receipt, not an undo: nothing offered to take back, no countdown.
    expect(line.querySelector(".speech-clock")).toBeNull();

    // The trace is mounted only while it plays, so on a loaded machine a poll
    // can fall between its start and its end and never see it. Record it as
    // it is inserted instead (it once failed the deploy that way, 2026-10-14).
    let traced = false;
    const watch = new MutationObserver((records) => {
      for (const r of records)
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          // The trace may arrive on its own, or inside the card arriving with it.
          const trace = n.matches(".trace") ? n : n.querySelector(".trace");
          if (trace && /zzzcapturelens/i.test(trace.closest(".card")?.textContent ?? "")) traced = true;
        }
    });
    watch.observe(document.body, { childList: true, subtree: true });
    fireEvent.click(within(line).getByRole("button", { name: /^Go/ }));
    await waitFor(() => expect(boardName()).toMatch(/^inbox/i), { timeout: 5_000 });
    await screen.findByRole("button", { name: /zzzcapturelens/i }, { timeout: 5_000 });
    // Traced on arrival, so it is found without reading the board.
    await waitFor(() => expect(traced).toBe(true), { timeout: 5_000, interval: 10 });
    watch.disconnect();
    await waitFor(() => expect(document.querySelector(".topbar .speech")).toBeNull());
  });

  /**
   * The Delete key used to be a second, shorter copy of the trash path: it set
   * the mark and the status by hand and never ran the idea bookkeeping. A note
   * merged into an idea is archived, and the Archive board does not filter
   * those out — so it is an ordinary card there, and deleting it with the
   * keyboard left the canvas holding an item pointing at a note in the bin.
   */
  it("deleting an idea's note with the Delete key takes it out of the idea too", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));
    const plainCards = () => cards().filter((c) => c.dataset.idea !== "true");
    const spatialNotes = () => document.querySelectorAll<HTMLElement>(".spatial-note");

    fireEvent.contextMenu(plainCards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    const sourceId = plainCards()[1].dataset.id!;
    fireEvent.click(plainCards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));

    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    expect(spatialNotes()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close idea" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull(),
    );

    // The sources are archived by the merge, so that is where the card is.
    await goToBoard(/^archive/i);
    const card = await waitFor(() => {
      const found = cards().find((c) => c.dataset.id === sourceId);
      expect(found).toBeTruthy();
      return found!;
    });
    card.focus();
    fireEvent.keyDown(window, { key: "Delete" });

    // Reopen the idea: it holds one note, not two with one of them in the bin.
    await goToBoard(/^all/i);
    const ideaCard = await waitFor(() => {
      const found = cards().find((c) => c.dataset.idea === "true");
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(ideaCard);
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      // The canvas is a lazy chunk; a loaded machine takes longer than a second.
      timeout: 10_000,
    });
    await waitFor(() => expect(spatialNotes()).toHaveLength(1));
  });

  /**
   * Capturing while standing on Todos should mark the note as a to-do right
   * away, the same shortcut a folder gets.
   */
  it("marks a note captured on the Todos board as a to-do", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    await goToBoard(/^todos/i);

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "captured as a todo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getByRole("button", { name: /captured as a todo/i }));
    expect(await screen.findByRole("button", { name: "To-do", pressed: true })).toBeTruthy();
  });

  /**
   * The Todo-toggle and the Todos board, end to end, on the notes the fault was
   * about: a list nobody typed as a todo, which is on the board by its own text.
   *
   * The mark used to read the raw field, so it drew *off* about a note sitting
   * on Todos, and pressing it flipped the label and moved nothing — twice over.
   * Now it reads membership, and turning it off writes the opt-out that makes
   * *"this list is not a to-do list"* sayable, so the note actually leaves.
   *
   * A checklist card carries no words in its accessible name (its face draws the
   * items, and `face.body` is empty), so it is found by its text like the idea
   * cards elsewhere in this file rather than by role and name.
   */
  it("takes a checklist off Todos when the toggle is turned off, and puts it back", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "[ ] zzzalbumone\n[ ] zzzalbumtwo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // Case-insensitively, because `capitalizeCapture` opens every capture with
    // a capital and the first item is where the words go in.
    const listCard = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".card")).find((c) =>
        /zzzalbumone/i.test(c.textContent ?? ""),
      );

    // Nobody said it was a todo. Its own tick boxes did.
    await goToBoard(/^todos/i);
    await waitFor(() => expect(listCard()).toBeTruthy());

    // So the mark draws on, and turning it off takes the note off the board.
    fireEvent.click(listCard()!);
    fireEvent.click(await screen.findByRole("button", { name: "To-do", pressed: true }));
    expect(await screen.findByRole("button", { name: "To-do", pressed: false })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await waitFor(() => expect(listCard()).toBeFalsy());

    // The note is not lost, only unfiled from Todos — it is still on All, and
    // saying it is one after all puts it straight back.
    await goToBoard(/^all/i);
    await waitFor(() => expect(listCard()).toBeTruthy());
    fireEvent.click(listCard()!);
    fireEvent.click(await screen.findByRole("button", { name: "To-do", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "Close note" }));
    await goToBoard(/^todos/i);
    await waitFor(() => expect(listCard()).toBeTruthy());
  });

  /**
   * The selection panel's row is the same toggle said to many notes at once, so
   * it has to ask the same question: a selection of checklists must not report
   * "none of these are todos" while each note reports the opposite about itself.
   */
  it("shows the selection row already on for a checklist nobody typed", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "[ ] zzzpacksocks\n[ ] zzzpackboots" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // A checklist is a to-do, so it lands on the Todos board, not in the Inbox.
    await goToBoard(/^todos/i);

    const listCard = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".card")).find((c) =>
        /zzzpacksocks/i.test(c.textContent ?? ""),
      );
    await waitFor(() => expect(listCard()).toBeTruthy());

    fireEvent.contextMenu(listCard()!);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    openSelection();
    expect(screen.getByRole("button", { name: "To-do", pressed: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "To-do", pressed: false })).toBeNull();
  });

  /**
   * The mascot belongs to an empty *place*, not to an empty *result*. A board
   * with nothing filed in it is somewhere you have arrived; a search that found
   * nothing is a mode you are in while still standing on the board underneath
   * it, and drawing a sleeping machine over that says the wrong thing. Either
   * way the words are unchanged — the drawing joins them, never replaces them.
   */
  it("draws the mascot on an empty board and not on a search with no matches", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    // A board just made is the one board guaranteed to be empty.
    await makeBoard("zzzmascottest");
    await goToBoard(/zzzmascottest/i);

    // Headed with the folder's own name (review UI-28).
    await waitFor(() => expect(document.querySelector(".empty strong")?.textContent).toBe("zzzmascottest"));
    expect(document.querySelector(".empty spar-mascot")).toBeTruthy();
    // One creature on screen, not two: while the board draws it asleep the
    // header's is away — the same node, its box kept, out of reach.
    const header = document.querySelector(".topbar spar-mascot")!;
    expect(header.hasAttribute("away")).toBe(true);
    expect(header.hasAttribute("tabindex")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "qwxzvbnmqwxzvbnm" },
    });

    await waitFor(() => expect(screen.getByText("No matches")).toBeTruthy());
    // One word has no fewer words to try (review UX-27).
    expect(document.querySelector(".empty")?.textContent).toContain("Try a shorter form of the word.");
    expect(document.querySelector(".empty spar-mascot")).toBeNull();
    // The header's is a different instance and is not part of this rule — it
    // is there in every mode, including this one, and with the board's gone it
    // is back home.
    expect(document.querySelector(".topbar spar-mascot")).toBe(header);
    await waitFor(() => expect(header.hasAttribute("away")).toBe(false));
    expect(header.getAttribute("tabindex")).toBe("0");
  });

  /**
   * The header's mascot is a running animation, and the one thing that would
   * ruin it is being torn down and rebuilt: the breathing would restart from
   * zero, visibly, every time the board changed under it. So it is rendered
   * above everything that moves, and this holds the *identical DOM node*
   * across a board change, a search and a note opening — not merely "one is
   * present afterwards", which a remount would also satisfy.
   */
  it("keeps one and the same mascot in the header across the whole session", async () => {
    render(<App />);
    await waitFor(() =>
      expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    );

    const mascot = document.querySelector(".topbar spar-mascot");
    expect(mascot).toBeTruthy();
    // Pokeable, so it is reachable and named rather than hidden. The live
    // region beside it is still the one that *announces* the state — a label
    // that changes on something which is not live is not reliably spoken.
    expect(mascot!.getAttribute("role")).toBe("img");
    expect(mascot!.getAttribute("tabindex")).toBe("0");
    expect(mascot!.hasAttribute("aria-hidden")).toBe(false);
    expect(document.querySelector('.topbar [role="status"]')).toBeTruthy();

    await goToBoard(/^all/i);
    await waitFor(() => expect(document.querySelector(".topbar spar-mascot")).toBe(mascot));

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "qwxzvbnmqwxzvbnm" },
    });
    await waitFor(() => expect(screen.getByText("No matches")).toBeTruthy());
    expect(document.querySelector(".topbar spar-mascot")).toBe(mascot);
  });
});

/**
 * The grid answers the arrows and Delete, and it has to stand down for
 * anything the app has put over it.
 *
 * It used to keep a list of its own — the open note, the menu, search — and so
 * it stayed live under the idea canvas, the board menu, the drawer, the Sorter
 * and a confirm dialog. The dialog is the one that mattered: `Dialog` traps
 * Tab but not the arrows, so one arrow key moved the focus out of a modal on
 * to a card behind the scrim, and Delete then sent that card to the trash
 * while the app was still asking whether to destroy something else.
 *
 * There is now one list of what covers the grid (`gridCovered` in App.tsx) and
 * `layerOpen` is derived from it, so the two can no longer drift. Multi-select
 * stays the one deliberate exception, which the second test here pins.
 */
describe("the grid's keyboard, under a layer", () => {
  async function boardIsUp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  it("does not let an arrow key walk out of a confirm dialog on to a card", async () => {
    await boardIsUp();
    await makeBoard("zzzguardtest");

    fireEvent.contextMenu(await screen.findByRole("tab", { name: /zzzguardtest/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog", { name: /Delete .zzzguardtest./ });

    // The dialog holds the focus. Which button it opens on is `Dialog`'s own
    // rule and not what is being tested here.
    expect(dialog.contains(document.activeElement)).toBe(true);

    for (const key of ["ArrowDown", "ArrowRight", "Home", "End"]) {
      fireEvent.keyDown(document.activeElement!, { key });
    }

    // Still inside the question, and never on a card underneath it.
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).closest(".card")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: /Delete .zzzguardtest./ })).toBeNull(),
    );
  });

  it("still answers the arrows once nothing is over the grid", async () => {
    await boardIsUp();

    // Nothing open: the first arrow picks up the first card rather than doing
    // nothing and making you wonder whether the keys work at all.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() =>
      expect((document.activeElement as HTMLElement)?.classList.contains("card")).toBe(true),
    );
  });

  /**
   * Multi-select is the one layer that leaves the grid on screen and in
   * charge, and it is the reason the guard reads `gridCovered` rather than
   * `layerOpen`. Delete with a selection is the key you reach for once you
   * have picked out a note or five.
   */
  it("keeps answering Delete while a selection is up", async () => {
    await boardIsUp();

    const input = screen.getByLabelText("Write a note");
    fireEvent.change(input, { target: { value: "zzzselectiondelete" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    const card = await screen.findByRole("button", { name: /zzzselectiondelete/i });
    fireEvent.contextMenu(card);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    fireEvent.keyDown(window, { key: "Delete" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /zzzselectiondelete/i })).toBeNull(),
    );
  });
});

/**
 * Reminders — a mode, not a board.
 *
 * `reminder_at` was written from one place and read in two (a mark in a card's
 * footer and the open note), so there was no way to answer "what am I being
 * reminded about" short of scrolling a board and spotting marks. This is the
 * screen that answers it, and it is search's shape rather than an eighth row
 * on the shelf: a reminder is a *time*, and a time is not a place a note lives.
 *
 * **These run in order and the first one depends on it.** The store is shared
 * by every test in this file, nothing before this point sets a reminder, and
 * the empty state can therefore only be reached before the listing test puts
 * three into it. The first test asserts that emptiness out loud before relying
 * on it, so if that ever stops being true it fails saying so.
 */
describe("the Reminders mode", () => {
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();

  async function boardIsUp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  async function openReminders() {
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reminders/ }));
    await screen.findByText("Reminders", { selector: ".board-mode" });
  }

  const count = () => document.querySelector(".count")?.textContent ?? "";
  const cardIds = () =>
    [...document.querySelectorAll<HTMLElement>(".grid .card")].map((c) => c.dataset.id);

  async function seed(rows: Array<[string, string | null, Note["status"]]>) {
    for (const [id, reminder_at, status] of rows) {
      await putNote({
        id,
        raw_content: id,
        body: id,
        source: "web",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        note_type: null,
        board_id: null,
        status,
        priority: 0,
        reminder_at,
        done: null,
        merged_from: null,
        keep_id: null,
        attachments: [],
      });
    }
  }

  /**
   * The board is one tab stop, not four hundred.
   *
   * Every card is a real button, so a board of 401 notes put 401 stops between
   * the board row and the capture bar. The strip beside it has always used a
   * roving tabindex and `useGridKeyboard` has always owned the arrows; this is
   * the half that was missing.
   */
  it("hands the keyboard one card, and follows the card that takes focus", async () => {
    await seed([
      ["rove-a", null, "active"],
      ["rove-b", null, "active"],
      ["rove-c", null, "active"],
    ]);
    render(<App />);
    await screen.findByText("rove-a");

    const stops = () =>
      [...document.querySelectorAll<HTMLElement>(".grid .card[data-id]")].filter(
        (el) => el.tabIndex === 0,
      );
    expect(stops()).toHaveLength(1);

    // Focus anywhere in the grid moves the one stop onto that card, so Tab
    // returns to where the reader last was rather than to the top of the board.
    const other = document.querySelector<HTMLElement>('.grid .card[data-id="rove-b"]')!;
    fireEvent.focus(other, { bubbles: true });
    await waitFor(() => expect(stops()[0]?.dataset.id).toBe("rove-b"));
    expect(stops()).toHaveLength(1);
  });

  /**
   * An empty reminders list is the normal state and not a failure, so it says
   * something true and calm — and it draws **no mascot**. An empty board is a
   * place you have arrived at and the creature belongs to the place; a mode is
   * not a place, which is the distinction search's own empty state already
   * makes.
   */
  it("says something calm when nothing is waiting, and draws no mascot", async () => {
    await boardIsUp();

    // The premise, asserted rather than assumed: nothing before this test in
    // this file has ever set a reminder.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(
      (await screen.findByRole("menuitem", { name: /^Reminders/ })).textContent,
    ).toContain("0");
    fireEvent.click(screen.getByRole("menuitem", { name: /^Reminders/ }));
    await screen.findByText("Reminders", { selector: ".board-mode" });

    expect(screen.getByText("No reminders")).toBeTruthy();
    expect(
      screen.getByText("Nothing waiting. Set one in a note."),
    ).toBeTruthy();
    expect(document.querySelector(".empty spar-mascot")).toBeNull();
    expect(count()).toBe("0 reminders");
  });

  it("lists what is waiting, overdue first, and leaves the trash out of it", async () => {
    await seed([
      ["zzzremlater", at(8 * 86_400_000), "active"],
      ["zzzremoverdue", at(-2 * 86_400_000), "active"],
      ["zzzremsoon", at(3_600_000), "active"],
      ["zzzremtrashed", at(3_600_000), "trashed"],
      ["zzzremnone", null, "active"],
    ]);
    await boardIsUp();
    await openReminders();

    // One ascending timeline: the overdue one is at the top because a past
    // instant is smaller than a future one, not because of a second rule.
    expect(cardIds()).toEqual(["zzzremoverdue", "zzzremsoon", "zzzremlater"]);
    // A trashed note is on its way out and is not something to be reminded
    // about; a note with no reminder was never in this list to begin with.
    expect(cardIds()).not.toContain("zzzremtrashed");
    expect(cardIds()).not.toContain("zzzremnone");
    // The header says what the mode is showing, in place of the board's own
    // bare count, exactly as a search does.
    expect(count()).toBe("3 reminders");
  });

  /**
   * It borrows the board row the way search does and gives it back, and the
   * one mark at the end of that row is the way out — the only visible one on a
   * desktop, where there is no back gesture under the thumb.
   */
  it("gives the shelf back when the row's own mark closes it", async () => {
    await boardIsUp();
    await openReminders();

    // The shelf is not what is under your hands while a mode runs.
    expect(document.querySelector("div.boards")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Close reminders" }));
    await waitFor(() => expect(document.querySelector(".board-mode")).toBeNull());
    // Back on a board, so the corner falls silent again — the count belongs to
    // the mode, not to the place underneath it.
    expect(count()).toBe("");
    expect(document.querySelector("div.boards")).toBeTruthy();
  });

  // Back closes whatever is on top of the grid rather than walking out of the
  // app, and a mode counts — `layerOpen` has to know about it even though it
  // covers nothing.
  it("closes on Back", async () => {
    await boardIsUp();
    await openReminders();

    fireEvent.popState(window, { state: null });
    await waitFor(() => expect(document.querySelector(".board-mode")).toBeNull());
    expect(count()).toBe("");
  });

  /**
   * A mode is a layer over the board, not a place you are standing, so the
   * filing shortcut must not run against the folder underneath it. Capturing
   * with the Reminders list open lands the note in the Inbox, not in the
   * folder that was on screen behind it.
   */
  it("does not file into the folder underneath while a mode has the grid", async () => {
    await boardIsUp();
    await makeBoard("zzzmodefolder");
    await goToBoard(/zzzmodefolder/i);
    await openReminders();

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzremcapture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getByRole("button", { name: "Close reminders" }));
    await waitFor(() => expect(document.querySelector(".board-mode")).toBeNull());

    // Not filed into the folder the mode was covering: it went to the Inbox.
    await goToBoard(/^inbox/i);
    expect(await screen.findByRole("button", { name: /zzzremcapture/i })).toBeTruthy();
  });
});

/**
 * Escape is one rule: it closes the topmost open layer regardless of which
 * element has focus. It did in nine places and in two it did nothing — the
 * capture bar's Add panel, whose state lived inside the bar where the form's
 * key handler only knew the board chooser, and search when focus was on the
 * ✕ beside the field rather than in it (2026-09-04 audit, F5). Both now go
 * through the app's one listener, in `dismissLayer`'s order. The key is sent
 * to whatever has focus — the body, the ✕ — never to the layer's own field,
 * because the field's handler was never the one that was missing.
 */
describe("Escape closes the top layer from wherever focus is", () => {
  async function boardIsUp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  it("closes the capture bar's Add panel with focus nowhere in particular", async () => {
    await boardIsUp();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("menu", { name: "Add" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Add" })).toBeNull();
  });

  it("closes search from the ✕ beside the field", async () => {
    await boardIsUp();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Search notes");
    const close = screen.getByRole("button", { name: "Close search" });
    close.focus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByLabelText("Search notes")).toBeNull();
  });

  it("closes the Reminders mode, the other thing that takes the board row", async () => {
    await boardIsUp();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Reminders/ }));
    await screen.findByText("Reminders", { selector: ".board-mode" });
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByText("Reminders", { selector: ".board-mode" })).toBeNull();
  });

  it("closes the Add panel first when it stands over search", async () => {
    await boardIsUp();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByLabelText("Search notes");
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Add" })).toBeNull();
    expect(screen.getByLabelText("Search notes")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByLabelText("Search notes")).toBeNull();
  });
});

/** The next frame, by which the history entry Back took has been put back. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("Back and a selection, with a mode underneath", () => {
  async function boardIsUp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  /**
   * `dismissLayer` answers false for "that layer closed", which says nothing
   * about what was under it. The hook trusted the answer alone and put no entry
   * back, so the second Back walked out of the app with search still open.
   */
  it("keeps the history entry while search is still open under a cleared selection", async () => {
    await boardIsUp();
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzbacktwice" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "zzzbacktwice" },
    });
    fireEvent.contextMenu(await screen.findByRole("button", { name: /zzzbacktwice/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());

    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());
    expect(screen.getByLabelText("Search notes")).toBeTruthy();
    await nextFrame();
    expect((window.history.state as { spar?: string } | null)?.spar).toBe("layer");

    // The second Back is heard, and it closes search rather than the app.
    fireEvent.popState(window);
    await waitFor(() => expect(screen.queryByLabelText("Search notes")).toBeNull());
  });

  /**
   * Search an archived note, pick it, ✕ ✕, Delete — and the note on no screen
   * went to the trash. A selection is never wider than what is on screen, and
   * it does not outlive the mode it was made in.
   */
  it("lets a selection go when its notes leave the screen, and when the mode closes", async () => {
    await putNote({
      id: "zzzprune-archived",
      raw_content: "zzzprune archived",
      body: "zzzprune archived",
      source: "web",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      note_type: null,
      board_id: null,
      status: "archived",
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    });
    await boardIsUp();
    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzprune inbox" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = await screen.findByLabelText("Search notes");
    fireEvent.change(field, { target: { value: "zzzprune" } });

    // The archived one is only on screen while the query holds it.
    fireEvent.contextMenu(await screen.findByRole("button", { name: /zzzprune archived/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());

    // One that is still on the board underneath survives the query clearing,
    // and goes with the mode.
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "zzzprune" } });
    fireEvent.contextMenu(await screen.findByRole("button", { name: /zzzprune inbox/i }));
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByText(/1 selected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    await waitFor(() => expect(screen.queryByText(/1 selected/)).toBeNull());
  });
});

/**
 * The collection end to end: what the phone's share sheet parked becomes one
 * note, traced like any other capture, and the parking space is emptied only
 * once that note exists.
 */
describe("a share that arrives", () => {
  const traced = () => document.querySelector(".card .trace")?.closest(".card")?.textContent ?? "";

  // 2026-10-10, owner approved, audit SEC-1: any website can post to /share,
  // so a share carrying files waits for one tap instead of saving itself.
  it("holds pictures and their words for one tap, then lands them as one note, traced", async () => {
    const photo = new File(["not really a png"], "zzzshared.png", { type: "image/png" });
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({
      files: [photo],
      text: "zzzsharedphoto words",
      commit,
    });

    render(<App />);
    const save = await screen.findByRole("button", { name: "Save: 1 picture shared" }, { timeout: 10_000 });
    // Nothing is made, and nothing is spent, before the tap.
    await new Promise((done) => setTimeout(done, 50));
    expect((await allNotes()).filter((n) => /zzzsharedphoto words/i.test(n.body))).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();

    // A double tap is one answer, not two notes.
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(traced()).toMatch(/zzzsharedphoto words/i), { timeout: 10_000 });
    const made = (await allNotes()).filter((n) => /zzzsharedphoto words/i.test(n.body));
    expect(made).toHaveLength(1);
    expect(made[0].attachments.map((a) => a.name)).toEqual(["zzzshared.png"]);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  it("lets a held share of files go without making anything", async () => {
    const photo = new File(["not really a png"], "zzzunwanted.png", { type: "image/png" });
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({ files: [photo, photo], text: "", commit });

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Discard: 2 pictures shared" }, { timeout: 10_000 }),
    );
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".capture-line")).toBeNull();
    expect((await allNotes()).filter((n) => n.attachments?.some((a) => a.name === "zzzunwanted.png"))).toHaveLength(0);
  });

  it("names the files the worker left out at the door", async () => {
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({
      files: [],
      text: "",
      left: { names: [{ name: "zzzhuge.mov", size: 300 * 1024 * 1024 }], count: 3 },
      commit,
    });

    render(<App />);
    expect(await screen.findByText("Some shared files were not added", {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByText(/zzzhuge\.mov/)).toBeTruthy();
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  // Review 2026-10-04, FX-A-02: words alone wait in the write field, unsaved,
  // under a blank first line holding the caret; one press saves them.
  it("puts words alone in the write field unsaved, and clears the worker's signal", async () => {
    window.history.replaceState({}, "", "/?shared=1");
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({ files: [], text: "zzzsharedpage words", commit });

    render(<App />);
    const field = await screen.findByLabelText<HTMLTextAreaElement>("Write a note", {}, { timeout: 10_000 });
    await waitFor(() => expect(field.value).toBe("\nzzzsharedpage words"), { timeout: 10_000 });
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect((await allNotes()).filter((n) => /zzzsharedpage words/i.test(n.body))).toHaveLength(0);
    expect(window.location.search).toBe("");

    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(traced()).toMatch(/zzzsharedpage words/i), { timeout: 10_000 });
    expect((await allNotes()).filter((n) => /zzzsharedpage words/i.test(n.body))).toHaveLength(1);
  });
});

describe("a share that is refused", () => {
  it("is spent when every file is over the limit, so the dialog does not come back", async () => {
    const tooBig = new File(["x"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(tooBig, "size", { value: MAX_FILE_BYTES + 1 });
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({ files: [tooBig], text: "", commit });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Save: 1 file shared" }, { timeout: 10_000 }));
    expect(await screen.findByText("Files over the limit were not added", {}, { timeout: 10_000 })).toBeTruthy();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
  });

  /**
   * A folder arrives as a `File` with no type and no bytes. Only the window's
   * drop refused it; a share, a paste and the open note's picker made a note
   * that could never open or upload.
   */
  it("keeps the words and leaves a folder out of the note", async () => {
    const folder = new File([], "Holiday photos");
    const commit = vi.fn(async () => {});
    vi.mocked(takeShared).mockResolvedValueOnce({
      files: [folder],
      text: "zzzsharedfolder words",
      commit,
    });

    render(<App />);
    // With nothing left to attach, the words are a share of words alone, and
    // wait in the write field like one (review 2026-10-04, FX-A-02).
    const field = await screen.findByLabelText<HTMLTextAreaElement>("Write a note", {}, { timeout: 10_000 });
    await waitFor(() => expect(field.value).toBe("\nzzzsharedfolder words"), { timeout: 10_000 });
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(
      async () => {
        // A capture's first letter is capitalised on the way in.
        const made = (await allNotes()).find((n) => /^zzzsharedfolder words$/i.test(n.body));
        expect(made).toBeTruthy();
        expect(made!.attachments).toHaveLength(0);
      },
      { timeout: 10_000 },
    );
  });
});

/**
 * The drawer is phone-only, so these put the app on a phone the way
 * `components/Shelf.test.tsx` does: jsdom has no `matchMedia`, and the
 * breakpoint falls back to the width.
 */
describe("the phone's drawer, over the rest of the app", () => {
  const desktopWidth = window.innerWidth;
  beforeEach(() => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
  });
  afterEach(() => {
    window.innerWidth = desktopWidth;
  });

  async function boardIsUp() {
    render(<App />);
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );
  }

  it("closes on Escape with the focus on nothing in particular", async () => {
    await boardIsUp();
    fireEvent.click(screen.getByRole("button", { name: /^boards/i }));
    expect(screen.getByRole("tablist", { name: "Boards" })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "Boards" })).toBeNull());
  });

  /**
   * A note opened from a canvas, the drawer opened from that note, a board
   * chosen: the note closed, and the full-screen canvas stayed over the board.
   */
  it("closes the canvas under a note when a board is chosen from the note's drawer", async () => {
    await boardIsUp();
    const plain = () =>
      [...document.querySelectorAll<HTMLElement>(".card")].filter((c) => c.dataset.idea !== "true");

    fireEvent.contextMenu(plain()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(plain()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
    await screen.findByRole("dialog", { name: "Idea canvas" });

    fireEvent.contextMenu(document.querySelector<HTMLElement>(".spatial-note")!, {
      clientX: 40,
      clientY: 40,
    });
    fireEvent.click(
      within(document.querySelector<HTMLElement>(".ctx-menu")!).getByRole("menuitem", {
        name: "Open note",
      }),
    );
    const sheet = await screen.findByRole("dialog", { name: "Note" });

    fireEvent.click(within(sheet).getByRole("button", { name: "Boards" }));
    const shelf = await screen.findByRole("tablist", { name: "Boards" });
    fireEvent.click(within(shelf).getByRole("tab", { name: /^all/i }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull());
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
  });
});

/**
 * Untick all from inside the open note, and its undo from inside it too. The
 * board closes the open note whenever a reversal happens (merge's undo needs
 * that), so an offer made in the note has to stand over it and has to leave it
 * standing when pressed — `inPlace` on the entry.
 */
describe("a list rewritten from the open note", () => {
  it("offers the undo over the note and puts the ticks back without closing it", async () => {
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "[x] quince\n[ ] medlar" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    // Two boxes make a checklist, which Todos shows whatever board the app
    // happened to reopen on.
    await goToBoard(/^todos/i);
    const card = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".card[data-id]")].find((c) =>
        (c.textContent ?? "").includes("quince"),
      );
      expect(found).toBeTruthy();
      return found!;
    });
    fireEvent.click(card);
    const sheet = await screen.findByRole("dialog", { name: "Note" });

    fireEvent.click(within(sheet).getByRole("button", { name: "Untick all" }));
    await waitFor(() => expect(sheet.textContent).toContain("[ ] quince"));

    const undo = await screen.findByRole("button", { name: "Undo: Unticked 1" });
    expect(undo.closest(".undo-slot-over")).toBeTruthy();
    fireEvent.click(undo);

    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Note" }).textContent).toContain("[x] quince"),
    );
    expect(screen.getByRole("dialog", { name: "Note" })).toBeTruthy();
  });
});
