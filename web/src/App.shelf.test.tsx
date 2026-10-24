// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getMeta, setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL, SHELF_ORDER_ID } from "./lib/boards";
import type { UserBoard } from "./types";
import { LONG_PRESS_MS } from "./components/NoteCard";

/*
 * The strip's own gestures, and the shelf changing under the board you are
 * standing on.
 *
 * A file of its own for the reason `App.capture.test.tsx` gives: these make
 * folders, and `App.test.tsx` shares one database across every test it holds,
 * where one extra board moves another test's board along the strip.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

/** One tap and a name, from the "+" tab at the end of the strip. The board opens. */
async function newBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") });
}

/** A board made, then back on the Inbox: most tests want the board, not to stand on it. */
async function makeBoard(name: string) {
  const tab = await newBoard(name);
  await waitFor(() => expect(boardName()).toMatch(new RegExp(name, "i")));
  fireEvent.click(await screen.findByRole("tab", { name: /^inbox/i }));
  await waitFor(() => expect(boardName()).toMatch(/^inbox/i));
  return tab;
}

/** Which board the strip says you are standing on. */
const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

/**
 * Holding a folder's tab and letting go where it was opens its own menu. The
 * right-click half is tested in `App.test.tsx`; this is the held finger, which
 * goes through a timer instead — and the click that a hold ends with must not
 * also take you to the board. Since the tab can also be carried (see
 * "carrying a board along the shelf" below), the menu waits for the release:
 * a hold that goes on to travel is a move, not a request for the menu.
 */
