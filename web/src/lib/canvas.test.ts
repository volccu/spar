import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { addCanvasText, addCanvasItem, addStroke, anchorScroll, buildCanvas, clampZoom, canvasSnapshot, createSnapshotCache, isCanvasIdea, looksArranged, MAX_ZOOM, MIN_ZOOM, moveCanvasItem, placeForNewItem, removeCanvasItem, removeStroke, resizeCanvasItem, setCanvasImageWidth, worldFromClient } from "./canvas";
import { note as base } from "../test/fixtures";
import { fitView } from "./canvasFit";

const note = (partial: Partial<Note> = {}): Note =>
  base({
    created_at: "2026-08-10T10:00:00.000Z",
    updated_at: "2026-08-10T10:00:00.000Z",
    status: "archived",
    ...partial,
  });


describe("spatial folders", () => {
  it("maps an idea's original notes to independent default positions", () => {
    const idea = note({ id: "idea", source: "merge", merged_from: ["a", "b", "missing"] });
    const folder = buildCanvas(
      idea,
      [note({ id: "a", body: "first" }), note({ id: "b", body: "second" })],
      new Date("2026-08-12T12:00:00.000Z"),
    );

    expect(folder.id).toBe("idea");
    expect(folder.items).toEqual([
      { note_id: "a", x: 0, y: 0 },
      { note_id: "b", x: 276, y: 0 },
    ]);
    expect(folder.items).not.toContainEqual(expect.objectContaining({ note_id: "missing" }));
    expect(folder.strokes).toEqual([]);
    expect(folder.image_widths).toEqual({});
  });

  /**
   * The row height was a flat 190 while a canvas note is `height: auto`, so
   * merging anything longer than a paragraph opened onto a pile.
   */
  it("stacks a column under the note above it, however long that note is", () => {
    const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b", "c", "d"] }),
      [
        note({ id: "a", body: long }),
        note({ id: "b", body: "short" }),
        note({ id: "c", body: "short" }),
        note({ id: "d", body: "short" }),
      ],
    );

    const [a, , , d] = folder.items;
    // The fourth note wraps back to the first column, and must clear the tall
    // note standing in it rather than landing on top of it.
    expect(d.x).toBe(a.x);
    expect(d.y).toBeGreaterThan(600);
  });

  it("moves one child without mutating the other children", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b"] }),
      [note({ id: "a" }), note({ id: "b" })],
    );
    const next = moveCanvasItem(folder, "b", 900, -40);

    expect(next.items[0]).toEqual(folder.items[0]);
    expect(next.items[1]).toEqual({ note_id: "b", x: 900, y: -40 });
    expect(folder.items[1]).toEqual({ note_id: "b", x: 276, y: 0 });
  });

  it("recognises merged notes and sketches as ideas", () => {
    expect(isCanvasIdea(note({ source: "merge", merged_from: ["a", "b"] }))).toBe(true);
    expect(isCanvasIdea(note({ source: "web", merged_from: ["a", "b"] }))).toBe(false);
    // A sketch is an idea born empty: zero sources is its normal state, and
    // it is a canvas from the first moment, before any stroke exists.
    expect(isCanvasIdea(note({ source: "draw" }))).toBe(true);
    expect(isCanvasIdea(note({ source: "draw", merged_from: [] }))).toBe(true);
    expect(isCanvasIdea(note({ source: "web" }))).toBe(false);
  });

  it("adds a stroke without mutating the original folder", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a"] }),
      [note({ id: "a" })],
    );
    const stroke = { id: "s1", points: [[10, 20], [30, 40]] as [number, number][], color: "#16161a", width: 4 };
    const next = addStroke(folder, stroke);

    expect(next.strokes).toHaveLength(1);
    expect(next.strokes[0]).toEqual(stroke);
    expect(folder.strokes).toHaveLength(0);
  });

  it("removes a stroke by id", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a"] }),
      [note({ id: "a" })],
    );
    const stroke = { id: "s1", points: [[10, 20], [30, 40]] as [number, number][], color: "#16161a", width: 4 };
    const withStroke = addStroke(folder, stroke);
    const cleaned = removeStroke(withStroke, "s1");

    expect(cleaned.strokes).toHaveLength(0);
    expect(withStroke.strokes).toHaveLength(1);
  });

  it("resizes a folder item width", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b"] }),
      [note({ id: "a" }), note({ id: "b" })],
    );
    const next = resizeCanvasItem(folder, "a", 400);
    expect(next.items[0].width).toBe(400);
    expect(next.items[1].width).toBeUndefined();
  });

  it("stores image display widths", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a"] }),
      [note({ id: "a" })],
    );
    const next = setCanvasImageWidth(folder, "att1", 320);
    expect(next.image_widths).toEqual({ att1: 320 });
  });
});

