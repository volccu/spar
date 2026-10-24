import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import type { UserBoard } from "../types";

/**
 * Prefs sync — the user's own folder boards — and the one thing its conflict
 * rule exists to prevent: an empty list nobody chose overwriting a shelf
 * somebody actually built on the other device.
 */

/** Whether the fake server has run migration 0014/0016. */
let tableExists = true;
/** Whether it has run 0018, which added the Inbox date to the same row. */
let sinceColumn = true;
/** The network failing the very first question, not the server lacking the table. */
let probeFails = false;
/** The single row the fake server hands back from a pull, if any. */
let remoteRows: Record<string, unknown>[] = [];
/** Rows the client tried to push, for inspection. */
let pushedRows: Record<string, unknown>[] = [];
/** Whether the fake server has run migration 0028 (the conditional write). */
let conditionalWrite = false;
/** What each conditional write was asked, for inspection. */
let conditionalCalls: Record<string, unknown>[] = [];
/** Runs just before a conditional write lands — the other device, writing in between. */
let meanwhile: (() => void) | null = null;
/** How many times the client read the row. */
let reads = 0;

vi.mock("./supabase", () => {
  const builder = () => ({
    select(cols: string) {
      // The probe, which asks for the column the pull will actually read.
      // It used to ask for "owner_id" — present since 0014 — while the pull
      // reads "boards", which only arrived in 0016, so a half-migrated server
      // passed the probe and then failed every read.
      if (cols === "boards") {
        return {
          limit: async () =>
            probeFails
              ? { data: null, error: { message: "Failed to fetch" } }
              : tableExists
              ? { data: [], error: null }
              : { data: null, error: { message: 'relation "prefs" does not exist' } },
        };
      }
      // The second probe: the Inbox date arrived a migration later than the
      // folders, so a server can have one column and not the other.
      if (cols === "inbox_since") {
        return {
          limit: async () =>
            tableExists && sinceColumn
              ? { data: [], error: null }
              : {
                  data: null,
                  error: { message: 'column prefs.inbox_since does not exist' },
                },
        };
      }
      if (!tableExists) throw new Error("asked the server for a table it has not got");
      return {
        limit: async () => {
          reads++;
          return { data: remoteRows, error: null };
        },
      };
    },
    async upsert(row: Record<string, unknown>) {
      if (!tableExists) return { error: { message: 'relation "prefs" does not exist' } };
      pushedRows.push(row);
      return { error: null };
    },
  });

  // Migration 0028's conditional write, as Postgres would answer it: written
  // only while `updated_at` is still the one read, or while there is no row.
  async function rpc(name: string, args: Record<string, unknown>) {
    if (name !== "write_prefs_if_unchanged" || !conditionalWrite) {
      return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    }
    conditionalCalls.push(args);
    meanwhile?.();
    const current = remoteRows[0];
    const ok = args.p_expected_at === null ? !current : Boolean(current) && current.updated_at === args.p_expected_at;
    if (ok) {
      const row = {
        boards: args.p_boards,
        updated_at: args.p_updated_at,
        ...(args.p_set_since ? { inbox_since: args.p_inbox_since } : {}),
      };
      pushedRows.push(row);
      remoteRows = [{ inbox_since: current?.inbox_since ?? null, ...row }];
    }
    return { data: ok, error: null };
  }

  return { getSupabase: async () => ({ from: () => builder(), rpc }), syncConfigured: true };
});

const BOARDS_AT = "2026-08-12T09:00:00.000Z";
const recipes: UserBoard[] = [
  { id: "b1", name: "Recipes", position: 0 },
  { id: "b2", name: "Work", position: 1 },
];

beforeEach(() => {
  tableExists = true;
  sinceColumn = true;
  probeFails = false;
  remoteRows = [];
  pushedRows = [];
  conditionalWrite = false;
  conditionalCalls = [];
  meanwhile = null;
  reads = 0;
  vi.resetModules();
});

describe("a server that has not run migration 0016", () => {
  it("says nothing rather than throwing", async () => {
    tableExists = false;
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [recipes[0]],
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
    });

    expect(outcome).toEqual({ pushed: false, pulled: null });
    expect(pushedRows).toHaveLength(0);
  });
});

