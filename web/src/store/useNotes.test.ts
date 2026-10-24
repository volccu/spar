// @vitest-environment jsdom
import { forgetServerClock, noteServerDate } from "./serverClock";
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import type { Note } from "../types";
import { useNotes } from "./useNotes";

const removedPaths: string[][] = [];
vi.mock("./attachments", async (importActual) => ({
  ...(await importActual<typeof import("./attachments")>()),
  removeRemotePaths: async (paths: string[]) => {
    removedPaths.push(paths);
  },
}));
import { allNotes, deleteNotes, dirtyEntries, getFile, putNote } from "./db";
import { TAB_CHANNEL } from "./tabs";
import { editedAt, wasEdited } from "../lib/versions";

// Unmounted after every case, so no store is left running its write and retry
// timers once the file ends: Testing Library cleans up by itself only where
// the runner's globals are on, and here they are not. A timer firing after
// jsdom was torn down sent React's scheduler looking for `window`.
afterEach(() => cleanup());

/**
 * `raw_content` is immutable, checked rather than trusted.
 *
 * This is the hardest rule in the app (CLAUDE.md, SPEC §2.3) and on the client
 * it rested on a single line — the `delete safe.raw_content` in `localPatch` —
 * with nothing to notice if it went. The server does guard it, with a BEFORE
 * UPDATE trigger from migration 0001, but a server-side guard is the wrong
 * shape of protection here: it fires after a round trip, and by then the wrong
 * text is already on screen and already written to IndexedDB. Worse, the
 * rejection arrives as a refused upsert, which sync treats as one bad row and
 * bisects around — so the note would sit in the outbox failing quietly forever
 * rather than announcing anything.
 *
 * Both halves are checked below: what the screen shows, and what the disk
 * holds. They are separate writes and a regression could take either one.
 */
/** The archive seeds on first open; nothing here depends on what is in it. */
async function ready() {
  const hook = renderHook(() => useNotes());
  await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });
  return hook.result;
}

describe("raw_content survives editing", () => {

  it("keeps the original capture when an edit tries to change it", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      // Opens upright so the capture rule (lib/capitalize.ts) has nothing to
      // do here — this test is about immutability, not casing.
      id = result.current.create("The original capture")!.id;
    });

    // The patch names both fields. Only one of them may land.
    act(() => {
      result.current.update(id, { raw_content: "overwritten", body: "the edited body" });
    });

    const onScreen = result.current.notes.find((note) => note.id === id);
    expect(onScreen?.raw_content).toBe("The original capture");
    expect(onScreen?.body).toBe("the edited body");

    // `persist` is fire-and-forget, so the durable copy lands a tick later.
    await waitFor(async () => {
      const stored = (await allNotes()).find((note) => note.id === id);
      expect(stored?.raw_content).toBe("The original capture");
      expect(stored?.body).toBe("the edited body");
    });
  });

  it("keeps it on the bulk path too", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      id = result.current.create("Captured once")!.id;
    });

    // Multi-select runs through `bulkUpdate`, not `update`. It shares
    // `localPatch` today; a refactor that inlined one and not the other would
    // leave a second way in, which is the whole reason this case is here.
    act(() => {
      result.current.bulkUpdate([id], { raw_content: "overwritten", status: "archived" });
    });

    const onScreen = result.current.notes.find((note) => note.id === id);
    expect(onScreen?.raw_content).toBe("Captured once");
    expect(onScreen?.status).toBe("archived");
  });
});

/**
 * The capital is written before the note exists, so both copies carry it and
 * agree — and it is written only then, so lowering it by hand afterwards
 * sticks. The rule itself lives in lib/capitalize.ts with its own tests; this
 * one checks the wiring.
 */
