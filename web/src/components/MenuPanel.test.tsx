// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MenuPanel } from "./MenuPanel";

afterEach(cleanup);
afterEach(() => vi.unstubAllGlobals());

/** A machine with a mouse, and so with a keyboard. jsdom answers no media
 *  query at all, which the hint reads as "no key to press". */
function stubKeyboard() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: hover) and (pointer: fine)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function noop() {}

function renderPanel(props: {
  trashCount: number;
  inTrash: boolean;
  reminderCount?: number;
  onReminders?: () => void;
  onSettings?: () => void;
  onClose?: () => void;
}) {
  return render(
    <MenuPanel
      trashCount={props.trashCount}
      inTrash={props.inTrash}
      onSearch={noop}
      reminderCount={props.reminderCount ?? 0}
      onReminders={props.onReminders ?? noop}
      onTrash={noop}
      onEmptyTrash={noop}
      oldNotesOut={0}
      onBringOldNotesIn={noop}
      onSettings={props.onSettings ?? noop}
      onSampleNotes={noop}
      onClose={props.onClose ?? noop}
    />,
  );
}

const emptyTrash = { name: /^empty trash/i } as const;

describe("MenuPanel", () => {
  /** The demo's sample-notes row is the demo's alone: handed a loader in this
   *  build, it still draws nothing (review UX-A-03, `DEMO` folded away). */
  it("never offers the demo's sample notes outside the demo", () => {
    renderPanel({ trashCount: 0, inTrash: false });
    expect(screen.queryByRole("menuitem", { name: /sample notes/i })).toBeNull();
  });

  // Destroying notes is offered where the notes are, not on top of an
  // unrelated board — so the row is scoped to the Trash board, and an empty
  // trash still has nothing to empty.
  it("hides Empty trash on an ordinary board even when the trash has notes", () => {
    renderPanel({ trashCount: 3, inTrash: false });
    expect(screen.queryByRole("menuitem", emptyTrash)).toBeNull();
    expect(screen.getByRole("menuitem", { name: /^trash/i })).toBeTruthy();
  });

  it("shows Empty trash while viewing the trash with notes in it", () => {
    renderPanel({ trashCount: 3, inTrash: true });
    expect(screen.getByRole("menuitem", emptyTrash)).toBeTruthy();
  });

  it("hides Empty trash while viewing an empty trash", () => {
    renderPanel({ trashCount: 0, inTrash: true });
    expect(screen.queryByRole("menuitem", emptyTrash)).toBeNull();
  });

  /**
   * A reminder is a time, not a place a note lives, so the way to it is a menu
   * row and never an eighth board on the shelf. The count rides in the row for
   * the reason the Trash row's does: the commonest answer to "what am I being
   * reminded about" is *none*, and that answer costs nothing to give here.
   */
  it("offers Reminders with its count, and says none as a number rather than by hiding", () => {
    const onReminders = vi.fn();
    renderPanel({ trashCount: 0, inTrash: false, reminderCount: 3, onReminders });
    const row = screen.getByRole("menuitem", { name: /^Reminders/ });
    expect(row.textContent).toContain("3");
    fireEvent.click(row);
    expect(onReminders).toHaveBeenCalledTimes(1);

    cleanup();
    renderPanel({ trashCount: 0, inTrash: false, reminderCount: 0 });
    expect(screen.getByRole("menuitem", { name: /^Reminders/ }).textContent).toContain("0");
  });

  /**
   * Settings took over About, both imports and the account (2026-10-11, owner
   * approved): each is done once or twice in the life of the app, so the one
   * row that holds them sits furthest from the thumb.
   */
  it("offers Settings first, furthest from the thumb, and opens it", () => {
    const onSettings = vi.fn();
    renderPanel({ trashCount: 0, inTrash: false, onSettings });
    const rows = screen.getAllByRole("menuitem");
    expect(rows[0].textContent).toBe("Settings");
    fireEvent.click(rows[0]);
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("no longer carries the rows that moved into Settings", () => {
    renderPanel({ trashCount: 0, inTrash: false });
    for (const gone of [/About/, /Google Keep/, /spår download/, /Sign (in|out)/]) {
      expect(screen.queryByRole("menuitem", { name: gone })).toBeNull();
    }
  });

  // Position is the only emphasis in this panel and nearest the thumb wins, so
  // Search stays last and Reminders sits directly above it.
  it("puts Reminders directly above Search", () => {
    renderPanel({ trashCount: 2, inTrash: false });
    const rows = screen
      .getAllByRole("menuitem")
      .map((row) => row.textContent ?? "");
    const remindersAt = rows.findIndex((text) => text.startsWith("Reminders"));
    expect(remindersAt).toBeGreaterThan(-1);
    expect(rows[remindersAt + 1]).toMatch(/^Search/);
  });

  /**
   * The drawn `.kbd` box is `aria-hidden` — a reader announcing "Ctrl K" as
   * loose text beside "Search" would be reading the furniture — and the
   * stylesheet gives it `pointer-events: none`, so it can never be hovered
   * for a tooltip either. Between the two, the shortcut was announced to
   * nobody at all. It now belongs to the row's own name, said once.
   */
  it("says the shortcut in the Search row's own name where there is a key to press", () => {
    stubKeyboard();
    renderPanel({ trashCount: 1, inTrash: false });
    // Loose on the joiner: a browser puts a space between two element
    // children when it builds an accessible name and the test runner's
    // implementation does not, and which of the two is right is not what this
    // test is about.
    expect(screen.getByRole("menuitem", { name: /^Search\s*Ctrl\+K$/ })).toBeTruthy();
    // Said once, not twice: the drawn box stays out of the name, so the
    // spaced form the box prints ("Ctrl K") never appears in it.
    expect(screen.queryByRole("menuitem", { name: /Ctrl K/ })).toBeNull();
  });

  it("names the Search row plainly on a device with no such key", () => {
    renderPanel({ trashCount: 1, inTrash: false });
    expect(screen.getByRole("menuitem", { name: "Search" })).toBeTruthy();
  });

  it("moves focus through menu items and restores the trigger on Escape", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open menu
          </button>
          {open && (
            <MenuPanel
              trashCount={1}
              inTrash
              onSearch={() => setOpen(false)}
              onTrash={() => setOpen(false)}
              onEmptyTrash={() => setOpen(false)}
              onSettings={() => setOpen(false)}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open menu" });
    opener.focus();
    fireEvent.click(opener);

    // Settings is the first row — the one opened least, furthest from the
    // thumb — and in the trash, Empty trash the next.
    const first = screen.getByRole("menuitem", { name: "Settings" });
    const second = screen.getByRole("menuitem", { name: "Empty trash" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  // On a desktop the Settings row is display:none (the cog is in the header),
  // and a hidden row cannot take focus. The panel's keys listen on the panel,
  // so focus must land on the first row that can be seen (review QA-01).
  it("puts focus on the first row you can see and walks only the visible ones", () => {
    const hide = document.createElement("style");
    hide.textContent = ".selpanel-btn.menu-settings { display: none; }";
    document.head.appendChild(hide);
    try {
      const onClose = vi.fn();
      renderPanel({ trashCount: 1, inTrash: true, onClose });
      const shown = screen
        .getAllByRole("menuitem", { hidden: true })
        .filter((el) => getComputedStyle(el).display !== "none");
      expect(shown[0].textContent).toMatch(/^empty trash/i);
      expect(document.activeElement).toBe(shown[0]);

      fireEvent.keyDown(shown[0], { key: "ArrowUp" });
      expect(document.activeElement).toBe(shown[shown.length - 1]);
      fireEvent.keyDown(shown[shown.length - 1], { key: "ArrowDown" });
      expect(document.activeElement).toBe(shown[0]);

      // And Escape, which the hidden row's focus never reached, closes it.
      fireEvent.keyDown(shown[0], { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      hide.remove();
    }
  });
});
