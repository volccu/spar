import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Canvas } from "../types";
import { canvas } from "../test/fixtures";
import { REPAIR_WINDOW_MS } from "./cursors";

const folder = (over: Partial<Canvas> = {}): Canvas =>
  canvas({ updated_at: ARRANGED, ...over });

/**
 * Folder sync, and the two things it must never do: take the notes down with
 * it when the server is behind, and let a canvas nobody arranged overwrite one
 * somebody did.
 */

/** Whether the fake server has run migration 0010. */
let tableExists = true;
/** Rows the fake server hands back from a pull. */
let remoteRows: Record<string, unknown>[] = [];
/** Rows the client tried to push, for inspection. */
let pushedRows: Record<string, unknown>[] = [];
/** The folder outbox: id -> the `updated_at` of the version waiting to go up. */
let outbox = new Map<string, string>();
/** Something that happens while an upload is on the wire. Usually nothing. */
let duringUpload: (() => void) | null = null;
/**
 * Every keyset filter the client handed to `.or(...)`, verbatim. The real
 * server *parses* this string, and the bug that motivated capturing it was
 * exactly one a discarding mock waves through: a cursor with no id rendered
 * `id.gt.` with nothing after it, Postgres refused to cast "" to uuid, and
 * every pull on a fresh device failed with 400 — while this suite stayed
 * green, because `or: () => chain` never looked at what it was sent.
 */
let sentFilters: string[] = [];
/** What the fake IndexedDB holds under `lastFoldersPulledAt`. */
let storedCursor: unknown = undefined;
/** Every cursor the client wrote back after a pull, in order. */
let storedCursors: unknown[] = [];
/** When set, successive page reads take these in turn instead of `remoteRows`. */
let remotePages: Record<string, unknown>[][] | null = null;
/** Every canvas the pull wrote into the local store. */
let writtenLocally: Canvas[] = [];

vi.mock("./supabase", () => {
  const builder = () => ({
    select(cols: string) {
      // The probe that asks whether the table is there at all.
      if (cols === "id") {
        return {
          limit: async () =>
            tableExists
              ? { data: [], error: null }
              : { data: null, error: { message: 'relation "folders" does not exist' } },
        };
      }
      if (!tableExists) throw new Error("asked the server for a table it has not got");
      const chain = {
        or: (filter: string) => {
          sentFilters.push(filter);
          // The real PostgREST answers a malformed keyset with 400; a mock
          // that returned rows anyway would re-hide the bug this exists for.
          if (/\bid\.gt\.[,)]/.test(`${filter})`)) {
            throw new Error('invalid input syntax for type uuid: ""');
          }
          return chain;
        },
        gt: () => chain,
        order: () => chain,
        limit: async () => ({
          data: remotePages ? (remotePages.shift() ?? []) : remoteRows,
          error: null,
        }),
      };
      return chain;
    },
    async upsert(rows: Record<string, unknown>[]) {
      if (!tableExists) return { error: { message: 'relation "folders" does not exist' } };
      pushedRows.push(...rows);
      duringUpload?.();
      return { error: null };
    },
  });

  return { getSupabase: async () => ({ from: () => builder() }), syncConfigured: true };
});

vi.mock("./db", () => ({
  dirtyCanvasEntries: async () => [...outbox].map(([id, stamp]) => ({ id, stamp })),
  clearCanvasDirtySent: async (sent: { id: string; stamp: string }[]) => {
    for (const { id, stamp } of sent) {
      if (outbox.get(id) === stamp) outbox.delete(id);
    }
  },
  getMeta: async () => storedCursor,
  putCanvasesLocalOnly: async (folders: Canvas[]) => {
    writtenLocally.push(...folders);
  },
  setMeta: async (_key: string, value: unknown) => {
    storedCursors.push(value);
  },
}));

const ARRANGED = "2026-08-12T09:00:00.000Z";


/** The same canvas, as the other device left it: one note dragged well clear. */
const remoteRow = {
  id: "idea",
  items: [{ note_id: "a", x: 900, y: 400 }],
  strokes: [],
  image_widths: {},
  text_elements: [],
  created_at: "2026-08-12T08:00:00.000Z",
  updated_at: "2026-08-12T10:00:00.000Z",
};

