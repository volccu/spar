// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";
import { writeSetting } from "./lib/settings";

/*
 * The phone's board row can stand at the foot, on the capture bar, where the
 * thumb is (Settings' `boardRow`, 2026-10-11, owner approved; `rowAtFoot` in
 * App.tsx). It is the one row either way, rendered before the grid or after
 * it so the reading and Tab order follow the screen. jsdom lays nothing out,
 * so what is held here is the structure — which side of `<main>` the row is
 * on, whether it is `hidden` — and that search and the drawer still work from
 * it. Where it lands in pixels is the stylesheet's (`styles.test.ts`) and the
 * screenshots'.
 */

const DESKTOP_WIDTH = window.innerWidth;
const DESKTOP_HEIGHT = window.innerHeight;

function widthIs(px: number) {
  window.innerWidth = px;
  window.dispatchEvent(new Event("resize"));
}

afterEach(() => {
  cleanup();
  writeSetting("boardRow", "top");
  window.innerHeight = DESKTOP_HEIGHT;
});
afterAll(() => widthIs(DESKTOP_WIDTH));

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
  widthIs(DESKTOP_WIDTH);
});

async function boardIsUp() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
}

const app = () => document.querySelector<HTMLElement>(".app")!;
const row = () => document.querySelector<HTMLElement>(".board-row")!;
const main = () => document.querySelector<HTMLElement>("main.scroll")!;
const bar = () => document.querySelector<HTMLElement>("form.capture")!;
const field = () => screen.getByLabelText("Write a note") as HTMLTextAreaElement;

/** Where the row stands among the app's own children: before the grid, or
 *  after it and before the capture bar. */
function rowSide(): "top" | "bottom" {
  const kids = [...app().children];
  const at = kids.indexOf(row());
  expect(at, "the row is a child of the app").toBeGreaterThan(-1);
  if (at < kids.indexOf(main())) return "top";
  expect(at, "a row at the foot stands before the capture bar").toBeLessThan(kids.indexOf(bar()));
  return "bottom";
}

describe("the board row on a phone", () => {
  beforeEach(() => widthIs(390));

  it("stands above the grid by default, exactly as before", async () => {
    await boardIsUp();
    expect(rowSide()).toBe("top");
    expect(app().dataset.boardRow).toBeUndefined();
    expect(row().hidden).toBe(false);
  });

  it("stands after the grid and before the bar when the setting says bottom", async () => {
    writeSetting("boardRow", "bottom");
    await boardIsUp();
    expect(rowSide()).toBe("bottom");
    expect(app().dataset.boardRow).toBe("bottom");
    // The same row: the one control that opens the drawer, and search's mark.
    expect(within(row()).getByRole("button", { name: /^boards:/i })).toBeTruthy();
    expect(within(row()).getByRole("button", { name: "Search" })).toBeTruthy();
    fireEvent.click(within(row()).getByRole("button", { name: /^boards:/i }));
    expect(screen.getByRole("dialog", { name: "Boards" })).toBeTruthy();
  });

  it("moves the moment the setting changes, with no reload", async () => {
    await boardIsUp();
    expect(rowSide()).toBe("top");
    act(() => writeSetting("boardRow", "bottom"));
    expect(rowSide()).toBe("bottom");
    act(() => writeSetting("boardRow", "top"));
    expect(rowSide()).toBe("top");
  });

  it("stands down while the write field holds the caret, and comes back after", async () => {
    writeSetting("boardRow", "bottom");
    await boardIsUp();
    expect(row().hidden).toBe(false);

    act(() => field().focus());
    expect(row().hidden).toBe(true);

    // Another control in the bar taking the focus is not the keyboard: the
    // row comes back rather than vanishing as the menu opens.
    act(() => screen.getByRole("button", { name: "Menu" }).focus());
    expect(row().hidden).toBe(false);

    act(() => field().focus());
    expect(row().hidden).toBe(true);
    act(() => field().blur());
    expect(row().hidden).toBe(false);
  });

  it("never hides the row at the top for the write field", async () => {
    await boardIsUp();
    act(() => field().focus());
    expect(row().hidden).toBe(false);
  });

  it("opens search in the row at the foot, and the search works", async () => {
    writeSetting("boardRow", "bottom");
    await boardIsUp();
    const words = "zzzbottomrow findable words";
    fireEvent.change(field(), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await screen.findByRole("button", { name: new RegExp(`${words}$`, "i") });

    fireEvent.click(within(row()).getByRole("button", { name: "Search" }));
    const search = within(row()).getByLabelText("Search notes");
    expect(rowSide()).toBe("bottom");
    fireEvent.change(search, { target: { value: "zzzbottomrow" } });

    await waitFor(() => {
      const cards = [...document.querySelectorAll<HTMLElement>(".card[data-id]")];
      expect(cards).toHaveLength(1);
    });
    expect(screen.getByRole("button", { name: new RegExp(`${words}$`, "i") })).toBeTruthy();

    // The row's one mark clears, then closes, from the foot as from the top.
    fireEvent.click(within(row()).getByRole("button", { name: "Clear search" }));
    expect((search as HTMLInputElement).value).toBe("");
    fireEvent.click(within(row()).getByRole("button", { name: "Close search" }));
    expect(within(row()).queryByLabelText("Search notes")).toBeNull();
    expect(rowSide()).toBe("bottom");
  });

  it("stays at the top on a short screen, where the folded header rides in it", async () => {
    writeSetting("boardRow", "bottom");
    window.innerHeight = 420;
    await boardIsUp();
    expect(rowSide()).toBe("top");
    expect(app().dataset.boardRow).toBeUndefined();
  });
});

describe("the board row on a desktop", () => {
  it("ignores the setting: the strip is always at the top", async () => {
    writeSetting("boardRow", "bottom");
    await boardIsUp();
    expect(document.querySelector("div.boards")).toBeTruthy();
    expect(rowSide()).toBe("top");
    expect(app().dataset.boardRow).toBeUndefined();
    act(() => field().focus());
    expect(row().hidden).toBe(false);
  });
});
