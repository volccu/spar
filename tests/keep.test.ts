// tests/keep.test.ts
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseKeepNote, usecToIso, type KeepNote } from "../src/keep.js";

function load(name: string): KeepNote {
  return JSON.parse(readFileSync(`tests/fixtures/keep/${name}`, "utf-8"));
}

test("trashed notes return null", () => {
  expect(parseKeepNote(load("trashed.json"), "trashed")).toBeNull();
});

test("plain text note: labels->tags, timestamps, active/unpinned, enrichable", () => {
  const n = parseKeepNote(load("text.json"), "text")!;
  expect(n.raw_content).toBe("sourdough starter?? how often to feed it");
  expect(n.tags).toEqual(["baking"]);
  expect(n.status).toBe("active");
  expect(n.pinned).toBe(false);
  expect(n.created_at).toBe("2020-09-13T12:26:40.000Z");
  expect(n.last_interacted_at).toBe("2020-09-13T12:28:20.000Z");
  expect(n.has_enrichable_text).toBe(true);
  expect(n.keep_id).toBe("text");
});

test("titled note: title prepended, archived+pinned mapped", () => {
  const n = parseKeepNote(load("titled.json"), "titled")!;
  expect(n.raw_content).toBe("Umbrella\n\nbuy a new one, the old one blew inside out");
  expect(n.status).toBe("archived");
  expect(n.pinned).toBe(true);
});

test("checklist: rendered as [ ]/[x] under the title", () => {
  const n = parseKeepNote(load("checklist.json"), "checklist")!;
  expect(n.raw_content).toBe("Groceries\n\n[ ] milk\n[x] eggs");
  expect(n.has_enrichable_text).toBe(true);
});

test("weblink: block appended after user text; enrichable", () => {
  const n = parseKeepNote(load("weblink.json"), "weblink")!;
  expect(n.raw_content).toBe(
    "read later\n\nSaved link: Bread baking 101 — https://example.com/bread — how yeast makes dough rise"
  );
  expect(n.has_enrichable_text).toBe(true);
});

test("weblink-only: weblink block alone is enrichable, no leading blank line", () => {
  const n = parseKeepNote(load("weblink-only.json"), "weblink-only")!;
  expect(n.raw_content).toBe(
    "Saved link: Bread baking 101 — https://example.com/bread — how yeast makes dough rise"
  );
  expect(n.has_enrichable_text).toBe(true);
});

test("usecToIso: microseconds converted to ISO 8601", () => {
  expect(usecToIso(1600000000000000)).toBe("2020-09-13T12:26:40.000Z");
});

test("image-only: breadcrumb marker, NOT enrichable", () => {
  const n = parseKeepNote(load("image-only.json"), "image-only")!;
  expect(n.raw_content).toBe("[image attachment: abc.jpg]");
  expect(n.has_enrichable_text).toBe(false);
});

test("empty note: empty raw_content, NOT enrichable", () => {
  const n = parseKeepNote(load("empty.json"), "empty")!;
  expect(n.raw_content).toBe("");
  expect(n.has_enrichable_text).toBe(false);
});