describe("a new capture opens with a capital", () => {
  it("lands in both copies, which stay identical", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      id = result.current.create("bought milk")!.id;
    });

    const made = result.current.notes.find((note) => note.id === id);
    expect(made?.body).toBe("Bought milk");
    expect(made?.raw_content).toBe("Bought milk");
    expect(made?.body).toBe(made?.raw_content);

    await waitFor(async () => {
      const stored = (await allNotes()).find((note) => note.id === id);
      expect(stored?.body).toBe("Bought milk");
      expect(stored?.raw_content).toBe("Bought milk");
    });
  });

  it("never fires again on an edit — a lowered capital stays lowered", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      id = result.current.create("bought milk")!.id;
    });
    act(() => {
      result.current.update(id, { body: "bought milk" });
    });

    const edited = result.current.notes.find((note) => note.id === id);
    expect(edited?.body).toBe("bought milk");
  });
});

/**
 * A sketch is created through the same `create`, marked by its `source` — the
 * one field that says what kind of capture a note was, set at creation and
 * never patched. The seed heading is text like any other, so both copies
 * carry it and the immutability rule needs no exception for it.
 */
describe("a draw note is an ordinary note wearing a source", () => {
  it("carries source, the seed heading, and identical copies", async () => {
    const result = await ready();

    let made: ReturnType<typeof result.current.create> = null;
    act(() => {
      made = result.current.create("# Sketch", "draw");
    });

    expect(made?.source).toBe("draw");
    expect(made?.body).toBe("# Sketch");
    expect(made?.raw_content).toBe("# Sketch");
    expect(made?.merged_from).toBeNull();

    await waitFor(async () => {
      const stored = (await allNotes()).find((note) => note.id === made?.id);
      expect(stored?.source).toBe("draw");
      expect(stored?.body).toBe("# Sketch");
    });
  });
});

/**
 * The trash sweep runs once on open and destroys everything whose month is up,
 * locally and on the server, permanently — and until now it said nothing at
 * all. It is the only entirely silent loss in an app whose whole argument is
 * that nothing is lost, and what ends that is a number handed upward.
 *
 * The number has to be what was actually destroyed. `destroy` re-checks every
 * id against the store as it is when the write runs, so "eligible when the
 * store was read" and "gone" are two different counts, and a receipt for four
 * when three went would be worse than no receipt.
 */
describe("the sweep answers for what it took", () => {
  const DAY = 86_400_000;

  // The sweep destroys nothing on a clock no server has confirmed
  // (`store/serverClock.ts`), so these cases let the server say what time it
  // is — which is what has already happened in any app that has ever synced.
  beforeEach(() => {
    forgetServerClock();
    noteServerDate(new Date().toUTCString());
  });

  function trashed(id: string, daysAgo: number): Note {
    const at = new Date(Date.now() - daysAgo * DAY).toISOString();
    return {
      id,
      raw_content: id,
      body: id,
      source: "web",
      created_at: at,
      updated_at: at,
      note_type: null,
      board_id: null,
      status: "trashed",
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    } as Note;
  }

  it("takes the notes whose month is up, and leaves the rest of the trash alone", async () => {
    // Two notes a month and a bit into the trash, and one that still has three
    // weeks to run — the sweep must take exactly the first two.
    await putNote(trashed("swept-a", 40));
    await putNote(trashed("swept-b", 60));
    await putNote(trashed("swept-safe", 9));

    const first = renderHook(() => useNotes());
    await waitFor(() => expect(first.result.current.loading).toBe(false), { timeout: 15_000 });
    await waitFor(async () => {
      const left = await allNotes();
      expect(left.some((n) => n.id === "swept-a")).toBe(false);
      expect(left.some((n) => n.id === "swept-b")).toBe(false);
    });

    const left = await allNotes();
    expect(left.some((n) => n.id === "swept-safe")).toBe(true);
  });

  /**
   * Handed an id for a note that is not in the trash, `destroy` leaves it
   * alone — the two-callers rule (the sweep, and emptying the bin by hand)
   * rests on that — and the answer counts only what it really took.
   */
  it("destroy answers with what it actually destroyed", async () => {
    const result = await ready();

    let live = "";
    act(() => {
      live = result.current.create("still on the board")!.id;
    });
    await putNote(trashed("destroy-one", 90));

    const reloaded = renderHook(() => useNotes());
    await waitFor(() => expect(reloaded.result.current.loading).toBe(false), { timeout: 15_000 });

    let took = -1;
    await act(async () => {
      took = await reloaded.result.current.destroy([live, "never-existed"]);
    });
    expect(took).toBe(0);
    expect((await allNotes()).some((n) => n.id === live)).toBe(true);
  });
});