/**
 * Read by the version-5 upgrade, of canvases written before folders had an
 * outbox. It errs towards "untouched" on purpose: a missed arrangement waits
 * for its next drag, a false positive flattens the other device.
 */
describe("looksArranged", () => {
  it("says no to a canvas standing exactly where the app put it", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b", "c", "d"] }),
      ["a", "b", "c", "d"].map((id) => note({ id })),
    );
    expect(looksArranged(folder)).toBe(false);
    // Including the third column and the second row, which is where a default
    // layout stops being obviously a default.
    expect(folder.items.some((item) => item.x === 552)).toBe(true);
    expect(folder.items.some((item) => item.y > 0)).toBe(true);
  });

  it("says yes to a note that was dragged, drawn on, labelled or resized", () => {
    const base = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a"] }),
      [note({ id: "a" })],
    );

    expect(looksArranged(moveCanvasItem(base, "a", 812, 340))).toBe(true);
    expect(looksArranged(resizeCanvasItem(base, "a", 400))).toBe(true);
    expect(looksArranged(setCanvasImageWidth(base, "att1", 320))).toBe(true);
    expect(
      looksArranged(
        addStroke(base, {
          id: "s1",
          points: [[0, 0], [10, 10]],
          color: "#16161a",
          width: 4,
        }),
      ),
    ).toBe(true);
    expect(
      looksArranged(addCanvasText(base, { id: "t1", x: 10, y: 10, text: "why" })),
    ).toBe(true);
  });
});

describe("createSnapshotCache", () => {
  const a = note({ id: "a", body: "one" });
  const b = note({ id: "b", body: "two" });
  const other = note({ id: "c", body: "not in the idea" });
  const idea = note({ id: "idea", source: "merge", merged_from: ["a", "b"] });

  it("hands back the same object while nothing it draws has changed", () => {
    const cache = createSnapshotCache();
    const first = cache.get(idea, undefined, new Map([a, b, other].map((n) => [n.id, n])));
    // A different note changed — a keystroke elsewhere. Same miniature, same object.
    const edited = { ...other, body: "typed into" };
    const again = cache.get(idea, undefined, new Map([a, b, edited].map((n) => [n.id, n])));
    expect(again).toBe(first);
  });

  it("rebuilds when a note it draws changes", () => {
    const cache = createSnapshotCache();
    const first = cache.get(idea, undefined, new Map([a, b].map((n) => [n.id, n])));
    const grown = { ...b, body: "two\nthree\nfour" };
    const again = cache.get(idea, undefined, new Map([a, grown].map((n) => [n.id, n])));
    expect(again).not.toBe(first);
    expect(again.shapes[1].lines.length).toBe(3);
  });

  it("rebuilds when the idea or its canvas is a new object", () => {
    const cache = createSnapshotCache();
    const byId = new Map([a, b].map((n) => [n.id, n]));
    const first = cache.get(idea, undefined, byId);
    expect(cache.get({ ...idea }, undefined, byId)).not.toBe(first);
  });

  it("forgets ideas it is told to", () => {
    const cache = createSnapshotCache();
    const byId = new Map([a, b].map((n) => [n.id, n]));
    const first = cache.get(idea, undefined, byId);
    cache.keepOnly(new Set());
    expect(cache.get(idea, undefined, byId)).not.toBe(first);
  });
});

