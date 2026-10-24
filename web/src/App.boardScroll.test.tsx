// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Each board keeps its own place in the one scroller, and the board you are
 * already on, chosen again, goes to the top — `lib/useBoardScroll.ts`, through
 * the whole app, because every interesting thing about it is a seam: the
 * strip, the drawer, the swipe, search borrowing the grid, a capture, and the
 * drawer standing over an open note.
 *
 * jsdom lays nothing out, so `scrollTop` is simply what was last written to
 * it and the browser never clamps it; a scroll is "the reader scrolled" by
 * writing it and firing the event, which is all the scroller's own handler
 * reads. Paging does not animate here (no Web Animations), so a board arrives
 * in the same act as the tap that asked for it.
 */

const DESKTOP_WIDTH = window.innerWidth;

afterEach(cleanup);
afterAll(() => {
  window.innerWidth = DESKTOP_WIDTH;
  window.dispatchEvent(new Event("resize"));
});

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  window.innerWidth = DESKTOP_WIDTH;
  window.dispatchEvent(new Event("resize"));
});

async function boardIsUp() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

const scroller = () => document.querySelector<HTMLElement>("main.scroll")!;

/** The reader scrolling the board to `top`. */
function scrollTo(top: number) {
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
}

const stripTab = (name: RegExp) =>
  within(document.querySelector<HTMLElement>("div.boards")!).getByRole("tab", { name });
const onBoard = () =>
  document.querySelector('div.boards [role="tab"][aria-selected="true"]')?.textContent ?? "";

function swipe(from: number, to: number) {
  fireEvent.touchStart(scroller(), { touches: [{ clientX: from, clientY: 300 }] });
  fireEvent.touchMove(scroller(), { touches: [{ clientX: to, clientY: 300 }] });
  fireEvent.touchEnd(scroller(), { changedTouches: [{ clientX: to, clientY: 300 }] });
}

describe("each board keeps its place", () => {
  it("comes back to where it was left, and a board never visited starts at the top", async () => {
    await boardIsUp();
    scrollTo(640);

    fireEvent.click(stripTab(/^all/i));
    await waitFor(() => expect(onBoard()).toMatch(/^all/i));
    expect(scroller().scrollTop).toBe(0);
    scrollTo(120);

    fireEvent.click(stripTab(/^inbox/i));
    await waitFor(() => expect(onBoard()).toMatch(/^inbox/i));
    expect(scroller().scrollTop).toBe(640);

    fireEvent.click(stripTab(/^all/i));
    await waitFor(() => expect(onBoard()).toMatch(/^all/i));
    expect(scroller().scrollTop).toBe(120);
  });

  it("does the same for a board reached by the paging swipe", async () => {
    await boardIsUp();
    scrollTo(480);

    swipe(300, 60);
    await waitFor(() => expect(onBoard()).not.toMatch(/^inbox/i));
    expect(scroller().scrollTop).toBe(0);

    swipe(60, 300);
    await waitFor(() => expect(onBoard()).toMatch(/^inbox/i));
    expect(scroller().scrollTop).toBe(480);
  });

  it("is not moved by what a search scrolls, and the board comes back to its place", async () => {
    await boardIsUp();
    scrollTo(560);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByLabelText(/^Search notes/), { target: { value: "a" } });
    // The results are the mode's, not the Inbox's: scrolling them writes
    // nothing down against the board underneath.
    scrollTo(30);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => expect(scroller().scrollTop).toBe(560));
  });

  it("does not chase a capture — the new card traces itself where it lands", async () => {
    await boardIsUp();
    scrollTo(700);

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzscroll captured while down the board" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    expect(document.querySelector(".trace")).toBeTruthy();
    expect(scroller().scrollTop).toBe(700);
  });
});

describe("the board you are on, chosen again", () => {
  it("goes to the top from its strip tab, and does nothing more once there", async () => {
    await boardIsUp();
    scrollTo(900);

    fireEvent.click(stripTab(/^inbox/i));
    expect(scroller().scrollTop).toBe(0);
    expect(onBoard()).toMatch(/^inbox/i);

    // Already at the top: the tab does what it always did, which is stay.
    fireEvent.click(stripTab(/^inbox/i));
    expect(scroller().scrollTop).toBe(0);
    expect(onBoard()).toMatch(/^inbox/i);

    // And the top is now what the board remembers.
    fireEvent.click(stripTab(/^all/i));
    await waitFor(() => expect(onBoard()).toMatch(/^all/i));
    fireEvent.click(stripTab(/^inbox/i));
    await waitFor(() => expect(onBoard()).toMatch(/^inbox/i));
    expect(scroller().scrollTop).toBe(0);
  });

  it("does the same for the Trash's own pinned tab", async () => {
    await boardIsUp();
    const trash = screen.getByRole("tab", { name: /^trash/i });
    fireEvent.click(trash);
    await waitFor(() => expect(trash.getAttribute("aria-selected")).toBe("true"));
    scrollTo(300);

    fireEvent.click(trash);
    expect(scroller().scrollTop).toBe(0);
    expect(trash.getAttribute("aria-selected")).toBe("true");
  });
});

describe("on a phone", () => {
  beforeEach(() => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
  });

  const headerRow = () => screen.getByRole("button", { name: /^boards:/i });
  const drawer = () => screen.queryByRole("dialog", { name: "Boards" });

  it("leaves the header row opening the drawer, whose row for this board goes to the top", async () => {
    await boardIsUp();
    scrollTo(800);

    // The one control that opens the drawer is still only that.
    fireEvent.click(headerRow());
    expect(drawer()).toBeTruthy();
    expect(scroller().scrollTop).toBe(800);

    const list = within(drawer()!).getByRole("tablist", { name: "Boards" });
    fireEvent.click(within(list).getByRole("tab", { name: /^inbox/i }));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(scroller().scrollTop).toBe(0);
  });

  it("keeps the board's place when the drawer over an open note chooses that board", async () => {
    await boardIsUp();
    const words = "zzzscroll note over its own board";
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    scrollTo(350);

    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`${words}$`, "i") }));
    const sheet = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".sheet");
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Boards" }));
    const list = within(drawer()!).getByRole("tablist", { name: "Boards" });
    fireEvent.click(within(list).getByRole("tab", { name: /^inbox/i }));

    // The note shrinks back into its card, and the card is still where it
    // was: the board was not sent to the top from under it.
    await waitFor(() => expect(document.querySelector(".sheet")).toBeNull());
    expect(scroller().scrollTop).toBe(350);
  });
});
