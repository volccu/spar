import { makeZip, type FixtureEntry } from "./zipFixture";

/**
 * A synthetic Google Takeout, for the Keep import's tests.
 *
 * The notes are the JSON files in `tests/fixtures/keep/takeout-sample/Keep/` —
 * invented text only, shaped the way Takeout writes Keep — and the files they
 * carry are made here, a few bytes each, because nothing in a test decodes a
 * picture (jsdom has no `createImageBitmap`) and a binary fixture in the tree
 * is a thing nobody can read in review. Between them they hold what the import
 * has to get right: a titled, pinned checklist; a note with three labels and
 * a saved link; a photograph Takeout names `.jpeg` and stores as `.jpg`; an
 * archived note; a drawing with no words; a recording; a photograph missing
 * from the Takeout; and a note from Keep's trash. `Labels.txt` sits beside them
 * as Takeout leaves it, naming one label no note carries.
 *
 * Not a test file, so `tsc -b` checks it; nothing in the app imports it. The
 * fixture folder is read by the tests themselves (`node:fs`, which this file
 * cannot name: the web build has no Node types) and handed in as a map of file
 * name to text.
 */

/** Where the fixture's `Keep` folder is, from a test file in `web/src/*`. */
export const TAKEOUT_DIR = "tests/fixtures/keep/takeout-sample/Keep/";

/** The bytes of the three files the notes carry and the Takeout includes. */
export const CARRIED: Record<string, string> = {
  "swatch.jpg": "a few bytes standing in for a photograph",
  "doodle.png": "a few bytes standing in for a drawing",
  "memo.3gp": "a few bytes standing in for a recording",
};

/** Every entry of the Takeout, under `Takeout/Keep/`, as a zip would hold it. */
export function takeoutEntries(notes: Record<string, string>): FixtureEntry[] {
  const entries: FixtureEntry[] = Object.entries(notes).map(([name, text]) => ({
    path: `Takeout/Keep/${name}`,
    data: text,
    deflate: true,
  }));
  for (const [name, data] of Object.entries(CARRIED)) {
    entries.push({ path: `Takeout/Keep/${name}`, data, deflate: false });
  }
  // Another product's files ride in the same Takeout, and must be left alone.
  entries.push({
    path: "Takeout/Fit/Daily activity metrics/2023-01-01.json",
    data: '{"not":"a note"}',
    deflate: true,
  });
  return entries;
}

/** The Takeout as the zip Google sends. */
export function takeoutZip(notes: Record<string, string>): Promise<Blob> {
  return makeZip(takeoutEntries(notes));
}

/** How many notes the fixture holds that an import brings in. */
export const FIXTURE_NOTES = 7;