beforeEach(() => {
  tableExists = true;
  pushedRows = [];
  remoteRows = [];
  outbox = new Map();
  duringUpload = null;
  sentFilters = [];
  storedCursor = undefined;
  storedCursors = [];
  remotePages = null;
  writtenLocally = [];
  vi.resetModules();
});

describe("a server that has not run migration 0010", () => {
  /**
   * The invariant this whole module is arranged around. The client deploys
   * from one place and the schema migrates from another, so for a while they
   * disagree — and a canvas is derivable from notes that have already synced,
   * while the notes are not derivable from anything.
   */
  it("says nothing rather than throwing", async () => {
    tableExists = false;
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");

    const outcome = await syncCanvasesOnce([folder()]);

    expect(outcome).toEqual({ pushed: 0, pulled: [], refused: null, held: [] });
    expect(pushedRows).toHaveLength(0);
    // The arrangement keeps its place in the queue and goes up after the
    // migration, rather than being quietly dropped on the floor.
    expect(outbox.get("idea")).toBe(ARRANGED);
  });
});

describe("pushing an arrangement", () => {
  it("sends only what is queued", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pushed } = await syncCanvasesOnce([folder(), folder({ id: "other", idea_id: "other" })]);

    expect(pushed).toBe(1);
    expect(pushedRows).toHaveLength(1);
    expect(pushedRows[0].id).toBe("idea");
    expect(outbox.size).toBe(0);
  });

  /**
   * The notes' outbox rule, and it earns its keep harder here: dragging a note
   * across the canvas writes several times a second, so an edit landing while
   * the upload is in flight is not an edge case — it is what dragging is.
   */
  it("leaves a move made while the upload was in flight", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    duringUpload = () => outbox.set("idea", "2026-08-12T09:00:02.000Z");
    const { syncCanvasesOnce } = await import("./canvasSync");

    await syncCanvasesOnce([folder()]);

    expect(outbox.get("idea")).toBe("2026-08-12T09:00:02.000Z");
  });

  /** The client never names an owner, so it can never name the wrong one. */
  it("leaves owner_id to the server", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");

    await syncCanvasesOnce([folder()]);

    expect("owner_id" in pushedRows[0]).toBe(false);
  });
});

describe("pulling an arrangement", () => {
  /**
   * The bug the whole conflict rule exists to prevent.
   *
   * Opening an idea invents a default layout stamped now, which by plain
   * last-write-wins is *newer* than the arrangement made on the laptop last
   * week. Merely looking at an idea on the phone would therefore win the
   * argument and flatten it. An invented layout never enters the outbox, and
   * that — not its timestamp — is what decides.
   */
  it("replaces a default layout the user never touched", async () => {
    remoteRows = [remoteRow];
    const local = folder({ updated_at: "2026-08-12T23:59:00.000Z" });
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([local]);

    expect(pulled).toHaveLength(1);
    expect(pulled[0].items[0]).toEqual({ note_id: "a", x: 900, y: 400 });
    // Read back off the primary key: a folder is the arrangement of that note.
    expect(pulled[0].idea_id).toBe("idea");
  });

  /** …but an arrangement still waiting to go up is not something to overwrite. */
  it("stands off a canvas this device has queued", async () => {
    remoteRows = [remoteRow];
    // Re-queued mid-upload, so it survives the push and is still waiting.
    duringUpload = () => outbox.set("idea", "2026-08-12T09:00:02.000Z");
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([folder()]);

    expect(pulled).toHaveLength(0);
  });

  /**
   * A push comes straight back down the next pull. Applying it would be
   * harmless and identical — and would re-render the canvas under the hand
   * still dragging on it.
   */
  it("ignores its own upload coming back", async () => {
    remoteRows = [{ ...remoteRow, updated_at: ARRANGED }];
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([folder()]);

    expect(pulled).toHaveLength(0);
  });

  /** A row written before labels existed must read as "no labels", not null. */
  it("reads a row without text elements as an empty canvas", async () => {
    const { text_elements: _omitted, ...withoutLabels } = remoteRow;
    remoteRows = [withoutLabels];
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([]);

    expect(pulled[0].text_elements).toEqual([]);
  });

  /**
   * The same instant, spelled the way this device wrote it and the way the
   * server hands it back. The repair window reads recent rows again on every
   * tick, so a string compare would re-apply such a row under the hand.
   */
  it("does not apply a row it already holds, however the stamp is spelled", async () => {
    remoteRows = [{ ...remoteRow, updated_at: "2026-08-12T10:00:00+00:00" }];
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([
      folder({ items: remoteRow.items, updated_at: "2026-08-12T10:00:00.000Z" }),
    ]);

    expect(pulled).toEqual([]);
    expect(writtenLocally).toEqual([]);
  });
});