/**
 * Organising a note is not editing it — for an imported note too.
 *
 * The rule (`editedAt`, lib/versions.ts) held only for notes with a `body`
 * clock. The importer writes none, so the first priority press on a note from
 * July stamped a clock for `priority` alone, moved `updated_at`, and the
 * footer fell back to that: "edited just now", and the card jumped to the top
 * of the board (2026-09-04 audit, F1). `localPatch` now seeds the full clock
 * set from the pre-write `updated_at` before stamping the field it touched,
 * so every verb below leaves the stamp exactly where it was.
 */
describe("organising an imported note leaves its edit stamp alone", () => {
  const JULY = "2026-07-12T09:00:00.000Z";

  function imported(id: string): Note {
    return {
      id,
      raw_content: id,
      body: id,
      source: "import",
      created_at: JULY,
      updated_at: JULY,
      note_type: null,
      board_id: null,
      status: "active",
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
      // No `field_updated_at` at all — exactly what the importer produces.
    } as Note;
  }

  it("through priority, archive, trash, filing, to-do, the bulk path, and undo", async () => {
    await putNote(imported("imported-organised"));
    const result = await ready();
    const find = () => result.current.notes.find((n) => n.id === "imported-organised")!;
    expect(editedAt(find())).toBe(JULY);

    const steps: Array<() => void> = [
      () => result.current.togglePriority(find()),
      () => result.current.togglePriority(find()),
      () => result.current.setStatus("imported-organised", "archived"),
      () => result.current.setStatus("imported-organised", "active"),
      () => result.current.setStatus("imported-organised", "trashed"),
      () => result.current.setStatus("imported-organised", "active"),
      () => result.current.update("imported-organised", { board_id: "some-folder" }),
      () => result.current.update("imported-organised", { note_type: "todo" }),
      () => result.current.bulkUpdate(["imported-organised"], { status: "archived" }),
      () => result.current.bulkUpdate(["imported-organised"], { status: "active", board_id: null }),
    ];
    for (const step of steps) {
      act(step);
      expect(editedAt(find())).toBe(JULY);
      expect(wasEdited(find())).toBe(false);
    }
    // The write really did land — the clocks say so, and `updated_at` moved.
    expect(find().updated_at).not.toBe(JULY);
    expect(find().field_updated_at?.body).toBe(JULY);

    // Words are an edit, and the stamp follows them.
    act(() => result.current.editBody("imported-organised", "now with new words"));
    expect(editedAt(find())).not.toBe(JULY);
    expect(wasEdited(find())).toBe(true);
  });

  it("and the sources of a merge keep theirs while they sit in the archive", async () => {
    await putNote(imported("imported-merge-a"));
    await putNote(imported("imported-merge-b"));
    const result = await ready();
    const pick = (id: string) => result.current.notes.find((n) => n.id === id)!;

    let undo = () => {};
    act(() => {
      undo = result.current.merge([pick("imported-merge-a"), pick("imported-merge-b")]).undo;
    });
    expect(pick("imported-merge-a").status).toBe("archived");
    expect(editedAt(pick("imported-merge-a"))).toBe(JULY);
    expect(editedAt(pick("imported-merge-b"))).toBe(JULY);

    act(() => undo());
    expect(pick("imported-merge-a").status).toBe("active");
    expect(editedAt(pick("imported-merge-a"))).toBe(JULY);
    expect(editedAt(pick("imported-merge-b"))).toBe(JULY);
  });

  // bughunt 2026-10-15: the undo stays on the stack, and a source taken out
  // of the idea and deleted since must stay deleted.
  it("and an old merge undo leaves a source alone once it has moved on", async () => {
    await putNote(imported("stale-merge-a"));
    await putNote(imported("stale-merge-b"));
    const result = await ready();
    const pick = (id: string) => result.current.notes.find((n) => n.id === id)!;

    let undo = () => {};
    act(() => {
      undo = result.current.merge([pick("stale-merge-a"), pick("stale-merge-b")]).undo;
    });
    act(() => result.current.update("stale-merge-b", { status: "trashed", merged_into: null }));

    act(() => undo());
    expect(pick("stale-merge-a").status).toBe("active");
    expect(pick("stale-merge-b").status).toBe("trashed");
  });
});

