import { describe, expect, it, vi } from "vitest";
import type { Attachment, Canvas, Note, UserBoard } from "../types";
import { planArchive, writeArchive } from "./exportArchive";
import type { ImportChunk } from "./keepImport";
import { openSource, picked } from "./keepSource";
import {
  cleanNote,
  filePaths,
  findSparJson,
  mergeFolders,
  planSparImport,
  readSparExport,
  rootOf,
  runSparImport,
  type SparExport,
} from "./sparImport";

/*
 * A spår download, read back in (audit 2026-10-10, DATA-4 / UX-3) — tested
 * against a download made by `lib/exportArchive.ts` itself, so the two halves
 * cannot drift apart: what one writes, the other must read.
 */

const T = "2026-03-01T10:00:00.000Z";

function note(id: string, body: string, fields: Partial<Note> = {}): Note {
  return {
    id,
    raw_content: body,
    body,
    source: "web",
    created_at: T,
    updated_at: T,
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
}

function attachment(id: string, name: string, size: number, fields: Partial<Attachment> = {}): Attachment {
  return {
    id,
    name,
    mime: "image/png",
    size,
    width: 10,
    height: 10,
    thumb: "data:image/jpeg;base64,AAAA",
    path: `user/${id}`,
    added_at: T,
    ...fields,
  };
}

const PICTURE = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);

const folder: UserBoard = { id: "f-recipes", name: "Recipes", position: 0, color: "teal" };

function archive() {
  const notes: Note[] = [
    note("n-plain", "Plain words", { created_at: "2026-01-01T00:00:00.000Z" }),
    // Edited since it was written: the original must come back as written.
    note("n-edited", "Now it says this", {
      raw_content: "It first said this",
      board_id: folder.id,
      priority: 1,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-02-02T00:00:00.000Z",
      field_updated_at: { body: "2026-02-02T00:00:00.000Z" },
    }),
    note("n-picture", "A picture", {
      status: "archived",
      created_at: "2026-01-03T00:00:00.000Z",
      attachments: [attachment("a-pic", "beach.png", PICTURE.length)],
    }),
    // Only its preview reached the download.
    note("n-lost", "A lost file", {
      created_at: "2026-01-04T00:00:00.000Z",
      attachments: [attachment("a-lost", "gone.png", 50)],
    }),
    note("n-trashed", "In the bin", { status: "trashed", created_at: "2026-01-05T00:00:00.000Z" }),
    note("n-idea", "An idea", { merged_from: ["n-plain"], created_at: "2026-01-06T00:00:00.000Z" }),
  ];
  const canvases: Canvas[] = [
    {
      id: "c-1",
      idea_id: "n-idea",
      items: [{ note_id: "n-plain", x: 10, y: 20 }],
      strokes: [],
      image_widths: {},
      text_elements: [{ id: "t-1", x: 1, y: 2, text: "a label" }],
      created_at: T,
      updated_at: T,
    },
  ];
  return { notes, folders: [folder], canvases };
}

/** A download, as About's Download everything makes it, opened as the import opens it. */
async function download(input = archive()) {
  const now = new Date("2026-04-01T12:00:00.000Z");
  const plan = planArchive({ ...input, now });
  const made = await writeArchive(plan, async (att) => (att.id === "a-pic" ? PICTURE : null), undefined, now);
  const zip = new File([await made.blob.arrayBuffer()], made.fileName, { type: "application/zip" });
  const source = await openSource(picked([zip]));
  const file = findSparJson(source);
  if (!file) throw new Error("no spår.json in the download");
  const read = readSparExport(JSON.parse(new TextDecoder().decode(await file.read())));
  if (typeof read === "string") throw new Error(read);
  return { source, root: rootOf(file.path), data: read.data };
}

/** The store's `importNotes`, as far as the import can see it. */
function store() {
  const written: Note[] = [];
  const files = new Map<string, File[]>();
  const write = async (chunk: ImportChunk) => {
    const made = chunk.map(({ note: n, files: own }) => {
      files.set(n.id, own);
      return n;
    });
    written.push(...made);
    return made;
  };
  return { written, files, write };
}

const nothingHere = { notes: [] as Note[], tombstones: new Set<string>(), folders: [] as UserBoard[], canvases: [] as Canvas[] };

