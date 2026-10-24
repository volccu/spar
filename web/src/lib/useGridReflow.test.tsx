// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGridReflow } from "./useGridReflow";

/** A grid of cards whose positions the test sets, one 100px row each. */
function Grid({ ids, grid }: { ids: string[]; grid: HTMLElement | null }) {
  useGridReflow(grid, "board", ids.join(","), () => {});
  return null;
}

function card(grid: HTMLElement, id: string) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = id;
  el.innerHTML = `<div class="card-body">words ${id}</div>`;
  el.animate = vi.fn() as unknown as HTMLElement["animate"];
  grid.appendChild(el);
  return el;
}

describe("useGridReflow", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // Audit PERF-4: a card that is off screen before and after a change moved
  // where nobody could see it, and animating it cost as much as one that did.
  it("animates only the cards that are on screen before or after", () => {
    const grid = document.createElement("div");
    document.body.appendChild(grid);
    const ids = Array.from({ length: 10 }, (_, i) => `n${i}`);
    let order = [...ids];
    const els = new Map(ids.map((id) => [id, card(grid, id)]));
    for (const [id, el] of els) {
      el.getBoundingClientRect = () => {
        const at = order.indexOf(id);
        return { left: 0, top: at * 100, width: 100, height: 100 } as DOMRect;
      };
    }
    const { rerender } = render(<Grid ids={order} grid={grid} />);

    // n0 leaves; everything after it moves up a row.
    order = ids.slice(1);
    els.get("n0")!.remove();
    rerender(<Grid ids={order} grid={grid} />);

    // On screen (0..300) after: n1, n2, n3 — n3 came up from 300. n4 was at
    // 400 and is now at 300: off screen both times, like everything below.
    for (const id of ["n1", "n2", "n3"]) expect(els.get(id)!.animate).toHaveBeenCalledTimes(1);
    for (const id of ["n4", "n5", "n9"]) expect(els.get(id)!.animate).not.toHaveBeenCalled();
  });
});
