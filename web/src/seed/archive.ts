/**
 * The notes the archive assertions run over, and whether they are the real ones.
 *
 * Four test files hold this project's strongest guarantees — the round trips
 * that `offsetAtPoint` depends on, and the false-positive rates for unfenced
 * code, headings and numbered lists. All four measured them against
 * `notes.json`: the user's own 241 notes, gitignored because personal data
 * never enters git. So on a fresh checkout, and on CI, those four files could
 * not even *load*, and every CI run since the suite was written has failed on
 * a missing module rather than on anything about the code. A suite that cannot
 * run is not a guard, and a red pipeline nobody expects to be green hides the
 * next real break.
 *
 * The fix is the one the app already made for itself (`seedIfEmpty` in
 * `store/useNotes.ts`): take the real archive when it is here, and the tracked
 * synthetic `fixture.json` when it is not. What must not be papered over is
 * that the two prove different things. The *structural* invariants — parse and
 * rebuild returns the input character for character, nothing marks whitespace,
 * renumbering changes nothing — are claims about the code and have to hold over
 * whatever is loaded. The *tallies* — exactly 121 bold, exactly 4 headings, more
 * than 200 notes — are facts about one person's archive, and 30 synthetic notes
 * cannot stand in for them. Asserting them against the fixture would mean
 * rewriting the numbers to match it, which is how a guard becomes a decoration.
 *
 * So `REAL_ARCHIVE` says which one is loaded and the tallies run only when it
 * is true — `it.runIf(REAL_ARCHIVE)` in the test files, so a skip is reported
 * rather than silently passing. Locally, after `npm run seed`, everything runs.
 * On CI the structure is checked and the counts are skipped, which is honest
 * about what CI can see. Never re-point these assertions at the fixture and
 * adjust the numbers to fit: the numbers are the guard.
 */

interface SeedNote {
  body?: string;
  raw_content?: string;
}

const files = import.meta.glob<{ default: SeedNote[] }>("./*.json", { eager: true });

const entries = Object.entries(files);
const real = entries.find(([path]) => path.endsWith("/notes.json"))?.[1];
const fixture = entries.find(([path]) => path.endsWith("/fixture.json"))?.[1];

/**
 * True when the user's own archive is present, so the exact-count assertions
 * mean something. False on a fresh checkout and on CI.
 */
export const REAL_ARCHIVE = real !== undefined;

/** Every seed note, real if available and synthetic otherwise. */
export const archiveNotes: SeedNote[] = (real ?? fixture)?.default ?? [];

/**
 * The same notes as bodies, which is all most of the assertions want. Matches
 * the app's own read: `body` is what is edited, `raw_content` the original
 * capture it defaults to.
 */
export const archiveBodies: string[] = archiveNotes.map((n) => n.body ?? n.raw_content ?? "");
