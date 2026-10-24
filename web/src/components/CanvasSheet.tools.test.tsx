// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Canvas, DrawingStroke } from "../types";
import { addStroke, removeStroke, restoreStrokes } from "../lib/canvas";
import { CanvasSheet } from "./CanvasSheet";
import { note as base } from "../test/fixtures";

/**
 * The drawing screen's way back and its eraser, and where its controls stand.
 *
 * World coordinates here: the sheet opens scrolled to 48px short of the world's
 * middle, and the stubbed rect starts at 0, so a pointer at client (x, y) is at
 * world (x - 48, y - 48). `at()` says it the other way round.
 */

const DESKTOP_WIDTH = window.innerWidth;

beforeEach(() => {
  window.innerWidth = DESKTOP_WIDTH;
});

afterEach(() => {
  cleanup();
  window.innerWidth = DESKTOP_WIDTH;
});

const empty: Canvas = {
  id: "idea",
  idea_id: "idea",
  items: [],
  strokes: [],
  image_widths: {},
  created_at: "2026-08-12T12:00:00.000Z",
  updated_at: "2026-08-12T12:00:00.000Z",
};

const stroke = (id: string, points: [number, number][]): DrawingStroke => ({
  id,
  points,
  color: "var(--ink)",
  width: 4,
});

/** A line along the world's y = 0, and another far below it. */
const top = stroke("top", [[0, 0], [100, 0]]);
const low = stroke("low", [[0, 300], [100, 300]]);

/** Where on the screen a world point is. */
const at = (x: number, y: number): { clientX: number; clientY: number } => ({
  clientX: x + 48,
  clientY: y + 48,
});

function surface() {
  const el = document.querySelector<HTMLElement>(".canvas-surface")!;
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
  return el;
}

let pointer = 0;

/** One finger down, along a path, and up. */
function drag(path: [number, number][]) {
  const el = surface();
  const id = ++pointer;
  const init = (p: [number, number]) => ({ ...at(p[0], p[1]), pointerId: id, pointerType: "touch" });
  fireEvent.pointerDown(el, init(path[0]));
  for (const p of path.slice(1)) fireEvent.pointerMove(el, init(p));
  fireEvent.pointerUp(el, init(path[path.length - 1]));
}

function props(overrides: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) {
  return {
    folder: empty,
    idea: base({ id: "idea", raw_content: "", body: "", source: "draw" }),
    notes: [],
    onClose: () => {},
    onRename: () => {},
    onRelease: () => {},
    onDissolve: () => {},
    onTrashNote: () => {},
    onDragNoteTo: () => {},
    onOpenNote: () => {},
    onAddStroke: () => {},
    onClearStrokes: () => {},
    onRemoveStroke: () => {},
    onRestoreStrokes: () => {},
    onResizeNote: () => {},
    onResizeImage: () => {},
    onAddText: () => {},
    onEditText: () => {},
    onRemoveText: () => {},
    ...overrides,
  } satisfies React.ComponentProps<typeof CanvasSheet>;
}

function renderSheet(overrides: Partial<React.ComponentProps<typeof CanvasSheet>> = {}) {
  return render(<CanvasSheet {...props(overrides)} />);
}

/**
 * The sheet with a real store behind it, written the way the app writes it
 * (the same `lib/canvas` functions), so a way back can be followed all the way
 * to what is drawn.
 */
function Held({ strokes }: { strokes: DrawingStroke[] }) {
  const [folder, setFolder] = useState<Canvas>({ ...empty, strokes });
  return (
    <CanvasSheet
      {...props({
        folder,
        initialTool: "draw",
        onAddStroke: (_id, s) => setFolder((f) => addStroke(f, s)),
        onRemoveStroke: (_id, sid) => setFolder((f) => removeStroke(f, sid)),
        onRestoreStrokes: (_id, entries) => setFolder((f) => restoreStrokes(f, entries)),
        onClearStrokes: () => setFolder((f) => ({ ...f, strokes: [] })),
      })}
    />
  );
}

const drawn = () => Array.from(document.querySelectorAll(".canvas-svg path"));
const undo = () => screen.getByLabelText("Undo") as HTMLButtonElement;