describe("holding a folder's tab", () => {
  const hold = () => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100));

  it("opens the folder's menu, and the click the hold ends with goes nowhere", async () => {
    await open();
    const tab = await makeBoard("zzzheldfolder");
    expect(boardName()).toMatch(/^inbox/i);

    fireEvent.pointerDown(tab, { pointerId: 1, pointerType: "touch" });
    await act(hold);
    // Picked up, and nothing opened yet: it may still be carried.
    expect(tab.getAttribute("data-lifted")).toBe("true");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    fireEvent.pointerUp(tab, { pointerId: 1, pointerType: "touch" });
    // A real click after a press carries `detail: 1`; the keyboard's is 0.
    fireEvent.click(tab, { detail: 1 });
    // Long wait: under the full suite's load the menu has taken over a second.
    expect(
      await screen.findByRole("button", { name: "Rename" }, { timeout: 10_000 }),
    ).toBeTruthy();
    expect(tab.getAttribute("data-lifted")).toBeNull();
    // Still on the Inbox: the hold asked for the menu, not the board.
    expect(boardName()).toMatch(/^inbox/i);
  });

  // Split from the hold above (audit 2026-10-10, CODE-5): each waits out a
  // real hold, and together they were the suite's slowest test.
  it("takes a press let go before it was a hold as an ordinary click", async () => {
    await open();
    const tab = await makeBoard("zzzpressedfolder");
    expect(boardName()).toMatch(/^inbox/i);

    fireEvent.pointerDown(tab, { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(tab, { pointerId: 1, pointerType: "touch" });
    fireEvent.click(tab, { detail: 1 });
    await waitFor(() => expect(boardName()).toMatch(/zzzpressedfolder/i));
    await act(hold);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("offers nothing on a board the user did not make", async () => {
    await open();
    const inbox = await screen.findByRole("tab", { name: /^inbox/i });
    fireEvent.pointerDown(inbox, { pointerId: 1, pointerType: "touch" });
    await act(hold);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });
});

/**
 * The lenses stand on one lifted ground (`--lens-ground`, 2026-10-08): the
 * strip marks Todos, Links, Files, All and Trash, and nothing the user made.
 */
describe("the lens run's ground", () => {
  it("marks the lenses and Trash, and no place", async () => {
    await open();
    await makeBoard("zzzplainfolder");
    const lifted = [...document.querySelectorAll<HTMLElement>('[role="tab"][data-lens="true"]')];
    // Inspiration stands on the band too (a built-in, not a lens); its id is
    // minted per account, so it is found by name.
    const named = (t: HTMLElement) => /^Inspiration/.test(t.textContent ?? "");
    expect(lifted.filter(named)).toHaveLength(1);
    const marked = lifted
      .filter((t) => !named(t))
      .map((t) => t.dataset.boardId ?? t.id.replace("board-tab-", ""))
      .sort();
    expect(marked).toEqual(["files", "links", "recent", "todos", "trash"]);
    expect(document.querySelector('.boards [data-board-id="inbox"]')!.hasAttribute("data-lens")).toBe(false);
    expect(document.querySelector('.boards [data-board-id="archive"]')!.hasAttribute("data-lens")).toBe(false);
  });
});

/**
 * A query that is exactly a folder's name is answered by standing on the
 * folder, offered over the results. The recent-search chips beside it are
 * pinned in `App.test.tsx`.
 */
describe("searching for a folder by name", () => {
  it("offers to jump to it, and the jump lands on the board with search closed", async () => {
    await open();
    await makeBoard("zzzjumpfolder");
    expect(boardName()).toMatch(/^inbox/i);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = await screen.findByLabelText("Search notes");
    fireEvent.change(field, { target: { value: "zzzjump" } });
    // Part of a name is a search like any other.
    expect(screen.queryByRole("button", { name: /^Jump to/ })).toBeNull();

    fireEvent.change(field, { target: { value: "ZZZJUMPFOLDER" } });
    fireEvent.click(await screen.findByRole("button", { name: "Jump to the zzzjumpfolder board" }));

    await waitFor(() => expect(boardName()).toMatch(/zzzjumpfolder/i));
    expect(screen.queryByLabelText("Search notes")).toBeNull();
  });
});

describe("the seat follows the board", () => {
  /**
   * A folder arriving shifts Archive and every lens one seat along. Held by
   * number, a reader sitting on All would quietly become a reader sitting on
   * Files; the seat follows the board instead.
   */
  it("goes to a folder made from All, and the board under it is the folder's", async () => {
    await open();
    fireEvent.click(await screen.findByRole("tab", { name: /^all/i }));
    await waitFor(() => expect(boardName()).toMatch(/^all/i));

    await newBoard("zzzseatfolder");
    await waitFor(() => expect(boardName()).toMatch(/zzzseatfolder/i));
    // And the board under it is the new folder's, not the seat's old tenant's.
    expect(document.getElementById("board-panel")?.getAttribute("aria-labelledby")).toBe(
      document.querySelector('[role="tab"][aria-selected="true"]')?.id,
    );
  });
});

/**
 * Hold a tab, then carry it: the owner's ask of 2026-09-29, and the quick way
 * to put the shelf in order. A board moves only along its own run — folders
 * among folders, Todos, Links and Files among themselves — so the hairline and
 * the four fixed seats (Inbox, Archive, All, Trash) never move.
 *
 * jsdom lays nothing out, so the strip is laid out here: every tab 100px wide,
 * edge to edge, in the order the DOM holds them. That is all a carry measures.
 * This file shares one database down its length, so every order below is read
 * off the strip rather than assumed.
 */
describe("carrying a board along the shelf", () => {
  const hold = () => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100));

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const list = this.closest('[role="tablist"]');
      const tabs = list ? [...list.querySelectorAll<HTMLElement>("[data-board-id]")] : [];
      const i = tabs.indexOf(this);
      const left = i >= 0 ? i * 100 : 0;
      const width = i >= 0 ? 100 : 100_000;
      return {
        left,
        right: left + width,
        top: 0,
        bottom: 44,
        width,
        height: 44,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const order = () =>
    [...document.querySelectorAll<HTMLElement>(".boards [data-board-id]")].map(
      (tab) => tab.dataset.boardId!,
    );
  const tabOf = (id: string) =>
    document.querySelector<HTMLElement>(`.boards [data-board-id="${id}"]`)!;
  const centreOf = (id: string) => order().indexOf(id) * 100 + 50;
  const idOf = (name: string) =>
    [...document.querySelectorAll<HTMLElement>(".boards [data-board-id]")].find((tab) =>
      new RegExp(name, "i").test(tab.textContent ?? ""),
    )!.dataset.boardId!;
  const lenses = () => order().filter((id) => ["todos", "links", "files"].includes(id));

  /** Holds `id`'s tab, carries it to `toX`, and ends the gesture as asked. */
  async function carry(id: string, toX: number, end: "drop" | "cancel" | "escape" = "drop") {
    const tab = tabOf(id);
    const at = { pointerId: 7, pointerType: "touch", clientY: 20 };
    fireEvent.pointerDown(tab, { ...at, clientX: centreOf(id) });
    await act(hold);
    expect(tab.getAttribute("data-lifted")).toBe("true");
    fireEvent.pointerMove(tab, { ...at, clientX: toX });
    if (end === "cancel") {
      fireEvent.pointerCancel(tab, at);
      return tab;
    }
    if (end === "escape") fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(tab, { ...at, clientX: toX });
    fireEvent.click(tab, { detail: 1 });
    return tab;
  }

  it("moves a folder to where it is let go, and the board you stand on stays yours", async () => {
    await open();
    await makeBoard("zzzcarrya");
    await makeBoard("zzzcarryb");
    const a = idOf("zzzcarrya");
    const b = idOf("zzzcarryb");
    // Stand on the folder the carry is about to pass.
    fireEvent.click(tabOf(a));
    await waitFor(() => expect(boardName()).toMatch(/zzzcarrya/i));
    expect(order().indexOf(a)).toBeLessThan(order().indexOf(b));

    const tab = await carry(b, centreOf(a) - 10);
    await waitFor(() => expect(order().indexOf(b)).toBeLessThan(order().indexOf(a)));
    // Put down, not still held, and the click it ended with went nowhere.
    expect(tab.getAttribute("data-lifted")).toBeNull();
    expect(tab.style.transform).toBe("");
    expect(boardName()).toMatch(/zzzcarrya/i);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    // Queued for the other device exactly as the menu's step is.
    await waitFor(async () => expect(await getMeta<boolean>("boardsDirty")).toBe(true));
  });

  it("never carries a board across the hairline, nor past the Inbox", async () => {
    await open();
    await makeBoard("zzzfencefolder");
    const folder = idOf("zzzfencefolder");
    const firstLifted = () => document.querySelector<HTMLElement>('.boards [data-lens="true"]')!;

    // Flung far past the end of the strip: it stops as the last of the places,
    // past Archive (which is carried among the folders now) and short of the line.
    await carry(folder, 100_000);
    await waitFor(() => expect((firstLifted().previousElementSibling as HTMLElement).dataset.boardId).toBe(folder));
    // Flung back past the start: it stops beside the Inbox, never before it.
    await carry(folder, -100_000);
    await waitFor(() => expect(order()[1]).toBe(folder));
    expect(order()[0]).toBe("inbox");

    // A lens flung back towards the folders stops at the head of the app's own
    // boards — ahead of Inspiration now, which is carried too — and never
    // crosses into the places: the board before it is still Archive.
    const last = lenses()[2];
    await carry(last, -100_000);
    await waitFor(() => expect(firstLifted().dataset.boardId).toBe(last));
    expect((firstLifted().previousElementSibling as HTMLElement).dataset.boardId).toBe("archive");
    expect((firstLifted().nextElementSibling as HTMLElement).textContent).toMatch(/^Inspiration/);
  });

  it("moves a lens, and the order is kept on this device and queued to sync", async () => {
    await open();
    const [first, second, third] = lenses();
    await carry(third, centreOf(first) - 10);
    await waitFor(() => expect(lenses()).toEqual([third, first, second]));
    await waitFor(async () => {
      const stored = await getMeta<(UserBoard & { lenses?: string[] })[]>("boards");
      expect(stored?.find((b) => b.id === SHELF_ORDER_ID)?.lenses).toEqual([third, first, second]);
    });

    cleanup();
    await open();
    expect(lenses()).toEqual([third, first, second]);
    // The entry is never mistaken for a folder: no stray tab.
    expect(screen.queryByRole("tab", { name: /shelf order/i })).toBeNull();
  });

  it("puts everything back when the carry is abandoned", async () => {
    await open();
    await makeBoard("zzzabandona");
    await makeBoard("zzzabandonb");
    const a = idOf("zzzabandona");
    const b = idOf("zzzabandonb");
    const before = order();

    // The browser took the pointer.
    const tab = await carry(b, centreOf(a) - 10, "cancel");
    expect(tab.getAttribute("data-lifted")).toBeNull();
    expect(tab.style.transform).toBe("");
    expect(order()).toEqual(before);

    // Escape, mid-carry: nothing is written when the finger lifts after it.
    await carry(b, centreOf(a) - 10, "escape");
    expect(order()).toEqual(before);
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("lifts nothing that holds its seat", async () => {
    await open();
    for (const id of ["inbox"]) {
      const tab = tabOf(id);
      fireEvent.pointerDown(tab, { pointerId: 7, pointerType: "touch", clientX: centreOf(id) });
      await act(hold);
      expect(tab.getAttribute("data-lifted")).toBeNull();
      fireEvent.pointerUp(tab, { pointerId: 7, pointerType: "touch" });
    }
  });

  it("gives a lens a menu of only its two Move rows, which move it too", async () => {
    await open();
    const [first, second] = lenses();
    fireEvent.contextMenu(tabOf(first));
    fireEvent.click(await screen.findByRole("button", { name: "Move right" }));
    await waitFor(() => expect(lenses().slice(0, 2)).toEqual([second, first]));
    // A lens is the app's: nothing of it to rename, dress or delete.
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Look" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });
});

/**
 * A strip with more boards than the window holds (review UX-04). It hid Links,
 * Files and All past its right edge behind a fade over an empty slot, and a
 * mouse wheel over it did nothing. Now a count beside it says how many are out
 * of sight and brings them into view, and a wheel moves it sideways.
 *
 * jsdom lays nothing out, so the strip is laid out here: 450px wide, every
 * board tab 100px, edge to edge, moved by its own scroll position.
 */
describe("a strip with more boards than it shows", () => {
  function layOut() {
    const nav = document.querySelector<HTMLElement>("div.boards")!;
    const tabs = Array.from(nav.querySelectorAll<HTMLElement>('[role="tab"]'));
    let left = 0;
    const width = tabs.length * 100;
    Object.defineProperty(nav, "clientWidth", { configurable: true, get: () => 450 });
    Object.defineProperty(nav, "scrollWidth", { configurable: true, get: () => width });
    Object.defineProperty(nav, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (v: number) => {
        left = v;
      },
    });
    nav.getBoundingClientRect = () => ({ left: 0, right: 450, top: 0, bottom: 44, width: 450, height: 44, x: 0, y: 0, toJSON: () => ({}) });
    tabs.forEach((t, i) => {
      t.getBoundingClientRect = () => ({
        left: i * 100 - left, right: (i + 1) * 100 - left, top: 0, bottom: 44, width: 100, height: 44, x: i * 100 - left, y: 0, toJSON: () => ({}),
      });
    });
    const scrollBy = vi.fn((opts: ScrollToOptions) => {
      left = Math.max(0, Math.min(width - 450, left + (opts.left ?? 0)));
      fireEvent.scroll(nav);
    });
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
      left = opts.left ?? 0;
      fireEvent.scroll(nav);
    });
    Object.assign(nav, { scrollBy, scrollTo });
    fireEvent.scroll(nav);
    return { nav, tabs, scrollBy, scrollTo, left: () => left };
  }

  it("counts the boards past the edge, and brings them into view", async () => {
    await open();
    const { tabs, scrollTo } = layOut();
    // 450 - 28px of fade: every tab whose middle is past 422 is out of sight.
    const hidden = tabs.filter((_, i) => i * 100 + 50 > 422).length;
    expect(hidden).toBeGreaterThan(0);
    const more = await screen.findByRole("button", {
      name: `${hidden} more ${hidden === 1 ? "board" : "boards"}`,
    });

    // A page at a time (this file shares one database, so how many folders
    // earlier tests left on the shelf decides how many pages there are). At
    // the end of the strip the count turns round and offers the way back.
    fireEvent.click(more);
    for (let i = 0; i < 10 && !screen.queryByRole("button", { name: "Back to the first boards" }); i++) {
      fireEvent.click(await screen.findByRole("button", { name: /more boards?$/ }));
    }
    const back = await screen.findByRole("button", { name: "Back to the first boards" });
    fireEvent.click(back);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 0 }));
    expect(await screen.findByRole("button", { name: /more boards?$/ })).toBeTruthy();
  });

  it("turns a mouse wheel over the strip sideways", async () => {
    await open();
    const { nav, scrollBy } = layOut();
    const down = new WheelEvent("wheel", { deltaY: 100, cancelable: true, bubbles: true });
    nav.dispatchEvent(down);
    expect(scrollBy).toHaveBeenCalledWith({ left: 100 });
    expect(down.defaultPrevented).toBe(true);

    // A sideways gesture is the browser's own, and is left to it.
    scrollBy.mockClear();
    const across = new WheelEvent("wheel", { deltaX: 80, deltaY: 5, cancelable: true, bubbles: true });
    nav.dispatchEvent(across);
    expect(scrollBy).not.toHaveBeenCalled();
    expect(across.defaultPrevented).toBe(false);
  });
});

