import { describe, expect, it } from "vitest";
import type { Canvas, DrawingStroke } from "../types";
import {
  pictureChanged,
  redoStep,
  strokeAdded,
  strokeChanged,
  strokeRemoved,
  textAdded,
  textChanged,
  textRemoved,
  undoStep,
} from "./canvasSteps";

const empty: Canvas = {
  id: "c",
  idea_id: "c",
  items: [],
  strokes: [],
  image_widths: {},
  text_elements: [],
  created_at: "2026-10-28T10:00:00.000Z",
  updated_at: "2026-10-28T10:00:00.000Z",
};

const s = (id: string, x = 0): DrawingStroke => ({ id, points: [[x, 0], [x + 10, 0]], color: "var(--ink)", width: 2 });
const ids = (c: Canvas) => c.strokes.map((stroke) => stroke.id);

describe("a canvas step", () => {
  it("takes back a stroke drawn, and Redo draws it again", () => {
    const a = s("a");
    const step = [strokeAdded(a, 0)];
    const drawn = { ...empty, strokes: [a] };
    expect(ids(undoStep(drawn, step))).toEqual([]);
    expect(ids(redoStep(undoStep(drawn, step), step))).toEqual(["a"]);
  });

  it("sets strokes rubbed out back in their own places", () => {
    const [a, b, c] = [s("a"), s("b"), s("c")];
    // Removals are listed highest place first, as the sheet records them.
    const step = [strokeRemoved(c, 2), strokeRemoved(a, 0)];
    const left = { ...empty, strokes: [b] };
    expect(ids(undoStep(left, step))).toEqual(["a", "b", "c"]);
    expect(ids(redoStep(undoStep(left, step), step))).toEqual(["b"]);
  });

  it("rewinds nothing it did not touch: a stroke drawn elsewhere since stays", () => {
    const a = s("a");
    const moved = { ...a, points: a.points.map(([x, y]) => [x + 50, y] as [number, number]) };
    const step = [strokeChanged(a, moved, 0)];
    const now = { ...empty, strokes: [moved, s("other", 300)] };
    const back = undoStep(now, step);
    expect(back.strokes[0]).toEqual(a);
    expect(ids(back)).toEqual(["a", "other"]);
  });

  it("puts a label back, and takes a copy away", () => {
    const t = { id: "t", x: 1, y: 2, text: "Hello", width: 200 };
    const copy = { ...t, id: "t2", x: 25 };
    expect(undoStep(empty, [textRemoved(t, 0)]).text_elements).toEqual([t]);
    expect(undoStep({ ...empty, text_elements: [t, copy] }, [textAdded(copy, 1)]).text_elements).toEqual([t]);
  });

  it("takes back only what the step changed: words edited since a move stay", () => {
    const t = { id: "t", x: 0, y: 0, text: "Old words", width: 200 };
    const moved = { ...t, x: 50 };
    const step = [textChanged(t, moved, 0)];
    const back = undoStep({ ...empty, text_elements: [{ ...moved, text: "New words" }] }, step);
    expect(back.text_elements).toEqual([{ ...t, text: "New words" }]);
  });

  it("never brings back an item deleted since, by undoing or redoing an old change", () => {
    const a = s("a");
    const recoloured = { ...a, color: "var(--muted)" };
    const step = [strokeChanged(a, recoloured, 0)];
    expect(undoStep(empty, step).strokes).toEqual([]);
    expect(redoStep(empty, step).strokes).toEqual([]);
  });

  it("leaves a picture removed since off the canvas", () => {
    const step = [pictureChanged({ attachment_id: "p", x: 0, y: 0, width: 240 }, { attachment_id: "p", x: 9, y: 9, width: 240 }, 0)];
    expect(undoStep(empty, step).images ?? []).toEqual([]);
  });

  it("moves a picture back to where it stood, at the width it had", () => {
    const before = { attachment_id: "p", x: 0, y: 0, width: 240 };
    const after = { attachment_id: "p", x: 100, y: 40, width: 480 };
    const step = [pictureChanged(before, after, 0)];
    const placed = { ...empty, images: [{ attachment_id: "p", x: 0, y: 0 }] };
    const done = redoStep(placed, step);
    expect(done.images).toEqual([{ attachment_id: "p", x: 100, y: 40 }]);
    expect(done.image_widths.p).toBe(480);
    const back = undoStep(done, step);
    expect(back.images).toEqual([{ attachment_id: "p", x: 0, y: 0 }]);
    expect(back.image_widths.p).toBe(240);
  });
});
