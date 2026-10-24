// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Every find and wait in this file gets thirty seconds, and a test forty, because
 * this file was seen failing only inside the whole suite, where the machine is
 * busy and a find that takes 100 ms alone takes seconds. A longer wait costs
 * nothing when the thing arrives, and a failing test still fails — later.
 */
configure({ asyncUtilTimeout: 30_000 });
vi.setConfig({ testTimeout: 90_000 });

/*
 * `?` — the About page, opened at its list of keys (`lib/shortcuts.ts`).
 * `About.test.tsx` covers the list itself; this is the app's half: the key
 * opens the page from a board, and never from inside something being typed.
 */

const nativeScroll = Element.prototype.scrollIntoView;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = nativeScroll;
});

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

describe("? on a board", () => {
  it("opens the About page at its list of keys", async () => {
    const scrolled = vi.fn();
    // jsdom has no scrollIntoView; the page calls it on the list's heading.
    Element.prototype.scrollIntoView = scrolled;
    await open();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByRole("dialog", { name: "About spår" }, { timeout: 30_000 });
    // Drawn although jsdom answers no keyboard query: whoever pressed `?` has one.
    const heading = await screen.findByRole("heading", { name: "The keys" }, { timeout: 30_000 });
    // The app scrolls other things into view too (the board's own tab); what
    // matters is that the list's heading is one of them.
    await waitFor(() => expect(scrolled.mock.contexts).toContain(heading));
  });

  it("is a question mark and nothing more inside the write box", async () => {
    await open();
    const field = screen.getByLabelText("Write a note");
    field.focus();
    fireEvent.keyDown(field, { key: "?", shiftKey: true });
    // Give a lazy page every chance to arrive before saying it did not.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog", { name: "About spår" })).toBeNull();
  });
});

/*
 * Review 2026-10-04, UX-A-01: after a capture the caret stays in the write
 * field, and the two verbs' keys used to stand down there as they do in any
 * field — so Ctrl+K silently did nothing (or let the browser have it), and
 * Escape could not get the caret out. The write field is the one field they
 * now work from; the open note's editor is still exempt.
 */
describe("the two keys from the write field", () => {
  it("opens search from the write field and keeps what was being written", async () => {
    await open();
    const field = screen.getByLabelText<HTMLTextAreaElement>("Write a note");
    field.focus();
    fireEvent.change(field, { target: { value: "half a thought" } });
    fireEvent.keyDown(field, { key: "k", ctrlKey: true });
    const search = await screen.findByLabelText("Search notes", {}, { timeout: 10_000 });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Write a note").value).toBe("half a thought");
  });

  it("takes Ctrl+E in the write field as already answered", async () => {
    await open();
    const field = screen.getByLabelText("Write a note");
    field.focus();
    const pressed = fireEvent.keyDown(field, { key: "e", ctrlKey: true });
    // Handled, so the browser's own Ctrl+E (its address bar) is not reached.
    expect(pressed).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  it("lets Escape release the write field, empty or not, and keeps the words", async () => {
    await open();
    const field = screen.getByLabelText("Write a note") as HTMLTextAreaElement;
    field.focus();
    fireEvent.change(field, { target: { value: "still writing" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).not.toBe(field);
    expect(field.value).toBe("still writing");
    field.focus();
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).not.toBe(field);
  });
});

/*
 * Review 2026-10-01, UX-12: closing a note or search left the focus on the
 * body, so a keyboard or screen-reader user lost their place. The sheet hands
 * focus back as it unmounts, but at that moment the board under it is still
 * inert and the hand-back is refused; the app now finishes the job once the
 * board is live again.
 */
describe("closing a layer gives the focus back", () => {
  it("returns it to the card the note was opened from", async () => {
    await open();
    const card = document.querySelector<HTMLElement>(".card[data-id]")!;
    const id = card.dataset.id;
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(card);
    // Long waits: the sheet is a lazy chunk, and the suite runs under load.
    await screen.findByRole("dialog", { name: "Note" }, { timeout: 10_000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Note" })).toBeNull(), {
      timeout: 10_000,
    });
    await waitFor(
      () => expect((document.activeElement as HTMLElement | null)?.dataset?.id).toBe(id),
      { timeout: 10_000 },
    );
  });

  it("returns it to the search button when search closes", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const field = await screen.findByLabelText("Search notes", {}, { timeout: 10_000 });
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Search notes")).toBeNull(), {
      timeout: 10_000,
    });
    await waitFor(
      () => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Search" })),
      { timeout: 10_000 },
    );
  });
});