describe("Undo", () => {
  it("is there but cannot be pressed until something has been drawn", () => {
    renderSheet({ initialTool: "draw" });
    expect(undo().disabled).toBe(true);

    drag([[10, 10], [60, 40], [120, 40]]);
    expect(undo().disabled).toBe(false);
  });

  it("takes back the stroke just drawn, by the id it was drawn with", () => {
    const onAddStroke = vi.fn();
    const onRemoveStroke = vi.fn();
    renderSheet({ initialTool: "draw", onAddStroke, onRemoveStroke });

    drag([[10, 10], [60, 40], [120, 40]]);
    expect(onAddStroke).toHaveBeenCalledTimes(1);
    const drew = onAddStroke.mock.calls[0][1] as DrawingStroke;

    fireEvent.click(undo());
    expect(onRemoveStroke).toHaveBeenCalledWith("idea", drew.id);
    expect(undo().disabled).toBe(true);
  });

  it("takes back one drawing action at a time, newest first", () => {
    render(<Held strokes={[]} />);
    drag([[0, 0], [50, 0]]);
    drag([[0, 100], [50, 100]]);
    expect(drawn()).toHaveLength(2);

    fireEvent.click(undo());
    expect(drawn()).toHaveLength(1);
    fireEvent.click(undo());
    expect(drawn()).toHaveLength(0);
    expect(undo().disabled).toBe(true);
  });

  it("puts back what the eraser took, where it stood", () => {
    render(<Held strokes={[top, low]} />);
    fireEvent.click(screen.getByLabelText("Eraser"));
    drag([[50, 0]]);
    expect(drawn()).toHaveLength(1);

    fireEvent.click(undo());
    expect(drawn()).toHaveLength(2);
    // Back in its own place in the list, not on the end.
    expect(drawn()[0].getAttribute("d")).toContain("M 50000 50000");
  });

  it("puts back everything Clear took", () => {
    render(<Held strokes={[top, low]} />);
    fireEvent.click(screen.getByLabelText("Clear drawings"));
    expect(drawn()).toHaveLength(0);

    fireEvent.click(undo());
    expect(drawn()).toHaveLength(2);
  });

  it("answers Ctrl+Z while there is something to take back, and not otherwise", () => {
    render(<Held strokes={[]} />);
    // Nothing yet: the key is left for the board, which is what it always was.
    expect(fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })).toBe(true);

    drag([[0, 0], [50, 0]]);
    expect(drawn()).toHaveLength(1);
    act(() => {
      expect(fireEvent.keyDown(document.body, { key: "z", ctrlKey: true })).toBe(false);
    });
    expect(drawn()).toHaveLength(0);
  });

  it("leaves Ctrl+Z to a field being typed in", () => {
    render(<Held strokes={[]} />);
    drag([[0, 0], [50, 0]]);
    fireEvent.click(screen.getByRole("button", { name: /name this idea/i }));
    const field = screen.getByLabelText("Idea name");
    expect(fireEvent.keyDown(field, { key: "z", ctrlKey: true })).toBe(true);
    expect(drawn()).toHaveLength(1);
  });
});

