// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Canvas, DrawingStroke } from "../types";
import { addStroke, removeStroke } from "../lib/canvas";
import { CanvasSheet } from "./CanvasSheet";
import { attachment, note as base } from "../test/fixtures";

/**
 * The second round of drawing tools: shapes, the pen's tidying, the highlighter, Redo and
 * the Select tool. World coordinates as in `CanvasSheet.tools.test.tsx`: a pointer at client
 * (x, y) is at world (x - 48, y - 48).
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

const empty: Canvas = {
  id: "idea",
  idea_id: "idea",
  items: [],
  strokes: [],
  image_widths: {},
  text_elements: [],
  created_at: "2026-10-28T12:00:00.000Z",
  updated_at: "2026-10-28T12:00:00.000Z",
};

const at = (x: number, y: number) => ({ clientX: x + 48, clientY: y + 48 });

function surface() {
  const el = document.querySelector<HTMLElement>(".canvas-surface")!;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }) as DOMRect;
  return el;
}

let pointer = 0;

/** A finger (or a mouse) down, along a path, and up. */
function drag(path: [number, number][], pointerType = "touch", extra: object = {}) {
  const el = surface();
  const id = ++pointer;
  const init = (p: [number, number]) => ({ ...at(p[0], p[1]), pointerId: id, pointerType, button: 0, ...extra });
  fireEvent.pointerDown(el, init(path[0]));
  for (const p of path.slice(1)) fireEvent.pointerMove(el, init(p));
  fireEvent.pointerUp(el, init(path[path.length - 1]));
}

/** The sheet with a real store behind it, written the way the app writes it. */
let latest: Canvas = empty;

function Held({
  strokes = [],
  tool = "draw" as const,
  idea = base({ id: "idea", raw_content: "", body: "", source: "draw" }),
}: {
  strokes?: DrawingStroke[];
  tool?: React.ComponentProps<typeof CanvasSheet>["initialTool"];
  idea?: ReturnType<typeof base>;
}) {
  const [folder, setFolder] = useState<Canvas>({ ...empty, strokes });
  latest = folder;
  return (
    <CanvasSheet
      folder={folder}
      idea={idea}
      notes={[]}
      initialTool={tool}
      onClose={() => {}}
      onRename={() => {}}
      onRelease={() => {}}
      onDissolve={() => {}}
      onTrashNote={() => {}}
      onDragNoteTo={() => {}}
      onOpenNote={() => {}}
      onAddStroke={(_id, s) => setFolder((f) => addStroke(f, s))}
      onRemoveStroke={(_id, sid) => setFolder((f) => removeStroke(f, sid))}
      onClearStrokes={() => setFolder((f) => ({ ...f, strokes: [] }))}
      onChangeCanvas={(_id, change) => setFolder((f) => change(f))}
      onResizeNote={() => {}}
      onResizeImage={() => {}}
      onAddText={() => {}}
      onEditText={() => {}}
      onRemoveText={() => {}}
    />
  );
}

