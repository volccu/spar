import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFLICT_FIELDS } from "./versions";
import { FILE_STRIP_LINES, LINK_STRIP_LINES, ROW_LINES } from "./face";
import { ENTER, EXIT, VANISH_MS } from "./motion";
import { readStyles } from "../test/readStyles.node";

/**
 * Numbers that have to agree across files, checked rather than hoped for.
 *
 * Every pair here is one fact written in two languages — TypeScript and SQL,
 * or TypeScript and CSS — where nothing but a comment connected them. A
 * comment does not fail a build, so the drift is silent: nothing throws,
 * nothing looks broken, and the behaviour is quietly wrong until somebody
 * notices months later.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * The per-field merge list, client and server.
 *
 * The client proposes a clock per field and the server's trigger enforces it,
 * walking its own hardcoded array. A field added to one and not the other is
 * not rejected anywhere — the server simply never merges it, so that field
 * silently falls back to whole-row last-write-wins whenever the two clock sets
 * differ, and one device's edit quietly overwrites the other's. This is the
 * cheapest test in the repo and it guards the most expensive failure.
 */
describe("the fields that merge independently", () => {
  const DIR = new URL("../../../supabase/migrations/", import.meta.url);
  const FOREACH = /foreach field in array array\[([\s\S]*?)\]\s*loop/;

  /**
   * The migration that most recently restated the trigger, found rather than
   * named.
   *
   * This test used to read `0016_folder_boards.sql` by name, which made adding
   * a field a two-part edit where the second part was invisible until it
   * failed: a later migration restating the array (0020 did, for
   * `reminder_repeat`) left this reading a file the server had long since
   * overwritten, so the check passed against dead SQL. The trigger is defined
   * by whichever migration ran last, so that is the one to compare against.
   */
  const carriers = readdirSync(fileURLToPath(DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => FOREACH.test(readFileSync(fileURLToPath(new URL(name, DIR)), "utf8")));

  it("finds a migration that defines the trigger's field list at all", () => {
    expect(carriers.length, "no migration carries a `foreach field in array` — it moved").toBeGreaterThan(0);
  });

  it("says the same thing in the client and in the newest trigger", () => {
    const latest = readFileSync(fileURLToPath(new URL(carriers.at(-1)!, DIR)), "utf8");
    const block = FOREACH.exec(latest)!;
    const inTrigger = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...inTrigger].sort()).toEqual([...CONFLICT_FIELDS].sort());
  });

  it("names that migration in versions.ts, so the pointer is not stale", () => {
    // versions.ts said "mirrored by the foreach array in migration 0011" long
    // after 0016 replaced it — a pointer at the wrong file is how the next
    // person edits the wrong list.
    const doc = read("./versions.ts");
    expect(doc).toContain(carriers.at(-1)!.slice(0, 4));
  });
});

/**
 * The columns sync names without asking, and the schema that has to have them.
 *
 * `BASE_COLUMNS` is the list the client writes into every select and every
 * upsert unconditionally. Naming a column the server has not got does not fail
 * that column — it fails the whole statement, for every note, in both
 * directions, until somebody deploys again. That is not a hypothetical: it is
 * what `board_id` did, and the write-up sits in `sync.ts` above
 * `CAPABILITIES`.
 *
 * The interesting part is *why* the obvious test would not have caught it.
 * `board_id` is a perfectly real column — migration 0016 adds it — so asking
 * "does this column exist in the schema?" answers yes and passes. The rule the
 * comment on `BASE_COLUMNS` actually states is stronger, and it is about time
 * rather than existence: *the columns every server has, whatever migrations it
 * has run.* A client reaches phones the moment it is deployed; a migration
 * reaches the database when someone runs it. Between those two moments the only
 * columns the client may assume are the ones that were already there.
 *
 * So the check below is against the baseline schema, not the current one.
 */
