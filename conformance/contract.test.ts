/**
 * The facts the contract states in more than one place, held together. These
 * read files, not a backend, so they pass or fail the same on every driver.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFLICT_FIELDS } from "../web/src/lib/versions";
import { TOMBSTONE_DAYS } from "../web/src/lib/trash";
import { MERGE_FIELDS } from "./support";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function newestDefinitionOf(fn: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  const definition = new RegExp(`create (or replace )?function public\\.${fn}\\(`, "g");
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const starts = [...sql.matchAll(definition)].map((m) => m.index ?? 0);
    if (starts.length > 0) {
      const from = starts[starts.length - 1];
      // To the end of the function body: the next `$$;` after its opening `$$`.
      const open = sql.indexOf("$$", from);
      const close = sql.indexOf("$$;", open + 2);
      body = sql.slice(from, close + 3);
    }
  }
  if (!body) throw new Error(`no migration defines ${fn}`);
  return body;
}

describe("the contract's constants agree with the code", () => {
  it("merges exactly the client's CONFLICT_FIELDS", () => {
    expect([...MERGE_FIELDS]).toEqual([...CONFLICT_FIELDS]);
  });

  it("merges exactly the fields the newest Supabase merge trigger walks", () => {
    const sql = newestDefinitionOf("merge_note_field_versions");
    const list = sql.match(/foreach field in array array\[([\s\S]*?)\]/)?.[1] ?? "";
    const fields = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(fields).toEqual([...MERGE_FIELDS]);
  });

  it("keeps a tombstone for the same year on both sides", () => {
    const sql = newestDefinitionOf("prune_note_tombstones");
    const days = Number(sql.match(/interval '(\d+) days'/)?.[1]);
    expect(days).toBe(TOMBSTONE_DAYS);
    expect(TOMBSTONE_DAYS).toBe(365);
  });

  it("caps a file at 50 MiB in the bucket", () => {
    const sql = readFileSync(join(MIGRATIONS, "0027_prefs_history_and_bigger_files.sql"), "utf8");
    expect(sql).toMatch(/file_size_limit = 52428800/);
  });

  it("keeps an occurrence due for one day in the sweep and in the function that sends it", () => {
    expect(newestDefinitionOf("due_reminders")).toMatch(/p_grace interval default interval '1 day'/);
    // The constant lives in the file the function and the spår server share,
    // and the function must take its TTL from there rather than a copy.
    const shared = readFileSync(join(ROOT, "supabase", "functions", "_shared", "notification.ts"), "utf8");
    expect(shared).toMatch(/export const GRACE_SECONDS = 24 \* 60 \* 60;/);
    const fn = readFileSync(join(ROOT, "supabase", "functions", "send-reminders", "index.ts"), "utf8");
    expect(fn).toMatch(/import \{[^}]*\bttlFor\b[^}]*\} from "\.\.\/_shared\/notification\.ts";/);
    expect(fn).not.toMatch(/GRACE_SECONDS/);
  });

  it("reads the same note columns in the Supabase driver as the web client does with every capability", () => {
    const quoted = (text: string | undefined) => [...(text ?? "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    const sync = readFileSync(join(ROOT, "web", "src", "store", "sync.ts"), "utf8");
    const base = quoted(sync.match(/const BASE_COLUMNS = \[([\s\S]*?)\];/)?.[1]);
    // `columns(caps)` is BASE_COLUMNS plus one column per capability. Every
    // entry must be one of those two shapes, so a new kind of entry fails
    // here rather than being skipped by the reading below.
    const entries = (sync.match(/function columns\(caps: Caps\): string \{\s*return \[([\s\S]*?)\]\s*\.filter/)?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const optional: string[] = [];
    for (const entry of entries) {
      if (entry === "...BASE_COLUMNS,") continue;
      const column = entry.match(/^caps\.\w+ \? "([a-z_]+)" : "",$/)?.[1];
      expect(column, entry).toBeDefined();
      optional.push(column!);
    }
    const driver = readFileSync(join(ROOT, "conformance", "drivers", "supabase.ts"), "utf8");
    const listed = quoted(driver.match(/const NOTE_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1]);
    expect(base.length).toBeGreaterThan(0);
    expect(entries).toContain("...BASE_COLUMNS,");
    expect(listed).toEqual([...base, ...optional]);
  });
});
