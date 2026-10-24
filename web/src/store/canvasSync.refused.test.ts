// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A canvas the server will never take (review 2026-10-13, EH-07).
 *
 * Its idea note is not on the server, so the foreign key refuses it (23503 on
 * Supabase, `no_such_note` on a spår server). It used to throw before the pull,
 * so no arrangement made on the other device arrived while it stayed queued,
 * and "sync failed" never cleared. It is now treated as a refused note is
 * (`held.ts`): reported, the pull goes on, and after `HOLD_AFTER` refusals it
 * is held and named rather than sent again. The local store is real.
 */

/** Every canvas id the client tried to upsert, in order. */
let upserted: string[] = [];
/** When set, every upsert fails this way instead of refusing only the orphan. */
let requestFails: { message: string; code?: string } | null = null;

vi.mock("./supabase", () => {
  const table = () => ({
    select(cols: string) {
      if (cols === "id") return { limit: async () => ({ data: [], error: null }) };
      const chain = {
        or: () => chain,
        gt: () => chain,
        order: () => chain,
        limit: async () => ({
          data: [
            {
              id: "other",
              items: [{ note_id: "x", x: 9, y: 9 }],
              strokes: [],
              image_widths: {},
              text_elements: [],
              created_at: "2026-10-01T00:00:00.000Z",
              updated_at: "2026-10-12T09:00:00.000Z",
            },
          ],
          error: null,
        }),
      };
      return chain;
    },
    async upsert(rows: { id: string }[]) {
      upserted.push(...rows.map((r) => r.id));
      if (requestFails) return { error: requestFails };
      if (rows.some((r) => r.id === "orphan")) {
        return {
          error: {
            code: "23503",
            message: 'insert or update on table "folders" violates foreign key constraint',
          },
        };
      }
      return { error: null };
    },
  });
  return {
    shellReady: () => {},
    syncConfigured: true,
    getSupabase: async () => ({
      from: table,
      auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) },
    }),
  };
});

const db = await import("./db");
const { syncCanvasesOnce } = await import("./canvasSync");
const { HOLD_AFTER } = await import("./held");
const { canvas } = await import("../test/fixtures");

beforeEach(async () => {
  await db.purgeEverything();
  upserted = [];
  requestFails = null;
});

const orphan = canvas({ id: "orphan", idea_id: "orphan", updated_at: "2026-10-12T08:00:00.000Z" });
const fine = canvas({ id: "fine", idea_id: "fine", updated_at: "2026-10-12T08:00:00.000Z" });

describe("a canvas the server refuses for good", () => {
  it("does not stop the other device's arrangements from arriving, and is reported", async () => {
    await db.putCanvasSynced(orphan);
    await db.putCanvasSynced(fine);

    const outcome = await syncCanvasesOnce([orphan, fine], null);

    expect(outcome.pulled.map((c) => c.id)).toContain("other");
    expect(outcome.refused?.message).toMatch(/orphan/);
    expect(outcome.pushed).toBe(1);
    expect((await db.dirtyCanvasEntries()).map((e) => e.id)).toEqual(["orphan"]);
  });

  it("is held after a few refusals: named, no longer a failure, and not sent again", async () => {
    await db.putCanvasSynced(orphan);
    let outcome = await syncCanvasesOnce([orphan], null);
    for (let i = 1; i < HOLD_AFTER; i++) outcome = await syncCanvasesOnce([orphan], null);

    expect(outcome.refused).toBeNull();
    expect(outcome.held.map((c) => c.id)).toEqual(["orphan"]);
    expect(outcome.held[0].stamp).toBe(orphan.updated_at);

    upserted = [];
    outcome = await syncCanvasesOnce([orphan], null);
    expect(upserted).toEqual([]);
    expect(outcome.pulled.map((c) => c.id)).toContain("other");
    // Still queued: being held is about the sending, not the arrangement.
    expect((await db.dirtyCanvasEntries()).map((e) => e.id)).toEqual(["orphan"]);
  });

  it("is offered again once it is arranged anew", async () => {
    await db.putCanvasSynced(orphan);
    for (let i = 0; i < HOLD_AFTER; i++) await syncCanvasesOnce([orphan], null);

    const moved = { ...orphan, updated_at: "2026-10-12T08:05:00.000Z" };
    await db.putCanvasSynced(moved);
    upserted = [];
    await syncCanvasesOnce([moved], null);
    expect(upserted).toEqual(["orphan"]);
  });

  it("charges nothing when the request itself failed", async () => {
    requestFails = { message: "TypeError: Failed to fetch" };
    await db.putCanvasSynced(orphan);
    await db.putCanvasSynced(fine);
    let outcome = await syncCanvasesOnce([orphan, fine], null);
    for (let i = 0; i < HOLD_AFTER; i++) outcome = await syncCanvasesOnce([orphan, fine], null);

    expect(outcome.held).toEqual([]);
    expect(outcome.refused?.message).toMatch(/Failed to fetch/);
    // Asked once a tick, whole: a failed request is not halved down to its rows.
    expect(upserted).toHaveLength((HOLD_AFTER + 1) * 2);
  });
});
