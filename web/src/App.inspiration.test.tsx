// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { putNote, setMeta, writeCaptureDraft } from "./store/db";
import { attachment, note } from "./test/fixtures";
import { INBOX_ALL } from "./lib/boards";
import { LONG_PRESS_MS } from "./components/NoteCard";

/*
 * The Inspiration board through the whole app: it appears by itself, sits first
 * after the one line on the lifted band, cannot be carried or dressed, and a
 * note written while standing on it is filed there. A file of its own, like
 * `App.shelf.test.tsx`, because it shares one database across its tests.
 */

const DESKTOP_WIDTH = window.innerWidth;

// Under a full-suite load a find that would take 100 ms can take seconds, so a
// test here may use the long waits below without meeting the test's own clock.
vi.setConfig({ testTimeout: 40_000 });

/**
 * Lets the frames the app waits on go by (it defers its history work to an
 * animation frame), instead of sleeping a fixed time and hoping that was
 * enough: three frames, whatever the machine's load, is what "a frame went
 * by" means.
 */
const framesGoneBy = () =>
  new Promise<void>((resolve) => {
    let left = 3;
    const tick = () => (--left <= 0 ? resolve() : window.requestAnimationFrame(tick));
    window.requestAnimationFrame(tick);
  });

afterEach(cleanup);
afterAll(() => {
  window.innerWidth = DESKTOP_WIDTH;
});

beforeEach(async () => {
  window.innerWidth = DESKTOP_WIDTH;
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function open() {
  render(<App />);
  await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
  return await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 });
}

const strip = () => [...document.querySelectorAll('.boards-tabs [role="tab"]')] as HTMLElement[];

describe("the Inspiration board on the shelf", () => {
  it("arrives by itself, first after the line, on the lifted band", async () => {
    const tab = await open();
    const tabs = strip();
    const at = tabs.indexOf(tab);
    expect(tabs[at - 1].textContent).toMatch(/Archive/i);
    expect(tabs[at + 1].textContent).toMatch(/Todos/i);
    // the lifted band starts here, with no rule drawn before it
    expect(tab.getAttribute("data-lens")).toBe("true");
    expect(tabs[at - 1].getAttribute("data-lens")).toBeNull();
    expect(document.querySelectorAll(".board-split")).toHaveLength(0);
    // and no tint, whatever
    expect(tab.getAttribute("style") ?? "").not.toMatch(/--board-tint/);
  });

  it("is not carried and has no menu to rename or delete it", async () => {
    const tab = await open();
    fireEvent.contextMenu(tab);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText(/Rename|Delete board/i)).toBeNull();
    await act(async () => {
      fireEvent.pointerDown(tab, { pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 10 });
      await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 100));
      fireEvent.pointerUp(tab, { pointerId: 1, pointerType: "touch", button: 0, clientX: 10, clientY: 10 });
    });
    expect(screen.queryByText(/Rename|Delete board/i)).toBeNull();
  });

  it("files a note written while standing on it", async () => {
    const tab = await open();
    fireEvent.click(tab);
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"), { timeout: 10_000 });
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "a window seat in the evening light" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText(/window seat in the evening light/, {}, { timeout: 10_000 })).toBeTruthy();
    // On the Inbox it is not: the note is filed, so the Inbox does not hold it.
    fireEvent.click(strip()[0]);
    await waitFor(() => expect(strip()[0].getAttribute("aria-selected")).toBe("true"), { timeout: 10_000 });
    expect(screen.queryByText(/window seat in the evening light/)).toBeNull();
  });

  it("draws the wall here and the uniform grid on every other board", async () => {
    const tab = await open();
    expect(document.querySelector(".wall")).toBeNull();
    expect(document.querySelector(".grid")).toBeTruthy();
    fireEvent.click(tab);
    await waitFor(() => expect(tab.getAttribute("aria-selected")).toBe("true"), { timeout: 10_000 });
    const field = screen.getByLabelText("Write a note");
    fireEvent.change(field, { target: { value: "a stair in a white room" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    // the wall is its own chunk, so it arrives a moment after the board does
    await waitFor(() => expect(document.querySelector(".wall .card[data-wall='true']")).toBeTruthy(), { timeout: 10_000 });
    expect(document.querySelector(".grid")).toBeNull();
    fireEvent.click(strip()[0]);
    await waitFor(() => expect(strip()[0].getAttribute("aria-selected")).toBe("true"), { timeout: 10_000 });
    expect(document.querySelector(".wall")).toBeNull();
    expect(document.querySelector(".grid")).toBeTruthy();
  });

  it("is offered in the Move chooser, as the last place", async () => {
    await open();
    fireEvent.click(document.querySelector(".card") as HTMLElement); // opens a note
    const move = await screen.findByRole("button", { name: /^move/i }, { timeout: 10_000 });
    fireEvent.click(move);
    const rows = [...document.querySelectorAll(".selpanel-scroll .selpanel-board")];
    expect(rows.at(-1)?.textContent).toMatch(/Inspiration/);
  });
});

describe("the Inspiration board in the drawer", () => {
  it("stands after the one line in the phone's drawer too", async () => {
    window.innerWidth = 390;
    window.dispatchEvent(new Event("resize"));
    render(<App />);
    await waitFor(() => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0), {
      timeout: 10_000,
    });
    fireEvent.click(screen.getByRole("button", { name: /^boards/i }));
    const rows = [...document.querySelectorAll(".shelf-row[role='tab']")] as HTMLElement[];
    const inspo = rows.find((r) => /Inspiration/i.test(r.textContent ?? ""))!;
    expect(inspo.previousElementSibling?.classList.contains("shelf-split")).toBe(true);
    expect(inspo.getAttribute("data-lens")).toBe("true");
    expect(document.querySelectorAll(".shelf-split")).toHaveLength(1);
  });
});