/**
 * What a screen reader is told the strip and the board are (review QA-02):
 * a tablist that holds tabs and nothing else, Trash a member of it though it
 * stands outside the scroller, and the board in a real main landmark that
 * holds the tab panel — `role="tabpanel"` on the <main> itself overrode it.
 */
describe("the strip and the board, as assistive tech hears them", () => {
  it("holds only tabs in the tablist, Trash included, beside its other controls", async () => {
    await open();
    const list = screen.getByRole("tablist", { name: "Boards" });
    const members = [...list.children].filter((el) => el.getAttribute("aria-hidden") !== "true");
    expect(members.length).toBeGreaterThan(0);
    for (const el of members) expect(el.getAttribute("role")).toBe("tab");
    expect(list.getAttribute("aria-owns")).toBe("board-tab-trash");
    expect(document.getElementById("board-tab-trash")?.getAttribute("role")).toBe("tab");
    expect(list.contains(screen.getByRole("button", { name: "New board" }))).toBe(false);
    expect(list.contains(screen.getByRole("button", { name: "Boards" }))).toBe(false);
  });

  it("puts the board in a main landmark that holds the tab panel", async () => {
    await open();
    const main = screen.getByRole("main");
    const panel = document.getElementById("board-panel")!;
    expect(main.hasAttribute("role")).toBe(false);
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(main.contains(panel)).toBe(true);
    expect(panel.contains(document.querySelector(".card"))).toBe(true);
  });
});