describe("a clean device with no local boards", () => {
  it("takes the remote list", async () => {
    remoteRows = [
      { boards: recipes, inbox_since: null, updated_at: "2026-08-10T12:00:00.000Z" },
    ];
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: null,
      at: "1970-01-01T00:00:00.000Z",
      boardsDirty: false,
      sinceDirty: false,
    });

    expect(outcome.pushed).toBe(false);
    expect(outcome.pulled).toEqual({
      boards: recipes,
      at: "2026-08-10T12:00:00.000Z",
      inboxSince: null,
    });
  });

  /**
   * The answer to the first-open question travels in the same row as the
   * folders, because it is the same kind of thing: one small preference, synced
   * whole. A second device that has never been asked takes the answer given on
   * the first rather than asking again.
   */
  it("takes the Inbox date along with the list", async () => {
    remoteRows = [
      {
        boards: recipes,
        inbox_since: "2026-08-18T06:00:00.000Z",
        updated_at: "2026-08-18T06:00:00.000Z",
      },
    ];
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: null,
      at: "1970-01-01T00:00:00.000Z",
      boardsDirty: false,
      sinceDirty: false,
    });

    expect(outcome.pulled?.inboxSince).toBe("2026-08-18T06:00:00.000Z");
  });

  /**
   * A server that has not run 0018 says *nothing* about the date — reported as
   * null it would wipe the answer already given on this device, every single
   * time the loop ran, which is the same "an empty answer nobody chose must not
   * win" rule the folder list itself is built on.
   */
  it("says nothing about the Inbox date when the server has no column for it", async () => {
    sinceColumn = false;
    remoteRows = [{ boards: recipes, updated_at: "2026-08-10T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: "2026-08-18T06:00:00.000Z",
      at: "1970-01-01T00:00:00.000Z",
      boardsDirty: false,
      sinceDirty: false,
    });

    expect(outcome.pulled?.boards).toEqual(recipes);
    expect("inboxSince" in (outcome.pulled ?? {})).toBe(false);
  });

  it("pulls nothing when the server has no row yet either", async () => {
    remoteRows = [];
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: null,
      at: "1970-01-01T00:00:00.000Z",
      boardsDirty: false,
      sinceDirty: false,
    });

    expect(outcome).toEqual({ pushed: false, pulled: null });
  });
});

describe("a device with a queued board change", () => {
  /**
   * The bug the whole conflict rule exists to prevent, the same way an
   * invented default canvas layout must not win against an arrangement made
   * last week. An older remote row must never land on top of a push that
   * just made it stale — so this device does not even ask.
   */
  it("pushes, and is not overwritten by an older remote row", async () => {
    remoteRows = [{ boards: [], inbox_since: null, updated_at: "2026-08-01T00:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [recipes[0]],
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
    });

    expect(outcome.pushed).toBe(true);
    expect(outcome.pulled).toBeNull();
    expect(pushedRows).toHaveLength(1);
    expect(pushedRows[0]).toEqual({
      boards: [recipes[0]],
      inbox_since: null,
      updated_at: BOARDS_AT,
    });
  });

  it("pushes the Inbox date in the same row, and omits it on an old server", async () => {
    const { syncBoardsOnce } = await import("./boardSync");
    const since = "2026-08-18T06:00:00.000Z";

    await syncBoardsOnce({
      boards: [recipes[0]],
      inboxSince: since,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
    });
    expect(pushedRows[0].inbox_since).toBe(since);

    // Against a server that has not run 0018 the column is left out of the
    // upsert entirely rather than sent and rejected — the folders still go up.
    sinceColumn = false;
    pushedRows = [];
    vi.resetModules();
    const { syncBoardsOnce: again } = await import("./boardSync");
    await again({
      boards: [recipes[0]],
      inboxSince: since,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
    });
    expect(pushedRows).toHaveLength(1);
    expect("inbox_since" in pushedRows[0]).toBe(false);
  });

  /** The client never names an owner, so it can never name the wrong one. */
  it("leaves owner_id to the server", async () => {
    const { syncBoardsOnce } = await import("./boardSync");

    await syncBoardsOnce({
      boards: [recipes[0]],
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
    });

    expect("owner_id" in pushedRows[0]).toBe(false);
  });
});

/**
 * The day the shelf was lost, written down as a test.
 *
 * A browser whose local store had been cleared sat on the sign-in screen holding
 * no folders and no Inbox answer. The app answered the Inbox question for it —
 * the pile read 0, which is under `INBOX_ASK_MIN`, so it is answered silently —
 * and while the two facts shared one dirty flag, that answer put the *empty
 * folder list* in the queue beside it. Eleven seconds later the sign-in turned
 * sync on, saw a change queued, and pushed. A push is unconditional by design,
 * so the blank shelf replaced four real folders on the server.
 *
 * Two things now stand between that and a repeat: `App.tsx` will not answer the
 * question before the server has been heard from, and this — a push says only
 * what somebody actually changed.
 */
