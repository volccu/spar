import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Note, UserBoard } from "../types";
import { note as fixtureNote } from "../test/fixtures";
import { CARRIED, FIXTURE_NOTES, TAKEOUT_DIR, takeoutZip } from "../test/takeout";
import { isTodoNote, linksOnly } from "./boards";
import { MAX_FILE_BYTES } from "./files";
import { noteName } from "./name";
import {
  allChoice,
  automaticBoardName,
  boardsToMake,
  chooseAll,
  composeText,
  defaultChoices,
  keepJsonPaths,
  LABELS_LINE,
  makeBoards,
  planImport,
  placeNote,
  readKeepNote,
  resolveChoices,
  runImport,
  scanKeep,
  trashImport,
  undoImport,
  untrashImport,
  whereToShow,
  whereTheyWent,
  type ImportChunk,
  type ImportStore,
  type KeepFound,
  type KeepScan,
} from "./keepImport";
import { openSource, type SourceFiles } from "./keepSource";
// The Phase 0 importer the owner's own archive came in through (repository root).
import { parseKeepNote } from "../../../src/keep";

const KEEP = join(__dirname, "..", "..", "..", TAKEOUT_DIR);
const NOTES = Object.fromEntries(readdirSync(KEEP).map((name) => [name, readFileSync(join(KEEP, name), "utf8")]));

/** The fixture Takeout, opened the way the screen opens a picked zip. */
async function fixture(): Promise<SourceFiles> {
  const zip = await takeoutZip(NOTES);
  return openSource([{ file: new File([zip], "takeout-20260927.zip", { type: "application/zip" }), path: "takeout-20260927.zip" }]);
}

function byStem(scan: KeepScan, stem: string): KeepFound {
  const found = scan.notes.find((n) => n.stem === stem);
  if (!found) throw new Error(`no ${stem} in the scan`);
  return found;
}

/** A store the size of the undo: notes in an array, boards in a list. */
function memoryStore(notes: Note[], boards: UserBoard[] = []) {
  const state = { notes, boards, undos: [] as { message: string; run: () => void }[] };
  const store: ImportStore = {
    notes: () => state.notes,
    bulkUpdate: (ids, patch) => {
      const set = new Set(ids);
      state.notes = state.notes.map((n) => (set.has(n.id) ? { ...n, ...patch } : n));
    },
    editBoards: (change) => {
      state.boards = change(state.boards);
    },
    pushUndo: (entry) => state.undos.push(entry),
  };
  return { state, store };
}

describe("what a Keep note becomes", () => {
  it("writes the title as the note's name, above its own words", () => {
    const text = composeText({ title: "Umbrella", textContent: "buy a new one" });
    expect(text).toBe("# Umbrella\n\nbuy a new one");
    expect(noteName(text)).toBe("Umbrella");
  });

  it("does not let a title replace a first line that is already a heading", () => {
    // `withNoteName` would put the title *over* the note's own `# ` line.
    expect(composeText({ title: "Trip", textContent: "# Day one\nferry" })).toBe(
      "# Trip\n\n# Day one\nferry",
    );
  });

  it("makes a checklist the app's own tick boxes, one line an item, empty items dropped", () => {
    const text = composeText({
      title: "Pantry list",
      listContent: [
        { text: "flour", isChecked: false },
        { text: "rolled\noats", isChecked: true },
        { text: "  ", isChecked: false },
      ],
    });
    expect(text).toBe("# Pantry list\n\n[ ] flour\n[x] rolled oats");
    // A named list keeps its face, and so its place on Todos.
    expect(isTodoNote(fixtureNote({ body: text, raw_content: text }))).toBe(true);
  });

  it("writes a saved link as its address on a line of its own, and never twice", () => {
    const link = { source: "WEBLINK", title: "Bread", url: "https://example.com/bread" };
    expect(composeText({ textContent: "read later", annotations: [link] })).toBe(
      "read later\n\nhttps://example.com/bread",
    );
    expect(
      composeText({ textContent: "read https://example.com/bread later", annotations: [link, link] }),
    ).toBe("read https://example.com/bread later");
    // A link alone is a bare link, and lives on Links until it is filed.
    const bare = composeText({ annotations: [link] });
    expect(linksOnly(fixtureNote({ body: bare, raw_content: bare }))).toBe(true);
  });

  it("keeps the words exactly as written — no capital added, inner spacing kept", () => {
    expect(composeText({ textContent: "  two  spaces\n\n\nand gaps\n\n" })).toBe("  two  spaces\n\n\nand gaps");
  });

  it("reads a note's stamps, status, pin and labels, and leaves Keep's trash behind", async () => {
    const files = await fixture();
    const found = readKeepNote(
      {
        textContent: "x",
        isArchived: true,
        isPinned: true,
        labels: [{ name: "Work" }, { name: " Work " }, { name: "Ideas" }],
        createdTimestampUsec: 1_600_000_000_000_000,
        userEditedTimestampUsec: 1_600_000_100_000_000,
      },
      "Takeout/Keep/Sample.json",
      files,
    );
    expect(found).not.toBe("trashed");
    const note = found as KeepFound;
    expect(note.stem).toBe("Sample");
    expect(note.status).toBe("archived");
    expect(note.pinned).toBe(true);
    expect(note.labels).toEqual(["Work", "Ideas"]);
    expect(note.created_at).toBe("2020-09-13T12:26:40.000Z");
    expect(note.edited_at).toBe("2020-09-13T12:28:20.000Z");
    expect(readKeepNote({ isTrashed: true, createdTimestampUsec: 1 }, "Keep/x.json", files)).toBe("trashed");
    // Not a Keep note: no stamp of either kind.
    expect(readKeepNote({ not: "a note" }, "Keep/y.json", files)).toBeNull();
    expect(readKeepNote([1, 2], "Keep/z.json", files)).toBeNull();
  });
});