/*
 * Ctrl+K and Ctrl+E stand down under any open layer (web/CLAUDE.md). The guard
 * used to be a hand-kept list that missed About, Settings, the import and the
 * wall: Ctrl+K over About opened search behind the page. It is now the layer
 * table's `verbKeys` column; `lib/useLayerStack.test.ts` holds every row, and
 * these are the app's half, on the two pages a key opens.
 */
describe("closing Settings opened by a key", () => {
  it("returns the focus to the cog, not to the page", async () => {
    await open();
    document.querySelector<HTMLElement>(".card[data-id]")!.focus();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Settings" }, { timeout: 30_000 });
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull(), {
      timeout: 30_000,
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" })));
  });
});

describe("the two keys under a full-screen page", () => {
  const searchField = () => screen.queryByLabelText(/^Search notes/);

  it("do nothing over About", async () => {
    await open();
    fireEvent.keyDown(window, { key: "?", shiftKey: true });
    await screen.findByRole("dialog", { name: "About spår" }, { timeout: 30_000 });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    // Not handled, so not taken from the browser either.
    expect(fireEvent.keyDown(window, { key: "e", ctrlKey: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(searchField()).toBeNull();
    expect(screen.getByRole("dialog", { name: "About spår" })).toBeTruthy();
  });

  it("do nothing over Settings", async () => {
    await open();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" }, { timeout: 30_000 });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(fireEvent.keyDown(window, { key: "e", ctrlKey: true })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(searchField()).toBeNull();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });
});

/*
 * Review UX-06: Enter on a card (a click with no pointer, `detail` 0) on a
 * machine with a keyboard opens the note ready to type. The card hands the
 * flag to the note through lib/keyOpen.ts; this is the whole road through
 * the board, which a test of either half alone does not walk.
 */
describe("a note opened by a key", () => {
  function stubKeyboard() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  }
  afterEach(() => vi.unstubAllGlobals());

  async function capture(words: string) {
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(screen.getByLabelText<HTMLTextAreaElement>("Write a note").value).toBe(""));
  }
  const cardOf = (words: RegExp) =>
    Array.from(document.querySelectorAll<HTMLElement>(".card[data-id]")).find((c) =>
      words.test(c.textContent ?? ""),
    )!;

  it("puts the caret at the end of the words", async () => {
    stubKeyboard();
    await open();
    await capture("zzzkeyopen one\nand two");
    await waitFor(() => expect(cardOf(/zzzkeyopen/i)).toBeTruthy());
    fireEvent.click(cardOf(/zzzkeyopen/i), { detail: 0 });
    const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Note text" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.selectionStart).toBe(field.value.length);
  });

  it("puts the caret just after the hit when it was opened from a search", async () => {
    stubKeyboard();
    await open();
    await capture("zzzsearchopen first line\nthe zzzneedle is here\nlast line");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    // With a keyboard, the field's name carries its key: "Search notes, Ctrl+K".
    fireEvent.change(await screen.findByLabelText(/^Search notes/), {
      target: { value: "zzzneedle" },
    });
    await waitFor(() => expect(document.querySelector(".card[data-search='true']")).toBeTruthy());
    fireEvent.click(cardOf(/zzzneedle/i), { detail: 0 });
    const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Note text" });
    await waitFor(() => expect(document.activeElement).toBe(field));
    const after = field.value.indexOf("zzzneedle") + "zzzneedle".length;
    expect(field.selectionStart).toBe(after);
  });
});
