import { POOF_MIN_MS, POOF_MS, POOF_STAGGER_MS } from "./motion";

/**
 * The mascot's puff of smoke, drawn anew every time it plays (2026-10-12, the
 * owner: "now the smoke cloud always spawns the same way").
 *
 * This is only the plan — where each puff sits, how big it grows, which way it
 * drifts and when it goes — as plain numbers in the drawing's own 100-unit box,
 * so it can be tested without a browser. `mascot-element.ts` draws and plays
 * it. The random source is a parameter for the same reason: a test hands in a
 * seeded one and gets the same cloud back every run.
 *
 * What varies is everything a viewer could recognise a repeat by: how many
 * puffs (a few big ones round the middle, a few small wisps further out), their
 * sizes, where they sit, which way the whole cloud turns and drifts, when each
 * starts and when each thins away. What does not vary is what makes it one
 * cloud: every puff swells out of the creature's middle, the cloud's tones are
 * the creature's own two, and the outline is one line round the union of all
 * of them (the element draws each puff twice for that).
 */

/** Where the cloud gathers: the middle of the creature, in the 100-unit box. */
export const POOF_CENTRE = { x: 50, y: 54 } as const;

/**
 * How far from the centre any part of the cloud may ever reach, outline
 * included. It keeps the whole cloud inside the drawing's own box (6..94
 * across, 12..96 down), which is also inside the region the boil filter is
 * drawn over — a puff past that edge would be sliced off flat.
 */
export const POOF_REACH = 42;

/** Half the cloud's outline: the line is drawn 7 wide and the fill covers the inner half. */
export const POOF_LINE = 3.5;

export interface Puff {
  /** Where it sits at its fullest, and its radius there before scaling. */
  cx: number;
  cy: number;
  r: number;
  /** Where it starts, relative to (cx, cy): most of the way in to the centre. */
  fromX: number;
  fromY: number;
  fromScale: number;
  /** Its fullest: the scale it swells to, and when, as a fraction of its own life. */
  peakScale: number;
  peakAt: number;
  /** Where it has drifted to, relative to (cx, cy), and what is left of it, when it goes. */
  toX: number;
  toY: number;
  toScale: number;
  /** When it starts and how long it lasts, in ms from the start of the cloud. */
  delay: number;
  duration: number;
}

export interface PoofPlan {
  /** The whole cloud, first puff to last wisp, in ms. */
  total: number;
  puffs: Puff[];
  /** The cloud as one: how far it turns about the centre, in degrees, and drifts. */
  turn: number;
  riseX: number;
  riseY: number;
  /** When the cloud as a whole starts to thin, as a fraction of `total`. */
  fadeFrom: number;
}

/**
 * The furthest any point of this puff can be from the centre at any moment of
 * its life, outline included — counted generously (by the triangle inequality,
 * as if every offset pointed the same way), so a cloud that passes this test
 * passes it whatever the turn does.
 */
export function puffReach(puff: Puff, plan: Pick<PoofPlan, "riseX" | "riseY">): number {
  const rest = Math.hypot(puff.cx - POOF_CENTRE.x, puff.cy - POOF_CENTRE.y);
  const drift = Math.hypot(puff.toX, puff.toY);
  const rise = Math.hypot(plan.riseX, plan.riseY);
  const size = puff.r * Math.max(puff.fromScale, puff.peakScale, puff.toScale);
  return rest + drift + rise + size + POOF_LINE;
}

/** A new cloud. `random` is `Math.random` in the app and a seeded one in a test. */
export function planPoof(random: () => number = Math.random): PoofPlan {
  const between = (low: number, high: number) => low + random() * (high - low);
  const count = (low: number, high: number) => Math.min(high, low + Math.floor(random() * (high - low + 1)));

  const total = Math.round(between(POOF_MIN_MS, POOF_MS));
  // The cloud as a whole drifts up a little, a touch to one side, and turns
  // a few degrees one way or the other as it goes.
  const riseX = between(-3, 3);
  const riseY = -between(2, 6);
  const turn = (random() < 0.5 ? -1 : 1) * between(4, 10);
  const fadeFrom = between(0.42, 0.58);

  function puff(
    angle: number,
    o: { dist: number; r: number; drift: number; delay: number; end: number; toScale: number },
  ): Puff {
    const a = (angle * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const peakScale = between(0.95, 1.15);
    const fromScale = between(0.15, 0.35);
    // Pulled in, if need be, until the whole of its life fits inside the reach.
    const room = POOF_REACH - POOF_LINE - o.r * Math.max(peakScale, fromScale, o.toScale) - Math.hypot(riseX, riseY);
    const fit = Math.min(1, room / (o.dist + o.drift));
    const dist = o.dist * fit;
    const drift = o.drift * fit;
    const inward = between(0.6, 0.9);
    return {
      cx: POOF_CENTRE.x + ux * dist,
      cy: POOF_CENTRE.y + uy * dist,
      r: o.r,
      fromX: -ux * dist * inward,
      fromY: -uy * dist * inward,
      fromScale,
      peakScale,
      peakAt: between(0.3, 0.5),
      toX: ux * drift,
      toY: uy * drift,
      toScale: o.toScale,
      delay: o.delay,
      duration: o.end - o.delay,
    };
  }

  const puffs: Puff[] = [];
  const spin = random() * 360;
  const core = count(4, 6);
  for (let i = 0; i < core; i++) {
    // Spread round the middle evenly enough to cover it, unevenly enough
    // that the silhouette is lumpy rather than a flower.
    const angle = spin + (i * 360) / core + between(-22, 22);
    puffs.push(
      puff(angle, {
        dist: between(5, 13),
        r: between(10, 16),
        drift: between(2, 5),
        delay: between(0, POOF_STAGGER_MS),
        end: between(0.7, 1) * total,
        toScale: between(0.35, 0.65),
      }),
    );
  }
  const wisps = count(1, 3);
  for (let i = 0; i < wisps; i++) {
    // Small puffs thrown out past the edge: later to start, further to go,
    // first to be gone.
    puffs.push(
      puff(random() * 360, {
        dist: between(15, 21),
        r: between(5, 8),
        drift: between(4, 8),
        delay: between(POOF_STAGGER_MS / 2, POOF_STAGGER_MS * 1.5),
        end: between(0.55, 0.85) * total,
        toScale: between(0.1, 0.3),
      }),
    );
  }

  return { total, puffs, turn, riseX, riseY, fadeFrom };
}