/**
 * A folder name may run to forty characters, and one such name made a 442px
 * tab (review UI-B-05). The strip cuts it with an ellipsis in CSS; what can
 * be held here is that the cut name keeps the whole of itself on hover, and
 * that a short name is not given a tooltip that only repeats it.
 */
describe("a long folder name on the strip", () => {
  it("is cut by its own span and keeps the whole name as its hover title", async () => {
    await open();
    const long = "zzz a folder whose name runs on and on";
    const tab = await makeBoard(long);
    const name = tab.querySelector(".board-tab-name");
    expect(name?.textContent).toBe(long);
    expect(name?.getAttribute("title")).toBe(long);
    const inbox = screen.getByRole("tab", { name: /^inbox/i }).querySelector(".board-tab-name");
    expect(inbox?.hasAttribute("title")).toBe(false);
  });
});

/**
 * The strip's new-board field takes Rename's look, and leaving it is cancel,
 * as the drawer's and Tidy up's are (review UI-A-04): blur runs before the
 * click that took the focus, so a half-typed name used to become a board on
 * the way to wherever the pointer went.
 */
describe("the strip's new-board field", () => {
  it("is the words' field, and leaving it makes nothing", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    const field = screen.getByLabelText("New board name");
    expect(field.classList.contains("field-words")).toBe(true);
    fireEvent.change(field, { target: { value: "zzzhalftyped" } });
    fireEvent.blur(field);
    await waitFor(() => expect(screen.queryByLabelText("New board name")).toBeNull());
    expect(screen.queryByRole("tab", { name: /zzzhalftyped/i })).toBeNull();
    // And the + is back, ready to be asked again.
    expect(screen.getByRole("button", { name: "New board" })).toBeTruthy();
  });
});

describe("a board named from the strip", () => {
  it("is opened once it is made", async () => {
    await open();
    expect(boardName()).toMatch(/^inbox/i);
    await newBoard("zzzopenedatonce");
    await waitFor(() => expect(boardName()).toMatch(/zzzopenedatonce/i));
  });
});