/*
 * The wall's viewer through the whole app: a picture tile opens it, a words-only
 * tile opens the note, Back closes it and leaves nothing standing, and "Open
 * note" hands the one history entry to the note instead of spending it.
 */
describe("the Inspiration wall's viewer", () => {
  const STAMP = new Date().toISOString();

  /** Both kinds of tile on the board, written straight into the store. */
  async function seedWall(tag: string) {
    render(<App />);
    const tab = await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 });
    const boardId = tab.getAttribute("data-board-id") ?? (tab as HTMLElement).dataset.boardId!;
    expect(boardId).toBeTruthy();
    cleanup();
    const pic = `pic-${tag}`;
    const words = `words-${tag}`;
    await putNote(
      note({
        id: pic,
        raw_content: "",
        body: "",
        board_id: boardId,
        created_at: STAMP,
        updated_at: STAMP,
        attachments: [attachment({ id: `att-${tag}`, name: `${tag}.png`, thumb: "data:image/jpeg;base64,xx" })],
      }),
    );
    await putNote(
      note({
        id: words,
        raw_content: `words only ${tag}`,
        body: `words only ${tag}`,
        board_id: boardId,
        created_at: STAMP,
        updated_at: STAMP,
      }),
    );
    render(<App />);
    const wallTab = await screen.findByRole("tab", { name: /Inspiration/i }, { timeout: 10_000 });
    fireEvent.click(wallTab);
    await waitFor(() => expect(document.querySelector(`.wall .card[data-id="${pic}"]`)).toBeTruthy(), {
      timeout: 10_000,
    });
    return {
      pic: document.querySelector(`.wall .card[data-id="${pic}"]`) as HTMLElement,
      words: document.querySelector(`.wall .card[data-id="${words}"]`) as HTMLElement,
      picName: `${tag}.png`,
    };
  }

  const popped = () => new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
  /**
   * How many of the app's history entries are on the stack right now: pushes
   * minus pops since this was called. (jsdom keeps the entries it has walked
   * back over, so `history.length` and `history.state` cannot say.)
   */
  function watchHistory() {
    let pushes = 0;
    let pops = 0;
    const real = History.prototype.pushState;
    const push = vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
      pushes += 1;
      real.apply(window.history, args);
    });
    const onPop = () => (pops += 1);
    window.addEventListener("popstate", onPop);
    return {
      depth: () => pushes - pops,
      pushes: () => pushes,
      pops: () => pops,
      stop: () => {
        push.mockRestore();
        window.removeEventListener("popstate", onPop);
      },
    };
  }
  const viewerUp = () => document.querySelector(".lightbox");
  const mainInert = () => document.querySelector("main")?.hasAttribute("inert");

  it("opens on a picture tile, and a words-only tile opens the note instead", async () => {
    const { pic, words, picName } = await seedWall("open");
    fireEvent.click(words);
    expect(await screen.findByRole("button", { name: /^move/i }, { timeout: 10_000 })).toBeTruthy();
    expect(viewerUp()).toBeNull();
    // close that note again: Back
    const back = popped();
    act(() => window.history.back());
    await back;
    await waitFor(() => expect(screen.queryByRole("button", { name: /^move/i })).toBeNull(), { timeout: 10_000 });

    fireEvent.click(pic);
    const dialog = await screen.findByRole("dialog", { name: picName }, { timeout: 10_000 });
    expect(dialog.classList.contains("lightbox")).toBe(true);
    expect(mainInert()).toBe(true);
  });

  it("closes on Back and leaves no layer, entry or inert board behind", async () => {
    const { pic, picName } = await seedWall("back");
    const h = watchHistory();
    fireEvent.click(pic);
    await screen.findByRole("dialog", { name: picName }, { timeout: 10_000 });
    expect(h.depth()).toBe(1);
    const back = popped();
    act(() => window.history.back());
    await back;
    await waitFor(() => expect(viewerUp()).toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(mainInert()).toBe(false), { timeout: 10_000 });
    expect(h.depth()).toBe(0);
    h.stop();
  });

  it("plays the close animation on Back and keeps one entry in step with it", async () => {
    const { pic, picName } = await seedWall("anim");
    const h = watchHistory();
    const animations: { onfinish: null | (() => void); cancel: () => void }[] = [];
    const animate = vi.fn(() => {
      const a = { onfinish: null as null | (() => void), cancel: () => {}, finished: Promise.resolve(), commitStyles: () => {} };
      animations.push(a);
      return a;
    });
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true, writable: true });
    try {
      fireEvent.click(pic);
      await screen.findByRole("dialog", { name: picName }, { timeout: 10_000 });
      expect(h.depth()).toBe(1);
      const back = popped();
      act(() => window.history.back());
      await back;
      // The close is running, not done: the layer is still up, and the entry has
      // been put straight back for it rather than lost under it.
      const closing = animations.filter((a) => a.onfinish);
      expect(closing).toHaveLength(1);
      expect(viewerUp()).toBeTruthy();
      expect(h.depth()).toBe(1);
      // Let the frame the app waits on go by: nothing may push a second one.
      await framesGoneBy();
      expect(h.depth()).toBe(1);
      expect(h.pushes()).toBe(2);
      expect(viewerUp()).toBeTruthy();
      // The animation ends; the layer goes and takes its one entry with it.
      const last = popped();
      act(() => closing[0].onfinish?.());
      await last;
      await waitFor(() => expect(viewerUp()).toBeNull(), { timeout: 10_000 });
      await waitFor(() => expect(mainInert()).toBe(false), { timeout: 10_000 });
      // The user's Back, the entry put back, the entry taken off: no more.
      expect(h.depth()).toBe(0);
      expect(h.pushes()).toBe(2);
      expect(h.pops()).toBe(2);
    } finally {
      h.stop();
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
    }
  });

  it("Open note closes the viewer, opens that note, and keeps the one entry", async () => {
    const { pic, picName } = await seedWall("note");
    const h = watchHistory();
    fireEvent.click(pic);
    await screen.findByRole("dialog", { name: picName }, { timeout: 10_000 });
    fireEvent.click(screen.getByRole("button", { name: "Open note" }));
    await waitFor(() => expect(viewerUp()).toBeNull(), { timeout: 10_000 });
    expect(await screen.findByRole("button", { name: /^move/i }, { timeout: 10_000 })).toBeTruthy();
    await framesGoneBy();
    // The same one entry now holds the note: nothing pushed, nothing popped.
    expect(h.pushes()).toBe(1);
    expect(h.pops()).toBe(0);
    // One Back leaves the note, and that is the last of it.
    const back = popped();
    act(() => window.history.back());
    await back;
    await waitFor(() => expect(screen.queryByRole("button", { name: /^move/i })).toBeNull(), { timeout: 10_000 });
    await waitFor(() => expect(mainInert()).toBe(false), { timeout: 10_000 });
    // The entry the note held is taken off as it closes, and not again.
    await waitFor(() => expect(h.depth()).toBe(0), { timeout: 10_000 });
    h.stop();
  });
});