describe("the pull cursor", () => {
  /**
   * The 400 that broke folder sync for good. A device that has never pulled
   * holds no cursor, so the keyset tiebreak had nothing to say — and said it
   * anyway, as `id.gt.` with an empty value, which Postgres refuses to cast
   * to uuid. The throw landed before the cursor was ever written back, so the
   * next tick asked the identical broken question, forever: a fresh device
   * could never complete its first pull. The first page must carry no id at
   * all, and take the stamp inclusively so nothing sitting exactly on it is
   * skipped.
   */
  it("asks the first page with no id when no cursor is stored", async () => {
    remoteRows = [remoteRow];
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([]);

    // Stepped back over the repair window from the epoch, which is harmless.
    const start = new Date(Date.parse("1970-01-01T00:00:00.000Z") - REPAIR_WINDOW_MS).toISOString();
    expect(sentFilters).toEqual([`updated_at.gte.${start}`]);
    expect(pulled).toHaveLength(1);
    // The pull completing is what finally writes a real keyset cursor, which
    // is also what ends the retry loop the empty id used to feed.
    expect(storedCursors).toEqual([{ at: remoteRow.updated_at, id: "idea" }]);
  });

  /**
   * The same path for a device that synced before the cursor grew an id and
   * still holds the plain timestamp. Inclusive, because the old code's rows
   * sitting exactly on that stamp may never have been pulled — replaying one
   * that was is an idempotent overwrite, skipping one is a lost canvas.
   */
  it("upgrades a legacy string cursor without skipping its own stamp", async () => {
    storedCursor = remoteRow.updated_at;
    remoteRows = [remoteRow];
    const { syncCanvasesOnce } = await import("./canvasSync");

    const { pulled } = await syncCanvasesOnce([]);

    const start = new Date(Date.parse(remoteRow.updated_at) - REPAIR_WINDOW_MS).toISOString();
    expect(sentFilters).toEqual([`updated_at.gte.${start}`]);
    expect(pulled).toHaveLength(1);
    expect(storedCursors).toEqual([{ at: remoteRow.updated_at, id: "idea" }]);
  });

  /**
   * A stored cursor is where the read starts only after stepping back over the
   * repair window, id and all — the guard the notes pull always had. A canvas
   * that committed a moment behind the cursor, or went up stamped with a server
   * clock read a second early, sits inside it. Past the first page the read is
   * strict keyset again, from where that page ended.
   */
  it("steps back over the repair window from a stored cursor, then pages by keyset", async () => {
    storedCursor = { at: ARRANGED, id: "earlier-idea" };
    const page = Array.from({ length: 200 }, (_, i) => ({
      ...remoteRow,
      id: `idea-${String(i).padStart(3, "0")}`,
    }));
    remotePages = [page, []];
    const { syncCanvasesOnce } = await import("./canvasSync");

    await syncCanvasesOnce([]);

    const start = new Date(Date.parse(ARRANGED) - REPAIR_WINDOW_MS).toISOString();
    expect(sentFilters).toEqual([
      `updated_at.gte.${start}`,
      `updated_at.gt.${remoteRow.updated_at},and(updated_at.eq.${remoteRow.updated_at},id.gt.idea-199)`,
    ]);
  });

  it("keeps the cursor where it was when the window brings back only older rows", async () => {
    storedCursor = { at: ARRANGED, id: "earlier-idea" };
    remoteRows = [{ ...remoteRow, updated_at: "2026-08-12T08:59:30.000Z" }];
    const { syncCanvasesOnce } = await import("./canvasSync");

    await syncCanvasesOnce([]);

    expect(storedCursors).toEqual([{ at: ARRANGED, id: "earlier-idea" }]);
  });

  /** A canvas stamped by a fast clock must not drag this cursor into the future. */
  it("is never stored past the server's own clock, by either pull", async () => {
    const future = { ...remoteRow, updated_at: "2026-09-20T00:00:00.000Z" };
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate("Sat, 12 Sep 2026 12:00:00 GMT");

    remoteRows = [future];
    await syncCanvasesOnce([]);
    await syncCanvasesOnce([], {
      rows: [canvas({ updated_at: future.updated_at })],
      cursor: { at: future.updated_at, id: "idea" },
      complete: true,
    });

    expect(storedCursors).toHaveLength(2);
    for (const stored of storedCursors as { at: string; id: string }[]) {
      expect(stored.id).toBe("");
      expect(Date.parse(stored.at)).toBeLessThan(Date.parse("2026-09-12T12:01:00Z"));
    }
  });
});