/**
 * A pull and a keystroke racing each other.
 *
 * Every mutator here computes its next array from `notesRef.current` and hands
 * `setNotes` a finished value, and the reason is stated above `update`: React
 * runs an updater when it renders, not when it is given one. `applyRemote` was
 * the one exception — it read `prev` inside the updater and wrote the ref from
 * in there — so between a pull landing and the next render the ref still held
 * the pre-pull archive. Anything the user did in that window computed from the
 * old list and set it, and the pull vanished from the screen while sitting in
 * IndexedDB: exactly the "the store had it and the screen did not" split that
 * `remoteIsNewer` was introduced to close.
 *
 * Both calls are in the same `act`, which is the window: React has not
 * rendered between them.
 */
describe("a pull and a local edit in the same tick", () => {
  it("keeps both, whichever order they arrive in", async () => {
    const result = await ready();

    let mine = "";
    act(() => {
      mine = result.current.create("written here")!.id;
    });

    const theirs: Note = {
      id: "from-the-phone",
      raw_content: "written there",
      body: "written there",
      source: "web",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      note_type: null,
      board_id: null,
      status: "active",
      priority: 0,
      reminder_at: null,
      done: null,
      merged_from: null,
      keep_id: null,
      attachments: [],
    };

    act(() => {
      result.current.applyRemote([theirs]);
      // No render has happened in between. Read off a stale ref, this write
      // would hand back an array the pulled note is simply not in.
      result.current.editBody(mine, "edited before the render");
    });

    const ids = result.current.notes.map((n) => n.id);
    expect(ids).toContain("from-the-phone");
    expect(result.current.notes.find((n) => n.id === mine)?.body).toBe(
      "edited before the render",
    );
  });
});

/**
 * A pull is merged against the note as it is *now*, not swapped in for it.
 *
 * `syncOnce` merges each pulled row against the archive as the tick began,
 * then makes two more trips to the network before the row reaches
 * `applyRemote`. A keystroke that lands in between is in IndexedDB with a
 * newer body clock and nowhere in the row; swapping the row in put the
 * note on screen without the keystroke, the next push sent the screen's copy,
 * and the outbox entry — stamped by the keystroke — never matched what was
 * sent. The text sat in the store alone, and the note stayed dirty, until a
 * reload. Per-field clocks already know which side holds the newer body;
 * `applyRemote` just has to ask.
 */
describe("a pull that lands after a keystroke", () => {
  it("takes the phone's filing and keeps this device's text", async () => {
    const result = await ready();

    let id = "";
    act(() => {
      id = result.current.create("written here")!.id;
    });
    const before = result.current.notes.find((n) => n.id === id)!;
    // The other device filed the note a millisecond after it was made, and
    // knows nothing of the edit below.
    const filedAt = new Date(Date.parse(before.updated_at) + 1).toISOString();
    const theirs: Note = {
      ...before,
      board_id: "recipes",
      updated_at: filedAt,
      field_updated_at: { ...before.field_updated_at, board_id: filedAt },
    };

    act(() => {
      result.current.editBody(id, "written here, and then some");
    });
    act(() => {
      result.current.applyRemote([theirs]);
    });

    const after = result.current.notes.find((n) => n.id === id)!;
    expect(after.board_id).toBe("recipes");
    expect(after.body).toBe("written here, and then some");
  });
});

