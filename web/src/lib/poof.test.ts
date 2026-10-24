import { describe, expect, it } from "vitest";
import { POOF_MIN_MS, POOF_MS, POOF_STAGGER_MS } from "./motion";
import { POOF_REACH, planPoof, puffReach } from "./poof";

/** A small seeded random source (mulberry32), so every run sees the same clouds. */
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

/** The extremes a random source can hand out, which is where a bound breaks first. */
const always = (value: number) => () => value;

describe("the mascot's cloud", () => {
  const random = seeded(2026);
  const clouds = [
    ...Array.from({ length: 400 }, () => planPoof(random)),
    planPoof(always(0)),
    planPoof(always(0.999999)),
  ];

  it("is never the same cloud twice", () => {
    const a = planPoof(seeded(1));
    const b = planPoof(seeded(2));
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    // And from one source, play after play.
    const one = seeded(3);
    expect(JSON.stringify(planPoof(one))).not.toBe(JSON.stringify(planPoof(one)));
    // The same seed gives the same cloud back, which is what makes it testable.
    expect(planPoof(seeded(9))).toEqual(planPoof(seeded(9)));
  });

  it("varies what an eye could recognise a repeat by", () => {
    const counts = new Set(clouds.map((c) => c.puffs.length));
    const totals = new Set(clouds.map((c) => c.total));
    const turns = new Set(clouds.map((c) => Math.sign(c.turn)));
    expect(counts.size).toBeGreaterThanOrEqual(4);
    expect(totals.size).toBeGreaterThan(50);
    expect(turns).toEqual(new Set([-1, 1]));
  });

  it("keeps a small cloud, short and calm", () => {
    for (const cloud of clouds) {
      expect(cloud.puffs.length).toBeGreaterThanOrEqual(5);
      expect(cloud.puffs.length).toBeLessThanOrEqual(9);
      expect(cloud.total).toBeGreaterThanOrEqual(POOF_MIN_MS);
      expect(cloud.total).toBeLessThanOrEqual(POOF_MS);
      expect(cloud.total).toBeLessThanOrEqual(700);
      expect(Math.abs(cloud.turn)).toBeLessThanOrEqual(10);
      expect(cloud.fadeFrom).toBeGreaterThan(0.1);
      expect(cloud.fadeFrom).toBeLessThan(1);
      for (const puff of cloud.puffs) {
        expect(puff.delay).toBeGreaterThanOrEqual(0);
        expect(puff.delay).toBeLessThanOrEqual(POOF_STAGGER_MS * 1.5);
        expect(puff.duration).toBeGreaterThan(100);
        // Every puff is gone by the time the cloud is.
        expect(puff.delay + puff.duration).toBeLessThanOrEqual(cloud.total + 1e-9);
        expect(puff.peakAt).toBeGreaterThan(0);
        expect(puff.peakAt).toBeLessThan(1);
        // It billows: starts small, swells, and is thinner when it goes.
        expect(puff.fromScale).toBeLessThan(puff.peakScale);
        expect(puff.toScale).toBeLessThan(puff.peakScale);
        expect(puff.peakScale).toBeLessThanOrEqual(1.15);
      }
    }
  });

  it("stays inside the drawing's box, outline and all", () => {
    for (const cloud of clouds) {
      for (const puff of cloud.puffs) expect(puffReach(puff, cloud)).toBeLessThanOrEqual(POOF_REACH + 1e-9);
    }
  });

  it("swells out of the creature's middle and drifts outward", () => {
    for (const cloud of clouds) {
      for (const puff of cloud.puffs) {
        const outX = puff.cx - 50;
        const outY = puff.cy - 54;
        // It starts nearer the middle than it ends up...
        expect(Math.hypot(outX + puff.fromX, outY + puff.fromY)).toBeLessThan(Math.hypot(outX, outY) + 1e-9);
        // ...and drifts on away from it, not back across.
        expect(outX * puff.toX + outY * puff.toY).toBeGreaterThanOrEqual(-1e-9);
      }
      // The cloud as a whole rises.
      expect(cloud.riseY).toBeLessThan(0);
    }
  });

  it("thins unevenly, not all at once", () => {
    for (const cloud of clouds.slice(0, 400)) {
      const ends = new Set(cloud.puffs.map((p) => Math.round(p.delay + p.duration)));
      expect(ends.size).toBeGreaterThan(1);
    }
  });
});
