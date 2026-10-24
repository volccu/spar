// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { LONG_PRESS_MS } from "./NoteCard";
import { setMeta } from "../store/db";
import { INBOX_ALL } from "../lib/boards";

/**
 * The board shelf on a phone, exercised through the whole app rather than
 * against the component on its own — every interesting thing about it is a
 * seam with App: the same `goToBoard`, the same hold into `BoardMenu`,
 * the same new-board field, and the tab strip *not* being rendered beside it.
 *
 * The mobile branch is a real branch in JS (lib/breakpoint.ts), so a test has
 * to actually be on a phone-sized viewport to reach it. jsdom has no
 * `matchMedia` at all — which is why the hook, like lib/motion.ts, falls back
 * to the width — so setting `innerWidth` is what puts these tests on a phone.
 * The rest of the suite renders at jsdom's default 1024 and therefore keeps
 * exercising the desktop strip, untouched.
 */

const DESKTOP_WIDTH = window.innerWidth;

function phoneViewport() {
  window.innerWidth = 390;
  window.dispatchEvent(new Event("resize"));
}

afterEach(cleanup);
afterAll(() => {
  window.innerWidth = DESKTOP_WIDTH;
});

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  // Past the first-open question, which these tests are not about — see
  // App.test.tsx, where it is.
  await setMeta("inboxSince", INBOX_ALL);
  phoneViewport();
});

/** The app is up and the archive is on screen. */
async function boardIsUp() {
  render(<App />);
  await waitFor(
    () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    { timeout: 10_000 },
  );
}

const burger = () => screen.getByRole("button", { name: /^boards/i });
const openDrawer = () => fireEvent.click(burger());
const drawer = () => screen.queryByRole("tablist", { name: "Boards" });

