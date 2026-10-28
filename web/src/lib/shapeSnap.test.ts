import { describe, expect, it } from "vitest";
import { recogniseShape, SNAP_HOLD_MS, SNAP_STILL_PX } from "./shapeSnap";

type Point = [number, number];

/** A small deterministic generator, so a failing stroke fails the same way every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points `step` apart along straight runs through the corners. */
function along(corners: Point[], step = 5): Point[] {
  const out: Point[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1];
    const [bx, by] = corners[i];
    const run = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(run / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** A hand's wobble: every point moves up to `amount` either way. */
function shake(points: Point[], amount: number, seed: number): Point[] {
  const rand = seeded(seed);
  return points.map(([x, y]) => [x + (rand() * 2 - 1) * amount, y + (rand() * 2 - 1) * amount] as Point);
}

/** The pen resting: a dozen samples within a couple of pixels of the end. */
function withRest(points: Point[], seed = 99): Point[] {
  const rand = seeded(seed);
  const [x, y] = points[points.length - 1];
  const rest: Point[] = [];
  for (let i = 0; i < 12; i++) rest.push([x + (rand() * 2 - 1) * 2, y + (rand() * 2 - 1) * 2]);
  return [...points, ...rest];
}

function ellipseStroke(cx: number, cy: number, rx: number, ry: number, opts: { from?: number; turns?: number; wobble?: number; seed?: number } = {}): Point[] {
  const { from = 0, turns = 1, wobble = 0.03, seed = 7 } = opts;
  const rand = seeded(seed);
  const n = Math.round(60 * turns);
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = from + (i / 60) * Math.PI * 2;
    const k = 1 + (rand() * 2 - 1) * wobble;
    out.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  return out;
}

function near(p: Point, x: number, y: number, tolerance = 5) {
  expect(Math.abs(p[0] - x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(p[1] - y)).toBeLessThanOrEqual(tolerance);
}

describe("the hold", () => {
  it("is half a second, with a few pixels of give", () => {
    expect(SNAP_HOLD_MS).toBe(500);
    expect(SNAP_STILL_PX).toBe(6);
  });
});

describe("recogniseShape: what it snaps", () => {
  it("a level line", () => {
    const stroke = withRest(shake(along([[40, 100], [300, 104]]), 1.5, 1));
    const snap = recogniseShape(stroke);
    expect(snap?.kind).toBe("line");
    near(snap!.from, 40, 100, 3);
    near(snap!.to, 300, 104, 4);
  });

  it("a diagonal line, and a short one", () => {
    const diagonal = recogniseShape(withRest(shake(along([[20, 20], [220, 190]]), 1.5, 2)));
    expect(diagonal?.kind).toBe("line");
    near(diagonal!.from, 20, 20, 3);
    near(diagonal!.to, 220, 190, 4);
    const short = recogniseShape(withRest(shake(along([[10, 10], [60, 22]], 4), 1, 3)));
    expect(short?.kind).toBe("line");
  });

  it("a line drawn right to left keeps its direction", () => {
    const snap = recogniseShape(withRest(shake(along([[300, 50], [60, 70]]), 1.2, 4)));
    expect(snap?.kind).toBe("line");
    near(snap!.from, 300, 50, 3);
    near(snap!.to, 60, 70, 4);
  });

  it("a circle, whichever way round and wherever it starts", () => {
    for (const [from, seed] of [[0, 1], [2.1, 2], [4.4, 3]] as const) {
      const snap = recogniseShape(withRest(ellipseStroke(200, 150, 60, 60, { from, seed })));
      expect(snap?.kind).toBe("ellipse");
      near(snap!.from, 140, 90, 7);
      near(snap!.to, 260, 210, 7);
    }
    const backwards = ellipseStroke(200, 150, 60, 60).reverse();
    expect(recogniseShape(withRest(backwards))?.kind).toBe("ellipse");
  });

  it("a circle that overshoots where it began", () => {
    const snap = recogniseShape(withRest(ellipseStroke(200, 150, 60, 60, { turns: 1.07, seed: 5 })));
    expect(snap?.kind).toBe("ellipse");
  });

  it("a wide ellipse", () => {
    const snap = recogniseShape(withRest(ellipseStroke(250, 120, 130, 45, { from: 1, seed: 11 })));
    expect(snap?.kind).toBe("ellipse");
    near(snap!.from, 120, 75, 8);
    near(snap!.to, 380, 165, 8);
  });

  it("a rectangle drawn as four sides, from any corner", () => {
    const corners: Point[] = [[100, 80], [320, 80], [320, 190], [100, 190]];
    for (let start = 0; start < 4; start++) {
      const order = [...corners.slice(start), ...corners.slice(0, start), corners[start]];
      const snap = recogniseShape(withRest(shake(along(order), 1.5, 20 + start)));
      expect(snap?.kind).toBe("rect");
      near(snap!.from, 100, 80, 5);
      near(snap!.to, 320, 190, 5);
    }
  });

  it("a rectangle begun mid-side", () => {
    const path = along([[210, 80], [320, 80], [320, 190], [100, 190], [100, 80], [210, 80]]);
    const snap = recogniseShape(withRest(shake(path, 1.5, 30)));
    expect(snap?.kind).toBe("rect");
    near(snap!.from, 100, 80, 5);
    near(snap!.to, 320, 190, 5);
  });

  it("a square whose closing stroke overshoots", () => {
    const path = along([[100, 100], [220, 100], [220, 220], [100, 220], [100, 92]]);
    const snap = recogniseShape(withRest(shake(path, 1.2, 31)));
    expect(snap?.kind).toBe("rect");
    near(snap!.from, 100, 94, 8);
    near(snap!.to, 220, 220, 5);
  });

  it("a square that stops a little short of closing", () => {
    const path = along([[100, 100], [220, 100], [220, 220], [100, 220], [100, 112]]);
    expect(recogniseShape(withRest(shake(path, 1.2, 32)))?.kind).toBe("rect");
  });
});

describe("recogniseShape: many hands", () => {
  it("snaps the same shapes whatever the wobble, and still refuses the triangle and the S", () => {
    for (let seed = 100; seed < 130; seed++) {
      const amount = 0.5 + (seed % 4) * 0.6;
      expect(recogniseShape(withRest(shake(along([[40, 100], [300, 140]]), amount, seed)))?.kind).toBe("line");
      expect(recogniseShape(withRest(ellipseStroke(200, 150, 70, 55, { from: seed % 6, wobble: 0.02 + (seed % 3) * 0.015, seed })))?.kind).toBe("ellipse");
      const box = along([[100, 80], [320, 80], [320, 190], [100, 190], [100, 80]]);
      expect(recogniseShape(withRest(shake(box, amount, seed)))?.kind).toBe("rect");
      const triangle = along([[150, 40], [250, 190], [50, 190], [150, 40]]);
      expect(recogniseShape(withRest(shake(triangle, amount, seed)))).toBeNull();
    }
  });
});

describe("recogniseShape: what it leaves alone", () => {
  it("too few points, or too short to mean anything", () => {
    expect(recogniseShape([])).toBeNull();
    expect(recogniseShape([[0, 0], [30, 0], [60, 0], [90, 0], [120, 0]])).toBeNull();
    expect(recogniseShape(along([[10, 10], [24, 14]], 1))).toBeNull();
  });

  it("a stroke that only holds still", () => {
    const rand = seeded(8);
    const stroke: Point[] = Array.from({ length: 30 }, () => [100 + rand() * 3, 100 + rand() * 3]);
    expect(recogniseShape(stroke)).toBeNull();
  });

  it("an S", () => {
    const s: Point[] = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      // Two half-turns, one each way, taller than wide.
      const angle = t * Math.PI * 2 - Math.PI / 2;
      s.push(t < 0.5 ? [50 + 30 * Math.cos(angle * 1), 30 + 30 * Math.sin(angle)] : [50 - 30 * Math.cos(angle), 30 + 30 * Math.sin(angle) + 0]);
    }
    expect(recogniseShape(withRest(shake(s, 1, 40)))).toBeNull();
  });

  it("a 2", () => {
    const two: Point[] = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI + (i / 20) * Math.PI * 1.25;
      two.push([60 + 30 * Math.cos(a), 40 + 30 * Math.sin(a)]);
    }
    const stroke = [...two, ...along([two[two.length - 1], [30, 100], [90, 100]], 4)];
    expect(recogniseShape(withRest(shake(stroke, 1, 41)))).toBeNull();
  });

  it("a zigzag", () => {
    const stroke = along([[20, 80], [60, 20], [100, 80], [140, 20], [180, 80], [220, 20]], 4);
    expect(recogniseShape(withRest(shake(stroke, 1, 42)))).toBeNull();
  });

  it("an open U", () => {
    const u: Point[] = [];
    u.push(...along([[40, 20], [40, 90]], 4));
    for (let i = 1; i <= 20; i++) {
      const a = (i / 20) * Math.PI;
      u.push([70 - 30 * Math.cos(a), 90 + 30 * Math.sin(a)]);
    }
    u.push(...along([[100, 90], [100, 20]], 4));
    expect(recogniseShape(withRest(shake(u, 1, 43)))).toBeNull();
  });

  it("a spiral", () => {
    const spiral: Point[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * Math.PI * 4;
      const r = 10 + t * 60;
      spiral.push([200 + r * Math.cos(a), 150 + r * Math.sin(a)]);
    }
    expect(recogniseShape(withRest(spiral))).toBeNull();
  });

  it("a spiral that ends where it began", () => {
    // Two loops, the second inside the first.
    const loops = [...ellipseStroke(200, 150, 60, 60, { wobble: 0 }), ...ellipseStroke(200, 150, 45, 45, { wobble: 0 })];
    expect(recogniseShape(withRest(loops))).toBeNull();
  });

  it("a figure 8", () => {
    const eight: Point[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2;
      eight.push([200 + 40 * Math.sin(t), 150 + 60 * Math.sin(t) * Math.cos(t)]);
    }
    expect(recogniseShape(withRest(shake(eight, 1, 44)))).toBeNull();
  });

  it("a triangle", () => {
    for (const seed of [50, 51, 52]) {
      const triangle = along([[150, 40], [250, 190], [50, 190], [150, 40]]);
      expect(recogniseShape(withRest(shake(triangle, 1.5, seed)))).toBeNull();
    }
  });

  it("a diamond", () => {
    const diamond = along([[150, 40], [250, 115], [150, 190], [50, 115], [150, 40]]);
    expect(recogniseShape(withRest(shake(diamond, 1.5, 53)))).toBeNull();
  });

  it("a short scribble", () => {
    const scribble = along([[20, 20], [34, 26], [22, 30], [36, 34], [24, 38]], 3);
    expect(recogniseShape(withRest(shake(scribble, 1, 60)))).toBeNull();
  });

  it("a line scribbled out and back", () => {
    const back = along([[20, 100], [200, 102], [20, 100]], 5);
    expect(recogniseShape(withRest(shake(back, 1, 61)))).toBeNull();
  });

  it("a box left open on one side", () => {
    const path = along([[100, 100], [220, 100], [220, 220], [100, 220], [100, 165]]);
    expect(recogniseShape(withRest(shake(path, 1.2, 62)))).toBeNull();
  });

  it("a gentle arc", () => {
    const arc: Point[] = [];
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * 0.25 + (i / 40) * Math.PI * 0.5;
      arc.push([200 + 150 * Math.cos(a), 20 + 150 * Math.sin(a)]);
    }
    expect(recogniseShape(withRest(arc))).toBeNull();
  });

  it("an open C", () => {
    const c = ellipseStroke(100, 100, 50, 50, { from: 0.8, turns: 0.75, wobble: 0.02, seed: 70 });
    expect(recogniseShape(withRest(c))).toBeNull();
  });
});