/**
 * Given the arrangements the combined pull already brought down, the turn
 * applies them under its own conflict rule and asks the table for nothing.
 */
describe("a turn given the combined pull's answer", () => {
  it("applies what it was handed, stores the cursor, and reads nothing itself", async () => {
    const { syncCanvasesOnce } = await import("./canvasSync");
    const theirs = folder({ id: "idea", updated_at: "2026-08-12T10:00:00.000Z" });
    remoteRows = [{ id: "should-not-be-read", items: [], updated_at: "2026-08-12T11:00:00.000Z" }];

    const outcome = await syncCanvasesOnce([], {
      rows: [theirs],
      cursor: { at: theirs.updated_at, id: "idea" },
      complete: true,
    });

    expect(sentFilters).toEqual([]);
    expect(outcome.pulled.map((f) => f.id)).toEqual(["idea"]);
    expect(storedCursors).toEqual([{ at: theirs.updated_at, id: "idea" }]);
  });

  it("drops a row for a canvas this tick pushed: it was fetched before the push and is older", async () => {
    const { syncCanvasesOnce } = await import("./canvasSync");
    const mine = folder({ id: "idea", updated_at: "2026-08-12T12:00:00.000Z" });
    outbox = new Map([["idea", mine.updated_at]]);
    const theirs = folder({ id: "idea", updated_at: "2026-08-12T10:00:00.000Z" });

    const outcome = await syncCanvasesOnce([mine], {
      rows: [theirs],
      cursor: { at: theirs.updated_at, id: "idea" },
      complete: true,
    });

    expect(outcome.pulled).toEqual([]);
  });
});

/**
 * Dragging a note across a canvas pushes every 700ms, and each push was
 * echoed straight back through realtime as another reason to sync.
 */
describe("what the push tells the echo guard", () => {
  it("remembers the stamp that went up, so this device's own row wakes nothing", async () => {
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { forgetSent, isOwnEcho } = await import("./echo");
    forgetSent();
    const mine = folder({ id: "idea", updated_at: "2026-08-12T12:00:00.000Z" });
    outbox = new Map([["idea", mine.updated_at]]);

    await syncCanvasesOnce([mine]);

    expect(isOwnEcho("folders", { id: "idea", updated_at: "2026-08-12T12:00:00+00:00" })).toBe(true);
    // The note that the canvas arranges shares its id and is not covered.
    expect(isOwnEcho("notes", { id: "idea", updated_at: "2026-08-12T12:00:00+00:00" })).toBe(false);
  });
});

/**
 * A canvas goes up stamped no earlier than the server's clock — its pull has
 * no repair window, so an arrangement uploaded under an older stamp sat behind
 * the other device's cursor for good — and the restamped row coming back down
 * is still recognised as this device's own.
 */
