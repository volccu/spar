import { onWrittenElsewhere } from "./tabs";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, Note } from "../types";
import { buildMerge } from "../lib/merge";
import { capitalizeCapture } from "../lib/capitalize";
import { numberAttachments } from "../lib/attachRefs";
import { expiredInTrash } from "../lib/trash";
import { askToKeep } from "../lib/keepStorage";
import { clearUnsaved, readUnsaved, stashUnsaved, withUnsaved } from "./unsavedStash";

/**
 * How long the trash sweep waits for the server to say what time it is.
 *
 * Long enough for the first sync tick of an ordinary open, short enough that
 * nothing is holding anything up if the answer never comes — the sweep is the
 * lowest-priority thing on the tick and its own docblock explains why not
 * running is a safe outcome.
 */
const SWEEP_CLOCK_WAIT_MS = 20_000;

/**
 * How long a failed local write waits before it is tried again on its own,
 * growing with each failure in a row and then holding at the last. A
 * threshold, not motion — the same kind of number as the sweep's wait above.
 */
const RETRY_WAITS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * How long the open note's typing may pause before its words are written to
 * the device (`persistSoon`). Short enough that a pause to think is a save;
 * well inside the sync loop's own wait, so the outbox always has the words
 * before the upload looks for them.
 */
const BODY_WRITE_MS = 250;
import {
  CONFLICT_FIELDS,
  deletionMarker,
  fieldClocks,
  isDeletionMarker,
  mergeNoteFields,
  remoteIsNewer,
} from "../lib/versions";
import { pruneCache, removeRemote, removeRemotePaths, retryOrphans } from "./attachments";
import { shellReady } from "./supabase";
import { getBackend } from "./backend";
import { serverClock, stampNow } from "./serverClock";
import {
  allNotes,
  deleteFiles,
  deleteNotes,
  getNotes,
  isSeeded,
  markSeeded,
  pruneTombstones,
  putFiles,
  putNotes,
} from "./db";

/** The attach path's own chunk (`lib/describeFile.ts`), fetched on the first attach. */
const describeAll = async (files: File[]) => (await import("../lib/describeFile")).describeAll(files);

/**
 * Every mutation updates React state first and persists afterwards (SPEC §2.6):
 * the card must exist on screen before IndexedDB has heard about it.
 */


// Stamped from the server's clock once known (`stampNow`, audit DATA-6), so
// the trash sweep, which reads that clock, counts a month from the right zero.
function nextIso(previous?: string): string {
  const now = stampNow();
  const prior = previous ? Date.parse(previous) : NaN;
  return new Date(Math.max(now, Number.isFinite(prior) ? prior + 1 : now)).toISOString();
}

/** The order the archive is held in: newest capture first. */
function newestFirst(a: Note, b: Note): number {
  return (b.created_at ?? "").localeCompare(a.created_at ?? "");
}

/** The same list sync merges on — kept in one place so it cannot drift. */
const EDITABLE_FIELDS = new Set<string>(CONFLICT_FIELDS);

/**
 * Every local write goes through here, so this is where a note gets its
 * clocks — and where a note that never had any gets them for the first time.
 *
 * The clocks start from `fieldClocks(note)`, not from whatever the row
 * happened to hold. For a note the importer made — nearly the whole archive —
 * that is nothing at all, and starting from nothing meant the first write
 * stamped a clock for the one field it touched and no other. `editedAt` then
 * found no `body` clock, fell back to the row's `updated_at`, and that had
 * just moved: pressing the priority flag on a note from July made it read
 * "edited just now" and jump to the top of the board. Inventing the full set
 * from the *pre-write* `updated_at` first — the same invention `fieldClocks`
 * makes for sync — turns the old edit time into a real `body` clock that
 * survives the write and travels with the note, so filing is not editing for
 * an imported note either (2026-09-04 audit, F1).
 */
function localPatch(note: Note, patch: Partial<Note>): Note {
  const safe = { ...patch } as Partial<Note>;
  delete safe.raw_content;
  delete safe.id;
  delete safe.created_at;
  const stamp = nextIso(note.updated_at);
  const clocks = fieldClocks(note);
  for (const key of Object.keys(safe)) {
    if (EDITABLE_FIELDS.has(key)) clocks[key] = stamp;
  }
  return {
    ...note,
    ...safe,
    updated_at: stamp,
    field_updated_at: clocks,
  } as Note;
}

/**
 * What a capture may be saved *as*, chosen in the bar before Save is pressed:
 * a priority, a to-do, a board. Every one is optional and every one is set on
 * the note in the same write that makes it — the note lands in the right
 * place at once, rather than being created unfiled and then moved a tick
 * later by a second write with a second clock.
 */
export type CaptureFields = Partial<Pick<Note, "priority" | "note_type" | "board_id" | "reminder_at" | "reminder_repeat">>;

function newNote(text: string, source = "web", fields: CaptureFields = {}): Note {
  const ts = new Date(stampNow()).toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    raw_content: text,
    body: text,
    source,
    created_at: ts,
    updated_at: ts,
    note_type: null,
    board_id: null,
    status: "active",
    priority: 0,
    reminder_at: null,
    reminder_repeat: null,
    done: null,
    merged_from: null,
    keep_id: null,
    attachments: [],
    ...fields,
  };
  // A field chosen at capture is stamped at the note's own instant — the same
  // clock the words carry, not a bump past it. It was decided at the moment
  // the note was written, and the clock says exactly that.
  const clocks: Record<string, string> = { body: ts };
  for (const key of Object.keys(fields)) {
    if (EDITABLE_FIELDS.has(key)) clocks[key] = ts;
  }
  note.field_updated_at = clocks;
  return note;
}