describe("reading a Takeout", () => {
  it("opens only the JSON under Keep, and not another product's files", async () => {
    const files = await fixture();
    const paths = keepJsonPaths(files);
    expect(paths.every((path) => path.startsWith("Takeout/Keep/"))).toBe(true);
    expect(paths).toHaveLength(FIXTURE_NOTES + 1);
  });

  it("reads every note, counts Keep's trash, and finds each note's files", async () => {
    const files = await fixture();
    const progress = vi.fn();
    const scan = await scanKeep(files, progress);
    expect(scan.notes).toHaveLength(FIXTURE_NOTES);
    expect(scan.trashed).toBe(1);
    expect(scan.unreadable).toEqual([]);
    expect(progress).toHaveBeenLastCalledWith(FIXTURE_NOTES + 1, FIXTURE_NOTES + 1);

    // Takeout names the photograph `.jpeg` in the note and stores it as `.jpg`.
    const porch = byStem(scan, "Porch paint");
    expect(porch.files).toHaveLength(1);
    expect(porch.files[0].source?.path).toBe("Takeout/Keep/swatch.jpg");
    // A photograph the Takeout does not include is found missing, not dropped.
    expect(byStem(scan, "Ferry photo").files[0].source).toBeNull();
    expect(byStem(scan, "Voice memo").files[0].mime).toBe("audio/3gpp");
  });

  it("names a note file that will not read, when it sits under Keep", async () => {
    const files: SourceFiles = new Map([
      ["Keep/broken.json", { path: "Keep/broken.json", size: 3, read: async () => new TextEncoder().encode("{no") }],
    ]);
    const scan = await scanKeep(files);
    expect(scan.unreadable).toEqual(["Keep/broken.json"]);
  });

  it("takes a folder of loose Keep files, picked with no Keep folder around them", async () => {
    const json = JSON.stringify({ textContent: "loose", createdTimestampUsec: 1_000 });
    const scan = await scanKeep(await openSource([{ file: new File([json], "Loose.json"), path: "Loose.json" }]));
    expect(scan.notes.map((n) => n.text)).toEqual(["loose"]);
  });
});