describe("the stamp an arrangement goes up with", () => {
  const SERVER_SAYS = "Sat, 12 Sep 2026 12:00:00 GMT";

  it("is the server's clock when the arrangement is older, and is crossed off by its own", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { noteServerDate } = await import("./serverClock");
    const { forgetSent, isOwnEcho } = await import("./echo");
    forgetSent();
    noteServerDate(SERVER_SAYS);

    await syncCanvasesOnce([folder()]);

    const sent = String(pushedRows[0].updated_at);
    expect(Date.parse(sent)).toBeGreaterThanOrEqual(Date.parse("2026-09-12T12:00:00Z"));
    expect(outbox.size).toBe(0);
    expect(isOwnEcho("folders", { id: "idea", updated_at: sent.replace("Z", "+00:00") })).toBe(true);
  });

  it("does not apply its own restamped upload when it comes back down", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate(SERVER_SAYS);
    const mine = folder();
    await syncCanvasesOnce([mine]);
    const sent = String(pushedRows[0].updated_at).replace("Z", "+00:00");

    const outcome = await syncCanvasesOnce([mine], {
      rows: [folder({ updated_at: sent })],
      cursor: { at: sent, id: "idea" },
      complete: true,
    });

    expect(outcome.pulled).toEqual([]);
    // Nothing was queued by it either, so nothing goes round again.
    expect(outbox.size).toBe(0);
  });

  it("still takes the other device's arrangement after its own went up", async () => {
    outbox = new Map([["idea", ARRANGED]]);
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate(SERVER_SAYS);
    const mine = folder();
    await syncCanvasesOnce([mine]);

    const theirs = folder({
      items: [{ note_id: "a", x: 900, y: 400 }],
      updated_at: "2026-09-12T12:05:00.000+00:00",
    });
    const outcome = await syncCanvasesOnce([mine], {
      rows: [theirs],
      cursor: { at: theirs.updated_at, id: "idea" },
      complete: true,
    });

    expect(outcome.pulled.map((f) => f.items[0])).toEqual([{ note_id: "a", x: 900, y: 400 }]);
  });
});

/**
 * With the repair window, every tick reads the last two minutes of canvases
 * again — this device's own uploads among them. That must cost nothing: no
 * queued arrangement overwritten, nothing put back in the outbox, and no
 * tick provoking another. The server here holds one row per canvas, as the
 * real one does, so a read after an upload returns that upload.
 */
describe("a canvas read again inside the repair window", () => {
  /** The row the server holds after the last upload, spelled as it hands it back. */
  const onServer = (): Record<string, unknown> => {
    const last = pushedRows[pushedRows.length - 1];
    return { ...last, updated_at: String(last.updated_at).replace("Z", "+00:00") };
  };

  it("overwrites no queued arrangement, queues nothing, and settles", async () => {
    const { syncCanvasesOnce } = await import("./canvasSync");
    const { noteServerDate } = await import("./serverClock");
    noteServerDate("Sat, 12 Sep 2026 12:00:00 GMT");

    // 1. An arrangement goes up, restamped with the server's clock.
    outbox = new Map([["idea", ARRANGED]]);
    const first = folder();
    await syncCanvasesOnce([first]);
    expect(pushedRows).toHaveLength(1);

    // 2. The next tick, with nothing queued, reads that upload again.
    remoteRows = [onServer()];
    let outcome = await syncCanvasesOnce([first]);
    expect(outcome).toEqual({ pushed: 0, pulled: [], refused: null, held: [] });

    // 3. A drag goes up and another lands while it is in flight, so the canvas
    //    is still queued when the read comes back — with the other device's
    //    arrangement, which must not replace the one waiting here.
    const dragged = folder({
      items: [{ note_id: "a", x: 50, y: 0 }],
      updated_at: "2026-08-12T09:00:05.000Z",
    });
    outbox = new Map([["idea", dragged.updated_at]]);
    duringUpload = () => {
      outbox.set("idea", "2026-08-12T09:00:06.000Z");
      remoteRows = [{ ...remoteRow, updated_at: "2026-09-12T11:59:59+00:00" }];
    };
    outcome = await syncCanvasesOnce([dragged]);
    expect(outcome.pulled).toEqual([]);
    expect(outbox.get("idea")).toBe("2026-08-12T09:00:06.000Z");

    // 4. The queued move goes up, and the read returns that upload.
    const moved = folder({
      items: [{ note_id: "a", x: 60, y: 0 }],
      updated_at: "2026-08-12T09:00:06.000Z",
    });
    duringUpload = () => {
      remoteRows = [onServer()];
    };
    outcome = await syncCanvasesOnce([moved]);
    expect(outcome).toEqual({ pushed: 1, pulled: [], refused: null, held: [] });
    expect(outbox.size).toBe(0);

    // 5. And the tick after reads it again and does nothing at all.
    duringUpload = null;
    const uploads = pushedRows.length;
    outcome = await syncCanvasesOnce([moved]);
    expect(outcome).toEqual({ pushed: 0, pulled: [], refused: null, held: [] });
    expect(pushedRows).toHaveLength(uploads);
    expect(outbox.size).toBe(0);
    expect(writtenLocally).toEqual([]);
  });
});
