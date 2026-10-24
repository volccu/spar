import { test, expect } from "vitest";
import { openDb } from "../src/db.js";
import { importDir } from "../src/import.js";
import { ftsQuery, ftsSearch } from "../src/search/fts.js";

test("ftsQuery builds a safe prefix OR string", () => {
  expect(ftsQuery("yeast dough")).toBe('"yeast"* OR "dough"*');
  expect(ftsQuery('weird"quote')).toBe('"weirdquote"*');
});
test("ftsSearch finds a note by a body word", () => {
  const db = openDb(":memory:");
  importDir(db, "tests/fixtures/keep");
  const ids = ftsSearch(db, "sourdough", 10);
  expect(ids.length).toBeGreaterThanOrEqual(1);
  const row = db.prepare("SELECT keep_id FROM notes WHERE id=?").get(ids[0]) as { keep_id: string };
  expect(row.keep_id).toBe("text");
});
