import { describe, expect, it } from "vitest";
import { attachment, board, canvas, note } from "../test/fixtures";
import { dataUrlBytes, missingFilesLine, noteStem, planArchive, safeSegment, writeArchive } from "./exportArchive";
import { readZip } from "./zip.test";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function paths(plan: ReturnType<typeof planArchive>): string[] {
  return plan.entries.map((e) => e.path);
}

function textAt(plan: ReturnType<typeof planArchive>, path: string): string {
  const entry = plan.entries.find((e) => e.path === path);
  if (!entry || !("text" in entry)) throw new Error(`no text entry at ${path}`);
  return entry.text;
}

describe("planArchive", () => {
  it("writes every note once, into the place it is in — never into a lens", () => {
    const plan = planArchive({
      now: NOW,
      folders: [board({ id: "b1", name: "Kök" })],
      canvases: [],
      notes: [
        note({ id: "inbox", body: "loose thought", raw_content: "loose thought" }),
        note({ id: "filed", body: "bread", raw_content: "bread", board_id: "b1" }),
        note({ id: "old", body: "old", raw_content: "old", status: "archived", board_id: "b1" }),
        note({ id: "bin", body: "gone", raw_content: "gone", status: "trashed" }),
        note({ id: "todo", body: "[ ] milk\n[ ] eggs", raw_content: "[ ] milk\n[ ] eggs", note_type: "todo" }),
        // A folder that no longer exists is no place at all (`isFiled`).
        note({ id: "stray", body: "stray", raw_content: "stray", board_id: "gone" }),
      ],
    });
    const root = "spår 2026-09-17";
    expect(plan.root).toBe(root);
    expect(paths(plan).filter((p) => p.endsWith(".md")).sort()).toEqual(
      [
        `${root}/Archive/2026-01-01 old.md`,
        `${root}/Inbox/2026-01-01 loose thought.md`,
        `${root}/Inbox/2026-01-01 milk.md`,
        `${root}/Inbox/2026-01-01 stray.md`,
        `${root}/Kök/2026-01-01 bread.md`,
        `${root}/Trash/2026-01-01 gone.md`,
      ].sort(),
    );
    expect(plan.noteCount).toBe(6);
  });

  it("writes a note filed in Inspiration into a folder of its own, not into the Inbox", () => {
    const plan = planArchive({
      now: NOW,
      notes: [note({ id: "n1", body: "a picture", raw_content: "a picture", board_id: "i1" })],
      folders: [board({ id: "i1", name: "Inspiration", kind: "inspiration" })],
      canvases: [],
    });
    const written = paths(plan).filter((p) => p.endsWith(".md"));
    expect(written).toHaveLength(1);
    expect(written[0].startsWith("spår 2026-09-17/Inspiration/")).toBe(true);
  });

  it("puts the note's text after the front matter exactly as stored", () => {
    const body = "# Bröd\n\n[ ] mjöl\n```\ncode\n```";
    const plan = planArchive({
      now: NOW,
      folders: [board({ id: "b1", name: "Kök" })],
      canvases: [],
      notes: [
        note({
          body,
          raw_content: body,
          board_id: "b1",
          priority: 1,
          note_type: "todo",
          reminder_at: "2026-09-20T08:00:00.000Z",
          reminder_repeat: "weekly",
          field_updated_at: { body: "2026-02-01T00:00:00.000Z" },
        }),
      ],
    });
    const text = textAt(plan, "spår 2026-09-17/Kök/2026-01-01 Bröd.md");
    expect(text).toBe(
      [
        "---",
        'created: "2026-01-01T00:00:00.000Z"',
        'edited: "2026-02-01T00:00:00.000Z"',
        'folder: "Kök"',
        "priority: true",
        "todo: true",
        'reminder: "2026-09-20T08:00:00.000Z"',
        "repeats: weekly",
        'id: "n1"',
        "---",
        "",
      ].join("\n") + body,
    );
  });

  it("keeps the original beside an edited note, and only then", () => {
    const plan = planArchive({
      now: NOW,
      folders: [],
      canvases: [],
      notes: [
        note({ id: "a", raw_content: "first try", body: "second try" }),
        note({ id: "b", raw_content: "same", body: "same" }),
      ],
    });
    expect(textAt(plan, "spår 2026-09-17/Inbox/2026-01-01 second try (original).md")).toBe("first try");
    expect(paths(plan).filter((p) => p.includes("(original)"))).toHaveLength(1);
  });

  it("never hands out the same name twice in one folder, whatever the case", () => {
    const plan = planArchive({
      now: NOW,
      folders: [],
      canvases: [],
      notes: [
        note({ id: "a", body: "Plan", raw_content: "Plan" }),
        note({ id: "b", body: "plan", raw_content: "plan" }),
        note({ id: "c", body: "PLAN", raw_content: "PLAN" }),
      ],
    });
    expect(paths(plan).filter((p) => p.endsWith(".md"))).toEqual([
      "spår 2026-09-17/Inbox/2026-01-01 Plan.md",
      "spår 2026-09-17/Inbox/2026-01-01 plan (2).md",
      "spår 2026-09-17/Inbox/2026-01-01 PLAN (3).md",
    ]);
  });

  it("keeps a folder the user called Archive apart from the real Archive", () => {
    const plan = planArchive({
      now: NOW,
      folders: [board({ id: "b1", name: "Archive" })],
      canvases: [],
      notes: [
        note({ id: "a", body: "mine", raw_content: "mine", board_id: "b1" }),
        note({ id: "b", body: "archived", raw_content: "archived", status: "archived" }),
      ],
    });
    expect(paths(plan)).toContain("spår 2026-09-17/Archive (2)/2026-01-01 mine.md");
    expect(paths(plan)).toContain("spår 2026-09-17/Archive/2026-01-01 archived.md");
  });

  it("puts a note's files in a folder named after it, listed in its front matter", () => {
    const plan = planArchive({
      now: NOW,
      folders: [],
      canvases: [],
      notes: [
        note({
          body: "",
          raw_content: "",
          attachments: [attachment({ id: "a1", name: "receipt.pdf" }), attachment({ id: "a2", name: "receipt.pdf" })],
        }),
      ],
    });
    const md = "spår 2026-09-17/Inbox/2026-01-01 receipt.md";
    expect(textAt(plan, md)).toContain('files:\n  - "2026-01-01 receipt files/receipt.pdf"\n  - "2026-01-01 receipt files/receipt.pdf (2)"');
    expect(paths(plan)).toContain("spår 2026-09-17/Inbox/2026-01-01 receipt files/receipt.pdf");
    expect(plan.fileCount).toBe(2);
  });

  it("writes the whole store again as JSON, and a README", () => {
    const n = note();
    const folders = [board()];
    const canvases = [canvas()];
    const plan = planArchive({ now: NOW, notes: [n], folders, canvases });
    const json = JSON.parse(textAt(plan, "spår 2026-09-17/spår.json"));
    expect(json).toEqual({
      format: "spår export",
      version: 1,
      exported_at: NOW.toISOString(),
      // Which folder is Inspiration, for a download read back in (audit DATA-4).
      inspiration: null,
      notes: [n],
      folders,
      canvases,
    });
    expect(textAt(plan, "spår 2026-09-17/README.txt")).toContain("1 notes, 0 files.");
  });
});