describe("not twice", () => {
  it("skips a note already here, active or archived, by its Keep id and creation", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    for (const status of ["active", "archived"] as const) {
      const existing = [fixtureNote({ id: "old", keep_id: "Pantry list", created_at: pantry.created_at, status })];
      const plan = planImport(scan, existing);
      expect(plan.already).toBe(1);
      expect(plan.revive).toHaveLength(0);
      expect(plan.fresh).toHaveLength(FIXTURE_NOTES - 1);
      expect(plan.fresh.some((n) => n.stem === "Pantry list")).toBe(false);
    }
  });

  /** Undo is how a newcomer retries with better label choices; the retry used
   *  to call every note "already here" though all sat in the trash (review
   *  GAP-03). They are counted apart and come back, never made twice. */
  it("counts a match in the trash apart, and neither skips it nor makes it again", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    const existing = [
      fixtureNote({ id: "old", keep_id: "Pantry list", created_at: pantry.created_at, status: "trashed" }),
    ];
    const plan = planImport(scan, existing);
    expect(plan.already).toBe(0);
    expect(plan.revive.map((r) => r.id)).toEqual(["old"]);
    expect(plan.fresh.some((n) => n.stem === "Pantry list")).toBe(false);
    expect(plan.fresh).toHaveLength(FIXTURE_NOTES - 1);
  });

  it("calls a note already here when any copy of it is out of the trash", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    const plan = planImport(scan, [
      fixtureNote({ id: "a", keep_id: "Pantry list", created_at: pantry.created_at, status: "trashed" }),
      fixtureNote({ id: "b", keep_id: "Pantry list", created_at: pantry.created_at, status: "active" }),
    ]);
    expect(plan.already).toBe(1);
    expect(plan.revive).toHaveLength(0);
  });

  it("lists a note with nothing to bring in up front, and offers it no more", async () => {
    const scan = await scanKeep(await fixture());
    const doodle = byStem(scan, "Doodle");
    const empty = { ...doodle, text: "", labels: [], files: [{ name: "gone.png", mime: "image/png", source: null }] };
    const plan = planImport({ ...scan, notes: [empty] }, []);
    expect(plan.empty).toBe(1);
    expect(plan.fresh).toHaveLength(0);
    // The label's line is something to write, so a note carrying one is not empty.
    expect(planImport({ ...scan, notes: [{ ...empty, labels: ["Work"] }] }, []).empty).toBe(0);
  });

  it("matches a creation stamp as an instant, the way the server spells it", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    const spelled = pantry.created_at.replace("Z", "000+00:00").replace(".000000", ".000000");
    const plan = planImport(scan, [fixtureNote({ keep_id: "Pantry list", created_at: spelled })]);
    expect(plan.already).toBe(1);
  });

  it("gives a different note under a taken Keep id an id of its own, and knows it next time", async () => {
    const scan = await scanKeep(await fixture());
    // Another Keep account's "Pantry list", written on another day.
    const other = fixtureNote({ id: "theirs", keep_id: "Pantry list", created_at: "2019-01-01T00:00:00.000Z" });
    const plan = planImport(scan, [other]);
    expect(plan.already).toBe(0);
    const pantry = plan.fresh.find((n) => n.stem === "Pantry list")!;
    expect(pantry.keep_id).toBe("Pantry list@1700000000000000");
    // Imported once under that id, it is here the second time.
    const again = planImport(scan, [other, fixtureNote({ id: "ours", keep_id: pantry.keep_id })]);
    expect(again.already).toBe(1);
  });

  it("counts each label once, over the notes that are going in", async () => {
    const plan = planImport(await scanKeep(await fixture()), []);
    expect(plan.labels).toEqual([
      { name: "Kitchen", count: 3 },
      { name: "Errands", count: 1 },
      { name: "House", count: 1 },
      { name: "Someday", count: 1 },
    ]);
  });
});