describe("a spår download, round trip", () => {
  it("finds its notes, folders and canvases in a download the app made", async () => {
    const { data } = await download();
    expect(data.notes.map((n) => n.id).sort()).toEqual(
      ["n-edited", "n-idea", "n-lost", "n-picture", "n-plain", "n-trashed"],
    );
    expect(data.folders).toEqual([folder]);
    expect(data.canvases.map((c) => c.id)).toEqual(["c-1"]);
  });

  it("brings every note back under its own id, the original kept as written", async () => {
    const { data, source, root } = await download();
    const plan = planSparImport(data, nothingHere);
    const s = store();
    const result = await runSparImport(plan, source, filePaths(data, root), s.write);

    expect(result.imported).toBe(5);
    expect(plan.trashed).toBe(1);
    const edited = s.written.find((n) => n.id === "n-edited")!;
    expect(edited.raw_content).toBe("It first said this");
    expect(edited.body).toBe("Now it says this");
    expect(edited.board_id).toBe(folder.id);
    expect(edited.priority).toBe(1);
    expect(edited.updated_at).toBe("2026-02-02T00:00:00.000Z");
    expect(edited.field_updated_at).toEqual({ body: "2026-02-02T00:00:00.000Z" });
    expect(s.written.find((n) => n.id === "n-picture")!.status).toBe("archived");
    expect(s.written.some((n) => n.id === "n-trashed")).toBe(false);
    expect(result.made).toContainEqual({ id: "n-picture", status: "archived" });
  });

  it("brings a file back from the zip, byte for byte, and names one that is not in it", async () => {
    const { data, source, root } = await download();
    const plan = planSparImport(data, nothingHere);
    const s = store();
    const result = await runSparImport(plan, source, filePaths(data, root), s.write);

    const [file] = s.files.get("n-picture")!;
    expect(file.name).toBe("beach.png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PICTURE);
    // Handed over as a file to describe and store, not as the old record.
    expect(s.written.find((n) => n.id === "n-picture")!.attachments).toEqual([]);

    // Only its preview reached the download: the record stays, so the
    // thumbnail still draws, and the summary says so.
    expect(s.files.get("n-lost")).toEqual([]);
    expect(s.written.find((n) => n.id === "n-lost")!.attachments.map((a) => a.id)).toEqual(["a-lost"]);
    expect(result.files).toBe(1);
    expect(result.leftBehind).toEqual([{ note: "A lost file", name: "gone.png", why: "not in the download" }]);
  });

  it("is safe to run twice: the second run finds everything already here", async () => {
    const { data, source, root } = await download();
    const s = store();
    await runSparImport(planSparImport(data, nothingHere), source, filePaths(data, root), s.write);

    const again = planSparImport(data, { ...nothingHere, notes: s.written, folders: [folder] });
    expect(again.fresh).toEqual([]);
    expect(again.already).toBe(5);
    expect(again.newFolders).toEqual([]);
    expect(again.shelf).toEqual([folder]);
    expect(again.canvases).toEqual([]);
  });

  it("skips a note deleted for good here, and one whose Keep id is taken", async () => {
    const input = archive();
    input.notes[0] = { ...input.notes[0], keep_id: "keep-1" };
    const { data } = await download(input);
    const plan = planSparImport(data, {
      ...nothingHere,
      notes: [note("other", "x", { keep_id: "keep-1" })],
      tombstones: new Set(["n-edited"]),
    });
    expect(plan.fresh.map((n) => n.id)).not.toContain("n-edited");
    expect(plan.fresh.map((n) => n.id)).not.toContain("n-plain");
    expect(plan.deleted).toBe(1);
    expect(plan.keepTwin).toBe(1);
  });

  it("adds the download's folders after the shelf's, and never renames or removes one", async () => {
    const { data } = await download();
    const mine: UserBoard = { id: folder.id, name: "Cooking", position: 0 };
    const other: UserBoard = { id: "f-mine", name: "Mine", position: 1 };
    expect(mergeFolders([mine, other], data.folders)).toEqual([mine, other]);
    const fresh = mergeFolders([other], data.folders);
    expect(fresh[0]).toEqual(other);
    expect(fresh[1]).toMatchObject({ id: folder.id, name: "Recipes", color: "teal", position: 2 });
  });

  it("files the download's Inspiration notes into the Inspiration here, rather than a second folder", async () => {
    const theirs: UserBoard = { id: "f-theirs", name: "insp", position: 1, kind: "inspiration" };
    const input = archive();
    input.folders = [folder, theirs];
    input.notes[0] = { ...input.notes[0], board_id: "f-theirs" };
    const { data } = await download(input);
    // The download says which folder it was, though it writes it as a plain one.
    expect(data.inspiration).toBe("f-theirs");
    expect(data.folders.find((f) => f.id === "f-theirs")?.kind).toBeUndefined();

    const plan = planSparImport(data, { ...nothingHere, inspiration: "f-ours" });
    expect(plan.fresh.find((n) => n.id === "n-plain")!.board_id).toBe("f-ours");
    expect(plan.shelf.map((f) => f.id)).toEqual([folder.id]);

    // With no Inspiration here, it comes in as the folder it was written as.
    const alone = planSparImport(data, nothingHere);
    expect(alone.fresh.find((n) => n.id === "n-plain")!.board_id).toBe("f-theirs");
    expect(alone.shelf.map((f) => f.id)).toEqual([folder.id, "f-theirs"]);
  });

  it("reads an older download's Inspiration by its name", async () => {
    const { data } = await download({ ...archive(), folders: [folder, { id: "f-old", name: "Inspiration", position: 1 }] });
    const older: SparExport = { ...data, inspiration: undefined };
    expect(planSparImport(older, { ...nothingHere, inspiration: "f-ours" }).shelf.map((f) => f.id)).toEqual([folder.id]);
  });

  it("brings a canvas back with its idea, and not over one already here", async () => {
    const { data } = await download();
    expect(planSparImport(data, nothingHere).canvases.map((c) => c.id)).toEqual(["c-1"]);
    const mineToo: Canvas = { ...data.canvases[0], id: "c-mine" };
    expect(planSparImport(data, { ...nothingHere, canvases: [mineToo] }).canvases).toEqual([]);
  });
});

describe("what is let in from the file", () => {
  it("refuses anything that is not a spår download, and says so", () => {
    expect(readSparExport({ format: "something else" })).toMatch(/not a spår download/);
    expect(readSparExport({ format: "spår export", version: 2 })).toMatch(/newer spår/);
  });

  it("counts a row it cannot read, rather than guessing at it", () => {
    const read = readSparExport({
      format: "spår export",
      version: 1,
      exported_at: T,
      notes: [{ id: "ok", body: "fine", created_at: T }, { body: "no id" }, "not even a row"],
      folders: [],
      canvases: [],
    }) as { data: SparExport; unreadable: number };
    expect(read.data.notes.map((n) => n.id)).toEqual(["ok"]);
    expect(read.unreadable).toBe(2);
  });

  it("keeps the original as written, and lets no strange values through", () => {
    const n = cleanNote({
      id: "x",
      raw_content: "first",
      body: "now",
      created_at: T,
      status: "gone",
      note_type: "spell",
      priority: 7,
      attachments: [{ id: "a", name: "f.png", thumb: "javascript:alert(1)" }],
      link_previews: [{ href: "javascript:alert(1)" }],
    })!;
    expect(n.raw_content).toBe("first");
    expect(n.status).toBe("active");
    expect(n.note_type).toBeNull();
    expect(n.priority).toBe(1);
    expect(n.attachments[0].thumb).toBeNull();
    expect(n.link_previews).toBeUndefined();
  });

  it("finds spår.json whichever way the zip spells the å", () => {
    const files = new Map([
      ["x/spår.json", { path: "x/spår.json", size: 1, read: async () => new Uint8Array() }],
    ]);
    expect(findSparJson(files)?.path).toBe("x/spår.json");
  });
});

describe("what the summary says", () => {
  it("names a note by its first line, cut at sixty, or by its date when that line is blank", async () => {
    const long = "A first line that runs on well past the sixty characters a summary row holds";
    const input = archive();
    input.notes = [
      note("n-long", `# ${long}\nand more`, {
        created_at: "2026-01-07T00:00:00.000Z",
        attachments: [attachment("a-long", "long.png", 50)],
      }),
      note("n-blank", "   \nthe words start here", {
        created_at: "2026-01-08T00:00:00.000Z",
        attachments: [attachment("a-blank", "blank.png", 50)],
      }),
    ];
    const { data, source, root } = await download(input);
    const result = await runSparImport(planSparImport(data, nothingHere), source, filePaths(data, root), store().write);
    expect(result.leftBehind).toEqual([
      { note: `${long.slice(0, 59)}…`, name: "long.png", why: "not in the download" },
      { note: "a note from 2026-01-08", name: "blank.png", why: "not in the download" },
    ]);
  });

  it("stops at a chunk the device will not take, and says why", async () => {
    const { data, source, root } = await download();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const refusing = (error: Error) => async () => {
      throw error;
    };
    const full = await runSparImport(
      planSparImport(data, nothingHere),
      source,
      filePaths(data, root),
      refusing(new DOMException("full", "QuotaExceededError")),
    );
    expect(full.stopped).toBe("This device ran out of room.");
    expect(full.imported).toBe(0);
    const other = await runSparImport(
      planSparImport(data, nothingHere),
      source,
      filePaths(data, root),
      refusing(new Error("blocked")),
    );
    expect(other.stopped).toBe("This device would not save any more notes.");
  });
});
