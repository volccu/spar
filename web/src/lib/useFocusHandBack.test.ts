// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cardSlot, handFocusToCard } from "./useFocusHandBack";

/**
 * Where the focus goes after Move or Ctrl+Z took a card off the board or put
 * one back. It used to fall back to slot 0 whenever nothing held a card, and
 * to focus without `preventScroll` — so a mouse user scrolled far down a board
 * who pressed Ctrl+Z was thrown back to the top of it, and a touch user who
 * moved cards 2 and 40 was taken to slot 2.
 */

let scroller: HTMLDivElement;
let grid: HTMLDivElement;

/** A board of `n` cards, each 100px tall, in a scroller whose window is `view` tall. */
function board(n: number, view = 500) {
  scroller = document.createElement("div");
  scroller.className = "scroll";
  grid = document.createElement("div");
  grid.innerHTML = Array.from({ length: n }, (_, i) => `<button class="card" data-id="n${i}"></button>`).join("");
  scroller.append(grid);
  document.body.append(scroller);
  // jsdom has no layout: put the cards where a scrolled board would have them.
  // `scrollTop` is what the reader has scrolled past.
  scroller.getBoundingClientRect = () => rect(0, view);
  return {
    scrollTo(top: number) {
      grid.querySelectorAll<HTMLElement>(".card").forEach((card, i) => {
        card.getBoundingClientRect = () => rect(i * 100 - top, 100);
      });
    },
  };
}

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON() {} } as DOMRect;
}

const card = (id: string) => grid.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const later = (ms = 300) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("cardSlot", () => {
  it("is the place of the first card named, and -1 when none is on the board", () => {
    board(5);
    expect(cardSlot(grid, ["n3", "n1"])).toBe(1);
    expect(cardSlot(grid, [])).toBe(-1);
    expect(cardSlot(grid, ["gone"])).toBe(-1);
  });
});

describe("handFocusToCard", () => {
  it("lands a keyboard user on the neighbour that fills the slot, without scrolling", async () => {
    const view = board(6);
    view.scrollTo(0);
    const slot = cardSlot(grid, ["n2"]);
    card("n2").remove();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    handFocusToCard(grid, [], slot);
    await later();
    expect(document.activeElement).toBe(card("n3"));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("keeps the last card when the one that left was the last", async () => {
    board(3).scrollTo(0);
    const slot = cardSlot(grid, ["n2"]);
    card("n2").remove();
    handFocusToCard(grid, [], slot);
    await later();
    expect(document.activeElement).toBe(card("n1"));
  });

  it("does not invent a place at slot 0 when nothing held a card", async () => {
    // Card 0 is in plain view and the focus is on the page (a mouse): a card
    // leaves, and the focus stays where it was.
    board(6).scrollTo(0);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const slot = cardSlot(grid, []);
    card("n4").remove();
    handFocusToCard(grid, ["n4"], slot);
    await later();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("does not hand the focus to a neighbour the reader cannot see", async () => {
    // Cards 2 and 40 moved by a touch user who is looking at 40: slot 2's
    // neighbour is far above the window.
    board(60).scrollTo(4000);
    const slot = cardSlot(grid, ["n2", "n40"]);
    card("n2").remove();
    card("n40").remove();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    handFocusToCard(grid, [], slot);
    await later();
    expect(focus).not.toHaveBeenCalled();
  });

  it("gives the card acted on the focus once it is back, without scrolling to it", async () => {
    board(6).scrollTo(0);
    card("n4").remove();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    handFocusToCard(grid, ["n4"], -1);
    await later(10);
    // The reversal draws it a moment later.
    const back = document.createElement("button");
    back.className = "card";
    back.dataset.id = "n4";
    grid.append(back);
    back.getBoundingClientRect = () => rect(200, 100);
    await later();
    expect(document.activeElement).toBe(back);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("leaves the focus where it is when it has gone somewhere that is not a card", async () => {
    board(6).scrollTo(0);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    card("n2").remove();
    handFocusToCard(grid, [], 2);
    await later();
    expect(document.activeElement).toBe(field);
  });
});