describe("a device that answered only the Inbox question", () => {
  it("sends the date and says nothing at all about the folder list", async () => {
    const { syncBoardsOnce } = await import("./boardSync");

    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: "1970-01-01T00:00:00.000Z",
      at: BOARDS_AT,
      boardsDirty: false,
      sinceDirty: true,
    });

    expect(outcome.pushed).toBe(true);
    expect(pushedRows).toHaveLength(1);
    // The whole fix in one line: an upsert writes the columns it is given, so a
    // payload with no `boards` in it leaves the shelf on the server alone.
    expect("boards" in pushedRows[0]).toBe(false);
    expect(pushedRows[0].inbox_since).toBe("1970-01-01T00:00:00.000Z");
  });

  /** And the mirror of it, which is the same rule pointing the other way. */
  it("does not send a null Inbox date along with a folder somebody made", async () => {
    const { syncBoardsOnce } = await import("./boardSync");

    await syncBoardsOnce({
      boards: [recipes[0]],
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: false,
    });

    expect(pushedRows[0].boards).toEqual([recipes[0]]);
    expect("inbox_since" in pushedRows[0]).toBe(false);
  });
});

/**
 * Given the row the combined pull already brought down, the turn applies it
 * under its own rule — dirty here still means push and read nothing — and
 * never reads the table itself. `null` handed in is an answer ("no row"),
 * which is not the same as not being handed anything.
 */
describe("a turn given the combined pull's answer", () => {
  it("takes the row it was handed and reads nothing itself", async () => {
    const { syncBoardsOnce } = await import("./boardSync");
    remoteRows = [{ boards: [{ id: "x", name: "Should not be read", position: 0 }], updated_at: BOARDS_AT }];

    const outcome = await syncBoardsOnce(
      { boards: [], inboxSince: null, at: BOARDS_AT, boardsDirty: false, sinceDirty: false },
      { boards: recipes, at: BOARDS_AT, inboxSince: "2026-08-01T00:00:00.000Z" },
    );

    expect(outcome.pulled).toEqual({ boards: recipes, at: BOARDS_AT, inboxSince: "2026-08-01T00:00:00.000Z" });
  });

  it("treats a null row as the server's answer, not as a missing one", async () => {
    const { syncBoardsOnce } = await import("./boardSync");
    remoteRows = [{ boards: recipes, updated_at: BOARDS_AT }];

    const outcome = await syncBoardsOnce(
      { boards: [], inboxSince: null, at: BOARDS_AT, boardsDirty: false, sinceDirty: false },
      null,
    );

    expect(outcome.pulled).toBeNull();
  });

  it("still pushes rather than reads when this device has a change queued", async () => {
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce(
      { boards: recipes, inboxSince: null, at: BOARDS_AT, boardsDirty: true, sinceDirty: false },
      { boards: [], at: BOARDS_AT, inboxSince: null },
    );

    expect(outcome.pushed).toBe(true);
    expect(outcome.pulled).toBeNull();
    expect(pushedRows).toHaveLength(1);
  });
});

describe("what the push tells the echo guard", () => {
  it("remembers the stamp that went up, under the name the row has no id for", async () => {
    const { syncBoardsOnce } = await import("./boardSync");
    const { forgetSent, isOwnEcho, PREFS_ROW } = await import("./echo");
    forgetSent();

    await syncBoardsOnce({
      boards: recipes,
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: false,
    });

    expect(isOwnEcho("prefs", { owner_id: "me", updated_at: BOARDS_AT }, PREFS_ROW)).toBe(true);
  });
});

/**
 * 2026-10-09: a browser used "on this device only" — an empty shelf and an
 * Inspiration it made for itself — signed in and pushed its list whole over
 * the account's folders. A queued change is now merged into the server's row.
 */