/**
 * An upload is the slowest thing a sync tick does, and what it hands back is
 * the tick's opening snapshot with paths filled in. Applied as a whole list,
 * that snapshot overwrote whatever the note's files had become in the
 * meantime: a file attached during the upload vanished from the note (its
 * bytes orphaned on this device), and one removed came back. Only the paths
 * are taken now, by attachment id, into the list as it is.
 */
/**
 * Adding a file to a note that exists, and taking one off it. Both go through
 * `localPatch` and an immediate write: the screen first, then the disk and the
 * outbox at the note's new stamp, with the words the note was captured with
 * left exactly where they were.
 */
describe("a file added to or taken off an existing note", () => {
  const file = (name: string) => new File([`bytes of ${name}`], name, { type: "text/plain" });

  it("adds the file on screen, on disk and in the outbox, after what was there", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("zzzattach a note to hang files on")!.id;
    });
    await act(async () => {
      await result.current.attachTo(id, [file("first.txt")]);
    });
    await act(async () => {
      await result.current.attachTo(id, [file("second.txt")]);
    });
    const shown = result.current.notes.find((n) => n.id === id)!;
    expect(shown.attachments.map((a) => a.name)).toEqual(["first.txt", "second.txt"]);
    expect(shown.raw_content).toBe("Zzzattach a note to hang files on");
    expect(shown.field_updated_at?.attachments).toBe(shown.updated_at);
    expect(await getFile(shown.attachments[1].id)).toBeDefined();
    await waitFor(async () => {
      const stored = (await allNotes()).find((n) => n.id === id);
      expect(stored?.attachments.map((a) => a.name)).toEqual(["first.txt", "second.txt"]);
      expect((await dirtyEntries()).find((e) => e.id === id)?.stamp).toBe(shown.updated_at);
    });
  });

  it("takes one file off, keeps the others, and lets go of its bytes", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("zzzdetach a note losing a file")!.id;
    });
    await act(async () => {
      await result.current.attachTo(id, [file("keep.txt"), file("drop.txt")]);
    });
    const [kept, dropped] = result.current.notes.find((n) => n.id === id)!.attachments;
    const before = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.detach(id, dropped.id);
    });
    const shown = result.current.notes.find((n) => n.id === id)!;
    expect(shown.attachments.map((a) => a.id)).toEqual([kept.id]);
    expect(shown.updated_at > before.updated_at).toBe(true);
    expect(shown.raw_content).toBe("Zzzdetach a note losing a file");
    await waitFor(async () => {
      const stored = (await allNotes()).find((n) => n.id === id);
      expect(stored?.attachments.map((a) => a.id)).toEqual([kept.id]);
      expect((await dirtyEntries()).find((e) => e.id === id)?.stamp).toBe(shown.updated_at);
      expect(await getFile(dropped.id)).toBeUndefined();
    });
    expect(await getFile(kept.id)).toBeDefined();
  });
});

/**
 * A note captured with its files is written once, at its own instant: the files'
 * clock is `created_at`, not the moment their bytes had been read (which read as
 * "Edited" on a note nobody had touched). A file added afterwards, or words
 * changed, are edits again, and move the note up the board.
 */
