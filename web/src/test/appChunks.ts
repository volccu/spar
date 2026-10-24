import { beforeAll, expect } from "vitest";

/**
 * Every `App.*.test.tsx` starts with the app's code already in memory.
 *
 * The first test in each of those files used to pay for loading it: the seed
 * the empty store is filled from on first open, and each lazy layer the test
 * opens — the note, the idea canvas, About, the two modes, a carried board —
 * fetched and transformed on first use. Alone that is a second or two; with a hundred and
 * sixty files sharing the machine it was most of the 12.5 s the slowest test
 * measured against the 15 s timeout that gates a deploy (audit 2026-10-10,
 * CODE-5). Loading a module is not what any of these tests is about, so it
 * happens here, once per file and before the first test, under a timeout of
 * its own — and every test then measures only what it does.
 *
 * Nothing here changes what the app does: the same modules arrive, only
 * earlier, as the note's own does for a person (`prefetchNoteView`). The tap
 * that beats a fetch is covered where it matters (`lazyPanels.test.tsx`).
 * The icon set is deliberately left out — `App.test.tsx` watches it arrive.
 */
const APP_TEST = /[\\/]App\.[^\\/]*test\.tsx$/;

beforeAll(async () => {
  if (!APP_TEST.test(expect.getState().testPath ?? "")) return;
  // The seed `useNotes` fills the empty store from, chosen the same way.
  const seeds = import.meta.glob<{ default: unknown }>("../seed/*.json");
  const entries = Object.entries(seeds);
  const seed =
    entries.find(([path]) => path.endsWith("/notes.json")) ??
    entries.find(([path]) => path.endsWith("/fixture.json"));
  await Promise.all([
    seed?.[1](),
    import("../components/NoteView"),
    import("../components/CanvasSheet"),
    import("../components/About"),
    import("../components/Sorter"),
    import("../components/Ticker"),
    import("../lib/shelfCarry"),
  ]);
}, 120_000);