const paths = () => Array.from(document.querySelectorAll<SVGPathElement>(".canvas-svg path"));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("the Shapes tool", () => {
  it("drags out a rectangle, drawn straight, in the pen's colour", () => {
    render(<Held tool="shape" />);
    drag([[0, 0], [60, 20], [120, 80]]);
    expect(paths()).toHaveLength(1);
    expect(paths()[0].getAttribute("d")).toBe("M 50000 50000 L 50120 50000 L 50120 50080 L 50000 50080 L 50000 50000 Z");
    expect(paths()[0].getAttribute("fill")).toBe("none");
  });

  it("offers four shapes, and Fill only for one that closes", () => {
    render(<Held tool="shape" />);
    fireEvent.click(button("Shape: Rectangle"));
    const menu = screen.getByRole("menu", { name: "Shape" });
    expect(within(menu).getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual([
      "Rectangle",
      "Ellipse",
      "Line",
      "Arrow",
    ]);
    expect(screen.getByRole("button", { name: "Fill" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Line" }));
    expect(screen.queryByRole("button", { name: "Fill" })).toBeNull();
  });

  it("fills a closed shape with its own colour when Fill is on", () => {
    render(<Held tool="shape" />);
    fireEvent.click(button("Fill"));
    drag([[0, 0], [80, 80]]);
    expect(paths()[0].getAttribute("fill")).toBe("var(--ink)");
  });

  it("leaves nothing behind for a tap", () => {
    render(<Held tool="shape" />);
    drag([[0, 0], [1, 1]]);
    expect(paths()).toHaveLength(0);
  });
});

describe("the pen's tidying", () => {
  /** A rough circle drawn round (100, 100), then the pen held still at its end. */
  function roughCircle(): [number, number][] {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 2;
      const wobble = i % 2 === 0 ? 2 : -2;
      pts.push([100 + (60 + wobble) * Math.cos(t), 100 + (60 + wobble) * Math.sin(t)]);
    }
    return pts;
  }

  function drawAndHold(points: [number, number][]) {
    const el = surface();
    const id = ++pointer;
    const init = (p: [number, number]) => ({ ...at(p[0], p[1]), pointerId: id, pointerType: "touch" });
    fireEvent.pointerDown(el, init(points[0]));
    for (const p of points.slice(1)) fireEvent.pointerMove(el, init(p));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    fireEvent.pointerUp(el, init(points[points.length - 1]));
  }

  it("turns a rough circle held still into a clean one, and one Undo gives the rough line back", () => {
    vi.useFakeTimers();
    render(<Held />);
    drawAndHold(roughCircle());
    expect(paths()).toHaveLength(1);
    const tidy = paths()[0].getAttribute("d")!;
    expect(tidy).not.toContain("Q");
    fireEvent.click(button("Undo"));
    expect(paths()).toHaveLength(1);
    expect(paths()[0].getAttribute("d")).toContain("Q");
    fireEvent.click(button("Redo"));
    expect(paths()[0].getAttribute("d")).toBe(tidy);
  });

  it("leaves the line as drawn when Settings says no", () => {
    vi.useFakeTimers();
    localStorage.setItem("spar.tidyShapes", "off");
    render(<Held />);
    drawAndHold(roughCircle());
    expect(paths()[0].getAttribute("d")).toContain("Q");
  });
});

describe("the highlighter", () => {
  it("draws see-through and under the ink", () => {
    const ink: DrawingStroke = { id: "ink", points: [[0, 0], [100, 0]], color: "var(--ink)", width: 4 };
    render(<Held strokes={[ink]} tool="highlight" />);
    drag([[0, 10], [50, 10], [100, 10]]);
    expect(paths()).toHaveLength(2);
    expect(paths()[0].getAttribute("class")).toBe("canvas-highlight");
    expect(Number(paths()[0].getAttribute("stroke-width"))).toBeGreaterThanOrEqual(12);
    expect(paths()[1].getAttribute("class")).toBeNull();
  });
});

describe("Redo", () => {
  it("does again what Undo took back, and anything new ends it", () => {
    render(<Held />);
    drag([[0, 0], [50, 0]]);
    expect(button("Redo").disabled).toBe(true);
    fireEvent.click(button("Undo"));
    expect(paths()).toHaveLength(0);
    fireEvent.click(button("Redo"));
    expect(paths()).toHaveLength(1);
    fireEvent.click(button("Undo"));
    drag([[0, 100], [50, 100]]);
    expect(button("Redo").disabled).toBe(true);
  });

  it("answers Ctrl+Shift+Z and Ctrl+Y", () => {
    render(<Held />);
    drag([[0, 0], [50, 0]]);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(paths()).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    expect(paths()).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "y", ctrlKey: true });
    expect(paths()).toHaveLength(1);
  });
});

describe("the Select tool", () => {
  const a: DrawingStroke = { id: "a", points: [[10, 10], [30, 10], [50, 10]], color: "var(--ink)", width: 4 };
  const b: DrawingStroke = { id: "b", points: [[10, 300], [50, 300]], color: "var(--ink)", width: 4 };
  const loopRound: [number, number][] = [[0, 0], [80, 0], [80, 40], [0, 40], [0, 0]];

  it("takes what a loop goes round, carries it, and Undo carries it back", () => {
    render(<Held strokes={[a, b]} tool="select" />);
    drag(loopRound);
    expect(document.querySelector(".canvas-selection")).not.toBeNull();
    drag([[30, 10], [130, 60]]);
    expect(paths()[0].getAttribute("d")).toContain("M 50110 50060");
    // The other stroke stayed where it was.
    expect(paths()[1].getAttribute("d")).toContain("M 50010 50300");
    fireEvent.click(button("Undo"));
    expect(paths()[0].getAttribute("d")).toContain("M 50010 50010");
  });

  it("takes what a mouse's box goes round", () => {
    render(<Held strokes={[a, b]} tool="select" />);
    drag([[0, 0], [80, 40]], "mouse");
    expect(screen.getByRole("button", { name: "Delete selection" })).toBeTruthy();
  });

  it("copies the selection beside it, and deletes it as one step", () => {
    render(<Held strokes={[a, b]} tool="select" />);
    drag(loopRound);
    fireEvent.click(button("Duplicate"));
    expect(paths()).toHaveLength(3);
    fireEvent.click(button("Delete selection"));
    expect(paths()).toHaveLength(2);
    fireEvent.click(button("Undo"));
    expect(paths()).toHaveLength(3);
  });

  it("recolours the selected strokes and leaves the pen as it was", () => {
    render(<Held strokes={[a, b]} tool="select" />);
    drag(loopRound);
    fireEvent.click(screen.getByRole("button", { name: /^Colour of the selection/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Muted" }));
    expect(paths()[0].getAttribute("stroke")).toBe("var(--muted)");
    expect(paths()[1].getAttribute("stroke")).toBe("var(--ink)");
    fireEvent.click(button("Draw"));
    expect(screen.getByRole("button", { name: /^Pen colour: Ink/ })).toBeTruthy();
  });

  it("lets go with Escape before the canvas closes, and Delete takes the selection", () => {
    const onClose = vi.fn();
    render(<Held strokes={[a, b]} tool="select" />);
    drag(loopRound);
    fireEvent.keyDown(document.querySelector(".canvas-sheet")!, { key: "Escape" });
    expect(document.querySelector(".canvas-selection")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    drag(loopRound);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(paths()).toHaveLength(1);
  });
});

describe("a picture under the Select tool", () => {
  it("is carried from where it was drawn, though it never had a place of its own, and Undo puts it back", () => {
    const pic = attachment({ id: "p1", name: "photo.png" });
    const idea = base({ id: "idea", raw_content: "", body: "", source: "draw", attachments: [pic] });
    render(<Held tool="select" idea={idea} />);
    const el = document.querySelector<HTMLElement>('.canvas-picture[data-id="p1"]')!;
    const x = parseFloat(el.style.left) - 50000;
    const y = parseFloat(el.style.top) - 50000;
    // Round its middle with a box, then carry it 100 to the right.
    drag([[x - 10, y - 10], [x + 250, y + 200]], "mouse");
    drag([[x + 100, y + 60], [x + 200, y + 60]], "mouse");
    expect(latest.images).toEqual([{ attachment_id: "p1", x: x + 100, y }]);
    fireEvent.click(button("Undo"));
    expect(latest.images).toEqual([{ attachment_id: "p1", x, y }]);
  });
});

describe("Show everything and Save as picture", () => {
  it("cannot be pressed on an empty canvas", () => {
    render(<Held />);
    expect(button("Show everything").disabled).toBe(true);
    expect(button("Save as picture").disabled).toBe(true);
    drag([[0, 0], [50, 0]]);
    expect(button("Show everything").disabled).toBe(false);
    expect(button("Save as picture").disabled).toBe(false);
  });
});