describe("the columns sync names without asking first", () => {
  const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

  /**
   * The last migration the deployed database is assumed to have run already.
   *
   * 0001 creates the table and 0003 brings it up to SPEC v2; every column in
   * `BASE_COLUMNS` comes from one of those two. Everything after 0003 arrived
   * while the app was live, which is exactly the condition that requires a
   * probe instead. This number should effectively never move — raising it is a
   * claim that every server in existence has run that migration, and there is
   * no way to check that from here.
   */
  const BASELINE = "0003";

  /** Lines inside a `create table` block that declare something else. */
  const NOT_A_COLUMN = new Set(["constraint", "primary", "unique", "foreign", "check", "exclude"]);

  const migrations = readdirSync(fileURLToPath(MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  /**
   * The columns `public.notes` has once the given migrations have run, replayed
   * in filename order. Adds and drops both count — a column that came back
   * (`fts_doc` has, twice) has to end up present, and one that left has to end
   * up absent, or the answer is worse than not asking.
   */
  function notesColumnsAfter(files: string[]): Set<string> {
    const columns = new Set<string>();
    for (const file of files) {
      // Comments discuss columns that are not being created, so they go first.
      const sql = readFileSync(fileURLToPath(new URL(file, MIGRATIONS)), "utf8").replace(
        /--[^\n]*/g,
        "",
      );
      const created = /create table if not exists public\.notes\s*\(([\s\S]*?)\n\);/.exec(sql);
      for (const line of created?.[1].split("\n") ?? []) {
        const declared = /^\s+([a-z_][a-z0-9_]*)\s+\S/.exec(line);
        if (declared && !NOT_A_COLUMN.has(declared[1])) columns.add(declared[1]);
      }
      for (const [, name] of sql.matchAll(
        /alter table (?:public\.)?notes\s+add column(?:\s+if not exists)?\s+([a-z_][a-z0-9_]*)/gi,
      )) {
        columns.add(name);
      }
      for (const [, name] of sql.matchAll(
        /alter table (?:public\.)?notes\s+drop column(?:\s+if exists)?\s+([a-z_][a-z0-9_]*)/gi,
      )) {
        columns.delete(name);
      }
    }
    return columns;
  }

  const source = read("../store/sync.ts");
  const declared = /const BASE_COLUMNS = \[([\s\S]*?)\];/.exec(source);
  expect(declared, "BASE_COLUMNS moved or changed shape — find it and re-point this test").toBeTruthy();
  const baseColumns = [...declared![1].matchAll(/"([a-z_]+)"/g)].map(([, name]) => name);

  it("names only columns the schema actually has", () => {
    expect(baseColumns.length).toBeGreaterThan(0);
    const schema = notesColumnsAfter(migrations);
    expect(schema.size, "no migration parsed — the DDL moved or changed shape").toBeGreaterThan(0);
    for (const column of baseColumns) expect([...schema]).toContain(column);
  });

  it("names only columns that predate the probes, so a client may run ahead of its database", () => {
    const baseline = notesColumnsAfter(migrations.filter((name) => name.slice(0, 4) <= BASELINE));
    const tooNew = baseColumns.filter((column) => !baseline.has(column));
    expect(
      tooNew,
      `added after ${BASELINE}, so a server that has not migrated yet will reject every ` +
        `select and every upsert: ${tooNew.join(", ")}. Give each one a probe in columns() ` +
        `instead — see the boardId row of CAPABILITIES, which exists because this happened.`,
    ).toEqual([]);
  });
});

/**
 * The other half of the same rule: the columns sync asks about first.
 *
 * The test above pins `BASE_COLUMNS` to the baseline schema. That closes one
 * door. This closes the other, and it is worth being precise about why the
 * obvious checks do not.
 *
 * Reproduce the original outage inside `columns()` rather than inside
 * `BASE_COLUMNS` — write `"board_id"` where `caps.boardId ? "board_id" : ""`
 * should be — and every plausible test still passes:
 *
 *   - the test above sees nothing, because `board_id` is not in `BASE_COLUMNS`;
 *   - "does this column exist in the schema?" answers yes, because it genuinely
 *     does, migration 0016 adds it;
 *   - "is there a probe for this column?" answers yes, because
 *     the `boardId` row of `CAPABILITIES` is still sitting there in the same file.
 *
 * Every one of those is true of the broken code. The thing that is false is
 * narrower: the column is named *unconditionally at the point of use*. A probe
 * that exists but does not guard anything is decoration. So what is checked
 * here is the guard, not the existence of the column and not the existence of
 * the probe.
 *
 * The consequence of getting it wrong is not subtle and not local. A select
 * naming a column the server has not got fails the whole statement, so one
 * unguarded name takes down every pull and every push for every note — which
 * was confirmed against a fake server missing exactly that column before this
 * test was written.
 */
describe("the columns sync asks about first", () => {
  const source = read("../store/sync.ts");

  const fn = /function columns\(caps: Caps\): string \{([\s\S]*?)\n\}/.exec(source);
  expect(fn, "columns() moved or changed shape — find it and re-point this test").toBeTruthy();
  const list = /return \[([\s\S]*?)\n\s*\]/.exec(fn![1]);
  expect(list, "the array inside columns() moved — find it and re-point this test").toBeTruthy();

  /** Every entry after the `...BASE_COLUMNS` spread, one per line. */
  const entries = list![1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("..."));

  /** The column each entry names. The `: ""` arm of a ternary matches nothing. */
  const named = entries
    .map((line) => ({ line, name: /"([a-z_][a-z0-9_]*)"/.exec(line)?.[1] }))
    .filter((entry): entry is { line: string; name: string } => Boolean(entry.name));

  it("names every late column behind a capability flag, never outright", () => {
    expect(named.length).toBeGreaterThan(0);
    const unguarded = named.filter((entry) => !entry.line.includes("caps.")).map((e) => e.name);
    expect(
      unguarded,
      `named unconditionally in columns(), so a server that has not run the ` +
        `migration yet will reject every select and every upsert: ${unguarded.join(", ")}. ` +
        `Guard each one with its own caps flag — the column existing, and even having a ` +
        `probe, is not the same as the probe being consulted here.`,
    ).toEqual([]);
  });

  /**
   * The other half of a probed column, and the half that is easy to leave out.
   *
   * A clock is a claim about a column, and `knownClocks` exists to keep the
   * claim in step with the row: a clock for a column the server has not got
   * used to answer `42703` and fail the upsert, taking every note batched
   * alongside it with it (migration 0012 made the trigger shrug that off; not
   * sending it is the other half). The failure is silent from the client's
   * side and total from the server's, and nothing but this checks it —
   * `columns()` and `knownClocks` are twenty lines apart and neither mentions
   * the other.
   */
  it("drops the clock for every column it declines to send", () => {
    const fn = /function knownClocks\(note: Note, caps: Caps\): FieldClocks \{([\s\S]*?)\n\}/.exec(
      source,
    );
    expect(fn, "knownClocks moved or changed shape — find it and re-point this test").toBeTruthy();
    const forgotten = named
      // `field_updated_at` is the column the clocks are *carried in*, not a
      // field that has one. Without it the row omits the whole clock set, so
      // there is nothing for knownClocks to prune.
      .filter(({ name }) => name !== "field_updated_at")
      .filter(({ name }) => !new RegExp(`delete clocks\\.${name}\\b`).test(fn![1]))
      .map(({ name }) => name);
    expect(
      forgotten,
      `sent conditionally, but their clocks are sent unconditionally: ${forgotten.join(", ")}. ` +
        `Add a \`delete clocks.<column>\` to knownClocks for each — a clock naming a column ` +
        `the server has not got is the same 42703 the row itself was guarded against.`,
    ).toEqual([]);
  });

  it("backs every capability flag with a real probe", () => {
    // The probes are rows of `CAPABILITIES`, all asked through the one
    // `columnProbe(table, column)` in `serverKnows`. Both halves are checked:
    // a row nothing asks is as much a guess as no row at all.
    const table = /const CAPABILITIES = \{([\s\S]*?)\}/.exec(source);
    expect(table, "CAPABILITIES moved or changed shape — find it and re-point this test").toBeTruthy();
    expect(source).toMatch(/columnProbe\(table, column\)/);
    const unprobed = named
      .filter(({ name }) => !new RegExp(`\\[\\s*"notes"\\s*,\\s*"${name}"\\s*\\]`).test(table![1]))
      .map(({ name }) => name);
    expect(
      unprobed,
      `asked for conditionally, but nothing ever asks the server whether it has ` +
        `them: ${unprobed.join(", ")}. A flag that is set by anything other than a ` +
        `columnProbe is a guess about the schema.`,
    ).toEqual([]);
  });
});

/**
 * Motion durations and curves, TypeScript and CSS.
 *
 * web/CLAUDE.md: "All motion comes from lib/motion.ts … Never hard-code an
 * easing or a duration in a component." The stylesheet hard-codes both anyway,
 * because a CSS keyframe cannot import a constant. So the rule is enforced
 * from this side instead: the literals must equal the constants.
 *
 * It matters in both directions. Raise VANISH_MS and the JS teardown outlasts
 * the animation, leaving a ghost frozen on the board; lower it and the ghost
 * is unmounted mid-shrink — which is exactly the "never shorten VANISH_MS back
 * toward 300" rule the docs state and could not enforce.
 */
describe("motion, in the stylesheet and in motion.ts", () => {
  const css = readStyles();

  it("plays the vanish for exactly VANISH_MS", () => {
    const durations = [...css.matchAll(/animation:\s*vanish-\w+\s+(\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    expect(durations.length).toBeGreaterThan(0);
    for (const ms of durations) expect(ms).toBe(VANISH_MS);
  });

  it("uses the two curves from motion.ts, not hand-written ones", () => {
    // Used to be a literal cubic-bezier(...), hand-copied because a CSS
    // `animation` shorthand cannot read a JS export — exactly the drift risk
    // this test existed to catch. It is now --ease-enter/--ease-exit, a
    // single custom property each side reads, so what is checked here moves
    // one level down: that the token itself still resolves to ENTER/EXIT
    // (styles.test.ts checks that byte-for-byte too) and that vanish-card and
    // vanish-mark still pick one of the two, never a bezier of their own.
    const vanish = [
      ...css.matchAll(/animation:\s*vanish-\w+\s+\d+ms\s+var\(--ease-(enter|exit)\)/g),
    ];
    expect(vanish.length).toBeGreaterThan(0);
    const tokens: Record<string, string | undefined> = {
      enter: css.match(/--ease-enter:\s*([^;]+);/)?.[1]?.trim(),
      exit: css.match(/--ease-exit:\s*([^;]+);/)?.[1]?.trim(),
    };
    for (const [, which] of vanish) expect([ENTER, EXIT]).toContain(tokens[which]);
  });
});

/**
 * How tall a Links-board row is, in the stylesheet and in face.ts.
 *
 * The same relationship `--card-lines` has with the card face, and the same
 * failure if it drifts: CSS clamps the row's words to `--row-lines` line boxes
 * while `deriveFace` cuts them to `ROW_LINES`. Cut long, the clamp eats real
 * text and the cut mark never says so; cut short, the row is drawn with an
 * empty line in it. Neither throws, and neither looks broken enough to notice.
 */
describe("a Links row's line budget, in the stylesheet and in face.ts", () => {
  const css = readStyles();

  it("clamps the row to the same number of lines the face is cut to", () => {
    const declared = /--row-lines:\s*(\d+)\s*;/.exec(css);
    expect(declared, "styles.css must declare --row-lines").toBeTruthy();
    expect(Number(declared![1])).toBe(ROW_LINES);
  });

  it("builds the row's height on its own whole-pixel line box", () => {
    // A row is the name + --row-lines of words, on the row's line box, plus
    // the card's own padding, gap and footer. The domain costs nothing here —
    // it stands in the footer, which is already in the 47.
    const lh = Number(/--row-lh:\s*([\d.]+)px/.exec(css)![1]);
    const rowH = Number(/--row-h:\s*([\d.]+)px/.exec(css)![1]);
    expect(rowH).toBe((ROW_LINES + 1) * lh + 47);
    // Rows stack and are as tall as what they hold, so a half-pixel line box
    // put every second row on a half pixel and its dividing line was never
    // drawn (review UI-A-01). Whole, a row of any number of lines is whole.
    expect(Number.isInteger(lh)).toBe(true);
    expect(css).toMatch(/\.card\[data-row="true"\] \{[^}]*--card-lh: var\(--row-lh\);/);
  });
});

/**
 * How many links a card's strip can name, in the stylesheet and in face.ts.
 *
 * The same relationship, and the same silent failure. The strip is clipped to
 * `--card-link-lines` line boxes and `NoteCard` renders `LINK_STRIP_LINES` of
 * them; draw more than the clamp holds and the extras vanish with nothing to
 * say they were there. That is not a hypothetical — it is the bug this pair
 * was written for. The strip drew two 58px preview boxes and a count inside a
 * 58.5px clamp, so a note with ten addresses showed one link and looked like a
 * note with one link, for months.
 */
describe("a card's link strip, in the stylesheet and in face.ts", () => {
  const css = readStyles();

  it("clamps the strip to the same number of lines the card fills it with", () => {
    const declared = /--card-link-lines,\s*(\d+)\)/.exec(css);
    expect(declared, "styles.css must give --card-link-lines a fallback").toBeTruthy();
    expect(Number(declared![1])).toBe(LINK_STRIP_LINES);
  });

  it("sets a link line on the card's own line box, so the two shapes stack", () => {
    // A link line and a line of the note's words have to measure the same, or
    // the strip's three lines are not three of the card's eight and the card
    // overflows its fixed height.
    expect(css).toMatch(/\.card-link-line \{[^}]*height: var\(--card-lh\);/);
  });
});

describe("how far a grown card may go (review UI-B-01)", () => {
  it("fits whole lines in the room above the write bar, never fewer than the card shows at rest", async () => {
    const { peekLinesFor } = await import("./usePeek");
    // 530px of room, 47 of chrome, 19.5px lines: 24 whole lines fit.
    expect(peekLinesFor(530, 47, 19.5, 9, 24)).toBe(24);
    // A laptop: 400px of room fits 18.
    expect(peekLinesFor(400, 47, 19.5, 9, 24)).toBe(18);
    // Almost no room: the card's own resting lines, never fewer.
    expect(peekLinesFor(120, 47, 19.5, 9, 24)).toBe(9);
    // Plenty of room: the ceiling.
    expect(peekLinesFor(5000, 47, 19.5, 9, 24)).toBe(24);
  });
});

/**
 * The row of file squares under a note's words: the card takes
 * `FILE_STRIP_LINES` off the words' budget, and the stylesheet sizes the
 * squares and clamps the words on `--strip-lines`. Disagree, and the words are
 * cut a line early, or run under the squares.
 */
describe("a card's file strip, in the stylesheet and in face.ts", () => {
  it("takes the same number of lines in both", () => {
    const declared = /--strip-lines:\s*(\d+);/.exec(readStyles());
    expect(declared, "styles.css must declare --strip-lines").toBeTruthy();
    expect(Number(declared![1])).toBe(FILE_STRIP_LINES);
  });
});
