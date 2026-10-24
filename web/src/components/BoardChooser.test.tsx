// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BoardChooser } from "./BoardChooser";

afterEach(cleanup);

/**
 * The chooser names folders the way the shelf names them (review UI-08), and
 * its field is written in the reading face (review UI-09).
 */
describe("the board chooser", () => {
  function open() {
    render(
      <BoardChooser
        boards={[
          { id: "b1", name: "Kitchen", position: 0, color: "ochre" },
          { id: "b2", name: "Årsplan", position: 1 },
        ]}
        showUnfiled
        onUnfile={vi.fn()}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  it("gives a folder's mark the folder's own hue, and leaves an untinted one alone", () => {
    open();
    const kitchen = screen.getByRole("button", { name: "Kitchen" });
    expect(kitchen.style.getPropertyValue("--board-tint")).toBe("var(--board-ochre)");
    const plain = screen.getByRole("button", { name: "Årsplan" });
    expect(plain.getAttribute("style")).toBeNull();
  });

  it("sets every board row in the shelf's voice, and nothing else", () => {
    open();
    for (const name of ["Inbox", "Kitchen", "Årsplan"]) {
      expect(screen.getByRole("button", { name }).classList.contains("selpanel-board")).toBe(true);
    }
    expect(screen.getByRole("button", { name: "Cancel" }).classList.contains("selpanel-board")).toBe(false);
  });

  /* Owner approved 2026-10-05 (review UX-A-06): no six-row cap and no
     "N more — type to find them" line; the folders scroll instead. */
  it("lists every folder in shelf order, inside one scroll region", () => {
    const boards = Array.from({ length: 9 }, (_, i) => ({
      id: `b${i}`,
      name: `Folder ${i + 1}`,
      position: i,
    }));
    render(
      <BoardChooser
        boards={boards}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const region = document.querySelector(".selpanel-scroll");
    expect(region).not.toBeNull();
    const names = [...region!.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(boards.map((b) => b.name));
    expect(screen.queryByText(/type to find/)).toBeNull();
  });

  it("takes a typed name in the reading face, not the machine's", () => {
    open();
    const field = screen.getByRole("textbox", { name: "Search boards or name a new one" });
    expect(field.classList.contains("field-words")).toBe(true);
    expect(field.classList.contains("mono")).toBe(false);
  });
});

/* Dogfooding 2026-10-18: "kit" then Enter, with Kitchen listed, made an empty
   board called KIT and filed the note there. */
describe("the chooser's field and the keyboard", () => {
  const boards = [
    { id: "b1", name: "Kitchen", position: 0 },
    { id: "b2", name: "Årsplan", position: 1 },
    { id: "b3", name: "Kit", position: 2 },
  ];
  function setup(list = boards) {
    const onChoose = vi.fn();
    const onCreate = vi.fn();
    render(<BoardChooser boards={list} onChoose={onChoose} onCreate={onCreate} onCancel={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Search boards or name a new one" });
    return { field, onChoose, onCreate };
  }

  it("files into the top match on Enter and says so, and makes no board", () => {
    const { field, onChoose, onCreate } = setup(boards.slice(0, 2));
    fireEvent.change(field, { target: { value: "kit" } });
    expect(screen.getByText("Enter to move to Kitchen")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith(boards[0]);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("prefers the board named exactly over an earlier partial match", () => {
    const { field, onChoose } = setup();
    fireEvent.change(field, { target: { value: "kit" } });
    expect(screen.getByText("Enter to move to Kit")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith(boards[2]);
  });

  it("makes a new board only when nothing matches", () => {
    const { field, onChoose, onCreate } = setup();
    fireEvent.change(field, { target: { value: "Garden" } });
    expect(screen.getByText("Enter to create “Garden”")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Garden");
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("walks the board rows with the arrows from the field", () => {
    const { field } = setup();
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kitchen" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Årsplan" }));
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kit" }));
  });
});

/* Review 2026-10-19: Enter files into the first board whose name *contains*
   the typed text, so with Party, Cards and Homework listed "Art", "Car" and
   "Work" could never be made as boards — from Move, the capture bar's board
   mark or the open note. A visible row makes them. */
describe("a new board is always one row away", () => {
  const boards = [
    { id: "b1", name: "Party", position: 0 },
    { id: "b2", name: "Cards", position: 1 },
    { id: "b3", name: "Homework", position: 2 },
  ];
  function setup(list = boards) {
    const onChoose = vi.fn();
    const onCreate = vi.fn();
    render(<BoardChooser boards={list} onChoose={onChoose} onCreate={onCreate} onCancel={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Search boards or name a new one" });
    return { field, onChoose, onCreate };
  }

  it("draws New board for a name inside another's, and a tap makes it", () => {
    for (const [typed, filedInto] of [["Art", boards[0]], ["Car", boards[1]], ["Work", boards[2]]] as const) {
      const { field, onChoose, onCreate } = setup();
      fireEvent.change(field, { target: { value: typed } });
      const row = screen.getByRole("button", { name: `New board “${typed}”` });
      // The matching board is listed too: the row adds, it does not replace.
      expect(screen.getByRole("button", { name: filedInto.name })).toBeTruthy();
      fireEvent.click(row);
      expect(onCreate).toHaveBeenCalledWith(typed);
      expect(onChoose).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("leaves Enter going to the top match, so kit still files into Kitchen", () => {
    const { field, onChoose, onCreate } = setup([{ id: "b1", name: "Kitchen", position: 0 }]);
    fireEvent.change(field, { target: { value: "kit" } });
    expect(screen.getByRole("button", { name: "New board “kit”" })).toBeTruthy();
    expect(screen.getByText("Enter to move to Kitchen")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith({ id: "b1", name: "Kitchen", position: 0 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("draws it for a name that matches nothing, and Enter still makes it", () => {
    const { field, onCreate } = setup();
    fireEvent.change(field, { target: { value: "  Garden " } });
    expect(screen.getByRole("button", { name: "New board “Garden”" })).toBeTruthy();
    expect(screen.getByText("Enter to create “Garden”")).toBeTruthy();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Garden");
  });

  it("is not drawn for a name a board already has, whatever its case, or for nothing typed", () => {
    const { field } = setup();
    expect(screen.queryByRole("button", { name: /^New board/ })).toBeNull();
    fireEvent.change(field, { target: { value: "   " } });
    expect(screen.queryByRole("button", { name: /^New board/ })).toBeNull();
    fireEvent.change(field, { target: { value: " cards " } });
    expect(screen.queryByRole("button", { name: /^New board/ })).toBeNull();
    fireEvent.change(field, { target: { value: "Card" } });
    expect(screen.getByRole("button", { name: "New board “Card”" })).toBeTruthy();
  });

  it("stands after the matches, outside their scroll region, and is walked by the arrows", () => {
    const { field } = setup();
    fireEvent.change(field, { target: { value: "r" } });
    const row = screen.getByRole("button", { name: "New board “r”" });
    expect(row.closest(".selpanel-scroll")).toBeNull();
    expect(row.classList.contains("selpanel-btn")).toBe(true);
    // Under the matches, above the field.
    const scroll = document.querySelector(".selpanel-scroll")!;
    expect(scroll.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Up from the field is the nearest row above it: this one.
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(document.activeElement).toBe(row);
    // Down from the last row wraps to the first.
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Party" }));
  });

  it("makes the board from the keyboard once the arrows have reached the row", () => {
    const { field, onCreate } = setup();
    fireEvent.change(field, { target: { value: "Art" } });
    field.focus();
    fireEvent.keyDown(field, { key: "ArrowUp" });
    const row = screen.getByRole("button", { name: "New board “Art”" });
    expect(document.activeElement).toBe(row);
    // A focused button answers a click, which is what Enter and Space send it.
    fireEvent.click(row);
    expect(onCreate).toHaveBeenCalledWith("Art");
  });
});

/* An input method's arrows walk its own suggestions. The panel's walk used to
   take them, and the focus jumped from the field onto a board row mid-word. */
describe("the chooser while an input method is composing", () => {
  const boards = [
    { id: "b1", name: "Kitchen", position: 0 },
    { id: "b2", name: "Årsplan", position: 1 },
  ];
  function setup() {
    render(<BoardChooser boards={boards} onChoose={vi.fn()} onCreate={vi.fn()} onCancel={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Search boards or name a new one" });
    field.focus();
    return field;
  }

  it("leaves the arrows to the method, by the flag", () => {
    const field = setup();
    fireEvent.keyDown(field, { key: "ArrowDown", isComposing: true });
    fireEvent.keyDown(field, { key: "ArrowUp", isComposing: true });
    expect(document.activeElement).toBe(field);
  });

  it("leaves the arrows to the method, by key code 229", () => {
    const field = setup();
    fireEvent.keyDown(field, { key: "ArrowDown", keyCode: 229 });
    fireEvent.keyDown(field, { key: "ArrowUp", keyCode: 229 });
    expect(document.activeElement).toBe(field);
  });

  it("walks again once the composition is over", () => {
    const field = setup();
    fireEvent.keyDown(field, { key: "ArrowDown", isComposing: false });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Kitchen" }));
  });
});

describe("a folder's mark in the chooser", () => {
  // Loaded ahead, as NoteCard's test does: the Heroicons set is the slowest
  // module in the app to transform, and the test measures only what it draws.
  beforeAll(async () => {
    await import("../lib/iconSet");
  }, 120_000);

  it("is the folder's own glyph, answering hover, and the folder for one with none", async () => {
    const { renderHook, waitFor } = await import("@testing-library/react");
    const { useBoardIcons } = await import("./BoardLook");
    const loaded = renderHook(() => useBoardIcons(["BookOpenIcon"]));
    await waitFor(() => expect(loaded.result.current).toBe(true), { timeout: 10_000 });
    render(
      <BoardChooser
        boards={[
          { id: "b1", name: "Books", position: 0, icon: "BookOpenIcon" },
          { id: "b2", name: "Plain", position: 1 },
        ]}
        onChoose={vi.fn()}
        onCreate={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const books = screen.getByRole("button", { name: "Books" }).querySelector("svg")!;
    expect(books.getAttribute("class")).toBe("icon icon-inline icon-picked");
    const plain = screen.getByRole("button", { name: "Plain" }).querySelector("svg")!;
    expect(plain.querySelector(".icon-folder-flap")).toBeTruthy();
    expect(plain.classList.contains("icon-picked")).toBe(false);
  }, 20_000);
});
