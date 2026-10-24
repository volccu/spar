/**
 * The whole Heroicons outline set — **kept only for the marks folders chose
 * before Lucide** (2026-10-12). The Look sheet offers Lucide alone
 * (`lib/lucideSet.ts`), but a synced board may still carry `PaintBrushIcon` or
 * `BookOpenIcon`, and it must keep drawing exactly that. So this chunk is
 * fetched only when some board on the shelf wears a Heroicons name; a shelf of
 * Lucide marks never asks for it. Never delete it while a stored name could
 * still point into it — there is no migration that rewrites them.
 *
 * It is in a module of its own so the chunk has a name. `BoardLook.tsx`
 * reaches the set through a dynamic import, which Rollup answers by emitting a
 * separate chunk named after the module being imported — and the module being
 * imported was `@heroicons/react/24/outline/esm/index.js`, so the chunk came
 * out as `index-<hash>.js`, indistinguishable by name from the app's own entry
 * chunk. `buildInvariants.test.ts` checks for exactly one `index-*.js`
 * precisely so that a failure to split shows up as a failure; two files called
 * index broke that check while the split was in fact working, which is the
 * worst of both.
 *
 * Importing `./iconSet` instead names the chunk `iconSet-<hash>.js`, which the
 * same test can then assert is present and is *not* in the shell's precache —
 * the rule `lib/pdf.ts` follows for pdfjs.
 *
 * **Nothing may import this statically.** A static import anywhere puts 325
 * marks on the first paint and silently undoes the whole arrangement; the
 * board strip and every other mark in the app import their one glyph by its
 * own deep path (`Icons.tsx`), which is the rule in `web/CLAUDE.md`.
 */
export * from "@heroicons/react/24/outline";
