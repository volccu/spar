import { test, expect } from "vitest";
import { openDb } from "../src/db.js";

test("openDb creates notes, interactions, enrichment_history, notes_fts", () => {
  const db = openDb(":memory:");
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
    .all()
    .map((r) => (r as { name: string }).name);
  expect(names).toContain("notes");
  expect(names).toContain("interactions");
  expect(names).toContain("enrichment_history");
  expect(names).toContain("notes_fts");
});

test("FTS index updates when a note's title changes (trigger works)", () => {
  const db = openDb(":memory:");
  db.prepare(
    "INSERT INTO notes (id, raw_content, keep_id) VALUES ('n1', 'yeast dough baking', 'k1')"
  ).run();
  // before enrichment: found by body word
  let hit = db
    .prepare("SELECT n.id FROM notes_fts f JOIN notes n ON n.rowid=f.rowid WHERE notes_fts MATCH ?")
    .get("dough") as { id: string } | undefined;
  expect(hit?.id).toBe("n1");
  // set a title, then it must be findable by a title word
  db.prepare("UPDATE notes SET title='Bread note' WHERE id='n1'").run();
  hit = db
    .prepare("SELECT n.id FROM notes_fts f JOIN notes n ON n.rowid=f.rowid WHERE notes_fts MATCH ?")
    .get("Bread") as { id: string } | undefined;
  expect(hit?.id).toBe("n1");
});
