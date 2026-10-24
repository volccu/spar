// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionBar } from "./SelectionBar";
import type { UserBoard } from "../types";

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

/** A machine with a mouse, and so with a keyboard. jsdom answers no media
 *  query at all, which every hint in the app reads as "no key to press". */
function stubKeyboard() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: hover) and (pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function noop() {}

function renderBar(
  props: Partial<{
    count: number;
    anyArchived: boolean;
    allTodo: boolean;
    allPriority: boolean;
    inTrash: boolean;
    moving: boolean;
    anyFiled: boolean;
    anyReminder: boolean;
    onClearReminder: () => void;
    boards: UserBoard[];
    onSelectAll: () => void;
    onMoveUnfile: () => void;
    onMoveOpen: () => void;
    onArchive: () => void;
    onPriority: () => void;
    onDelete: () => void;
    onCancel: () => void;
    onClose: () => void;
  }> = {},
) {
  return render(
    <SelectionBar
      count={props.count ?? 2}
      anyArchived={props.anyArchived ?? false}
      allTodo={props.allTodo ?? false}
      allPriority={props.allPriority ?? false}
      anyReminder={props.anyReminder ?? false}
      inTrash={props.inTrash ?? false}
      moving={props.moving ?? false}
      anyFiled={props.anyFiled ?? false}
      boards={props.boards ?? []}
      countFor={() => 0}
      moveError={null}
      onMoveOpen={props.onMoveOpen ?? noop}
      onMoveCancel={noop}
      onMoveChoose={noop}
      onMoveCreate={noop}
      onMoveUnfile={props.onMoveUnfile ?? noop}
      onSelectAll={props.onSelectAll ?? noop}
      onCopy={noop}
      onMerge={noop}
      onPriority={props.onPriority ?? noop}
      onTodo={noop}
      onClearReminder={props.onClearReminder ?? noop}
      onArchive={props.onArchive ?? noop}
      onDelete={props.onDelete ?? noop}
      onRestore={noop}
      onCancel={props.onCancel ?? noop}
      onClose={props.onClose ?? noop}
    />,
  );
}

const rows = () =>
  within(screen.getByRole("group", { name: "Selected notes" }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));

describe("the selection panel's rows", () => {
  /**
   * Every row prints its word, and the same string is the hover title — one
   * source, three readings, nothing to drift. The strip that dropped the
   * printed word is gone; this is what remains of the reason for `announce`.
   */
  it("prints every verb, and names it the same way for a pointer", () => {
    renderBar({ count: 3 });
    const panel = screen.getByRole("group", { name: "Selected notes" });
    const verbs = within(panel).getAllByRole("button").filter((b) => b.classList.contains("selpanel-btn"));
    expect(verbs.length).toBe(8);
    for (const verb of verbs) {
      const printed = verb.querySelector(".selpanel-label")?.textContent ?? "";
      expect(printed, "every verb prints its own name").not.toBe("");
      expect(verb.getAttribute("title")).toBe(printed);
    }
    for (const name of [
      "Cancel",
      "Select all",
      "Copy",
      "Important",
      "To-do",
      "Merge 3",
      "Delete",
      "Archive",
      "Move",
    ]) {
      expect(within(panel).getByRole("button", { name })).toBeTruthy();
    }
  });

  /** Review 2026-10-24, UX-14: Clear reminder stands beside To-do, and only while a picked note has one. */
  it("offers Clear reminder after To-do only when a picked note has a reminder", () => {
    renderBar({ count: 3 });
    expect(rows()).not.toContain("Clear reminder");
    cleanup();
    const onClearReminder = vi.fn();
    renderBar({ count: 3, anyReminder: true, onClearReminder });
    const all = rows();
    expect(all.indexOf("Clear reminder")).toBe(all.indexOf("To-do") + 1);
    fireEvent.click(screen.getByRole("button", { name: "Clear reminder" }));
    expect(onClearReminder).toHaveBeenCalledOnce();
  });

  it("keeps one name for the flag and says it is on once every picked note carries it", () => {
    renderBar({ allPriority: true });
    const panel = screen.getByRole("group", { name: "Selected notes" });
    const flag = within(panel).getByRole("button", { name: "Important" });
    expect(flag.getAttribute("aria-pressed")).toBe("true");
    expect(within(panel).getByRole("button", { name: "To-do" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  /**
   * The menu the same burger opens has always walked by arrow; this panel
   * was Tab-only. It takes focus itself on opening — not its first row,
   * which is Select all — and the arrows, Home and End walk the rows.
   */
  it("is walked by the arrow keys, starting from the panel itself", () => {
    renderBar({ count: 3 });
    const panel = screen.getByRole("group", { name: "Selected notes" });
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Select all" }));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Copy" }));
    fireEvent.keyDown(panel, { key: "End" });
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Move" }));
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(panel).getByRole("button", { name: "Select all" }));
  });

  /**
   * The order *is* the design: read by distance from the thumb, the bottom
   * of the column nearest. Past the one hairline sit the three verbs that
   * change where a note is, Move closest of all; Select all is furthest,
   * because a stray tap there throws away the selection picked by hand and
   * looks like a success.
   */
  it("puts the moving verbs nearest the thumb and Select all furthest", () => {
    renderBar({ count: 3 });
    const names = rows();
    expect(names[0]).toBe("Cancel");
    expect(names.slice(1, 3)).toEqual(["Select all", "Copy"]);
    expect(names.slice(-3)).toEqual(["Delete", "Archive", "Move"]);
    // The line is drawn above the first of those three and nowhere else.
    const split = document.querySelectorAll(".selpanel-split");
    expect(split.length).toBe(1);
    expect(split[0].getAttribute("aria-label")).toBe("Delete");
  });

  /**
   * The count is one line with Cancel as the cross at its end: the sentence
   * for the reader, the cross for the thumb, and one rule under both.
   */
  it("says the count on the first line, with Cancel as its cross", () => {
    const cancel = vi.fn();
    renderBar({ count: 4, onCancel: cancel });
    const head = document.querySelector(".selpanel-head");
    expect(head?.textContent).toMatch(/4 selected/);
    const x = within(head as HTMLElement).getByRole("button", { name: "Cancel" });
    fireEvent.click(x);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  /**
   * Tapping outside is the menu's own dismiss, reused: the panel goes, the
   * selection stays. Only the cross, or a verb, ends the selection.
   */
  it("closes on a tap outside without touching the selection", () => {
    const cancel = vi.fn();
    const close = vi.fn();
    renderBar({ count: 2, onCancel: cancel, onClose: close });
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  /**
   * Merge is the one row that can be unavailable, and it says why in its own
   * name rather than going dead.
   */
  it("keeps Merge's explanation in its name", () => {
    renderBar({ count: 1 });
    const merge = screen.getByRole("button", { name: "Pick 2 to merge" });
    expect((merge as HTMLButtonElement).disabled).toBe(true);
    expect(merge.getAttribute("title")).toBe("Pick 2 to merge");

    cleanup();
    renderBar({ count: 3 });
    expect((screen.getByRole("button", { name: "Merge 3" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  /**
   * The trash is a board like any other, and `visible` means the same thing
   * standing on it — so Ctrl+A works there. A key that works where the panel
   * offers nothing is a shortcut for whoever wrote it, so the trash's panel
   * carries the row too, in the same place; its two verbs sit past the line.
   */
  it("offers Select all in the trash as well, in the same place", () => {
    renderBar({ count: 2, inTrash: true });
    expect(rows()).toEqual(["Cancel", "Select all", "Delete for good", "Put back"]);
    expect(document.querySelector(".selpanel-split")?.getAttribute("aria-label")).toBe(
      "Delete for good",
    );
  });

  /**
   * The drawn `.kbd` box is `aria-hidden`, so it reaches no reader on its own;
   * and the row sets `announce`, which means an `aria-label` — and an
   * `aria-label` replaces the button's content rather than joining it, so
   * `Hotkey`'s own hidden words would be thrown away unread. The name is
   * therefore composed at the call site, exactly as `App.tsx` composes the
   * search field's, and only where there is a key to press.
   */
  it("says the shortcut in Select all's own name where there is a key to press", () => {
    stubKeyboard();
    renderBar({ count: 2 });
    expect(screen.getByRole("button", { name: "Select all, Ctrl+A" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ctrl A/ })).toBeNull();
    const caps = [
      ...screen.getByRole("button", { name: "Select all, Ctrl+A" }).querySelectorAll(".kbd-cap"),
    ].map((c) => c.textContent);
    expect(caps).toEqual(["Ctrl", "A"]);
    expect(
      screen.getByRole("button", { name: "Select all, Ctrl+A" }).getAttribute("title"),
    ).toBe("Select all");
  });

  /* Dogfooding 2026-10-18: the panel showed only "Ctrl A"; E, M, F and Delete
     worked on a selection with no word of it. */
  it("draws the grid's own keys beside Archive, Move, Important and Delete", () => {
    stubKeyboard();
    renderBar({ count: 2 });
    const capsOf = (name: string) =>
      [...screen.getByRole("button", { name }).querySelectorAll(".kbd-cap")].map((c) => c.textContent);
    expect(capsOf("Archive, E")).toEqual(["E"]);
    expect(capsOf("Move, M")).toEqual(["M"]);
    expect(capsOf("Important, F")).toEqual(["F"]);
    expect(capsOf("Delete, Delete")).toEqual(["Delete"]);
  });

  /* The box is `aria-hidden`, so the key reaches a reader only through the
     row's name, the way Select all's does; the hover title stays the word. */
  it("says each of those keys in its row's own name, where there is a key to press", () => {
    stubKeyboard();
    renderBar({ count: 2 });
    for (const [name, word] of [
      ["Archive, E", "Archive"],
      ["Move, M", "Move"],
      ["Important, F", "Important"],
      ["Delete, Delete", "Delete"],
    ]) {
      expect(screen.getByRole("button", { name }).getAttribute("title"), name).toBe(word);
    }
    cleanup();
    renderBar({ count: 2, anyArchived: true });
    expect(screen.getByRole("button", { name: "Unarchive, E" })).toBeTruthy();
    cleanup();
    renderBar({ count: 2, inTrash: true });
    expect(screen.getByRole("button", { name: "Delete for good, Delete" })).toBeTruthy();
  });

  it("names them plainly on a device with no keyboard", () => {
    renderBar({ count: 2 });
    for (const name of ["Archive", "Move", "Important", "Delete"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("draws none of them on a device with no keyboard", () => {
    renderBar({ count: 2 });
    expect(document.querySelectorAll(".selpanel .kbd")).toHaveLength(0);
  });

  it("names Select all plainly, and draws no box, on a device with no such key", () => {
    renderBar({ count: 2 });
    expect(screen.getByRole("button", { name: "Select all" })).toBeTruthy();
    expect(document.querySelector(".selpanel .kbd")).toBeNull();
  });

  it("hands the whole visible board over when Select all is tapped", () => {
    const picked = vi.fn();
    renderBar({ count: 2, onSelectAll: picked });
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(picked).toHaveBeenCalledTimes(1);
  });

  /** The strip is gone: no panel here lies down, and nothing is left that
   *  would lay it down. */
  it("is a column everywhere, and the chooser is the same column", () => {
    renderBar({ count: 2 });
    expect(document.querySelector(".selpanel-strip")).toBeNull();
    expect(document.querySelector(".selpanel-tally")).toBeNull();

    cleanup();
    renderBar({ count: 2, moving: true });
    const chooser = screen.getByRole("group", { name: "Move to a board" });
    expect(chooser.classList.contains("selpanel")).toBe(true);
  });
});

/**
 * The chooser's Inbox row, offered to a selection.
 *
 * It was refused to multi-select for as long as the row was called "Unfiled",
 * on the grounds that the word had no one honest thing to say about a mixed
 * selection. The row is the Inbox now — a destination like every other row in
 * the list — so the objection went with the word. Without it there is no way
 * to empty a folder back into the pile: the only other exit is deleting the
 * folder, which archives everything filed there.
 */
describe("moving a selection back to the Inbox", () => {
  const recipes: UserBoard = { id: "b1", name: "Recipes", position: 0 };

  it("offers the Inbox row when something in the selection is filed", () => {
    const unfile = vi.fn();
    renderBar({
      count: 3,
      moving: true,
      anyFiled: true,
      boards: [recipes],
      onMoveUnfile: unfile,
    });
    const chooser = screen.getByRole("group", { name: "Move to a board" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Inbox" }));
    expect(unfile).toHaveBeenCalledTimes(1);
  });

  it("leaves it out when nothing in the selection is on a board", () => {
    renderBar({ count: 3, moving: true, anyFiled: false, boards: [recipes] });
    const chooser = screen.getByRole("group", { name: "Move to a board" });
    expect(within(chooser).queryByRole("button", { name: "Inbox" })).toBeNull();
    expect(within(chooser).getByRole("button", { name: /Recipes/ })).toBeTruthy();
  });
});

/**
 * The keys drawn beside four rows answer while the panel is up. The grid
 * stands down under it (the panel is a layer that covers the board), so
 * without these the box said E and pressing E did nothing until the panel was
 * closed. Each key runs the very handler its row's click does.
 */
describe("the keys drawn beside the rows", () => {
  const handlers = () => ({
    onArchive: vi.fn(),
    onMoveOpen: vi.fn(),
    onPriority: vi.fn(),
    onDelete: vi.fn(),
  });
  const none = (h: ReturnType<typeof handlers>) =>
    expect([h.onArchive, h.onMoveOpen, h.onPriority, h.onDelete].map((f) => f.mock.calls.length)).toEqual([0, 0, 0, 0]);

  it("runs Archive on E, Move on M, Important on F and Delete on Delete or Backspace", () => {
    const h = handlers();
    renderBar({ count: 2, ...h });
    const panel = screen.getByRole("group", { name: "Selected notes" });
    fireEvent.keyDown(panel, { key: "e" });
    expect(h.onArchive).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: "m" });
    expect(h.onMoveOpen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: "f" });
    expect(h.onPriority).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(panel, { key: "Delete" });
    fireEvent.keyDown(panel, { key: "Backspace" });
    expect(h.onDelete).toHaveBeenCalledTimes(2);
    // Caps Lock does not hide one; the key need not be on the panel itself.
    fireEvent.keyDown(window, { key: "E" });
    expect(h.onArchive).toHaveBeenCalledTimes(2);
  });

  it("is the same E whether the row says Archive or Unarchive, and stops the browser's own", () => {
    const h = handlers();
    renderBar({ count: 2, anyArchived: true, ...h });
    expect(fireEvent.keyDown(window, { key: "e" })).toBe(false);
    expect(h.onArchive).toHaveBeenCalledTimes(1);
  });

  it("leaves a modified key, and Shift+letter, alone", () => {
    const h = handlers();
    renderBar({ count: 2, ...h });
    for (const mod of ["ctrlKey", "metaKey", "altKey"]) {
      for (const key of ["e", "m", "f", "Delete"]) fireEvent.keyDown(window, { key, [mod]: true });
    }
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    none(h);
  });

  it("leaves a key typed into a field alone", () => {
    const h = handlers();
    renderBar({ count: 2, ...h });
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    for (const key of ["e", "m", "f", "Delete", "Backspace"]) fireEvent.keyDown(field, { key });
    none(h);
    field.remove();
  });

  it("answers only Delete in the trash, where the panel offers nothing else", () => {
    const h = handlers();
    renderBar({ count: 2, inTrash: true, ...h });
    for (const key of ["e", "m", "f"]) fireEvent.keyDown(window, { key });
    none(h);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it("stands down while the Move chooser is up, and once the panel has gone", () => {
    const h = handlers();
    const { unmount } = renderBar({ count: 2, moving: true, ...h });
    for (const key of ["e", "m", "f", "Delete"]) fireEvent.keyDown(window, { key });
    none(h);
    unmount();
    renderBar({ count: 2, ...h }).unmount();
    fireEvent.keyDown(window, { key: "e" });
    none(h);
  });
});