describe("labels, and where a note goes", () => {
  const shelf: UserBoard[] = [{ id: "b-kitchen", name: "kitchen", position: 0 }];

  it("starts a label at the board already called that, and otherwise at a new board", () => {
    const choices = defaultChoices([{ name: "Kitchen" }, { name: "House" }], shelf);
    expect(choices).toEqual({
      Kitchen: { to: "board", id: "b-kitchen" },
      House: { to: "new", name: "House" },
    });
  });

  it("starts a label on one or two notes in the Inbox, unless a board is already called that", () => {
    const choices = defaultChoices(
      [
        { name: "Kitchen", count: 1 },
        { name: "Errands", count: 2 },
        { name: "House", count: 3 },
      ],
      shelf,
    );
    expect(choices).toEqual({
      Kitchen: { to: "board", id: "b-kitchen" },
      Errands: { to: "inbox" },
      House: { to: "new", name: "House" },
    });
  });

  it("sends every label one way from the one switch, and reads which way they all go", () => {
    const labels = [{ name: "Kitchen" }, { name: "House" }];
    const boards = chooseAll(labels, shelf, "new");
    expect(boards).toEqual({
      Kitchen: { to: "board", id: "b-kitchen" },
      House: { to: "new", name: "House" },
    });
    expect(allChoice(labels, shelf, boards)).toBe("new");
    const inbox = chooseAll(labels, shelf, "inbox");
    expect(inbox).toEqual({ Kitchen: { to: "inbox" }, House: { to: "inbox" } });
    expect(allChoice(labels, shelf, inbox)).toBe("inbox");
    expect(allChoice(labels, shelf, { ...boards, House: { to: "inbox" } })).toBe("mixed");
  });

  it("makes each new board once, however many labels ask for it, and within the name limit", () => {
    const long = "x".repeat(60);
    expect(
      boardsToMake({
        a: { to: "new", name: "Home" },
        b: { to: "new", name: " home " },
        [long]: { to: "new", name: "" },
        c: { to: "inbox" },
      }),
    ).toEqual(["Home", "x".repeat(40)]);
  });

  /** Review GAP-04: a label named like a board the shelf already has files into
   *  it, and makes no empty second one. */
  it("makes no board for a name the shelf already has", () => {
    const shelf: UserBoard[] = [{ id: "b-work", name: "Work", position: 0 }];
    const choices = {
      a: { to: "new", name: " work " },
      b: { to: "new", name: "Home" },
    } as const;
    expect(boardsToMake(choices, shelf)).toEqual(["Home"]);
    expect(boardsToMake(choices)).toEqual(["work", "Home"]);
    const target = resolveChoices(choices, shelf);
    expect(target.get("a")).toBe("b-work");
  });

  it("knows Inspiration is one of the app's own names", () => {
    expect(automaticBoardName("inspiration")).toBe("Inspiration");
  });

  it("knows a name that looks like an automatic board", () => {
    expect(automaticBoardName("Todo")).toBe("Todos");
    expect(automaticBoardName("to-do")).toBe("Todos");
    expect(automaticBoardName("inbox")).toBe("Inbox");
    expect(automaticBoardName("Links")).toBe("Links");
    expect(automaticBoardName("Trash")).toBe("Trash");
    expect(automaticBoardName("All")).toBe("All");
    expect(automaticBoardName("Work")).toBeNull();
    expect(automaticBoardName("  ")).toBeNull();
  });

  it("files a multi-label note under the first label that became a board, and keeps the rest", () => {
    const found = { labels: ["Errands", "Kitchen", "Someday"], text: "Compare the kettles" } as KeepFound;
    const target = new Map<string, string | null>([
      ["Errands", null],
      ["Kitchen", "b-kitchen"],
      ["Someday", "b-someday"],
    ]);
    expect(placeNote(found, target)).toEqual({
      board_id: "b-kitchen",
      text: `Compare the kettles\n\n${LABELS_LINE}Errands, Someday`,
    });
  });

  it("keeps a label left in the Inbox on the line too, so no label is lost", () => {
    const found = { labels: ["Misc"], text: "" } as KeepFound;
    expect(placeNote(found, new Map([["Misc", null]]))).toEqual({
      board_id: null,
      text: "Keep labels: Misc",
    });
    // A note whose one label became its board carries no line at all.
    expect(placeNote({ labels: ["Misc"], text: "hi" } as KeepFound, new Map([["Misc", "b"]]))).toEqual({
      board_id: "b",
      text: "hi",
    });
  });

  it("resolves the choices once the boards exist, a vanished board falling to the Inbox", () => {
    const { store, state } = memoryStore([], [...shelf]);
    const made = makeBoards(["House"], store);
    expect(state.boards.map((b) => b.name)).toEqual(["kitchen", "House"]);
    const target = resolveChoices(
      {
        Kitchen: { to: "board", id: "b-kitchen" },
        House: { to: "new", name: "House" },
        Gone: { to: "board", id: "no-such-board" },
        Misc: { to: "inbox" },
      },
      state.boards,
    );
    expect(target.get("Kitchen")).toBe("b-kitchen");
    expect(target.get("House")).toBe(made[0].id);
    expect(target.get("Gone")).toBeNull();
    expect(target.get("Misc")).toBeNull();
  });
});