describe("folder snapshot", () => {
  const sources = [
    note({ id: "a", body: "one line" }),
    note({ id: "b", body: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n") }),
  ];
  const idea = note({ id: "idea", source: "merge", merged_from: ["a", "b"] });
  const byId = new Map(sources.map((n) => [n.id, n]));

  /**
   * A layout lives only on the device that arranged it. A phone that has never
   * opened an idea has no folder record, and the card was falling through to
   * the merged text — the one face an idea card must never wear.
   */
  it("draws the default layout when the device has no folder yet", () => {
    const shot = canvasSnapshot(idea, undefined, byId);

    expect(shot.shapes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(shot.shapes[0].x).toBe(0);
    expect(shot.shapes[1].x).toBeGreaterThan(0);
    expect(shot.strokes).toEqual([]);
  });

  it("measures a note by what is in it, not by a uniform box", () => {
    const shot = canvasSnapshot(idea, undefined, byId);
    const [short, long] = shot.shapes;

    expect(short.lines).toHaveLength(1);
    expect(long.lines).toHaveLength(12);
    // A one-line note keeps the canvas's minimum height; a long one grows past it.
    expect(short.h).toBe(206);
    expect(long.h).toBeGreaterThan(short.h);
    // A line that stops early is drawn short.
    expect(short.lines[0]).toBeLessThan(0.5);
  });

  it("keeps blank lines as gaps and wraps a line past the column", () => {
    const wide = note({ id: "c", body: `${"x".repeat(200)}\n\ntail` });
    const shot = canvasSnapshot(
      note({ id: "idea2", source: "merge", merged_from: ["c"] }),
      undefined,
      new Map([["c", wide]]),
    );

    const lines = shot.shapes[0].lines;
    expect(lines.filter((f) => f === 1).length).toBeGreaterThan(1);
    expect(lines).toContain(0);
  });

  it("prefers the arranged layout over the default one", () => {
    const folder = moveCanvasItem(buildCanvas(idea, sources), "a", 900, 400);
    const shot = canvasSnapshot(idea, folder, byId);

    expect(shot.shapes[0].x).toBe(900);
    expect(shot.shapes[0].y).toBe(400);
  });
});


describe("placeForNewItem", () => {
  it("lands in the first column on an empty canvas", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: [] }),
      [],
    );
    expect(placeForNewItem(folder, note({ id: "new" }))).toEqual({ x: 0, y: 0 });
  });

  it("picks the column pitch layOut itself uses, not a second copy of it", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a"] }),
      [note({ id: "a" })],
    );
    // The one empty column is the second, at buildCanvas's own pitch.
    expect(placeForNewItem(folder, note({ id: "b" }))).toEqual({ x: 276, y: 0 });
  });

  it("picks whichever column has nothing in it yet", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b"] }),
      [note({ id: "a" }), note({ id: "b" })],
    );
    expect(placeForNewItem(folder, note({ id: "c" }))).toEqual({ x: 552, y: 0 });
  });

  it("stacks under the shortest column rather than landing on the item already there", () => {
    const folder = buildCanvas(
      note({ id: "idea", source: "merge", merged_from: ["a", "b", "c"] }),
      [note({ id: "a" }), note({ id: "b" }), note({ id: "c" })],
    );
    const place = placeForNewItem(folder, note({ id: "d" }));
    // All three columns tie, so the first one wins — but the new item still
    // clears the item already standing there.
    const existing = folder.items[0];
    expect(place.x).toBe(existing.x);
    expect(place.y).toBeGreaterThanOrEqual(existing.y + 206);
  });
});

describe("zoom", () => {
  it("clamps to the range the canvas can actually draw", () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });

  it("reads a screen point back to a world position at zoom 1, as toWorldCoords always did", () => {
    const [x, y] = worldFromClient({
      scrollLeft: 50_000,
      scrollTop: 49_000,
      rectLeft: 10,
      rectTop: 20,
      clientX: 110,
      clientY: 120,
      zoom: 1,
      origin: 50_000,
    });
    // scrollLeft + (clientX - rectLeft) - origin = 50000 + 100 - 50000 = 100
    expect(x).toBe(100);
    expect(y).toBe(49_000 + 100 - 50_000);
  });

  it("divides by zoom, so the same screen point reads a smaller world offset when zoomed in", () => {
    const at1 = worldFromClient({
      scrollLeft: 0,
      scrollTop: 0,
      rectLeft: 0,
      rectTop: 0,
      clientX: 200,
      clientY: 200,
      zoom: 1,
      origin: 0,
    });
    const at2 = worldFromClient({
      scrollLeft: 0,
      scrollTop: 0,
      rectLeft: 0,
      rectTop: 0,
      clientX: 200,
      clientY: 200,
      zoom: 2,
      origin: 0,
    });
    expect(at1).toEqual([200, 200]);
    expect(at2).toEqual([100, 100]);
  });

  it("keeps a point under the pinch midpoint at its own content coordinates across a zoom change", () => {
    // A content point sitting at "scroll-space at zoom 1" coordinate 400,
    // read from under a screen point 150px into the canvas at zoom 1 —
    // exactly what worldFromClient(origin: 0) would have handed back at the
    // start of a pinch.
    const contentX = 400;
    const contentY = 300;
    const pointX = 150;
    const pointY = 120;

    const at1 = anchorScroll({ contentX, contentY, zoom: 1, pointX, pointY });
    // scrollLeft chosen so contentX still reads back at pointX under it.
    const [readBackX, readBackY] = worldFromClient({
      scrollLeft: at1.left,
      scrollTop: at1.top,
      rectLeft: 0,
      rectTop: 0,
      clientX: pointX,
      clientY: pointY,
      zoom: 1,
      origin: 0,
    });
    expect(readBackX).toBeCloseTo(contentX);
    expect(readBackY).toBeCloseTo(contentY);

    // Zoom to 2.5x, anchored on the same content point and the same screen
    // point — the content must read back identically, not just visually.
    const at2 = anchorScroll({ contentX, contentY, zoom: 2.5, pointX, pointY });
    const [readBackX2, readBackY2] = worldFromClient({
      scrollLeft: at2.left,
      scrollTop: at2.top,
      rectLeft: 0,
      rectTop: 0,
      clientX: pointX,
      clientY: pointY,
      zoom: 2.5,
      origin: 0,
    });
    expect(readBackX2).toBeCloseTo(contentX);
    expect(readBackY2).toBeCloseTo(contentY);
  });
});