describe("a device that has never seen the account's list", () => {
  const account: UserBoard[] = [
    { id: "b1", name: "Recipes", position: 0 },
    { id: "b2", name: "Work", position: 1 },
    { id: "i-old", name: "insp", position: 2, kind: "inspiration" },
  ];

  it("adds to the account's shelf and takes nothing off it", async () => {
    remoteRows = [{ boards: account, inbox_since: null, updated_at: "2026-10-01T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce({
      boards: [
        { id: "i-new", name: "Inspiration", position: 0, kind: "inspiration" },
        { id: "mine", name: "Made here", position: 1 },
      ],
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: false,
      base: null,
    });

    const sent = pushedRows[0].boards as UserBoard[];
    // Its own Inspiration goes up as a plain folder, so the notes filed into
    // it on this device stay filed (audit DATA-3); the account's stays the wall.
    expect(sent.map((b) => b.id)).toEqual(["b1", "b2", "i-old", "i-new", "mine"]);
    expect(sent.find((b) => b.id === "i-new")).toEqual({ id: "i-new", name: "Inspiration 2", position: 2 });
    expect(sent.find((b) => b.id === "i-old")?.kind).toBe("inspiration");
    expect(outcome.merged?.boards).toEqual(sent);
  });

  it("pushes its own list as it is when the server holds no row", async () => {
    remoteRows = [];
    const { syncBoardsOnce } = await import("./boardSync");
    await syncBoardsOnce({
      boards: recipes,
      inboxSince: null,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: false,
      base: null,
    });
    expect(pushedRows[0].boards).toEqual(recipes);
  });
});

describe("a server that could not be asked", () => {
  it("fails the turn rather than passing it as nothing to do", async () => {
    probeFails = true;
    const { syncBoardsOnce } = await import("./boardSync");
    await expect(
      syncBoardsOnce({ boards: [], inboxSince: null, at: BOARDS_AT, boardsDirty: false, sinceDirty: false }),
    ).rejects.toThrow(/could not ask/);
    expect(pushedRows).toHaveLength(0);
  });
});

/**
 * Audit DATA-1 (2026-10-10). The merge used the row the combined pull read at
 * the start of the tick — minutes before, behind notes, files and canvases —
 * and wrote with a plain upsert, so a folder change the other device made in
 * between was overwritten.
 */