async function seedIfEmpty(): Promise<void> {
  // Outside development there is nothing to seed with, and the "has it been
  // seeded" read was still a full IndexedDB round trip standing between
  // opening the database and reading the archive — on the one path that
  // gates the first card. Production skips the question.
  if (!import.meta.env.DEV) return;
  if (await isSeeded()) return;
  // Personal seed data is for local development/tests only. Keeping this
  // branch development-only prevents it from entering a production bundle.
  //
  // web/src/seed/notes.json (the real archive) is gitignored — personal
  // data never enters git — so a fresh checkout, CI included, doesn't have
  // it and this glob resolves to nothing. fixture.json is the one file in
  // that ignored directory that *is* tracked: synthetic, non-personal, and
  // what stands in so "seeds on first run" still has something to seed
  // with. Real data wins whenever `npm run seed` has produced it locally —
  // picked by filename rather than by glob key order, which isn't
  // guaranteed to put notes.json ahead of fixture.json.
  const seedFiles = import.meta.env.DEV
    ? import.meta.glob<{ default: Note[] }>("../seed/*.json")
    : {};
  const entries = Object.entries(seedFiles);
  const real = entries.find(([path]) => path.endsWith("/notes.json"));
  const fixture = entries.find(([path]) => path.endsWith("/fixture.json"));
  const load = (real ?? fixture)?.[1];
  if (load) {
    const seed = (await load()).default;
    await putNotes(seed);
  }
  await markSeeded();
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  /** The archive itself could not be read — not a failed write. */
  const [loadFailed, setLoadFailed] = useState(false);
  // The sync client is held back until the archive is on screen — see
  // `shellReady` in store/supabase.ts. An effect, so it runs after the commit
  // that drew the grid (or the message that it could not be read).
  useEffect(() => {
    if (!loading) shellReady();
  }, [loading]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const notesRef = useRef<Note[]>([]);
  // The ref first, so the next mutator builds on this array even before React
  // has rendered it, then the screen (`commit` in `useCanvases` is the same pair).
  const commit = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotes(next);
  }, []);
  const failedWrites = useRef(new Map<string, Note>());
  // Bumped by local edits only — never by notes arriving from the server, or
  // syncing would trigger itself in a loop.
  const [localVersion, setLocalVersion] = useState(0);
  const bump = useCallback(() => setLocalVersion((v) => v + 1), []);
  /**
   * A failed write is no longer left for the Retry button alone. It is copied
   * into `localStorage` at once (`unsavedStash.ts`), so a reload or a killed
   * tab cannot lose it, and retried on its own after a growing wait — a full
   * disk or a busy second tab is usually a moment, not a verdict. Pressing
   * Retry still retries at once.
   */
  const retryTimer = useRef<number | null>(null);
  const retryAttempt = useRef(0);
  const retryRef = useRef<() => void>(() => {});
  /**
   * Whether the store is still mounted. A write answers whenever the disk
   * does, which can be after the store has gone — the app closing, or a test
   * torn down — and setting state then is setting it on nothing (under the
   * server's test load it threw "window is not defined" and failed a deploy).
   */
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** The notes this tab put in the shared stash, the only ones it may take out. */
  const stashed = useRef(new Set<string>());
  const stashMine = useCallback((notes: Note[]) => {
    for (const note of notes) stashed.current.add(note.id);
    stashUnsaved(notes);
  }, []);
  const settled = useCallback(() => {
    if (!alive.current) return;
    if (failedWrites.current.size > 0) return;
    setStorageError(null);
    clearUnsaved(stashed.current);
    stashed.current.clear();
    retryAttempt.current = 0;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
  }, []);
  const failed = useCallback(() => {
    if (typeof window === "undefined") return;
    // Stashed even after the store has gone: the words are what matter.
    stashMine([...failedWrites.current.values()]);
    if (!alive.current) return;
    setStorageError("This change is visible, but it is not saved on this device yet.");
    if (retryTimer.current !== null) return;
    const wait = RETRY_WAITS_MS[Math.min(retryAttempt.current, RETRY_WAITS_MS.length - 1)];
    retryAttempt.current += 1;
    retryTimer.current = window.setTimeout(() => {
      retryTimer.current = null;
      retryRef.current();
    }, wait);
  }, [stashMine]);
  useEffect(
    () => () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    },
    [],
  );
  /**
   * Body edits waiting to be written — the open note's keystrokes.
   *
   * Every character used to be its own IndexedDB transaction: the whole note,
   * thumbnails and all, cloned and written, an outbox entry stamped, and every
   * other open tab told to re-read the store and re-sort its archive. The
   * screen still changes at once — React state is the first thing written, the
   * rule the store has always kept — but the durable write now waits
   * `BODY_WRITE_MS` for the typing to pause and goes as one batch. Anything
   * written *immediately* for the same note (a priority, an archive) takes the
   * pending entry with it, because it is built from the same newer state; so
   * an older body can never land on top of a newer write.
   *
   * The wait is never allowed to cost the words: the app being hidden or the
   * page going away copies what is waiting into the reload-safe stash
   * (`unsavedStash.ts`) and writes it at once, and so does the store unmounting.
   */
  const pendingWrites = useRef(new Map<string, Note>());
  /**
   * What is waiting, as each note stands *now*. A pull landing inside the
   * pause merges into `notesRef` and not into the copy queued at the first
   * keystroke, so writing that copy put the other device's change back out of
   * IndexedDB after the cursor had passed it (bughunt 2026-10-15). A note gone
   * from the store since (destroyed) is not written back.
   */
  const waiting = useCallback((): Note[] => {
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    const out: Note[] = [];
    for (const id of [...pendingWrites.current.keys()]) {
      const now = byId.get(id);
      if (now) out.push(now);
      else pendingWrites.current.delete(id);
    }
    return out;
  }, []);
  const writeTimer = useRef<number | null>(null);
  const flushRef = useRef<() => void>(() => {});
  const persistSoon = useCallback((note: Note) => {
    pendingWrites.current.set(note.id, note);
    if (writeTimer.current === null) {
      writeTimer.current = window.setTimeout(() => flushRef.current(), BODY_WRITE_MS);
    }
  }, []);
  /**
   * Writes notes to the device in one IndexedDB transaction, and keeps the
   * books on each: a note is held in `failedWrites` until its own write lands,
   * so a batch that fails is retried note by note. Archiving a hundred selected
   * notes used to open a hundred transactions, one per note.
   */
  const persistMany = useCallback(async (batch: Note[]) => {
    if (batch.length === 0) return;
    for (const note of batch) {
      pendingWrites.current.delete(note.id);
      failedWrites.current.set(note.id, note);
    }
    try {
      await putNotes(batch);
      void askToKeep();
      for (const note of batch) {
        if (failedWrites.current.get(note.id)?.updated_at === note.updated_at) {
          failedWrites.current.delete(note.id);
        }
      }
      settled();
    } catch {
      for (const note of batch) failedWrites.current.set(note.id, note);
      failed();
    }
  }, [failed, settled]);
  /** One note written at once — a batch of one, with the same books. */
  const persist = useCallback((note: Note) => persistMany([note]), [persistMany]);
  const flushWrites = useCallback(() => {
    if (writeTimer.current !== null) {
      window.clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    const batch = waiting();
    if (batch.length > 0) void persistMany(batch);
  }, [persistMany, waiting]);
  flushRef.current = flushWrites;
  useEffect(() => {
    const leaving = () => {
      if (pendingWrites.current.size === 0) return;
      // Synchronous, so it lands even if the page is gone before the
      // IndexedDB transaction below completes; cleared once it has.
      stashMine([...failedWrites.current.values(), ...waiting()]);
      flushRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") leaving();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leaving);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leaving);
      flushRef.current();
    };
  }, [stashMine, waiting]);
  const retryStorage = useCallback(async () => {
    // A failed *file* write leaves nothing on this queue — the bytes are gone
    // and the File object with them, so there is nothing to send again. The
    // button would then have sat there doing nothing at all, which is the
    // "error with no way out" shape. With nothing to retry it dismisses.
    if (failedWrites.current.size === 0) {
      setStorageError(null);
      return;
    }
    // Each note as it stands now, never the copy that failed: the user may
    // have typed on since, and writing the old copy would also take the
    // waiting newer words off the queue unwritten.
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    const now: Note[] = [];
    for (const [id, note] of failedWrites.current) {
      const current = byId.get(id);
      if (current) now.push(current);
      else if (notesRef.current.length > 0) failedWrites.current.delete(id);
      else now.push(note);
    }
    if (failedWrites.current.size === 0) settled();
    await Promise.all(now.map((note) => persist(note)));
  }, [persist, settled]);
  retryRef.current = () => void retryStorage();
  // The load effect writes back a stashed failure through this, for the same
  // reason it reaches the sweep through a ref: listing it would re-run the load.
  const persistRef = useRef(persistMany);
  persistRef.current = persistMany;
  // Held in a ref so the load effect can sweep the trash without listing the
  // sweep among its dependencies and re-running the whole load.
  const sweepRef = useRef<(all: Note[]) => void>(() => {});
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // The read path had no catch at all, while `persist` right above it has
      // one and surfaces a real message. Any rejection here — a full quota,
      // private browsing, a second tab holding the previous schema version —
      // became an unhandled rejection with `loading` still true, and the app
      // sat on its loading state forever with nothing to click and nothing to
      // read. The database promise caches its rejection too, so every later
      // call failed the same way. Failing visibly is the whole fix.
      try {
        await seedIfEmpty();
        const read = await allNotes();
        if (cancelled) return;
        // A write that failed last session, kept in `localStorage` so the
        // reload could not lose it, is laid back over the store and written
        // properly now (`unsavedStash.ts`).
        const stash = readUnsaved();
        // Laid over this tab's notes, so this tab now answers for them.
        for (const note of stash) stashed.current.add(note.id);
        const { notes: loaded, pending } = withUnsaved(read, stash);
        loaded.sort(newestFirst);
        commit(loaded);
        setLoading(false);
        if (pending.length > 0) void persistRef.current(pending);
        else clearUnsaved();
        sweepRef.current(loaded);
      } catch (error) {
        if (cancelled) return;
        console.error("could not read the local archive", error);
        setStorageError(
          "This device's notes could not be opened. Close any other tabs with spår open, then reload.",
        );
        // Said separately from the message, because two things follow from it
        // that a failed *write* must not do: the banner's button reloads rather
        // than retrying a queue that is empty, and the board draws nothing
        // rather than "Nothing here yet" over notes that were never read.
        setLoadFailed(true);
        setLoading(false);
      }
    };
    // The archive is local, so the read starts now. It used to wait behind
    // `getSession()` — a call that can cost a network round-trip — and then
    // ran a second time when INITIAL_SESSION echoed back through the
    // subscription below: every signed-in cold open read all of IndexedDB
    // twice, behind a wait it never needed. Auth has nothing to add to a
    // local read; the ownership claim that *does* matter gates sync, not
    // this hydration (see useAccount).
    void load();
    let unsubscribe: (() => void) | null = null;
    /**
     * Whose session the store was last told about: `undefined` until the first
     * event says, then a user id, or null for nobody.
     *
     * **An auth event is not an account change, and only a changed id is.**
     * This used to read every `SIGNED_IN` as a transition — but supabase-js
     * sends `SIGNED_IN` for the same person every time the tab comes back into
     * view (`_recoverAndRefresh`), and again whenever another tab of the app
     * says anything over its BroadcastChannel. Each one emptied the board,
     * flashed Loading, lost the scroll, dropped the open note (App finds it in
     * `notes`) and toggled sync off and on, for somebody who had only switched
     * apps and back. The first event only seeds the id, whatever it is called:
     * the load above is already reading the store, and on a cold open the
     * refresh's `SIGNED_IN` can arrive before `INITIAL_SESSION` does.
     */
    let seenUser: string | null | undefined;
    void getBackend().then((backend) => {
      if (!backend || cancelled) return;
      unsubscribe = backend.onSessionChange((session) => {
        const user = session?.user.id ?? null;
        const first = seenUser === undefined;
        const same = user === seenUser;
        seenUser = user;
        if (first || same) return;
        // A real change. React state is cleared before the ownership check
        // (useAccount) can purge IndexedDB, and the store is read again — on
        // a sign-out too, which used to clear and set `loading` and never
        // load anything again, so the app sat on Loading for good once the
        // handoff screen let it through. The store is still whole after a
        // sign-out; the handoff screen is what gates showing it. Words still
        // waiting for the typing pause are written first, while the notes
        // they belong to are still in hand.
        flushRef.current();
        commit([]);
        setLoading(true);
        void load();
      });
      if (cancelled) unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [commit]);

  // `source` marks what kind of capture this was — "web" for anything typed,
  // "draw" for a sketch born from the + panel. It is identity, not content,
  // so it is set here at creation and never patched afterwards.
  //
  // `fields` is what the bar's own marks chose — a priority, a to-do, a board
  // — and it goes into the same write. One write, one card landing where it
  // belongs, no second write catching up with the first.
  const create = useCallback((text: string, source = "web", fields: CaptureFields = {}): Note | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const note = newNote(capitalizeCapture(trimmed), source, fields);
    commit([note, ...notesRef.current]);
    void persist(note);
    bump();
    return note;
  }, [bump, commit, persist]);

  /**
   * A dropped file becomes a note holding it — which is the whole answer to
   * "where did I just put that". It is the newest card, on the board, with its
   * own face, found the same way everything else in the app is found.
   *
   * The bytes are written to this device first and the note appears at once;
   * the upload happens later on the sync tick. Reading the picture out of the
   * file is the one slow part, so `text` and the note itself do not wait on the
   * network for anything.
   *
   * The note's text is whatever the user actually typed, which is usually
   * nothing. The filename is *not* written in as a stand-in: it is already
   * under the picture, and a second copy in the body reads as a sentence the
   * user wrote and now has to delete.
   */
  const createWithFiles = useCallback(
    async (files: File[], text = "", fields: CaptureFields = {}, refs: readonly (number | undefined)[] = []): Promise<Note | null> => {
      if (files.length === 0) return null;
      const note = newNote(capitalizeCapture(text.trim()), "web", fields);
      const atts: Attachment[] = [];

      // Writing the bytes is the one step in a capture that can genuinely fail
      // on a device with no room left, and it used to fail in total silence:
      // `persist` has a catch and this loop did not, so a full quota threw
      // before the note was ever created. No card, no message, and a capture bar
      // that had already cleared itself — the file simply ceased to exist, which
      // is the exact failure that sends people back to Drive. Bytes from earlier
      // files in the batch are left to the cache sweep, which collects anything
      // no note points at.
      try {
        // Read a few at a time and written in one transaction: eight shared
        // photographs used to be eight decodes and eight writes in a row
        // before the card could be drawn.
        atts.push(...(await describeAll(files)));
        await putFiles(atts.map((att, i) => [att.id, files[i]]));
      } catch (error) {
        console.error("could not write an attachment to this device", error);
        setStorageError("There was no room on this device for that file, so nothing was added. Free some space, then add it again.");
        return null;
      }

      // The files are part of the note's making, not an edit after it: their
      // clock is the note's own instant, as the words' and the bar's marks'
      // are (`newNote`). Through `localPatch` it was the moment the bytes had
      // been written — seconds after `created_at` — and the open note read
      // "Edited" on a note nobody had touched. A file added later still goes
      // through `localPatch` (`attachTo`), and that is an edit.
      const withFiles: Note = {
        ...note,
        // Numbered as the capture bar's `[image 1]` markers were written:
        // the numbers handed in, else 1… per kind (`lib/attachRefs.ts`).
        attachments: numberAttachments([], atts, refs),
        field_updated_at: { ...note.field_updated_at, attachments: note.created_at },
      };
      commit([withFiles, ...notesRef.current]);
       void persist(withFiles);
      bump();
      return withFiles;
    },
    [bump, commit, persist],
  );

  /**
   * A chunk of notes made somewhere else — the Keep import (`runImport` in
   * `lib/keepImport.ts`) or a spår download (`runSparImport` in
   * `lib/sparImport.ts`) — each with the files it carries.
   *
   * The files go through exactly what a drop's go through: `describeAll` for
   * the thumbnail and the shape, `putFiles` for the bytes, one transaction for
   * the chunk. The notes are attached to *as they are*, not through
   * `localPatch`, because they arrive with Keep's own clocks and a stamp of
   * now on `attachments` would read as an edit today and lift every
   * photograph in a ten-year archive to the top of its board.
   *
   * **The disk comes first here, and only here.** Every other mutator puts the
   * note on screen and then writes it, because a capture is one note and the
   * card must not wait. An import is thousands, on no hot path, and the one
   * failure that matters — a device out of room halfway through — must stop it
   * with the notes that did land shown and the ones that did not *not* shown:
   * a failed write here throws to the import rather than joining the
   * `failedWrites` retry, which would copy a few thousand notes and their
   * thumbnails into `localStorage`. Running the import again skips what landed.
   */
  const importNotes = useCallback(
    async (chunk: { note: Note; files: File[]; refs?: (number | undefined)[] }[]): Promise<Note[]> => {
      if (chunk.length === 0) return [];
      const files = chunk.flatMap((entry) => entry.files);
      const atts = files.length > 0 ? await describeAll(files) : [];
      if (atts.length > 0) await putFiles(atts.map((att, i) => [att.id, files[i]]));
      let at = 0;
      const made = chunk.map(({ note, files: own, refs }) => {
        // A restored file keeps the number its `[image 2]` markers point at.
        const mine = atts.slice(at, (at += own.length)).map((a, i) => (refs?.[i] !== undefined ? { ...a, ref: refs[i] } : a));
        // Ahead of any the note already carries — a restored download keeps
        // the record of a file it could not bring back (`lib/sparImport.ts`);
        // a Keep note carries none.
        return mine.length > 0 ? { ...note, attachments: [...mine, ...note.attachments] } : note;
      });
      await putNotes(made);
      void askToKeep();
      const held = new Set(notesRef.current.map((n) => n.id));
      commit([...made.filter((n) => !held.has(n.id)), ...notesRef.current]);
      bump();
      return made;
    },
    [bump, commit],
  );

  // One note through `localPatch`, committed, and handed back as it now is
  // for the caller to write — at once (`persist`) or at the pause
  // (`persistSoon`). Undefined when the note is not here.
  const patchOne = useCallback((id: string, patch: (n: Note) => Partial<Note>) => {
    const next = notesRef.current.map((n) => (n.id === id ? localPatch(n, patch(n)) : n));
    commit(next);
    return next.find((n) => n.id === id);
  }, [commit]);

  /**
   * Every mutator below computes its next array from `notesRef.current` and
   * calls `setNotes` with the finished value, rather than reading `prev`
   * inside a `setNotes` updater function. React is allowed to call an updater
   * more than once for the same update — StrictMode does it on purpose, in
   * development, to catch exactly this — and a write to disk or to Supabase
   * Storage sitting inside one is not safe to run twice. Computing outside and
   * setting the value keeps the side effects to one call, always.
   */
  const update = useCallback((id: string, patch: Partial<Note>) => {
    bump();
    const changed = patchOne(id, () => patch);
    if (changed) void persist(changed);
  }, [bump, patchOne, persist]);

  /**
   * `update`, for the open note's text: the screen at once, the disk at the
   * pause (`persistSoon`).
   */
  const updateBody = useCallback((id: string, body: string) => {
    bump();
    const changed = patchOne(id, () => ({ body }));
    if (changed) persistSoon(changed);
  }, [bump, patchOne, persistSoon]);

  /**
   * Compare-and-swap for an editor holding an older snapshot: write the body
   * only if the note still holds the body this editor's draft grew out of.
   *
   * **The comparison is the body, and it used to be `updated_at`.** Two things
   * were wrong with the stamp, in opposite directions. It was too *weak*,
   * because the editor read it from its own props: once a remote row had
   * landed, the next render handed the editor the remote's stamp, so the very
   * next keystroke compared equal, wrote the local draft straight over the
   * other device's words, and cleared the banner that had just said they were
   * not saved. And it was too *strong*, because `updated_at` moves for reasons
   * that have nothing to do with the text — a priority toggled on the card, a
   * link preview arriving from the unfurl, any field at all — each of which
   * would have refused an honest keystroke and accused the other device of an
   * edit it never made.
   *
   * The body answers the question actually being asked. `NoteView` passes the
   * body it last agreed with (`lastSavedBody`), which is exactly the version
   * its draft descends from: its own last successful write, or a remote change
   * it adopted because there was nothing unsaved to lose. A refusal then
   * stands until the editor and the note agree again, which is what the
   * conflict banner claims and what closing the sheet acts on.
   */
  const editBodyIfBase = useCallback(
    (id: string, body: string, expectedBody: string): boolean => {
      const current = notesRef.current.find((note) => note.id === id);
      if (!current || current.body !== expectedBody) return false;
      updateBody(id, body);
      return true;
    },
    [updateBody],
  );

  /**
   * Adds files to a note that already exists. Same order: bytes, then note.
   * `refs` are the numbers the open note wrote their markers with
   * (`useAttachMarkers`); a file without one is numbered after the note's own.
   */
  const attachTo = useCallback(
    async (id: string, files: File[], refs: readonly (number | undefined)[] = []): Promise<Attachment[]> => {
      if (files.length === 0) return [];
      const added: Attachment[] = [];
      // The same unguarded write as `createWithFiles`, reached from the open
      // note instead of the bar, and it failed the same silent way.
      try {
        added.push(...(await describeAll(files)));
        await putFiles(added.map((att, i) => [att.id, files[i]]));
      } catch (error) {
        console.error("could not write an attachment to this device", error);
        setStorageError("There was no room on this device for that file, so nothing was added. Free some space, then add it again.");
        return [];
      }
      bump();
      let numbered: Attachment[] = [];
      const changed = patchOne(id, (n) => {
        numbered = numberAttachments(n.attachments ?? [], added, refs);
        return { attachments: [...(n.attachments ?? []), ...numbered] };
      });
      if (changed) void persist(changed);
      return changed ? numbered : [];
    },
    [bump, patchOne, persist],
  );

  /**
   * Removes one file from a note. This *does* destroy bytes — an attachment has
   * no trash of its own, because the note it hangs on is the thing the trash
   * protects, and a file removed from a note by hand is as deliberate an act as
   * emptying the trash is.
   */
  const detach = useCallback(
    (id: string, attachmentId: string) => {
      bump();
      const before = notesRef.current.find((n) => n.id === id);
      const gone = (before?.attachments ?? []).filter((a) => a.id === attachmentId);
      const changed = patchOne(id, (n) => ({
        attachments: (n.attachments ?? []).filter((a) => a.id !== attachmentId),
      }));
      if (changed) void persist(changed);
      // Bytes left behind by a failed local delete are orphans, and
      // `pruneCache` collects orphans first. A failed server removal is written
      // down by `removeRemote` and asked again on the next open.
      void deleteFiles([attachmentId]).catch((error: unknown) =>
        console.error("could not remove a file from this device", error),
      );
      void removeRemote(gone).catch((error: unknown) =>
        console.error("could not remove a file from the server; will try again", error),
      );
    },
    [bump, patchOne, persist],
  );

  /**
   * Records where uploaded files landed. Marks the notes dirty on purpose —
   * the path is the only way the other device can ever reach the bytes, so it
   * has to make the trip back up.
   *
   * Through `localPatch`, like every other mutator here. It used to write the
   * attachments straight onto the note, which left `updated_at` and the
   * `attachments` clock untouched, and that had two consequences that only
   * showed up together. The server's merge trigger compares clocks per field,
   * so an unchanged clock reads as "nothing new here" and the path was reverted
   * to the pre-upload value — the other device could then never reach the
   * bytes. And the server stamped the row with its own `now()` while this
   * device's copy stayed behind, permanently, because the pull that would
   * correct it finds no newer clock and drops the row while the cursor moves
   * on. A note in that state can never be permanently deleted either:
   * `permanently_delete_note` only accepts a delete when `updated_at` still
   * matches what the client expects, and it never will again.
   *
   * The cost is that recording an upload now counts as touching the note's
   * content, so a *retried* upload can lift the note on a board ordered by last
   * edit. That is the honest trade: the clock is what makes the path survive,
   * and a note whose file finally arrived has genuinely changed.
   */
  const applyUploaded = useCallback((uploaded: Note[], fresh?: Map<string, string>) => {
    if (uploaded.length === 0) return;
    // Two kinds of path that landed this tick are not recorded (audit BUG-4,
    // 2026-10-10). A file nothing holds any more — removed from its note, or
    // its note destroyed, while it was on the wire — is removed from the
    // server: nobody will ever name that path again, and it used to stay there
    // for good. And a file whose note went into the trash meanwhile is left
    // unrecorded, because recording it restamps the note and restarts its
    // thirty days; its bytes stay on this device and on the server, a restore
    // sends it again (the same path, an upsert), and destroying the note
    // removes its whole folder (`removeNoteFolders`).
    if (fresh && fresh.size > 0) {
      const holder = new Map<string, Note>();
      for (const n of notesRef.current) for (const a of n.attachments ?? []) holder.set(a.id, n);
      const stray: string[] = [];
      const binned = new Set<string>();
      for (const [id, path] of fresh) {
        const owner = holder.get(id);
        if (!owner) stray.push(path);
        if (!owner || owner.status === "trashed") binned.add(id);
      }
      if (stray.length > 0) {
        void removeRemotePaths(stray).catch((error: unknown) =>
          console.error("could not remove a file that landed after it was removed; will try again", error),
        );
      }
      if (binned.size > 0) {
        uploaded = uploaded.map((n) => ({
          ...n,
          attachments: (n.attachments ?? []).map((a) => (binned.has(a.id) ? { ...a, path: null } : a)),
        }));
      }
    }
    // Only the paths are taken from what came back — by attachment id, into
    // the note's list as it is *now*. `uploaded` is the tick's opening
    // snapshot with paths filled in, and an upload is the slowest thing a
    // tick does: a file attached or removed while it ran is in neither list
    // the snapshot holds, and swapping the whole list in dropped the one and
    // resurrected the other. A note none of whose files were still waiting
    // is left alone, clock and all.
    const landed = new Map<string, string>();
    for (const n of uploaded) {
      for (const a of n.attachments ?? []) if (a.path !== null) landed.set(a.id, a.path);
    }
    const touched = new Set<string>();
    const next = notesRef.current.map((n) => {
      const atts = n.attachments ?? [];
      if (!atts.some((a) => a.path === null && landed.has(a.id))) return n;
      touched.add(n.id);
      return localPatch(n, {
        attachments: atts.map((a) =>
          a.path === null && landed.has(a.id) ? { ...a, path: landed.get(a.id)! } : a,
        ),
      });
    });
    if (touched.size === 0) return;
    commit(next);
    void persistMany(next.filter((n) => touched.has(n.id)));
  }, [commit, persistMany]);

  /** raw_content is immutable (SPEC §2.3) — editing only ever writes `body`. */
  const editBody = useCallback(
    (id: string, body: string) => updateBody(id, body),
    [updateBody],
  );

  const setStatus = useCallback(
    (id: string, status: Note["status"]) => update(id, { status }),
    [update],
  );

  const togglePriority = useCallback(
    (note: Note) => update(note.id, { priority: note.priority > 0 ? 0 : 1 }),
    [update],
  );

  const bulkUpdate = useCallback((ids: string[], patch: Partial<Note>) => {
    bump();
    const idSet = new Set(ids);
    const next = notesRef.current.map((n) => (idSet.has(n.id) ? localPatch(n, patch) : n));
    commit(next);
    void persistMany(next.filter((n) => idSet.has(n.id)));
  }, [bump, commit, persistMany]);

  /**
   * Composes a new note from the sources and archives them (SPEC §7). Returns
   * an undo that restores the sources and archives the merged note — undo
   * never destroys anything, in keeping with the no-delete invariant.
   */
  const merge = useCallback((sources: Note[]): { merged: Note; undo: () => Set<string> } => {
    const { merged, archivedSourceIds } = buildMerge(sources);
    bump();
    const idSet = new Set(archivedSourceIds);
    /**
     * What each source was before the merge, so undo can put it back.
     *
     * Undo used to write `status: "active"` over all of them, which is right
     * for the ordinary case and wrong for every other one: merging two notes
     * while standing on the **Archive** and then pressing Undo inside the
     * eight seconds put two long-archived notes back on the board as though
     * they had just been captured. Every other reversal in the app already
     * captures per-note state this way — `absorbIntoIdea`, `dissolveIdea`,
     * archive, todo, priority and move all keep a `before` array — and this
     * was the one that guessed.
     */
    const before = new Map(
      notesRef.current
        .filter((n) => idSet.has(n.id))
        .map((n) => [n.id, { status: n.status, merged_into: n.merged_into ?? null }] as const),
    );

    // Each source gets its own stamp, guaranteed to be later than its own
    // previous one (nextIso, the same rule localPatch runs on every other
    // write) — not one timestamp shared across all of them. A shared "now"
    // can sit *behind* a source whose clock had already been pushed forward
    // by an earlier write, which would silently reverse that note's own
    // history and make this edit invisible to a sync that only looks forward.
    const next = notesRef.current.map((n) => {
      if (!idSet.has(n.id)) return n;
      const ts = nextIso(n.updated_at);
      return {
        ...n,
        status: "archived" as const,
        merged_into: merged.id,
        updated_at: ts,
        // Same seeding rule as `localPatch`: a source with no clocks keeps
        // its old edit time as a real clock rather than losing it here.
        field_updated_at: {
          ...fieldClocks(n),
          status: ts,
          merged_into: ts,
        },
      };
    });
    commit([merged, ...next]);
    void persistMany([merged, ...next.filter((n) => idSet.has(n.id))]);

    // Undo is a guarded reversal, like every `UndoStep`: a source is handed
    // back only while it is still as the merge left it, and the idea is
    // archived only while it is still active. The undo stays on the stack, so
    // a source taken out of the idea and deleted since came back to life on a
    // later Ctrl+Z (bughunt 2026-10-15).
    const undo = () => {
      const touched = new Set<string>();
      const reverted = notesRef.current.map((n) => {
        if (idSet.has(n.id)) {
          if (n.status !== "archived" || n.merged_into !== merged.id) return n;
          touched.add(n.id);
          return localPatch(n, {
            status: before.get(n.id)?.status ?? "active",
            // A source that lived in another idea goes back into it.
            merged_into: before.get(n.id)?.merged_into ?? null,
          });
        }
        if (n.id === merged.id && n.status === "active") {
          touched.add(n.id);
          return localPatch(n, { status: "archived" });
        }
        return n;
      });
      if (touched.size === 0) return touched;
      commit(reverted);
      void persistMany(reverted.filter((n) => touched.has(n.id)));
      // Which notes it reverted, so a caller undoing more around it touches
      // only those.
      return touched;
    };

    return { merged, undo };
  }, [bump, commit, persistMany]);

  /**
   * Destroys notes for good, locally and on the server. Only two things call
   * this: the month-old sweep, and the user emptying the trash by hand.
   *
   * Answers with **how many it actually destroyed**, which is not the length of
   * what it was handed: the list is re-checked against the store as it is at
   * the moment this runs, so a note restored between the read and the write is
   * left alone and is not counted. The sweep's notice quotes this number and
   * nothing else — a receipt for four when three went is a worse lie than no
   * receipt at all.
   */
  const destroy = useCallback(async (ids: string[]): Promise<number> => {
    const trashed = new Set(
      notesRef.current.filter((note) => note.status === "trashed").map((note) => note.id),
    );
    const eligibleIds = ids.filter((id) => trashed.has(id));
    if (eligibleIds.length === 0) return 0;
    const gone = new Set(eligibleIds);
    const taken = notesRef.current.filter((n) => gone.has(n.id));
    const next = notesRef.current.filter((n) => !gone.has(n.id));
    commit(next);
    // The note leaves the screen at once, and its bytes do not leave anything
    // at all yet: `deleteNotes` hands them to the tombstone, and sync destroys
    // them once the server has confirmed the delete. Removing them here was a
    // guess that the server would agree, and it can refuse — after which the
    // note is restored, and used to come back with nothing attached to it.
    try {
      await deleteNotes(eligibleIds);
    } catch (error) {
      // The store refused, so nothing was destroyed — but the screen had
      // already said otherwise, and the notes came back on the next reload with
      // no word in between. They go back into the trash on screen now, where
      // the store still has them, and the banner says so. Answered as zero, so
      // the sweep's receipt never counts a delete that did not happen.
      console.error("emptying the trash failed", error);
      const present = new Set(notesRef.current.map((n) => n.id));
      const restored = [...notesRef.current, ...taken.filter((n) => !present.has(n.id))];
      restored.sort(newestFirst);
      commit(restored);
      setStorageError(
        "These notes could not be deleted on this device, so they are still in the trash. Try again.",
      );
      return 0;
    }
    // A note whose write had failed is still held for retry and stashed in
    // localStorage; left there, the next open laid it back in from the stash.
    for (const id of eligibleIds) {
      failedWrites.current.delete(id);
      pendingWrites.current.delete(id);
    }
    clearUnsaved(eligibleIds);
    return eligibleIds.length;
  }, [commit]);

  /**
   * Everything whose month in the trash is up. Runs once, on open.
   *
   * It says nothing beforehand and nothing afterwards: the month in the trash is
   * the warning, and it is said three times over on the Trash board itself
   * (`lib/trash.ts`).
   *
   * **It asks the server what time it is first** (`serverClock`). This is the
   * only thing in the app that destroys a note without being asked to, and it
   * was doing it on the strength of `Date.now()` alone: a machine whose clock
   * reads a month ahead emptied the whole trash on its next open, locally and
   * on the server, whatever the real age of anything in it. There is no undo
   * for that. So the destroying half now runs on a clock a second party has
   * confirmed, and does not run at all in a session where no server answered —
   * a sweep deferred to the next open costs nothing, and the notes stay whole
   * in the trash meanwhile. With no server configured the device's clock
   * stands, because there is then no second opinion to be had and no second
   * copy to lose.
   *
   * The two tidying sweeps below are not gated: neither destroys anything the
   * server does not already hold.
   */
  const sweepTrash = useCallback(
    (all: Note[]) => {
      void serverClock(SWEEP_CLOCK_WAIT_MS).then((now) => {
        if (now === null) return;
        const expired = expiredInTrash(all, now);
        if (expired.length === 0) return;
        void destroy(expired.map((n) => n.id)).catch((error: unknown) =>
          console.error("trash sweep failed", error),
        );
      }, (error: unknown) => console.error("could not read the server clock", error));
      // Same tick, same reasoning: something that must happen and must never be
      // on the hot path. Opening a file keeps its bytes forever, which is right
      // until the day the browser runs out of room and drops the whole store —
      // notes and all. This only ever lets go of bytes the server also has.
      void pruneCache(all).catch(() => {
        /* a full cache is a slow app; a failed tidy is not worth a word */
      });
      // The third sweep on the same tick: delete markers past their year
      // (`TOMBSTONE_DAYS`). Never one still in the outbox.
      void pruneTombstones().catch(() => {
        /* an old marker kept is a slower sync, not a loss */
      });
      // The fourth: server files whose removal failed before (`removeRemote`).
      void retryOrphans().catch((error: unknown) =>
        console.error("files left on the server could not be removed yet", error),
      );
    },
    [destroy],
  );

  /**
   * Notes that arrived from the other device. Re-checked against current state,
   * by the same rule the durable store used to accept them.
   *
   * It used to ask only whether `updated_at` had moved, which is the wrong
   * question once notes carry a clock per field. A note merged from both sides
   * keeps the *later* of the two stamps — so when this device held the newer
   * one, the merged note came back with an identical `updated_at`, failed the
   * `>` test, and was dropped on the floor. IndexedDB had accepted it, the
   * screen had not, and the two stayed apart until a reload: the other device's
   * edit appeared to have never arrived, which is exactly the complaint.
   */
  const applyRemote = useCallback((incoming: Note[]) => {
    if (incoming.length === 0) return;
    // From `notesRef.current`, and set as a finished value — the rule the block
    // comment above `update` states for every mutator here, which this one
    // alone used to break by reading `prev` inside the updater. React runs an
    // updater when it renders, not when it is handed over, so between a pull
    // landing and the next render `notesRef.current` still held the *pre-pull*
    // archive: a keystroke arriving in that window computed its next array from
    // the old one and set it, and everything the pull had just brought down
    // vanished from the screen while sitting safely in IndexedDB — the exact
    // "the store had it and the screen did not" failure the per-field clocks
    // were introduced to end.
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    for (const n of incoming) {
      if (isDeletionMarker(n)) {
        byId.delete(n.id);
        continue;
      }
      const local = byId.get(n.id);
      if (!local) {
        byId.set(n.id, n);
        continue;
      }
      // Merged against the note as it is *now*, not swapped for the row. The
      // row was merged in `syncOnce` against the archive as the tick began,
      // and the tick then went to the network twice before landing here; a
      // keystroke that committed in between is in IndexedDB with a newer body
      // clock and nowhere in the row. Swapping put the row on screen without
      // it, the next push sent the screen's copy, and `clearDirtySent` found
      // the stamps disagreeing — so the note stayed dirty, and the text stayed
      // in the store alone, until a reload.
      if (remoteIsNewer(local, n)) byId.set(n.id, mergeNoteFields(local, n));
    }
    const next = [...byId.values()].sort(newestFirst);
    commit(next);
  }, [commit]);

  /**
   * Another tab of this app writing to the same archive (`store/tabs.ts`).
   * What it wrote is read back from the store and merged exactly as a pull
   * is — per field, by clock — so the two tabs cannot hold different words
   * for one note; what it destroyed is let go of the way a tombstone is.
   */
  useEffect(
    () =>
      onWrittenElsewhere((ids) => {
        getNotes(ids).then(
          (rows) =>
            applyRemote(
              ids.map((id) => rows.get(id) ?? deletionMarker(id)),
            ),
          (error: unknown) => console.error("could not read what another tab wrote", error),
        );
      }),
    [applyRemote],
  );

  sweepRef.current = sweepTrash;

  return {
    notes,
    loading,
    localVersion,
    applyRemote,
    applyUploaded,
    create,
    createWithFiles,
    importNotes,
    attachTo,
    detach,
    update,
    editBody,
    editBodyIfBase,
    setStatus,
    togglePriority,
    bulkUpdate,
    merge,
    destroy,
    storageError,
    loadFailed,
    retryStorage,
  };
}