describe("taking a note off a canvas", () => {
  const folder = buildCanvas(
    note({ id: "idea", merged_from: ["a", "b"] }),
    [note({ id: "a" }), note({ id: "b" })],
  );

  it("removes only that item", () => {
    const next = removeCanvasItem(folder, "a");
    expect(next.items.map((i) => i.note_id)).toEqual(["b"]);
  });

  it("stamps the canvas, so the arrangement travels", () => {
    const next = removeCanvasItem(folder, "a", new Date("2026-08-14T12:00:00.000Z"));
    expect(next.updated_at).toBe("2026-08-14T12:00:00.000Z");
  });

  it("puts one back exactly where it stood", () => {
    const place = folder.items[0];
    const next = addCanvasItem(removeCanvasItem(folder, "a"), place);
    expect(next.items.find((i) => i.note_id === "a")).toEqual(place);
  });

  it("refuses to add a note the canvas already holds", () => {
    const next = addCanvasItem(folder, { note_id: "a", x: 999, y: 999 });
    expect(next).toBe(folder);
  });
});

describe("fitView", () => {
  it("zooms out until two notes side by side fit a phone", () => {
    const fit = fitView({ x: 5000, y: 5000, w: 524, h: 200 }, { w: 390, h: 700 }, 16)!;
    expect(fit.zoom).toBeCloseTo((390 - 32) / 524);
    // Centred across: the middle of the notes lands in the middle of the view.
    expect(fit.left + 390 / 2).toBeCloseTo((5000 + 262) * fit.zoom);
    expect(fit.top).toBeCloseTo(5000 * fit.zoom - 16);
  });

  it("keeps room clear above the notes when asked", () => {
    const fit = fitView({ x: 5000, y: 5000, w: 524, h: 200 }, { w: 390, h: 700 }, 16, 72)!;
    expect(fit.top).toBeCloseTo(5000 * fit.zoom - 72);
  });

  it("leaves an arrangement that already fits at 100%", () => {
    expect(fitView({ x: 0, y: 0, w: 524, h: 200 }, { w: 1440, h: 800 }, 16)).toBeNull();
  });

  it("never zooms out past the canvas's own floor", () => {
    expect(fitView({ x: 0, y: 0, w: 5000, h: 200 }, { w: 390, h: 700 }, 16)!.zoom).toBe(MIN_ZOOM);
  });

  it("does nothing with nothing measured", () => {
    expect(fitView({ x: 0, y: 0, w: 0, h: 0 }, { w: 390, h: 700 }, 16)).toBeNull();
  });

  it("stops at a readable floor, and shows the notes from their left edge", () => {
    // Three notes (about 800 wide) on a phone would need 44%: the text is 7px. At the
    // floor the first notes are in view and the rest are a pan away.
    const fit = fitView({ x: 5000, y: 5000, w: 800, h: 200 }, { w: 390, h: 700 }, 16, 72, 0.75)!;
    expect(fit.zoom).toBe(0.75);
    expect(fit.left).toBeCloseTo(5000 * 0.75 - 16);
    expect(fit.top).toBeCloseTo(5000 * 0.75 - 72);
  });

  it("keeps the whole fit when it is above the floor, centred as before", () => {
    const near = fitView({ x: 5000, y: 5000, w: 460, h: 200 }, { w: 390, h: 700 }, 16, 72, 0.75)!;
    expect(near.zoom).toBeCloseTo((390 - 32) / 460);
    expect(near.left + 390 / 2).toBeCloseTo((5000 + 230) * near.zoom);
  });
});