describe("names", () => {
  it("makes a path segment safe on Windows and never empty", () => {
    expect(safeSegment('a/b\\c:d*e?f"g<h>i|j', "x")).toBe("a b c d e f g h i j");
    expect(safeSegment("trailing dots...", "x")).toBe("trailing dots");
    expect(safeSegment("   ", "fallback")).toBe("fallback");
    expect(safeSegment("CON", "x")).toBe("_CON");
    expect(safeSegment("x".repeat(100), "x")).toHaveLength(60);
  });

  it("calls a note by its name, then its first words, then its file", () => {
    expect(noteStem(note({ body: "# Trip\nday one" }))).toBe("Trip");
    expect(noteStem(note({ body: "\n\n- [ ] pack bags" }))).toBe("pack bags");
    expect(noteStem(note({ body: "[ ] pack bags" }))).toBe("pack bags");
    expect(noteStem(note({ body: "", attachments: [attachment({ name: "scan.pdf" })] }))).toBe("scan");
    expect(noteStem(note({ body: "" }))).toBe("note");
  });
});

describe("writeArchive", () => {
  it("writes the bytes it can reach and the preview of the ones it cannot", async () => {
    const thumb = `data:image/jpeg;base64,${btoa("JPEG")}`;
    const plan = planArchive({
      now: NOW,
      folders: [],
      canvases: [],
      notes: [
        note({
          id: "p",
          body: "photos",
          raw_content: "photos",
          attachments: [
            attachment({ id: "here", name: "here.png" }),
            attachment({ id: "away", name: "away.png", thumb }),
            attachment({ id: "lost", name: "lost.bin", thumb: null }),
          ],
        }),
      ],
    });
    const seen: number[] = [];
    const result = await writeArchive(
      plan,
      async (att) => (att.id === "here" ? new Uint8Array([1, 2, 3]) : null),
      (done) => seen.push(done),
      NOW,
    );
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(result.fileName).toBe("spår 2026-09-17.zip");
    expect(result.missing).toHaveLength(2);

    const files = await readZip(result.blob);
    const dir = "spår 2026-09-17/Inbox/2026-01-01 photos files";
    expect([...(files.get(`${dir}/here.png`) ?? [])]).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(files.get(`${dir}/away.png (preview).jpg`))).toBe("JPEG");
    expect(files.has(`${dir}/lost.bin`)).toBe(false);
    const readme = new TextDecoder().decode(files.get("spår 2026-09-17/README.txt"));
    expect(readme).toContain("away.png: only its preview");
    expect(readme).toContain("lost.bin: not saved");
    expect(readme).toContain("2 files were on neither this device nor the server");
    expect(readme).toContain("so they are not in here in full");
  });

  it("says one missing file in the singular, in the README and on screen", async () => {
    const plan = planArchive({
      now: NOW,
      folders: [],
      canvases: [],
      notes: [
        note({
          id: "p",
          body: "photos",
          raw_content: "photos",
          attachments: [attachment({ id: "lost", name: "lost.bin", thumb: null })],
        }),
      ],
    });
    const result = await writeArchive(plan, async () => null, undefined, NOW);
    const files = await readZip(result.blob);
    const readme = new TextDecoder().decode(files.get("spår 2026-09-17/README.txt"));
    expect(readme).toContain("1 file was on neither this device nor the server");
    expect(readme).toContain("so it is not in here in full");
    expect(missingFilesLine(1)).toBe("1 file was on neither this device nor the server, so the README lists it.");
    expect(missingFilesLine(3)).toBe("3 files were on neither this device nor the server, so the README lists them.");
  });

  it("reads a thumbnail data URL, and nothing else", () => {
    expect([...(dataUrlBytes(`data:image/jpeg;base64,${btoa("ab")}`) ?? [])]).toEqual([97, 98]);
    expect(dataUrlBytes("https://example.com/a.jpg")).toBeNull();
    expect(dataUrlBytes(null)).toBeNull();
  });
});
