import type { SampleStore } from "../demo/sampleNotes";

/**
 * Whether this is the public demo's build (`npm run build:demo`).
 *
 * The demo is the same app with no backend, opened straight onto the device-only
 * board, plus three things only it carries: an offer of sample notes on the
 * empty Inbox, a few sentences saying that nothing here leaves the browser, and
 * the files a static host wants beside it (`web/demo-site/`, copied in by
 * `vite.config.ts`). See `docs/demo.md`.
 *
 * **A literal at build time, and that is the whole contract.** Vite replaces
 * `import.meta.env.VITE_DEMO` with a string, so in every other build this is
 * `false` before the bundler ever sees it, and every `DEMO ? a : b` in the app
 * is folded to `b` — the owner's build is byte for byte what it was, with no
 * sample-notes chunk and not one of the demo's words in it.
 * `buildInvariants.test.ts` reads the bundle to hold that. Write every demo-only
 * line as `DEMO ? demoThing : ordinaryThing` (or `if (DEMO) …`), never as
 * `DEMO && thing` inside JSX, which leaves a `false` behind in the markup.
 */
export const DEMO: boolean = import.meta.env.VITE_DEMO === "1";

/**
 * The store's verbs, handed over from `App.tsx` on every render of a demo build
 * so that the empty Inbox's offer can reach them without a prop threaded through
 * every build. Only ever set under `if (DEMO)`, so the whole module drops out of
 * the owner's bundle along with the call.
 */
let store: SampleStore | null = null;

export function offerSampleStore(verbs: SampleStore): void {
  store = verbs;
}

/**
 * The sample set, into the store: the data and the loader are a chunk of their
 * own (`demo/sampleNotes.ts`), fetched on the click and never before. Answers
 * how many notes were written.
 */
export async function loadSamples(): Promise<number> {
  if (!store) return 0;
  const { loadSampleNotes } = await import("../demo/sampleNotes");
  return loadSampleNotes(store);
}

/**
 * The sample notes out again, to the trash and offered back (`removeSampleNotes`).
 * Answers how many notes were moved.
 */
export async function removeSamples(): Promise<number> {
  if (!store) return 0;
  const { removeSampleNotes } = await import("../demo/sampleNotes");
  return removeSampleNotes(store);
}
