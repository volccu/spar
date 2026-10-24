// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { allNotes, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { LONG_PRESS_MS } from "./components/NoteCard";

/*
 * Carrying a held card on to a board in the shelf files it there (2026-10-23,
 * `lib/shelfDrop.ts`) — the board's half, end to end, on the desktop strip.
 * The rules for each board are `shelfDrop.test.ts`. A file of its own, like
 * `App.mergeDrag.test.tsx`, because every test here writes notes.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 40_000 });

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function capture(words: string) {
  fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  return await screen.findByRole("button", { name: new RegExp(words, "i") });
}

async function start() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

async function makeBoard(name: string): Promise<HTMLElement> {
  fireEvent.click(screen.getAllByRole("button", { name: "New board" })[0]);
  const field = await screen.findByRole("textbox", { name: /board name/i });
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  const tab = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".boards [data-board-id]")].find((el) =>
      el.textContent?.includes(name),
    );
    expect(found).toBeTruthy();
    return found!;
  });
  // Back to the Inbox, or the note captured next would land in the new board.
  fireEvent.click(document.getElementById("board-tab-inbox")!);
  await waitFor(() => expect(document.getElementById("board-tab-inbox")?.getAttribute("aria-selected")).toBe("true"));
  return tab;
}

/** Hold `card`, carry it over `onto`, and let go there. */
async function carry(card: HTMLElement, onto: HTMLElement, check?: () => void) {
  fireEvent.pointerDown(card, { pointerId: 1, pointerType: "mouse", button: 0 });
  await act(() => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100)));
  const elementFromPoint = document.elementFromPoint;
  document.elementFromPoint = () => onto;
  try {
    fireEvent.pointerMove(card, { pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    check?.();
    fireEvent.pointerUp(card, { pointerId: 1, pointerType: "mouse" });
  } finally {
    document.elementFromPoint = elementFromPoint;
  }
}

// A capture may come back capitalised.
const stored = async (words: string) => (await allNotes()).find((n) => n.body.toLowerCase() === words);

describe("carrying a held card on to a board in the strip", () => {
  it("files it there, lit while it is over the tab, and offers it back", async () => {
    await start();
    const tab = await makeBoard("Zzzplace");
    const card = await capture("zzzshelfcarry");
    await carry(card, tab);
    await waitFor(async () => expect((await stored("zzzshelfcarry"))?.board_id).toBe(tab.dataset.boardId));

    fireEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
    await waitFor(async () => expect((await stored("zzzshelfcarry"))?.board_id ?? null).toBeNull());
  });

  it("lights the board it would land in", async () => {
    await start();
    const tab = await makeBoard("Zzzlit");
    const card = await capture("zzzshelflit");
    await carry(card, tab, () => {
      expect(tab.getAttribute("data-drop-target")).toBe("true");
    });
    await waitFor(() => expect(tab.getAttribute("data-drop-target")).toBeNull());
  });

  it("refuses a lens: All takes nothing, and the note stays where it was", async () => {
    await start();
    const card = await capture("zzzshelflens");
    const all = [...document.querySelectorAll<HTMLElement>(".boards [data-board-id]")].find(
      (el) => el.textContent?.includes("All"),
    )!;
    await carry(card, all, () => {
      expect(all.getAttribute("data-refuses")).toBe("true");
      expect(all.getAttribute("data-drop-target")).toBeNull();
    });
    const note = await stored("zzzshelflens");
    expect(note?.board_id ?? null).toBeNull();
    expect(note?.status).toBe("active");
  });

  it("archives on the Archive tab", async () => {
    await start();
    const card = await capture("zzzshelfarchive");
    const archive = [...document.querySelectorAll<HTMLElement>(".boards [data-board-id]")].find(
      (el) => el.textContent?.includes("Archive"),
    )!;
    await carry(card, archive);
    await waitFor(async () => expect((await stored("zzzshelfarchive"))?.status).toBe("archived"));
  });

  it("on a phone, opens the drawer when the finger reaches the board row, and files on a row of it", async () => {
    const wide = window.innerWidth;
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
    try {
      await start();
      const card = await capture("zzzshelfphone");
      const row = document.querySelector<HTMLElement>(".board-row")!;
      // jsdom has no layout: the board row stands across the top.
      row.getBoundingClientRect = () => ({ left: 0, right: 390, top: 0, bottom: 44, width: 390, height: 44, x: 0, y: 0 }) as DOMRect;
      fireEvent.pointerDown(card, { pointerId: 1, pointerType: "touch", button: 0 });
      await act(() => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100)));
      const elementFromPoint = document.elementFromPoint;
      try {
        document.elementFromPoint = () => row;
        fireEvent.pointerMove(card, { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 20 });
        // Passing through the row opens nothing; a pause on it does.
        expect(document.querySelector(".shelf-drop")).toBeNull();
        const drawer = await waitFor(() => {
          const found = document.querySelector<HTMLElement>(".shelf-drop");
          expect(found).toBeTruthy();
          return found!;
        });
        const archive = [...drawer.querySelectorAll<HTMLElement>("[data-drop-board]")].find((el) =>
          el.textContent?.includes("Archive"),
        )!;
        document.elementFromPoint = () => archive;
        fireEvent.pointerMove(card, { pointerId: 1, pointerType: "touch", clientX: 40, clientY: 200 });
        expect(archive.getAttribute("data-drop-target")).toBe("true");
        fireEvent.pointerUp(card, { pointerId: 1, pointerType: "touch" });
      } finally {
        document.elementFromPoint = elementFromPoint;
      }
      await waitFor(async () => expect((await stored("zzzshelfphone"))?.status).toBe("archived"));
      expect(document.querySelector(".shelf-drop")).toBeNull();
    } finally {
      window.innerWidth = wide;
      window.dispatchEvent(new Event("resize"));
    }
  });

  it("puts it in the trash on the Trash tab", async () => {
    await start();
    const card = await capture("zzzshelftrash");
    await carry(card, document.getElementById("board-tab-trash")!);
    await waitFor(async () => expect((await stored("zzzshelftrash"))?.status).toBe("trashed"));
  });
});