describe("a queued folder change, written over the row it was merged against", () => {
  const base: UserBoard[] = [{ id: "b1", name: "Recipes", position: 0 }];
  const made: UserBoard = { id: "here", name: "Made here", position: 1 };
  const there: UserBoard = { id: "there", name: "Made there", position: 1 };
  const local = () => ({
    boards: [...base, made],
    inboxSince: null,
    at: BOARDS_AT,
    boardsDirty: true,
    sinceDirty: false,
    base,
  });

  it("reads the row again rather than merging into the tick's early copy", async () => {
    remoteRows = [{ boards: [...base, there], inbox_since: null, updated_at: "2026-10-10T10:00:05.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    // What the combined pull brought down at the start of the tick: older.
    const early = { boards: base, at: "2026-10-10T10:00:00.000Z", inboxSince: null };
    const outcome = await syncBoardsOnce(local(), early);
    expect(reads).toBe(1);
    expect((pushedRows[0].boards as UserBoard[]).map((b) => b.id)).toEqual(["b1", "there", "here"]);
    expect(outcome.merged?.boards.map((b) => b.id)).toEqual(["b1", "there", "here"]);
  });

  it("writes only while the row is still the one it read", async () => {
    conditionalWrite = true;
    remoteRows = [{ boards: base, inbox_since: null, updated_at: "2026-10-10T10:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    await syncBoardsOnce(local());
    expect(conditionalCalls).toHaveLength(1);
    expect(conditionalCalls[0].p_expected_at).toBe("2026-10-10T10:00:00.000Z");
    expect(conditionalCalls[0].p_set_since).toBe(false);
    expect(remoteRows[0].boards).toEqual([...base, made]);
  });

  it("when another device wrote in between: reads, merges and sends again, keeping both", async () => {
    conditionalWrite = true;
    remoteRows = [{ boards: base, inbox_since: null, updated_at: "2026-10-10T10:00:00.000Z" }];
    meanwhile = () => {
      meanwhile = null;
      remoteRows = [{ boards: [...base, there], inbox_since: null, updated_at: "2026-10-10T10:00:01.000Z" }];
    };
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce(local());
    expect(conditionalCalls).toHaveLength(2);
    expect(reads).toBe(2);
    expect((remoteRows[0].boards as UserBoard[]).map((b) => b.id)).toEqual(["b1", "there", "here"]);
    expect(outcome.merged?.boards.map((b) => b.id)).toEqual(["b1", "there", "here"]);
  });

  it("creates the row only while there is still none", async () => {
    conditionalWrite = true;
    remoteRows = [];
    meanwhile = () => {
      meanwhile = null;
      remoteRows = [{ boards: [...base, there], inbox_since: null, updated_at: "2026-10-10T10:00:01.000Z" }];
    };
    const { syncBoardsOnce } = await import("./boardSync");
    await syncBoardsOnce({ ...local(), base: null });
    expect(conditionalCalls[0].p_expected_at).toBeNull();
    expect((remoteRows[0].boards as UserBoard[]).map((b) => b.id)).toEqual(["b1", "there", "here"]);
  });

  it("gives up after three tries and fails the turn, writing nothing", async () => {
    conditionalWrite = true;
    let n = 0;
    remoteRows = [{ boards: base, inbox_since: null, updated_at: "2026-10-10T10:00:00.000Z" }];
    const busy = () => {
      n++;
      remoteRows = [{ boards: base, inbox_since: null, updated_at: `2026-10-10T10:00:0${n}.000Z` }];
      meanwhile = busy;
    };
    meanwhile = busy;
    const { syncBoardsOnce } = await import("./boardSync");
    await expect(syncBoardsOnce(local())).rejects.toThrow(/kept changing/);
    expect(conditionalCalls).toHaveLength(3);
    expect(pushedRows).toHaveLength(0);
  });

  it("falls back to the plain upsert on a server without migration 0028", async () => {
    remoteRows = [{ boards: base, inbox_since: null, updated_at: "2026-10-10T10:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce(local());
    expect(outcome.pushed).toBe(true);
    expect(pushedRows).toEqual([{ boards: [...base, made], updated_at: BOARDS_AT }]);
  });
});

/**
 * Audit DATA-11 (2026-10-10). A store used "on this device only" answers the
 * Inbox question for itself; on signing in, that answer used to go up over the
 * account's own. A device that has never seen the account's row (no `base`)
 * now takes the account's answer when it has one.
 */
describe("an Inbox answer given before this device ever heard from the server", () => {
  const ACCOUNT_SINCE = "2026-06-01T00:00:00.000Z";
  const DEVICE_SINCE = "1970-01-01T00:00:00.000Z";

  it("yields to the account's answer, sending only the folder change", async () => {
    remoteRows = [{ boards: recipes, inbox_since: ACCOUNT_SINCE, updated_at: "2026-10-01T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce({
      boards: [{ id: "mine", name: "Made here", position: 0 }],
      inboxSince: DEVICE_SINCE,
      at: BOARDS_AT,
      boardsDirty: true,
      sinceDirty: true,
      base: null,
    });
    expect("inbox_since" in pushedRows[0]).toBe(false);
    expect(outcome.yieldedSince).toBe(ACCOUNT_SINCE);
  });

  it("yields when only the date is queued, and takes the account's row as it is", async () => {
    remoteRows = [{ boards: recipes, inbox_since: ACCOUNT_SINCE, updated_at: "2026-10-01T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: DEVICE_SINCE,
      at: BOARDS_AT,
      boardsDirty: false,
      sinceDirty: true,
      base: null,
    });
    expect(pushedRows).toHaveLength(0);
    expect(outcome.yieldedSince).toBe(ACCOUNT_SINCE);
    expect(outcome.pulled?.inboxSince).toBe(ACCOUNT_SINCE);
  });

  it("sends its answer when the account has none", async () => {
    remoteRows = [{ boards: recipes, inbox_since: null, updated_at: "2026-10-01T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce({
      boards: [],
      inboxSince: DEVICE_SINCE,
      at: BOARDS_AT,
      boardsDirty: false,
      sinceDirty: true,
      base: null,
    });
    expect(pushedRows[0].inbox_since).toBe(DEVICE_SINCE);
    expect(outcome.yieldedSince).toBeUndefined();
  });

  it("still sends a change made on a device that has seen the account's row", async () => {
    remoteRows = [{ boards: recipes, inbox_since: ACCOUNT_SINCE, updated_at: "2026-10-01T12:00:00.000Z" }];
    const { syncBoardsOnce } = await import("./boardSync");
    const outcome = await syncBoardsOnce({
      boards: recipes,
      inboxSince: DEVICE_SINCE,
      at: BOARDS_AT,
      boardsDirty: false,
      sinceDirty: true,
      base: recipes,
    });
    expect(pushedRows[0].inbox_since).toBe(DEVICE_SINCE);
    expect(outcome.yieldedSince).toBeUndefined();
  });
});