describe("a note made with its files", () => {
  const file = (name: string) => new File([`bytes of ${name}`], name, { type: "text/plain" });

  it("is not edited by its own files, on screen or on disk", async () => {
    const result = await ready();
    let made: Note | null = null;
    await act(async () => {
      made = await result.current.createWithFiles([file("first.txt")], "zzzmade with a file");
    });
    const shown = result.current.notes.find((n) => n.id === made!.id)!;
    expect(shown.attachments.map((a) => a.name)).toEqual(["first.txt"]);
    expect(shown.field_updated_at?.attachments).toBe(shown.created_at);
    expect(shown.updated_at).toBe(shown.created_at);
    expect(editedAt(shown)).toBe(shown.created_at);
    expect(wasEdited(shown)).toBe(false);
    await waitFor(async () => {
      const stored = (await allNotes()).find((n) => n.id === shown.id);
      expect(stored?.field_updated_at?.attachments).toBe(shown.created_at);
      expect(wasEdited(stored!)).toBe(false);
      expect((await dirtyEntries()).find((e) => e.id === shown.id)?.stamp).toBe(shown.updated_at);
    });
  });

  // Whether it then *reads* "Edited" waits a minute for the note's own files
  // to land (`FILES_LAND_MS`, `lib/versions.test.ts`); the board moves at once.
  it("moves up the board for a file added afterwards", async () => {
    const result = await ready();
    let made: Note | null = null;
    await act(async () => {
      made = await result.current.createWithFiles([file("first.txt")], "zzzmade then added to");
    });
    const before = result.current.notes.find((n) => n.id === made!.id)!;
    await act(async () => {
      await result.current.attachTo(before.id, [file("second.txt")]);
    });
    const after = result.current.notes.find((n) => n.id === before.id)!;
    expect(after.attachments.map((a) => a.name)).toEqual(["first.txt", "second.txt"]);
    expect(editedAt(after) > editedAt(before)).toBe(true);
    expect(after.field_updated_at?.attachments).toBe(after.updated_at);
  });

  it("is edited by words changed seconds after it was made", async () => {
    const result = await ready();
    let made: Note | null = null;
    await act(async () => {
      made = await result.current.createWithFiles([file("only.txt")], "zzzmade then retyped");
    });
    act(() => result.current.editBody(made!.id, "Zzzmade then fixed"));
    const after = result.current.notes.find((n) => n.id === made!.id)!;
    expect(wasEdited(after)).toBe(true);
  });
});

describe("an upload that lands after the note's files changed", () => {
  const att = (id: string) => ({
    id,
    name: `${id}.jpg`,
    mime: "image/jpeg",
    size: 10,
    width: 100,
    height: 100,
    thumb: "data:image/jpeg;base64,xx",
    path: null,
    added_at: "2026-09-01T00:00:00.000Z",
  });

  it("fills in the path by id and keeps what was attached meanwhile", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("with files")!.id;
    });
    const a1 = att("a1");
    const a2 = att("a2");
    act(() => {
      result.current.update(id, { attachments: [a1] });
    });
    const snapshot = result.current.notes.find((n) => n.id === id)!;
    // The tick is uploading a1; a second file is attached while it does.
    act(() => {
      result.current.update(id, { attachments: [a1, a2] });
    });
    act(() => {
      result.current.applyUploaded([{ ...snapshot, attachments: [{ ...a1, path: "u/n/a1" }] }]);
    });
    const after = result.current.notes.find((n) => n.id === id)!;
    expect(after.attachments.map((a) => [a.id, a.path])).toEqual([
      ["a1", "u/n/a1"],
      ["a2", null],
    ]);
  });

  it("leaves a note alone whose waiting file was removed meanwhile", async () => {
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("with a file")!.id;
    });
    const a1 = att("a1");
    act(() => {
      result.current.update(id, { attachments: [a1] });
    });
    const snapshot = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.update(id, { attachments: [] });
    });
    const before = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.applyUploaded([{ ...snapshot, attachments: [{ ...a1, path: "u/n/a1" }] }]);
    });
    const after = result.current.notes.find((n) => n.id === id)!;
    expect(after.attachments).toEqual([]);
    // Nothing changed, so the note is not re-stamped either.
    expect(after.updated_at).toBe(before.updated_at);
    expect(after).toBe(before);
  });

  /** Audit BUG-4 (2026-10-10). */
  it("removes from the server a file that landed after it was taken off its note", async () => {
    removedPaths.length = 0;
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("with a file")!.id;
    });
    const a1 = att(`b4-${Math.random()}`);
    act(() => {
      result.current.update(id, { attachments: [a1] });
    });
    const snapshot = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.update(id, { attachments: [] });
    });
    act(() => {
      result.current.applyUploaded(
        [{ ...snapshot, attachments: [{ ...a1, path: "u/n/a1" }] }],
        new Map([[a1.id, "u/n/a1"]]),
      );
    });
    expect(removedPaths).toEqual([["u/n/a1"]]);
  });

  it("does not restamp a note that went into the trash while its file was on the wire", async () => {
    removedPaths.length = 0;
    const result = await ready();
    let id = "";
    act(() => {
      id = result.current.create("with a file")!.id;
    });
    const a1 = att(`b4-${Math.random()}`);
    act(() => {
      result.current.update(id, { attachments: [a1] });
    });
    const snapshot = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.update(id, { status: "trashed" });
    });
    const before = result.current.notes.find((n) => n.id === id)!;
    act(() => {
      result.current.applyUploaded(
        [{ ...snapshot, attachments: [{ ...a1, path: "u/n/a1" }] }],
        new Map([[a1.id, "u/n/a1"]]),
      );
    });
    const after = result.current.notes.find((n) => n.id === id)!;
    expect(after).toBe(before);
    expect(after.attachments[0].path).toBeNull();
    // Kept on the server: a restore sends it again to the same path.
    expect(removedPaths).toEqual([]);
  });
});