describe("the eraser", () => {
  it("takes the stroke it is put on, and not one it misses", () => {
    const onRemoveStroke = vi.fn();
    renderSheet({ folder: { ...empty, strokes: [top, low] }, onRemoveStroke });
    fireEvent.click(screen.getByLabelText("Eraser"));

    // A hand's width from both: nothing.
    drag([[50, 100]]);
    expect(onRemoveStroke).not.toHaveBeenCalled();

    drag([[50, 4]]);
    expect(onRemoveStroke).toHaveBeenCalledTimes(1);
    expect(onRemoveStroke).toHaveBeenCalledWith("idea", "top");
  });

  it("takes every stroke a drag crosses as one step back", () => {
    const onRemoveStroke = vi.fn();
    const onRestoreStrokes = vi.fn();
    renderSheet({ folder: { ...empty, strokes: [top, low] }, onRemoveStroke, onRestoreStrokes });
    fireEvent.click(screen.getByLabelText("Eraser"));

    drag([[50, -40], [50, 340]]);
    expect(onRemoveStroke).toHaveBeenCalledTimes(2);

    fireEvent.click(undo());
    expect(onRestoreStrokes).toHaveBeenCalledTimes(1);
    const entries = onRestoreStrokes.mock.calls[0][1] as { stroke: DrawingStroke; index: number }[];
    expect(entries.map((e) => [e.stroke.id, e.index])).toEqual([
      ["top", 0],
      ["low", 1],
    ]);
    expect(undo().disabled).toBe(true);
  });

  it("does not draw, and does not move a note", () => {
    const onAddStroke = vi.fn();
    renderSheet({ onAddStroke });
    fireEvent.click(screen.getByLabelText("Eraser"));
    expect(screen.getByLabelText("Eraser").getAttribute("aria-pressed")).toBe("true");
    drag([[10, 10], [60, 40], [120, 40]]);
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".canvas-surface")!.dataset.tool).toBe("erase");
  });

  it("is offered from the canvas menu beside the other two tools", () => {
    renderSheet();
    fireEvent.contextMenu(surface(), { clientX: 200, clientY: 200 });
    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    fireEvent.click(menu.getByRole("menuitemradio", { name: "Eraser" }));
    expect(document.querySelector<HTMLElement>(".canvas-surface")!.dataset.tool).toBe("erase");
  });
});

describe("where the controls stand", () => {
  it("keeps every drawing control in the top bar on a desktop, and builds no foot bar", () => {
    renderSheet({ initialTool: "draw", folder: { ...empty, strokes: [top] } });
    const bar = within(document.querySelector<HTMLElement>(".canvas-bar")!);
    for (const name of ["Move", "Draw", "Eraser", "Undo", "Ink", "Stroke width 4", "Clear drawings"]) {
      expect(bar.getByLabelText(name), name).toBeTruthy();
    }
    expect(document.querySelector(".canvas-dock")).toBeNull();
  });

  it("puts every drawing control in a bar at the foot on a phone, and none in the top one", () => {
    window.innerWidth = 390;
    renderSheet({ initialTool: "draw", folder: { ...empty, strokes: [top] } });

    const head = document.querySelector<HTMLElement>(".canvas-bar")!;
    expect(head.querySelector(".canvas-tools")).toBeNull();
    expect(within(head).queryByLabelText("Draw")).toBeNull();
    // Back and the name stay up there.
    expect(within(head).getByLabelText("Close idea")).toBeTruthy();

    const dock = within(document.querySelector<HTMLElement>(".canvas-dock")!);
    for (const name of [
      "Move",
      "Draw",
      "Eraser",
      "Undo",
      "Ink",
      "Muted",
      "Faint",
      "Stroke width 2",
      "Stroke width 4",
      "Stroke width 8",
      "Clear drawings",
    ]) {
      expect(dock.getByLabelText(name), name).toBeTruthy();
    }
    // One set of each, never two.
    expect(screen.getAllByLabelText("Undo")).toHaveLength(1);
  });

  it("keeps the zoom readout in reach at the foot on a phone", () => {
    window.innerWidth = 390;
    renderSheet();
    const el = surface();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, pointerType: "touch" });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 50, clientY: 100, pointerType: "touch" });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 250, clientY: 100, pointerType: "touch" });

    const dock = within(document.querySelector<HTMLElement>(".canvas-dock")!);
    expect(dock.getByRole("button", { name: /zoomed to 200 percent/i })).toBeTruthy();
  });

  it("shows the tones and weights only with the pen out, as the top bar always did", () => {
    window.innerWidth = 390;
    renderSheet();
    const dock = within(document.querySelector<HTMLElement>(".canvas-dock")!);
    expect(dock.queryByLabelText("Ink")).toBeNull();
    fireEvent.click(dock.getByLabelText("Draw"));
    expect(dock.getByLabelText("Ink")).toBeTruthy();
    fireEvent.click(dock.getByLabelText("Eraser"));
    expect(dock.queryByLabelText("Ink")).toBeNull();
  });
});