describe("runImport", () => {
  async function planned() {
    const scan = await scanKeep(await fixture());
    return { scan, plan: planImport(scan, []) };
  }

  /** The store's write, as a list: every chunk and the files each note got. */
  function recorder() {
    const chunks: ImportChunk[] = [];
    const write = async (chunk: ImportChunk) => {
      chunks.push(chunk);
      return chunk.map(({ note, files }) => ({
        ...note,
        attachments: files.map((f, i) => ({
          id: `${note.id}-${i}`,
          name: f.name,
          mime: f.type,
          size: f.size,
          width: null,
          height: null,
          thumb: null,
          path: null,
          added_at: note.created_at,
        })),
      }));
    };
    return { chunks, write };
  }

  it("writes every note with Keep's stamps, its board, its files, and says what it did", async () => {
    const { plan } = await planned();
    const { chunks, write } = recorder();
    const target = new Map<string, string | null>([
      ["Kitchen", "b-kitchen"],
      ["Errands", null],
      ["House", "b-house"],
      ["Someday", null],
    ]);
    const result = await runImport(plan, target, write);
    const notes = chunks.flat().map((c) => c.note);
    expect(result.imported).toBe(FIXTURE_NOTES);
    expect(result.archived).toBe(1);
    expect(result.important).toBe(1);
    expect(result.filed).toBe(4);
    expect(result.files).toBe(3);
    expect(result.stopped).toBeNull();
    expect(result.leftBehind).toEqual([
      { note: "The view from the ferry deck", name: "ferry.jpg", why: "not in the Takeout" },
    ]);
    expect(result.made).toHaveLength(FIXTURE_NOTES);

    const pantry = notes.find((n) => n.keep_id === "Pantry list")!;
    expect(pantry.raw_content).toBe(pantry.body);
    expect(pantry.body).toBe("# Pantry list\n\n[ ] flour\n[x] rolled oats\n[ ] tinned tomatoes");
    expect(pantry.board_id).toBe("b-kitchen");
    expect(pantry.priority).toBe(1);
    expect(pantry.source).toBe("keep");
    expect(pantry.created_at).toBe("2023-11-14T22:13:20.000Z");
    expect(pantry.updated_at).toBe("2023-11-14T22:21:40.000Z");
    expect(pantry.field_updated_at?.body).toBe(pantry.updated_at);

    const kettles = notes.find((n) => n.keep_id === "2023-05-06T07_08_09.000-00_00")!;
    expect(kettles.body).toBe(
      "Compare the two kettles before the weekend\n\nhttps://example.com/kettles\n\nKeep labels: Errands, Someday",
    );
    expect(kettles.board_id).toBe("b-kitchen");

    const card = notes.find((n) => n.keep_id === "Old recipe card")!;
    expect(card.status).toBe("archived");

    const porch = chunks.flat().find((c) => c.note.keep_id === "Porch paint")!;
    expect(porch.files.map((f) => [f.name, f.type])).toEqual([["swatch.jpg", "image/jpeg"]]);
    expect(await porch.files[0].text()).toBe(CARRIED["swatch.jpg"]);
    const memo = chunks.flat().find((c) => c.note.keep_id === "Voice memo")!;
    expect(memo.files.map((f) => f.type)).toEqual(["audio/3gpp"]);
    // A drawing with no words is a note carrying its drawing.
    const doodle = chunks.flat().find((c) => c.note.keep_id === "Doodle")!;
    expect(doodle.note.body).toBe("");
    expect(doodle.files.map((f) => f.name)).toEqual(["doodle.png"]);
  });

  it("goes a chunk at a time, and says how far it has got", async () => {
    const { scan } = await planned();
    const many = { ...scan, notes: Array.from({ length: 120 }, (_, i) => ({ ...scan.notes[0], stem: `n${i}`, files: [] })) };
    const plan = planImport(many, []);
    const { chunks, write } = recorder();
    const progress = vi.fn();
    await runImport(plan, new Map(), write, { onProgress: progress });
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(progress.mock.calls).toEqual([
      [50, 120],
      [100, 120],
      [120, 120],
    ]);
  });

  it("names a file over the limit rather than carrying it or dropping it silently", async () => {
    const { scan } = await planned();
    const found = byStem(scan, "Porch paint");
    const big = { ...found, files: [{ ...found.files[0], source: { ...found.files[0].source!, size: MAX_FILE_BYTES + 1 } }] };
    const plan = planImport({ ...scan, notes: [big] }, []);
    const { chunks, write } = recorder();
    const result = await runImport(plan, new Map(), write);
    expect(chunks[0][0].files).toEqual([]);
    expect(result.leftBehind).toEqual([{ note: "Porch paint", name: "swatch.jpeg", why: "too large" }]);
  });

  it("leaves a note with nothing left in it behind, and counts it", async () => {
    const { scan } = await planned();
    const empty = { ...byStem(scan, "Doodle"), files: [{ name: "gone.png", mime: "image/png", source: null }] };
    const { write } = recorder();
    const result = await runImport(planImport({ ...scan, notes: [empty] }, []), new Map(), write);
    expect(result.imported).toBe(0);
    expect(result.empty).toBe(1);
  });

  /** Review GAP-03: matches in the trash come back under this run's choices,
   *  grouped, counted into the one undo. */
  it("brings a note from the trash back into the board the new choices name", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    const trashed = fixtureNote({ id: "old", keep_id: "Pantry list", created_at: pantry.created_at, status: "trashed" });
    const store = memoryStore([trashed]);
    const plan = planImport({ ...scan, notes: [pantry] }, [trashed]);
    const { write } = recorder();
    const target = new Map<string, string | null>(pantry.labels.map((l) => [l, "b-new"]));
    const result = await runImport(plan, target, write, {
      revive: store.store.bulkUpdate,
      notes: store.store.notes,
    });
    expect(result.revived).toBe(1);
    expect(result.imported).toBe(0);
    expect(result.made).toEqual([{ id: "old", status: pantry.status }]);
    expect(store.state.notes[0].status).toBe(pantry.status);
    // No duplicate was written.
    expect(store.state.notes).toHaveLength(1);
    // One undo takes it back to the trash.
    undoImport({ made: result.made, boards: [] }, store.store);
    expect(store.state.notes[0].status).toBe("trashed");
  });

  it("leaves alone a note put back by hand since the plan was made", async () => {
    const scan = await scanKeep(await fixture());
    const pantry = byStem(scan, "Pantry list");
    const trashed = fixtureNote({ id: "old", keep_id: "Pantry list", created_at: pantry.created_at, status: "trashed" });
    const plan = planImport({ ...scan, notes: [pantry] }, [trashed]);
    const store = memoryStore([{ ...trashed, status: "active" }]);
    const { write } = recorder();
    const result = await runImport(plan, new Map(), write, { revive: store.store.bulkUpdate, notes: store.store.notes });
    expect(result.revived).toBe(0);
  });

  /** Review GAP-02: how many it put in the Inbox, for the summary's offer. */
  it("counts the notes it put in the Inbox, apart from those its line keeps out", async () => {
    const { plan } = await planned();
    const { write } = recorder();
    const result = await runImport(plan, new Map(), write, { inboxSince: "2100-01-01T00:00:00.000Z" });
    expect(result.inInbox + result.beforeInboxLine).toBeGreaterThan(0);
    expect(result.inInbox).toBe(0);
    const all = await runImport(plan, new Map(), recorder().write, { inboxSince: "1970-01-01T00:00:00.000Z" });
    expect(all.inInbox).toBeGreaterThan(0);
    expect(all.beforeInboxLine).toBe(0);
  });

  it("counts the to-dos and bare links it left on Todos and Links, so every active unfiled note is somewhere (review 2026-10-24 critic)", async () => {
    const { scan } = await planned();
    const list = { ...byStem(scan, "Pantry list"), stem: "Shopping", body: "# Shopping\n\n[ ] flour\n[ ] eggs", labels: [] };
    const plan = planImport({ ...scan, notes: [...scan.notes, list] }, []);
    const { chunks, write } = recorder();
    const result = await runImport(plan, new Map(), write, { inboxSince: "1970-01-01T00:00:00.000Z" });
    const unfiled = chunks.flat().filter(({ note }) => note.status === "active" && !note.board_id).length;
    expect(result.onTodos + result.onLinks).toBeGreaterThan(0);
    expect(result.inInbox + result.beforeInboxLine + result.onTodos + result.onLinks).toBe(unfiled);
  });

  it("stops at a chunk the device will not take, with what landed still counted", async () => {
    const { scan } = await planned();
    const many = { ...scan, notes: Array.from({ length: 80 }, (_, i) => ({ ...scan.notes[0], stem: `n${i}`, files: [] })) };
    const { write } = recorder();
    let calls = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runImport(planImport(many, []), new Map(), async (chunk) => {
      calls += 1;
      if (calls === 2) throw new DOMException("full", "QuotaExceededError");
      return write(chunk);
    });
    expect(result.imported).toBe(50);
    expect(result.made).toHaveLength(50);
    expect(result.stopped).toBe("This device ran out of room.");
  });

  it("says so in other words when the device refuses for another reason", async () => {
    const { plan } = await planned();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runImport(plan, new Map(), async () => {
      throw new Error("blocked");
    });
    expect(result.imported).toBe(0);
    expect(result.stopped).toBe("This device would not save any more notes.");
  });

  it("counts the active notes the Inbox's line keeps out, and not a to-do or a filed note", async () => {
    const { plan } = await planned();
    const { write } = recorder();
    const result = await runImport(plan, new Map([["House", "b-house"]]), write, {
      inboxSince: "2024-01-01T00:00:00.000Z",
    });
    // Unfiled, active, written before 2024 and not a to-do: kettles, doodle,
    // memo, ferry — and the pantry list, which would have been a to-do but
    // for its `Keep labels: Kitchen` line: a list with a line of words under
    // it is not all tick boxes. The porch note is filed; the recipe card is
    // archived.
    expect(result.beforeInboxLine).toBe(5);
    const { write: second } = recorder();
    const filed = await runImport(plan, new Map([["Kitchen", "b-kitchen"]]), second, {
      inboxSince: "2024-01-01T00:00:00.000Z",
    });
    // Filed under Kitchen, the list carries no line and is not counted.
    expect(filed.beforeInboxLine).toBe(4);
  });
});

