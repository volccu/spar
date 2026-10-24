import { test, expect } from "vitest";
import { openDb } from "../src/db.js";
import { importDir } from "../src/import.js";

test("importDir loads *.json only, skips trashed, is idempotent", () => {
  const db = openDb(":memory:");
  const summary = importDir(db, "tests/fixtures/keep");
  // 8 fixtures, 1 trashed => 7 imported
  expect(summary.imported).toBe(7);
  expect(summary.skippedTrashed).toBe(1);
  expect(summary.archived).toBe(1); // titled.json
  expect(summary.withWeblink).toBe(2); // weblink.json, weblink-only.json
  expect(summary.imageOnly).toBe(1); // image-only.json
  expect(summary.empty).toBe(1); // empty.json

  const count = db.prepare("SELECT COUNT(*) c FROM notes").get() as { c: number };
  expect(count.c).toBe(7);

  // idempotent: second import inserts nothing new
  importDir(db, "tests/fixtures/keep");
  const count2 = db.prepare("SELECT COUNT(*) c FROM notes").get() as { c: number };
  expect(count2.c).toBe(7);
});

test("imported note carries mapped fields and an id", () => {
  const db = openDb(":memory:");
  importDir(db, "tests/fixtures/keep");
  // Only the columns this test actually asks about. SQLite gives back the
  // whole row; naming the five keeps the assertions honest about which ones
  // the importer is being held to. `tags` is JSON in a text column.
  const row = db.prepare("SELECT * FROM notes WHERE keep_id='titled'").get() as {
    id: string;
    status: string;
    pinned: number;
    tags: string;
    has_enrichable_text: number;
  };
  expect(row.status).toBe("archived");
  expect(row.pinned).toBe(1);
  expect(JSON.parse(row.tags)).toEqual([]);
  expect(row.has_enrichable_text).toBe(1);
  expect(typeof row.id).toBe("string");
});
