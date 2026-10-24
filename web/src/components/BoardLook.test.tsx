// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardIcon, BoardLook, FolderGlyph, useBoardIcons } from "./BoardLook";
import type { ReactElement } from "react";

/**
 * An `IntersectionObserver` the test drives by hand. jsdom has none, and
 * without one the grid draws the whole set at once (`PAGE` in BoardLook.tsx) —
 * so this stands in, and `scrollToEnd` says the marker after the last cell has
 * come into reach, as a scroll to the bottom of the grid would.
 */
const observers = new Set<FakeObserver>();
class FakeObserver {
  private targets: Element[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.add(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  disconnect() {
    observers.delete(this);
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
  fire() {
    const entries = this.targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}
const scrollToEnd = () => act(() => [...observers].forEach((o) => o.fire()));

beforeEach(() => vi.stubGlobal("IntersectionObserver", FakeObserver));
afterEach(() => {
  cleanup();
  observers.clear();
  vi.unstubAllGlobals();
});

function open(props: Partial<Parameters<typeof BoardLook>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <BoardLook
      name="Recipes"
      icon={null}
      color={null}
      onPick={onPick}
      onClose={onClose}
      {...props}
    />,
  );
  return { onPick, onClose };
}

const cells = () => document.querySelectorAll(".look-icons button.look-icon");
const labels = () => Array.from(cells(), (b) => b.getAttribute("aria-label"));

/** The panel loads the set on mount; nothing below is true before it lands. */
const ready = () =>
  waitFor(() => {
    expect(cells().length).toBeGreaterThan(50);
    return document.querySelector(".look-icons") as HTMLElement;
  });

/** Types into the filter, and waits for the search (a chunk of its own) to answer. */
async function find(words: string) {
  fireEvent.change(screen.getByLabelText("Find a mark"), { target: { value: words } });
  await waitFor(() => expect(screen.queryByText(/loading marks/i)).toBeNull());
}

describe("dressing a board", () => {
  it("offers the Lucide set a page at a time, and the folder it starts with", async () => {
    open();
    const grid = await ready();
    expect(
      within(grid).getByRole("button", { name: /^default mark$/i }),
    ).toBeTruthy();
    // Some 1,850 marks would be some 6,000 SVG nodes on the frame the sheet
    // slides in. The folder, the fifteen suggestions and one page are drawn…
    const first = cells().length;
    expect(first).toBeLessThanOrEqual(1 + 15 + 96);
    // …and the next page arrives as the grid nears its end. The app attaches
    // its observer after the page is drawn, which can land a frame later on a
    // busy machine, so wait for it before saying the end is in reach.
    await waitFor(() => expect(observers.size).toBeGreaterThan(0));
    scrollToEnd();
    expect(cells().length).toBeGreaterThan(first);
    // The set itself is Lucide's, behind its own prefix.
    expect(labels()).toContain("binoculars");
  });

  it("offers the marks a folder is usually named by first, then the set, once each", async () => {
    open();
    const grid = await ready();
    // The folder, then the suggestions — not letter marks and thirty arrows.
    expect(labels().slice(0, 5)).toEqual([
      "Default mark",
      "house",
      "book open",
      "shopping cart",
      "heart",
    ]);
    expect(grid.querySelector(".look-break")).toBeTruthy();
    expect(labels().filter((l) => l === "house")).toHaveLength(1);
  });

  it("narrows the set from the field, and says so when nothing matches", async () => {
    open();
    const grid = await ready();
    const all = cells().length;

    await find("book");
    const narrowed = cells().length;
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(all);
    // The default cell is the app's, not the set's, so it leaves while a query
    // is running rather than pretending to be a search result.
    expect(within(grid).queryByRole("button", { name: /the default mark/i })).toBeNull();

    await find("zzzz");
    expect(cells()).toHaveLength(0);
    expect(screen.getByText(/no mark by that name/i)).toBeTruthy();
  });

  it("finds a mark by what the folder is about — fishing gear for Fishing", async () => {
    open({ name: "Fishing" });
    await ready();
    await find("fishing");
    // The owner's example: the old set had nothing for it at all.
    expect(labels().slice(0, 3)).toEqual(expect.arrayContaining(["fishing rod", "fishing hook"]));
    expect(labels()).toContain("fish");
  });

  it("searches the whole set, not only the page that is drawn", async () => {
    open();
    await ready();
    // `zap` is near the end of the alphabet, far past the first page.
    expect(labels()).not.toContain("zap");
    await find("zap");
    expect(labels()).toContain("zap");
  });

  it("writes a mark straight through, with no Save to press", async () => {
    const { onPick } = open();
    await ready();
    await find("beaker");
    fireEvent.click(screen.getByRole("button", { name: "beaker" }));
    expect(onPick).toHaveBeenCalledWith({ icon: "lucide:beaker" });
  });

  it("keeps a folder's older Heroicons mark, shown first and chosen", async () => {
    // Folders dressed before Lucide store a Heroicons name, and nothing
    // rewrites it. The sheet no longer offers that set, so the board's own
    // mark stands at the front, pressed — nothing looks lost.
    open({ icon: "PaintBrushIcon" });
    await ready();
    const chosen = cells()[1] as HTMLElement;
    expect(chosen.getAttribute("aria-label")).toBe("paint brush");
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(chosen.querySelector("svg")).toBeTruthy();
    // And the swatches wear it, not the folder.
    const swatch = document.querySelector("button.look-swatch svg") as SVGElement;
    expect(swatch.outerHTML).toBe(chosen.querySelector("svg")!.outerHTML);
  });

  it("brings a chosen mark from deep in the set to the front", async () => {
    open({ icon: "lucide:zap" });
    await ready();
    const chosen = cells()[1] as HTMLElement;
    expect(chosen.getAttribute("aria-label")).toBe("zap");
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(labels().filter((l) => l === "zap")).toHaveLength(1);
  });

  it("offers the sixteen tints and a way back to none", async () => {
    const { onPick } = open({ color: "teal" });
    await ready();
    const swatches = document.querySelectorAll("button.look-swatch");
    expect(swatches).toHaveLength(17);

    const on = document.querySelector('button.look-swatch[aria-pressed="true"]');
    expect(on?.getAttribute("aria-label")).toBe("Forest");

    fireEvent.click(screen.getByRole("button", { name: "Plum" }));
    expect(onPick).toHaveBeenCalledWith({ color: "plum" });
    fireEvent.click(screen.getByRole("button", { name: "No colour" }));
    expect(onPick).toHaveBeenCalledWith({ color: null });
  });

  it("names a tint beside the swatches while the pointer or the keyboard is on it", async () => {
    open();
    await ready();
    const name = () => document.querySelector(".look-tint")?.textContent;
    expect(name()).toBe("");
    const plum = screen.getByRole("button", { name: "Plum" });
    fireEvent.pointerEnter(plum, { pointerType: "mouse" });
    expect(name()).toBe("Plum");
    fireEvent.pointerLeave(plum, { pointerType: "mouse" });
    expect(name()).toBe("");
    // A finger names nothing: there is no hover to show it on.
    fireEvent.pointerEnter(plum, { pointerType: "touch" });
    expect(name()).toBe("");
    fireEvent.focus(screen.getByRole("button", { name: "No colour" }));
    expect(name()).toBe("No colour");
    fireEvent.blur(screen.getByRole("button", { name: "No colour" }));
    expect(name()).toBe("");
  });

  it("draws the swatches as the board's own mark, never as blocks of colour", async () => {
    // The row is showing what the shelf is about to look like. A filled square
    // would be the one thing DESIGN.md refuses outright — colour as a slab —
    // and it would be showing something nobody is choosing.
    open({ color: "moss" });
    await ready();
    for (const swatch of document.querySelectorAll("button.look-swatch")) {
      expect(swatch.querySelector("svg")).toBeTruthy();
      expect(getComputedStyle(swatch).backgroundColor).not.toMatch(/rgb\(/);
    }
  });

  it("gives the tint to the mark and nothing else", async () => {
    open({ color: "iris" });
    await ready();
    const iris = screen.getByRole("button", { name: "Dusk" }) as HTMLElement;
    // The one property the stylesheet reads. It carries the token, never a
    // literal, so the value stays a single definition in :root.
    expect(iris.style.getPropertyValue("--board-tint")).toBe("var(--board-iris)");
    const none = screen.getByRole("button", { name: "No colour" }) as HTMLElement;
    expect(none.style.getPropertyValue("--board-tint")).toBe("");
  });

  /**
   * The filter field used to carry a bare `autoFocus`, and this sheet is a
   * bottom sheet held at 60dvh: on a phone the keyboard then came up over the
   * swatches and the mark grid — the two things the sheet exists to show. It
   * asks `hasKeyboard` now, the app's one keyboard question, which answers
   * false where it cannot be asked at all (jsdom, and so here).
   *
   * On touch the layer holds the focus itself, because a sheet where nothing
   * inside has the focus answers no key at all — the Sorter's own reason. The
   * panel, never a swatch: everything in here writes straight through with no
   * Save, so nothing may be one stray Enter from changing how a board looks.
   */
  it("keeps the caret out of the field where a keyboard would cover the sheet", async () => {
    const { onClose } = open();
    await ready();

    const panel = document.querySelector(".look") as HTMLElement;
    expect(document.activeElement).toBe(panel);
    expect(document.activeElement).not.toBe(screen.getByLabelText("Find a mark"));

    // And the key still lands, which is the whole reason the panel took it.
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape, but empties the field first when there is one", async () => {
    const { onClose } = open();
    await ready();
    const field = screen.getByLabelText("Find a mark");
    fireEvent.change(field, { target: { value: "book" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect((field as HTMLInputElement).value).toBe("");

    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("a picked mark answers hover", () => {
  it("wears icon-picked on the chosen glyph, and never on the default folder or an automatic board", async () => {
    // The default folder and the eight automatic boards are hand-drawn and move
    // their own parts; only a stock glyph has nothing to move, so only it takes
    // the generic hover class (DESIGN.md §7, 2026-10-08).
    const loaded = renderHook(() => useBoardIcons(["BookOpenIcon", "lucide:fish"]));
    await waitFor(() => expect(loaded.result.current).toBe(true));

    const picked = render(<BoardIcon kind="folder" icon="BookOpenIcon" />);
    expect(picked.container.querySelector("svg.icon-picked")).toBeTruthy();
    picked.unmount();

    const lucide = render(<BoardIcon kind="folder" icon="lucide:fish" />);
    expect(lucide.container.querySelector("svg.icon-picked")).toBeTruthy();
    lucide.unmount();

    const fallback = render(<BoardIcon kind="folder" icon="NoSuchMarkIcon" />);
    expect(fallback.container.querySelector("svg")).toBeTruthy();
    expect(fallback.container.querySelector(".icon-picked")).toBeNull();
    fallback.unmount();

    const unknown = render(<BoardIcon kind="folder" icon="lucide:no-such-mark" />);
    expect(unknown.container.querySelector(".icon-picked")).toBeNull();
    unknown.unmount();

    const inbox = render(<BoardIcon kind="inbox" icon="BookOpenIcon" />);
    expect(inbox.container.querySelector(".icon-picked")).toBeNull();
  });
});

describe("a Lucide mark beside a Heroicons one", () => {
  it("takes the app's tier classes and draws in the tint alone", async () => {
    // Size and stroke come from `.icon` and its tier in CSS (DESIGN.md §7),
    // which beat the width, height and stroke-width="2" Lucide sets as
    // attributes; the colour is currentColor, which is the folder's tint.
    const loaded = renderHook(() => useBoardIcons(["lucide:fish"]));
    await waitFor(() => expect(loaded.result.current).toBe(true));
    const { container } = render(<BoardIcon kind="folder" icon="lucide:fish" />);
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("icon")).toBe(true);
    expect(svg.classList.contains("icon-inline")).toBe(true);
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("style")).toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("fetches nothing, and is ready at once, for a shelf that wears no set's mark", () => {
    // The default folder and Inspiration's drawn mark need no set at all.
    const { result } = renderHook(() => useBoardIcons([null, undefined, "@inspiration"]));
    expect(result.current).toBe(true);
  });
});

describe("a folder's glyph, wherever a folder is named", () => {
  it("draws the chosen glyph at its tier, picked or not, and the folder for none", async () => {
    const loaded = renderHook(() => useBoardIcons(["BookOpenIcon"]));
    await waitFor(() => expect(loaded.result.current).toBe(true));
    const cls = (el: ReactElement) => {
      const { container, unmount } = render(el);
      const svg = container.querySelector("svg")!;
      const out = { cls: svg.getAttribute("class"), flap: Boolean(svg.querySelector(".icon-folder-flap")) };
      unmount();
      return out;
    };
    expect(cls(<FolderGlyph icon="BookOpenIcon" />).cls).toBe("icon icon-inline");
    expect(cls(<FolderGlyph icon="BookOpenIcon" picked />).cls).toBe("icon icon-inline icon-picked");
    expect(cls(<FolderGlyph icon="BookOpenIcon" tier="data" />).cls).toBe("icon icon-data");
    expect(cls(<FolderGlyph />).flap).toBe(true);
    expect(cls(<FolderGlyph icon="NoSuchMarkIcon" picked />)).toEqual(cls(<FolderGlyph />));
    expect(cls(<FolderGlyph on />).flap).toBe(false);
  });
});