describe("where the notes went (review UX-19)", () => {
  const none = { inInbox: 0, filed: 0, archived: 0, archivedFiled: 0, beforeInboxLine: 0, onTodos: 0, onLinks: 0 };

  it("says it in one line, in the order of the shelf", () => {
    expect(whereTheyWent({ ...none, inInbox: 4, archived: 1 })).toBe("4 in the Inbox, 1 in the Archive");
    expect(whereTheyWent({ ...none, inInbox: 2, filed: 3, archived: 1, beforeInboxLine: 5 })).toBe(
      "2 in the Inbox, 3 in boards, 1 in the Archive, 5 on All",
    );
    // An archived note that was also filed is counted once, as archived.
    expect(whereTheyWent({ ...none, filed: 3, archived: 2, archivedFiled: 1 })).toBe("2 in boards, 2 in the Archive");
    expect(whereTheyWent(none)).toBe("");
    // To-dos and bare links wait on their own boards, and are named too.
    expect(whereTheyWent({ ...none, inInbox: 2, onTodos: 3, onLinks: 1 })).toBe(
      "2 in the Inbox, 3 on Todos, 1 on Links",
    );
    expect(whereTheyWent({ ...none, onTodos: 3 })).toBe("3 on Todos");
  });

  it("opens the Inbox when it got any, else the first board the import made", () => {
    const made: UserBoard[] = [
      { id: "a", name: "Recipes", position: 0 },
      { id: "b", name: "Home", position: 1 },
    ];
    const empty = { inInbox: 0, onTodos: 0, onLinks: 0 };
    expect(whereToShow({ ...empty, inInbox: 3 }, made)).toBeNull();
    expect(whereToShow(empty, made)).toBe("a");
    expect(whereToShow(empty, [])).toBeNull();
  });

  it("falls back to Todos, then Links, when the import left nothing in the Inbox or a new board", () => {
    expect(whereToShow({ inInbox: 0, onTodos: 2, onLinks: 1 }, [])).toBe("todos");
    expect(whereToShow({ inInbox: 0, onTodos: 0, onLinks: 1 }, [])).toBe("links");
    expect(whereToShow({ inInbox: 1, onTodos: 2, onLinks: 1 }, [])).toBeNull();
  });

  it("opens All when the only notes it left loose are older than the Inbox's line", () => {
    expect(whereToShow({ inInbox: 0, beforeInboxLine: 4, onTodos: 0, onLinks: 0 }, [])).toBe("recent");
    expect(whereToShow({ inInbox: 0, beforeInboxLine: 4, onTodos: 2, onLinks: 0 }, [])).toBe("recent");
  });
});