/**
 * Two tabs share one archive on disk and, until `store/tabs.ts`, nothing
 * else: a note written in one stayed stale in the other until a reload, and
 * a keystroke there put the stale body back over the fresh one. Every store
 * write is announced by id, and a tab hearing it reads the rows back.
 */
describe("another tab of the app writing to the same archive", () => {
  it.runIf(typeof BroadcastChannel === "function")(
    "shows what it wrote, and lets go of what it destroyed",
    async () => {
      const result = await ready();
      const theirs: Note = {
        id: "from-the-other-tab",
        raw_content: "written over there",
        body: "written over there",
        source: "web",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T00:00:00.000Z",
        note_type: null,
        board_id: null,
        status: "trashed",
        priority: 0,
        reminder_at: null,
        done: null,
        merged_from: null,
        keep_id: null,
        attachments: [],
      };
      // The page's own channel never hears itself; the other tab has its own.
      const other = new BroadcastChannel(TAB_CHANNEL);
      try {
        await putNote(theirs);
        other.postMessage({ ids: [theirs.id] });
        await waitFor(() =>
          expect(result.current.notes.find((n) => n.id === theirs.id)?.body).toBe(
            "written over there",
          ),
        );

        await deleteNotes([theirs.id]);
        other.postMessage({ ids: [theirs.id] });
        await waitFor(() =>
          expect(result.current.notes.some((n) => n.id === theirs.id)).toBe(false),
        );
      } finally {
        other.close();
      }
    },
  );
});

/**
 * Local writes are stamped from the server's clock once it is known (audit
 * 2026-10-10, DATA-6). The trash sweep measures a note's month against the
 * server's clock, so a note trashed on a device whose own clock ran more than
 * thirty days slow was "older" than a month the moment it was trashed, and the
 * next open destroyed it. Stamped from the server's reading, the month starts
 * when it should.
 */
describe("a local write is stamped from the server's clock when it is known", () => {
  const DAY = 86_400_000;
  afterEach(() => forgetServerClock());

  it("trashes a note at the server's time, not a slow device's", async () => {
    const result = await ready();
    forgetServerClock();
    const serverSays = Date.now() + 40 * DAY;
    noteServerDate(new Date(serverSays).toUTCString());

    let id = "";
    act(() => {
      id = result.current.create("Written on a slow clock")!.id;
    });
    act(() => {
      result.current.setStatus(id, "trashed");
    });
    const trashed = result.current.notes.find((note) => note.id === id)!;
    expect(Date.parse(trashed.created_at)).toBeGreaterThan(serverSays - 5_000);
    expect(Date.parse(trashed.updated_at)).toBeGreaterThan(serverSays - 5_000);
  });

  it("falls back to the device's clock before any server has answered", async () => {
    const result = await ready();
    forgetServerClock();
    const before = Date.now();
    let id = "";
    act(() => {
      id = result.current.create("Written before any answer")!.id;
    });
    const made = result.current.notes.find((note) => note.id === id)!;
    expect(Date.parse(made.updated_at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(made.updated_at)).toBeLessThan(before + DAY);
  });
});