describe("the board shelf on a phone", () => {
  it("replaces the tab strip with a burger and the board you are on", async () => {
    await boardIsUp();

    // The strip is gone entirely, not merely hidden: two copies would mean two
    // sets of tabs and two elements carrying each `board-tab-*` id.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(burger().textContent).toMatch(/inbox/i);
  });

  it("opens the whole shelf as a vertical tablist, Trash and New board included", async () => {
    await boardIsUp();
    openDrawer();

    const list = drawer()!;
    expect(list).toBeTruthy();
    expect(list.getAttribute("aria-orientation")).toBe("vertical");

    for (const name of ["Inbox", "All", "Todos", "Links", "Files", "Archive", "Trash"]) {
      expect(within(list).getByRole("tab", { name: new RegExp(name, "i") })).toBeTruthy();
    }
    // The board you are on is marked the way the app marks "on" everywhere.
    expect(
      within(list).getByRole("tab", { name: /^inbox/i }).getAttribute("aria-selected"),
    ).toBe("true");

    // A row is a mark, a name and a count, and nothing else — the preview of
    // what was inside each board was tried here and taken out again.
    const inbox = within(list).getByRole("tab", { name: /^inbox/i });
    expect(inbox.querySelectorAll("span")).toHaveLength(2);

    // The affordance that was at the end of the strip comes with it — and it
    // sits outside the tablist, because a tablist holds nothing but tabs.
    const add = screen.getByRole("button", { name: /new board/i });
    expect(list.contains(add)).toBe(false);
  });

  /**
   * The one hairline, on the drawer's axis. The strip has drawn it since the
   * shelf was reordered into places-then-lenses, and the drawer — the shape
   * where all fourteen rows are read top to bottom — drew fourteen identical
   * rows and never asked which side a row was on at all. The line now means
   * *the app's own boards begin here*.
   */
  it("divides places from lenses, exactly once, where the lenses begin", async () => {
    await boardIsUp();
    openDrawer();
    const list = drawer()!;

    const splits = list.querySelectorAll(".shelf-split");
    expect(splits).toHaveLength(1);

    const rows = Array.from(list.children);
    const at = rows.indexOf(splits[0]);
    // Archive closes the places; Inspiration opens the app's own boards, Todos next.
    expect(rows[at - 1].textContent).toMatch(/^Archive/);
    expect(rows[at + 1].textContent).toMatch(/^Inspiration/);
    expect(rows[at + 2].textContent).toMatch(/^Todos/);
    // And Trash is still the last row, with no second line invented for it.
    expect(rows[rows.length - 1].textContent).toMatch(/^Trash/);
  });

  /**
   * The lenses, and Trash which closes them, stand on one lifted ground
   * (`--lens-ground`); the places stay on the paper.
   */
  it("lays the lens run, and Trash, on one lifted ground", async () => {
    await boardIsUp();
    openDrawer();
    const rows = Array.from(drawer()!.querySelectorAll<HTMLElement>(".shelf-row"));
    const liftedRows = rows.filter((r) => r.dataset.lens === "true");
    // Inspiration's id is minted per account; it is the first lifted row, by name.
    expect(liftedRows[0].textContent).toMatch(/^Inspiration/);
    expect(liftedRows.slice(1).map((r) => r.dataset.boardId)).toEqual([
      "todos",
      "links",
      "files",
      "recent",
      "trash",
    ]);
    expect(rows.find((r) => r.dataset.boardId === "inbox")!.dataset.lens).toBeUndefined();
    expect(rows.find((r) => r.dataset.boardId === "archive")!.dataset.lens).toBeUndefined();
  });

  /**
   * The new-board field committed on blur, and blur runs before the click that
   * took the focus away — so a half-typed name plus a tap on a board row made
   * a board nobody asked for. A name is committed by asking for it.
   */
  it("throws away a half-typed board name rather than making a board of it", async () => {
    await boardIsUp();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: "New board" }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: "zzzdrawernevermeant" } });
    fireEvent.blur(field);

    await waitFor(() => expect(screen.queryByLabelText("New board name")).toBeNull());
    expect(
      within(drawer()!).queryByRole("tab", { name: /zzzdrawernevermeant/i }),
    ).toBeNull();
  });

  it("goes to the board you choose, and shuts behind you", async () => {
    await boardIsUp();
    openDrawer();

    fireEvent.click(within(drawer()!).getByRole("tab", { name: /links/i }));

    await waitFor(() => expect(drawer()).toBeNull());
    expect(burger().textContent).toMatch(/links/i);
    expect(document.querySelector("#board-panel")?.getAttribute("aria-label")).toBe("Links");
  });

  it("closes on Escape and hands the focus back to the burger", async () => {
    await boardIsUp();
    openDrawer();
    expect(drawer()).toBeTruthy();

    fireEvent.keyDown(drawer()!, { key: "Escape" });

    await waitFor(() => expect(drawer()).toBeNull());
    expect(document.activeElement).toBe(burger());
    // Escape is not a navigation: the board is the one it was.
    expect(burger().textContent).toMatch(/inbox/i);
  });

  it("closes when you tap outside it", async () => {
    await boardIsUp();
    openDrawer();

    // The app's one dismiss pattern, reused rather than reinvented — the same
    // full-screen button every bottom panel closes through.
    fireEvent.click(screen.getByRole("button", { name: "Close boards" }));
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it("keeps the capture bar, because writing is still possible from here", async () => {
    await boardIsUp();
    openDrawer();

    // The Sorter is the one screen that takes the bar away; the drawer does not.
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "zzzwrittenontheshelf" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    // The drawer stays where it was — capture closes nothing — and the Inbox
    // count says so on the spot.
    const inbox = () => within(drawer()!).getByRole("tab", { name: /^inbox/i });
    await waitFor(() => expect(inbox().textContent).toMatch(/\d/));

    // And it landed unfiled, because the drawer is a layer over a board rather
    // than a place you are standing — even if that board is a folder.
    fireEvent.click(inbox());
    await waitFor(() => expect(drawer()).toBeNull());
    const card = await screen.findByRole("button", { name: /zzzwrittenontheshelf/i });
    expect(card.getAttribute("data-filed")).toBe("false");
  });

  it("walks the shelf with the arrow keys, the way the strip does sideways", async () => {
    await boardIsUp();
    openDrawer();

    const inbox = within(drawer()!).getByRole("tab", { name: /^inbox/i });
    expect(document.activeElement).toBe(inbox);
    fireEvent.keyDown(inbox, { key: "ArrowDown" });

    // One row down from the Inbox, which with no folders made yet is Archive:
    // the drawer takes the strip's own list, so it takes its order too.
    await waitFor(() =>
      expect(
        within(drawer()!).getByRole("tab", { name: /^archive/i }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  it("makes a board from the drawer, and long-press on its row still opens its menu", async () => {
    await boardIsUp();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: "zzzdrawertest" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // The board opens, and the drawer shuts behind it.
    await waitFor(() => expect(drawer()).toBeNull());
    expect(burger().textContent).toMatch(/zzzdrawertest/i);
    openDrawer();
    const row = await within(drawer()!).findByRole("tab", { name: /zzzdrawertest/i });

    // The tab's own gesture, unchanged: right-click (or a long press) on a
    // folder offers Rename and Delete. Only a folder the user made qualifies.
    fireEvent.contextMenu(row);
    expect(await screen.findByRole("button", { name: "Rename" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.contextMenu(within(drawer()!).getByRole("tab", { name: /^inbox/i }));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  // The Look sheet is half a screen so the folder can be seen taking its new
  // mark (DESIGN.md §2b). Opened from the drawer, the drawer stays — the sheet
  // is what the drawer opened — and makes room above the sheet, bringing the
  // row being dressed up into it rather than leaving it under the sheet with
  // an empty drawer showing above (review 2026-10-01 follow-up).
  it("keeps the drawer under a folder's Look sheet, with that row brought above it", async () => {
    const seen: Element[] = [];
    const had = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      seen.push(this);
    };
    try {
      await boardIsUp();
      openDrawer();
      fireEvent.click(screen.getByRole("button", { name: /new board/i }));
      const field = screen.getByLabelText("New board name");
      fireEvent.change(field, { target: { value: "zzzdressedrow" } });
      fireEvent.keyDown(field, { key: "Enter" });
      await waitFor(() => expect(drawer()).toBeNull());
      openDrawer();
      const row = await within(drawer()!).findByRole("tab", { name: /zzzdressedrow/i });
      const id = row.getAttribute("data-board-id");

      const panel = () => document.querySelector(".shelf");
      expect(panel()!.hasAttribute("data-dressing")).toBe(false);

      fireEvent.contextMenu(row);
      fireEvent.click(await screen.findByRole("button", { name: "Look" }));
      expect(await screen.findByRole("group", { name: /how zzzdressedrow looks/i })).toBeTruthy();

      expect(drawer()).toBeTruthy();
      expect(panel()!.getAttribute("data-dressing")).toBe(id);
      await waitFor(() => expect(seen).toContain(within(drawer()!).getByRole("tab", { name: /zzzdressedrow/i })));

      fireEvent.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() =>
        expect(screen.queryByRole("group", { name: /how zzzdressedrow looks/i })).toBeNull(),
      );
      expect(drawer()).toBeTruthy();
      expect(panel()!.hasAttribute("data-dressing")).toBe(false);
    } finally {
      Element.prototype.scrollIntoView = had;
    }
  });

  it("renames a folder from its row, and the burger follows", async () => {
    await boardIsUp();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: /new board/i }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: "zzzshelfrename" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(drawer()).toBeNull());
    openDrawer();

    const row = await within(drawer()!).findByRole("tab", { name: /zzzshelfrename/i });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole("button", { name: "Rename" }));
    const renameField = screen.getByLabelText("Board name");
    fireEvent.change(renameField, { target: { value: "zzzshelfrenamed" } });
    fireEvent.keyDown(renameField, { key: "Enter" });

    const renamed = await within(drawer()!).findByRole("tab", { name: /zzzshelfrenamed/i });
    fireEvent.click(renamed);
    await waitFor(() => expect(burger().textContent).toMatch(/zzzshelfrenamed/i));
  });

  /**
   * The reorder rows are named for the shelf that is on screen, and this is the
   * shelf that makes that necessary. A drawer is vertical, so a folder moving
   * one step towards the Inbox travels **up** — and "Move left", which is what
   * the same two rows say on the strip (`App.test.tsx`), would be describing a
   * shelf the reader is not looking at. One branch in JS off `useIsPhone`, the
   * same way this whole component is reached.
   */
  it("names the reorder rows for the drawer's own axis, not the strip's", async () => {
    await boardIsUp();

    for (const name of ["zzzupdowna", "zzzupdownb"]) {
      openDrawer();
      fireEvent.click(screen.getByRole("button", { name: /new board/i }));
      const field = screen.getByLabelText("New board name");
      fireEvent.change(field, { target: { value: name } });
      fireEvent.keyDown(field, { key: "Enter" });
      await waitFor(() => expect(drawer()).toBeNull());
    }
    openDrawer();

    const last = within(drawer()!).getByRole("tab", { name: /zzzupdownb/i });
    fireEvent.contextMenu(last);
    expect(await screen.findByRole("button", { name: "Move up" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Move left" })).toBeNull();
    // Archive is in the same run now (2026-10-23), so the last folder can
    // step down past it too.
    expect(screen.queryByRole("button", { name: "Move down" })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Move up" }));

    // The drawer behind the menu is already wearing the new order — the menu
    // stays open so a folder can be walked several places without re-opening
    // it, which is what makes an order you can change in practice.
    await waitFor(() => {
      const names = within(drawer()!)
        .getAllByRole("tab")
        .map((tab) => tab.textContent ?? "");
      expect(names.findIndex((n) => /zzzupdownb/i.test(n))).toBeLessThan(
        names.findIndex((n) => /zzzupdowna/i.test(n)),
      );
    });
    expect(await screen.findByRole("button", { name: "Move down" })).toBeTruthy();
  });


  /**
   * The closing flash. jsdom has no Web Animations, so the drawer normally
   * takes `animates()`'s other branch and closes instantly — which is why this
   * one stubs `animate` rather than trusting the default path: the bug lives
   * entirely in the options object, and only a browser would ever have shown
   * it.
   *
   * Without `fill: "forwards"` the animation releases the element the instant
   * it finishes, dropping the drawer back to its resting `translateX(0)` —
   * fully open — for the frames between `onfinish` and React unmounting it.
   * That is the flash: the whole drawer reappearing at the end of every close.
   */
  it("holds the drawer off-screen after it has closed, rather than letting it snap back", async () => {
    const calls: KeyframeAnimationOptions[] = [];
    const original = Element.prototype.animate;
    Element.prototype.animate = function (
      this: Element,
      keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
      options?: number | KeyframeAnimationOptions,
    ) {
      if (typeof options === "object" && options) calls.push(options);
      const anim = { onfinish: null as (() => void) | null, cancel() {}, finish() {} };
      // Land it on the next tick, the way a real one would.
      queueMicrotask(() => anim.onfinish?.());
      return anim as unknown as Animation;
    } as typeof Element.prototype.animate;

    try {
      await boardIsUp();
      openDrawer();
      expect(drawer()).toBeTruthy();
      calls.length = 0;

      // Off the drawer, which is the gesture that showed the flash.
      fireEvent.click(screen.getByRole("button", { name: "Close boards" }));
      await waitFor(() => expect(drawer()).toBeNull());

      expect(calls.length).toBeGreaterThan(0);
      const out = calls[calls.length - 1];
      expect(out.fill).toBe("forwards");
    } finally {
      Element.prototype.animate = original;
    }
  });

  /**
   * The shelf is a line and a horizontal swipe walks it (SPEC §6). The drawer
   * hangs off the left edge of that line, so carrying on leftwards from the
   * first board is not an edge at all — it is the next thing along, and the
   * drawer is what is there. The pull that used to spend itself on a rubber
   * band now opens the shelf.
   */
  describe("pulling past the first board", () => {
    const deck = () => document.querySelector("#board-panel")!;
    function swipe(from: number, to: number) {
      const el = deck();
      fireEvent.touchStart(el, { touches: [{ clientX: from, clientY: 300 }] });
      fireEvent.touchMove(el, { touches: [{ clientX: to, clientY: 300 }] });
      fireEvent.touchEnd(el, { changedTouches: [{ clientX: to, clientY: 300 }] });
    }

    it("opens the drawer on the Inbox, which is the near end of the shelf", async () => {
      await boardIsUp();
      expect(burger().textContent).toMatch(/inbox/i);
      expect(drawer()).toBeNull();

      swipe(100, 300);

      await waitFor(() => expect(drawer()).toBeTruthy());
      // The pull opened the shelf; it did not also move along it.
      expect(burger().textContent).toMatch(/inbox/i);
    });

    it("pages instead, anywhere there is still a board to the left", async () => {
      await boardIsUp();
      // Leftwards is forwards along the shelf. Which board that is depends on
      // whether a folder exists — the places run first now, and the tests above
      // have made some — so what is asserted is that it *moved*, which is the
      // whole difference between this and the drawer-opening pull above.
      swipe(300, 100);
      await waitFor(() => expect(burger().textContent).not.toMatch(/inbox/i));
      expect(drawer()).toBeNull();

      // Back the other way there is a board waiting, so the drawer stays shut.
      swipe(100, 300);
      await waitFor(() => expect(burger().textContent).toMatch(/inbox/i));
      expect(drawer()).toBeNull();
    });

    it("leaves a short pull as nothing at all", async () => {
      await boardIsUp();
      swipe(100, 130);
      await waitFor(() => expect(burger().textContent).toMatch(/inbox/i));
      expect(drawer()).toBeNull();
    });
  });

  it("gives search the row's own slot, and takes the drawer down with it", async () => {
    await boardIsUp();
    openDrawer();
    expect(drawer()).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(drawer()).toBeNull());
    expect(await screen.findByLabelText("Search notes")).toBeTruthy();
    // The shelf's slot is what search took — the burger is not beside it.
    expect(screen.queryByRole("button", { name: /^boards/i })).toBeNull();
  });
  /**
   * The drawer is modal in behaviour — a full-screen dismiss button in front
   * of the page, and the board behind it `inert` — so it has to be modal in
   * markup too, and Tab has to stay in it. The header and the capture bar are
   * outside that `inert`, so Tab off the last row landed in the write field
   * behind the scrim, where what you typed was invisible.
   */
  it("says it is a modal, and keeps Tab inside itself", async () => {
    await boardIsUp();
    openDrawer();

    const panel = document.querySelector<HTMLElement>(".shelf")!;
    expect(panel.getAttribute("role")).toBe("dialog");
    expect(panel.getAttribute("aria-modal")).toBe("true");
    expect(panel.getAttribute("aria-label")).toBe("Boards");

    const focusable = [...panel.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    expect(focusable.length).toBeGreaterThan(1);
    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(panel, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);
  });

});

/**
 * The shelf from inside an open note. The note is a full-screen sheet over the
 * board row, so the burger was under it and reaching another board meant Back
 * first. The note's bar carries the same burger now and opens the same drawer
 * over the note — and every seam that makes that honest is App's: the drawer
 * stands over the sheet, Back and Escape take the drawer before the note, and
 * choosing a board closes the note on the way.
 */
describe("the shelf from inside an open note", () => {
  const sheet = () => document.querySelector<HTMLElement>(".sheet");
  const noteBurger = () => within(sheet()!).getByRole("button", { name: "Boards" });

  /**
   * A note of the test's own, so what is opened is a note and not an idea —
   * and a different one each time, because every test here writes into the
   * one shared store and the second card with the same words is ambiguous.
   */
  let made = 0;
  async function noteIsOpen() {
    await boardIsUp();
    const words = `zzzshelf note ${String.fromCharCode(97 + made++)}`;
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${words}$`, "i") }));
    await waitFor(() => expect(sheet()).toBeTruthy());
  }

  it("opens the same drawer over the note", async () => {
    await noteIsOpen();
    fireEvent.click(noteBurger());

    expect(drawer()).toBeTruthy();
    expect(document.querySelector(".shelf")!.classList.contains("shelf-over")).toBe(true);
    expect(noteBurger().getAttribute("aria-expanded")).toBe("true");
    // Opening the shelf is not leaving the note.
    expect(sheet()).toBeTruthy();
  });

  it("goes to the board you choose, and closes the note on the way", async () => {
    await noteIsOpen();
    fireEvent.click(noteBurger());
    fireEvent.click(within(drawer()!).getByRole("tab", { name: /links/i }));

    await waitFor(() => expect(sheet()).toBeNull());
    await waitFor(() => expect(drawer()).toBeNull());
    expect(burger().textContent).toMatch(/links/i);
  });

  it("takes Escape itself, and hands the focus back to the note's burger", async () => {
    await noteIsOpen();
    fireEvent.click(noteBurger());
    fireEvent.keyDown(drawer()!, { key: "Escape" });

    await waitFor(() => expect(drawer()).toBeNull());
    expect(sheet()).toBeTruthy();
    expect(document.activeElement).toBe(noteBurger());
  });

  it("closes on Back before the note does", async () => {
    await noteIsOpen();
    fireEvent.click(noteBurger());

    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(sheet()).toBeTruthy();

    // The one history entry went back on, so the next Back is the note's.
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(sheet()).toBeNull());
  });
});

/**
 * The same drawer on a desktop, where the strip is still on screen behind it.
 * The owner asked for the burger there too (2026-09-16): a strip with more
 * folders than fit hides the rest behind a sideways scroll, and the drawer
 * shows the whole shelf at once. These tests put the viewport back to the
 * suite's default desktop width, which is where the rest of `App.test.tsx`
 * already runs.
 */
describe("the board shelf on a desktop", () => {
  beforeEach(() => {
    window.innerWidth = DESKTOP_WIDTH;
    window.dispatchEvent(new Event("resize"));
  });

  const row = () => document.querySelector<HTMLElement>(".board-row")!;
  const desktopBurger = () => within(row()).getByRole("button", { name: "Boards" });
  const stripNav = () => document.querySelector<HTMLElement>("div.boards")!;
  const dialog = () => screen.queryByRole("dialog", { name: "Boards" });

  it("keeps the strip and puts the burger first in the row", async () => {
    await boardIsUp();
    // The strip is there, so this is not the phone shape.
    expect(stripNav()).toBeTruthy();
    // The burger is the row's first control.
    const first = row().querySelector("button")!;
    expect(first).toBe(desktopBurger());
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the same drawer over the strip, with the rows carrying no tab ids", async () => {
    await boardIsUp();
    fireEvent.click(desktopBurger());

    const list = within(dialog()!).getByRole("tablist", { name: "Boards" });
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    expect(desktopBurger().getAttribute("aria-expanded")).toBe("true");

    // The strip is still in the document behind it and owns the ids, so no
    // drawer row may repeat one — duplicate ids are invalid markup.
    expect(within(stripNav()).getAllByRole("tab").length).toBeGreaterThan(0);
    for (const tab of within(list).getAllByRole("tab")) {
      expect(tab.id).toBe("");
    }
    const ids = Array.from(document.querySelectorAll("[id^='board-tab-']")).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("goes to the board you choose, and hands the focus back to the burger", async () => {
    await boardIsUp();
    fireEvent.click(desktopBurger());
    const list = within(dialog()!).getByRole("tablist", { name: "Boards" });
    fireEvent.click(within(list).getByRole("tab", { name: /links/i }));

    await waitFor(() => expect(dialog()).toBeNull());
    const stripTab = within(stripNav()).getByRole("tab", { name: /links/i });
    expect(stripTab.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(desktopBurger());
  });

  /**
   * An open note covers the strip on a desktop too, so the note's own bar
   * carries the burger at every width now — before, reaching another board
   * from a note there meant Back first.
   */
  it("is reached from inside an open note, which closes on the way", async () => {
    await boardIsUp();
    const words = "zzzshelf desktop note";
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${words}$`, "i") }));
    const sheet = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".sheet");
      expect(el).toBeTruthy();
      return el!;
    });

    fireEvent.click(within(sheet).getByRole("button", { name: "Boards" }));
    const list = within(dialog()!).getByRole("tablist", { name: "Boards" });
    expect(document.querySelector(".shelf")!.classList.contains("shelf-over")).toBe(true);
    fireEvent.click(within(list).getByRole("tab", { name: /links/i }));

    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    const stripTab = within(stripNav()).getByRole("tab", { name: /links/i });
    expect(stripTab.getAttribute("aria-selected")).toBe("true");
  });

  /**
   * The phone's order, held at the desktop width too: SPEC §6 promises Back
   * and Escape take the drawer first and the note second at every width, and
   * the phone block above is the only other place that says so.
   */
  describe("over an open note, Back and Escape take the drawer first", () => {
    let made = 0;
    const sheet = () => document.querySelector<HTMLElement>(".sheet");
    const noteBurger = () => within(sheet()!).getByRole("button", { name: "Boards" });
    async function noteIsOpen() {
      await boardIsUp();
      const words = `zzzshelf desktop over ${String.fromCharCode(97 + made++)}`;
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${words}$`, "i") }));
      await waitFor(() => expect(sheet()).toBeTruthy());
      fireEvent.click(noteBurger());
      expect(dialog()).toBeTruthy();
    }

    it("Escape", async () => {
      await noteIsOpen();
      fireEvent.keyDown(dialog()!, { key: "Escape" });
      await waitFor(() => expect(dialog()).toBeNull());
      expect(sheet()).toBeTruthy();
      expect(document.activeElement).toBe(noteBurger());
    });

    it("Back", async () => {
      await noteIsOpen();
      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() => expect(dialog()).toBeNull());
      expect(sheet()).toBeTruthy();

      window.dispatchEvent(new PopStateEvent("popstate"));
      await waitFor(() => expect(sheet()).toBeNull());
    });
  });

  it("closes when search takes the row", async () => {
    await boardIsUp();
    fireEvent.click(desktopBurger());
    expect(dialog()).toBeTruthy();

    fireEvent.click(within(row()).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(dialog()).toBeNull());
  });
});

/**
 * The strip's hold, said along the drawer's axis: a row held and carried up or
 * down moves along its own run, and the drawer stays open so the next row can
 * be moved without opening it again. jsdom lays nothing out, so the rows are
 * laid out here — 44px each, stacked in the order the DOM holds them.
 */
describe("carrying a row in the drawer", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const list = this.closest('[role="tablist"]');
      const rows = list ? [...list.querySelectorAll<HTMLElement>("[data-board-id]")] : [];
      const i = rows.indexOf(this);
      const top = i >= 0 ? i * 44 : 0;
      const height = i >= 0 ? 44 : 100_000;
      return { top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("moves a lens down the drawer, and the drawer stays open", async () => {
    await boardIsUp();
    openDrawer();
    const rowIds = () =>
      [...drawer()!.querySelectorAll<HTMLElement>("[data-board-id]")].map((r) => r.dataset.boardId!);
    const lensIds = () => rowIds().filter((id) => ["todos", "links", "files"].includes(id));
    const middleOf = (id: string) => rowIds().indexOf(id) * 44 + 22;
    const [first, second, third] = lensIds();

    const row = drawer()!.querySelector<HTMLElement>(`[data-board-id="${first}"]`)!;
    const at = { pointerId: 3, pointerType: "touch", clientX: 40 };
    fireEvent.pointerDown(row, { ...at, clientY: middleOf(first) });
    await act(() => new Promise((resolve) => setTimeout(resolve, LONG_PRESS_MS + 100)));
    expect(row.getAttribute("data-lifted")).toBe("true");
    fireEvent.pointerMove(row, { ...at, clientY: middleOf(third) + 10 });
    fireEvent.pointerUp(row, { ...at, clientY: middleOf(third) + 10 });
    fireEvent.click(row, { detail: 1 });

    await waitFor(() => expect(lensIds()).toEqual([second, third, first]));
    // Still open, and still on the board it was opened over.
    expect(drawer()).toBeTruthy();
    expect(burger().textContent).toMatch(/inbox/i);
  });
});