describe("the one undo", () => {
  const made = [
    { id: "a", status: "active" as const },
    { id: "b", status: "archived" as const },
    { id: "c", status: "active" as const },
  ];

  it("moves the batch to the trash — only what still has the status the import gave it", () => {
    const { store, state } = memoryStore(
      [
        fixtureNote({ id: "a", board_id: "b-new" }),
        fixtureNote({ id: "b", status: "archived" }),
        // Archived by hand since the import: left where it was put.
        fixtureNote({ id: "c", status: "archived" }),
        fixtureNote({ id: "mine" }),
      ],
      [{ id: "b-new", name: "House", position: 0 }],
    );
    const moved = undoImport({ made, boards: [{ id: "b-new", name: "House", position: 0 }] }, store);
    expect(moved).toBe(2);
    expect(state.notes.map((n) => [n.id, n.status])).toEqual([
      ["a", "trashed"],
      ["b", "trashed"],
      ["c", "archived"],
      ["mine", "active"],
    ]);
    // The board the import made holds nothing now, so it is off the shelf.
    expect(state.boards).toEqual([]);
    // And the undo is itself undoable: the notes come back as they were, the
    // board with them, filed where they were.
    expect(state.undos).toHaveLength(1);
    state.undos[0].run();
    expect(state.notes.map((n) => [n.id, n.status])).toEqual([
      ["a", "active"],
      ["b", "archived"],
      ["c", "archived"],
      ["mine", "active"],
    ]);
    expect(state.boards.map((b) => b.id)).toEqual(["b-new"]);
  });

  it("leaves a board the import made on the shelf while something else is filed in it", () => {
    const board = { id: "b-new", name: "House", position: 0 };
    const { store, state } = memoryStore(
      [fixtureNote({ id: "a", board_id: "b-new" }), fixtureNote({ id: "filed-since", board_id: "b-new" })],
      [board],
    );
    trashImport({ made: [{ id: "a", status: "active" }], boards: [board] }, store);
    expect(state.boards).toEqual([board]);
  });

  it("puts back only what is still in the trash", () => {
    const { store, state } = memoryStore([
      fixtureNote({ id: "a", status: "trashed" }),
      fixtureNote({ id: "b", status: "active" }),
    ]);
    untrashImport(
      [
        { id: "a", status: "archived" },
        { id: "b", status: "archived" },
      ],
      [],
      store,
    );
    expect(state.notes.map((n) => n.status)).toEqual(["archived", "active"]);
  });
});

/**
 * Audit CODE-9. The owner's archive came in through the Phase 0 importer
 * (`src/keep.ts`), which stored the Takeout file's name as `keep_id` and Keep's
 * creation stamp as `created_at`. The browser import recognises a note it has
 * seen by exactly those two, so if either side ever drifted, importing the same
 * Takeout in the browser would make the whole archive a second time.
 */
describe("an archive that came in through the Phase 0 importer", () => {
  it("is recognised whole, so importing the same Takeout again makes nothing", async () => {
    const phase0 = Object.entries(NOTES)
      .filter(([name]) => /\.json$/i.test(name))
      .map(([name, text]) => parseKeepNote(JSON.parse(text), name.replace(/\.json$/i, "")))
      .filter((parsed) => parsed !== null);
    expect(phase0.length).toBeGreaterThan(3);
    // As the server hands them back: Postgres writes an instant as
    // `…+00:00`, not as the `…Z` the importer wrote, so the match has to be
    // by instant and not by spelling.
    const existing = phase0.map((parsed, i) =>
      fixtureNote({
        id: `phase0-${i}`,
        keep_id: parsed.keep_id,
        created_at: parsed.created_at.replace(/\.000Z$/, "+00:00"),
        status: parsed.status,
      }),
    );
    const scan = await scanKeep(await fixture());
    expect(scan.notes.map((n) => n.stem).sort()).toEqual(phase0.map((p) => p.keep_id).sort());
    const plan = planImport(scan, existing);
    expect(plan.fresh).toEqual([]);
    expect(plan.revive).toEqual([]);
    expect(plan.already).toBe(phase0.length);
  });
});
