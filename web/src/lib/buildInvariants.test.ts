// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

/**
 * The build invariants web/CLAUDE.md states in prose, held by a test.
 *
 * All three used to be enforced by a human reading `npm run build`'s output,
 * and one of them drifted 51 kB between two audits without anyone noticing.
 * The whole file stands down when dist/ is absent — `npm run test:web` must
 * never require a build — so these only bite after `npm run build:web`,
 * which is exactly when the numbers they guard come into existence.
 */

const DIST = join(__dirname, "..", "..", "dist");
const ASSETS = join(DIST, "assets");
const built = existsSync(join(DIST, "sw.js")) && existsSync(ASSETS);

/**
 * Measured 126.2 kB gzipped on 2026-08-19, immediately after
 * `@supabase/supabase-js` moved behind a dynamic import (its chunk is the
 * separate supabase-*.js below). The ceiling leaves room for ordinary growth
 * and none for another dependency of that size landing on the first paint:
 * crossing it means either a real argument for the weight, written here, or
 * the new dependency following supabase behind a dynamic import.
 *
 * Raised to 155 on 2026-09-17, by exactly that route. Ordinary growth had
 * spent all the room: the committed build stood at 149.99 kB, 8 bytes under,
 * so a 60-byte bug fix (a long note jumping when tapped into) could not land
 * without shaving unrelated code to pay for it. Nothing heavy arrived — every
 * byte of the 24 kB since August is features. 5 kB is still a tenth of what
 * the supabase client weighs, so the thing this line exists to catch is caught
 * as surely as before.
 *
 * Raised to 156 on 2026-09-27, for the Google Keep import, and the argument is
 * where the weight went. The importer itself — the zip reader, the Keep parser,
 * the labels screen, its undo — is 19 kB behind a dynamic import
 * (`KeepImport-*.js`), exactly as this line asks. What the first paint carries
 * is only what cannot follow it there: the menu row and the empty Inbox's offer
 * that open it, the store's chunked write (`importNotes`, beside every other
 * write in `useNotes`) and the shelf's one-change edit. That measured 0.52 kB
 * gzipped, against 0.27 left under 155 (154.73 before, 155.25 after). The
 * alternative was shaving unrelated code to pay for it, which the 155 paragraph
 * above already turned down.
 *
 * Raised to 157 on 2026-09-29, for the mascot being one creature (the owner's
 * ask: the header's goes away in a puff of smoke while the empty board draws
 * it, and comes home the same way). None of it can follow a dynamic import:
 * the header has to be gone in the same frame the sleeping one appears, and
 * the app opens onto an empty Inbox — the state the whole Inbox exists to
 * reach — more often than onto anything else. What it costs is the element's
 * own presence rule, its smoke and the markup for six puffs, all inside the
 * custom element the first paint already carries: 1.20 kB gzipped, 155.17
 * before and 156.37 after, most of it the build lowering the element's private
 * fields to WeakMap helpers. Its CSS comment was moved out of the shipped style
 * string on the way in; nothing else was worth making less clear to save.
 *
 * Raised to 157 on 2026-09-29, for carrying a board along the shelf, on the
 * same terms. The carry itself — measuring the run, drawing the board and the
 * gap under the finger, the edge-scroll, the settle — is 1.2 kB behind a
 * dynamic import (`shelfCarry-*.js`), asked for the moment a movable tab goes
 * down and in hand long before the hold completes. What stays on the first
 * paint is what has to answer the pointer before anything could load: the
 * hold that tells a tap from a scroll from a pick-up (`useBoardPress`), the
 * shelf's two runs and the lens order (`lib/boards.ts`), and the store's half
 * of writing it. That measured 1.37 kB gzipped against 0.83 left under 156
 * (155.17 before, 156.54 after).
 *
 * Both landed together with the phone capture bar's two rows (whose
 * visible-height hook has to be on the first paint, since the bar is), so
 * the raises above are one step, to 159: the mascot's 1.20, the carry's 1.37
 * and the bar's ~0.4 do not fit under 157 side by side. Measured 158.13
 * gzipped with all three in (155.17 before any of them).
 *
 * Raised to 162 on 2026-10-01 for review rounds 3–7 together (owner
 * approved), each round built side by side from 158.62 and measured alone
 * there. Round 3, the shelf (UX-04, UI-15, UX-16): the desktop strip's count
 * of hidden boards and its sideways wheel, and a folder's menu hanging under
 * its tab with the board named on its first line (159.66 alone, +1.04). The
 * cards round: a card's spoken name built from what it shows
 * (`lib/cardName.ts`), the Reminders list's ring time (`ringMark`) and the
 * Links row that is as tall as it needs to be (159.30 alone). Round 6: the
 * to-do mark making a list to tick (UX-05), a plural finding its singular
 * (UX-27), the selection's verbs at the pointer on a right-click (UX-11), and
 * the few lines that tell the canvas a merge is fresh (UX-26); the one piece
 * that could wait, fitting a fresh merge to the screen, lives in
 * `lib/canvasFit.ts`, read only by the canvas's own chunk (159.28 alone).
 * Rounds 4–7 together measured 160.68 (r4 +0.68, r5 +0.34, r6 +0.78, r7
 * +0.25). All of it is the strip, the board, the bar or a menu answering a
 * pointer on the first screen, so none of it can follow a dynamic import.
 * Measured 161.85 gzipped with rounds 3–7 all in.
 *
 * Raised to 163.5 on 2026-10-01 for review round 9 (PL-10, owner approved):
 * splitting `App.tsx` into hooks, which adds no behaviour and no dependency.
 * What it costs is the seams themselves — a hook's options and its returned
 * values are object keys the minifier cannot shorten, written once on each
 * side. The first move (`store/useReminders.ts`) measured 161.85 before and
 * 162.03 after; all nine of the round's moves together measured 163.12.
 *
 * Raised to 164.5 on 2026-10-05 for two of the owner's asks of that day: the
 * capture bar saying "Saved … · Open" for a note whose whole text is already
 * saved (`textKey` in `lib/savedLinks.ts`), and a folder's Keep screen on
 * switch (`setBoardAwake`/`keepsScreenOn`, its row and mark in `BoardMenu`,
 * the wake lock held from `App`). Both answer on the first screen — the bar
 * per keystroke, the menu on a hold — so neither can follow a dynamic import.
 * Measured 163.36 before and 163.90 after.
 *
 * Raised to 165.5 on 2026-10-05 for review round 3 (owner approved): the write
 * bar's fourth mark, the reminder clock and its four presets (FX-B-06), and a
 * share or bookmark's words waiting in the field (FX-A-02, FX-A-03). All of it
 * answers on the first screen, in the bar. Measured 164.62 with the round in.
 *
 * Raised to 165.5 on 2026-10-05 for review round 5 (owner approved): the Links row's
 * site link, the folder's own mark and the write-bar cap on a grown card, the
 * short-screen header, the idea card's opening line and the strip's tablist
 * structure — all on the first screen. Measured 163.90 before and 164.95 after.
 */
/*
 * Raised to 169 on 2026-10-05 for review rounds 1–6 of 2026-10-04 together
 * (owner approved the work): each round's own raise to 165.5 was measured
 * alone; merged, the first screen holds all of them. Measured 166.44 with
 * rounds 1, 2, 3 and 5 in; rounds 4 and 6 added their own
 * (CD-01, UX-B-02, QA-06: plain sentences, Go offers, the signed-out notice).
 *
 * Raised to 170 on 2026-10-08 for review rounds 7–9 of 2026-10-04 merged
 * (owner approved the work): Tidy up's reminder wiring in `App` (FX-B-01) and
 * the idle starter for reading words in pictures (FX-A-07, beside the PDF
 * reader's; the engine itself is a chunk of its own). Measured 168.46 before
 * and 169.01 after. The open note's right-click menu is not in it — `NoteView`
 * is already a lazy chunk.
 *
 * Raised to 172 on 2026-10-08: Inspiration board model and shelf seat (owner
 * approved 2026-10-08) — the board's model in `lib/boards.ts` and the hook, its drawn
 * mark, and the shelf's wiring in `App`. The first screen draws the shelf, so
 * all of it is on the first paint.
 *
 * Raised to 173 on 2026-10-08: Inspiration wall pictures (owner approved 2026-10-08) —
 * the sized shrink in `lib/files.ts`, the wall's one re-ask in `needsUnfurl`
 * and the unfurl hook's wall-size write, all of which the first paint already
 * carries (the unfurl runs on open). Measured 171.89 before and 172.31 after.
 *
 * Raised to 173.1 on 2026-10-09 (owner approved 2026-10-09): the black-wall fix —
 * the empty-canvas check in `lib/files.ts` and the once-only re-ask of the
 * pictures it had let through. Measured 172.87 before and 172.95 after on the
 * PC; the server's own build of the same commit comes out about 0.07 larger
 * (173.05 against 172.98), so the PC's figure is not the one that decides.
 *
 * Raised to 174.4 on 2026-10-10 for audit round r3 (owner approved the work):
 * pictures and files — the refused-upload memory and its row (BUG-2), the
 * orphan removal of a late upload (BUG-4), the wall's one shown link (BUG-7),
 * the black-window drop (BUG-9), the folder sweep on a confirmed delete
 * (DATA-5), the size-capped upsert batches (DATA-10). All of it runs in the
 * sync and the unfurl, which start on open. Measured 172.90 before and 174.06
 * after on the PC. PERF-7 (another round) is the one that makes room for good.
 *
 * Set to 175.2 on 2026-10-10 (audit PERF-7, owner approved): the ceiling had
 * been raised eight times since 2026-10-05 and stood a few tenths above what
 * was built, so any first-screen addition failed the deploy. The menu, the
 * selection's verbs and a board's own menu — drawn only after a gesture — now
 * follow a dynamic import, prefetched at idle (`components/lazyPanels.tsx`),
 * which took 1.48 off the entry chunk (173.19 to 171.71 on round r4 alone).
 * Measured 173.23 on the PC with rounds r1, r2, r3 and r5 merged in; the line
 * is set about 2 KiB above that so ordinary growth has room again, and the
 * server's build comes out slightly larger than the PC's (see the 173.1 note
 * above).
 * Measured over the entry *and* every file `index.html` preloads beside it
 * since 2026-10-11 (audit CODE-10, Vite 8): Rolldown keeps its module runtime
 * in a file of its own (`rolldown-runtime-*.js`, 0.7 kB gzipped), and a first
 * paint split across files would otherwise pass this line by getting smaller.
 * Vite 8's minifier made the entry itself smaller: 164.69 kB with the runtime
 * beside it at 0.69, against 174.16 for the same code under Vite 6.
 * Set to 166.5 on 2026-10-11 when both landed together: 164.38 measured on the
 * PC (entry 163.68 + runtime 0.69) with every 2026-10-10 audit round merged —
 * the same ~2 KiB of room PERF-7 asked for, over the new measure. Left at 175.2
 * it would have let the first paint grow by ten unnoticed.
 * Round r6 (SEC-1's held file share, UX-11's sign-in code, both on the first
 * screen) added about half a kilobyte on top, under the same 166.5.
 * Set to 168.9 on 2026-10-11 for audit round r7 (CODE-6): one table for Back,
 * Escape and inert, and the folder and idea verbs moved into hooks of their own,
 * cost 1.54 on the first paint (165.34 before, 166.88 after, PC) — wiring, not
 * features, and the price of Back and Escape never disagreeing again. ~2 KiB of
 * room kept, as PERF-7 asked.
 * Raised to 169.5 the same day for Settings (the owner approved the work:
 * the screen, the light theme, the phone's board row at the foot). What they add
 * to the first paint is what has to run before or beside the first render:
 * this device's settings and the theme put on the document (`lib/settings.ts`,
 * `lib/theme.ts`), the Reduced motion check, the board row's placement in
 * `App`, the bar's height for it, and Settings' props and the sign-out moved
 * out of the menu. The screen itself is a lazy chunk, as About is. Measured
 * 167.50 on the PC with all three merged; set about 2 KiB above that, the
 * room PERF-7 asked for, and the server builds about 0.07 larger.
 * Raised to 171.6 on 2026-10-12 for the owner's batch: the Settings cog in the
 * header, a picked file waiting on the capture bar for Save, the Back hook
 * reading where history really stands, the varied poof, and the Lucide marks'
 * small first-paint stub (the sets themselves stay lazy). Measured 169.59 on
 * the PC with all five merged; ~2 KiB of room kept, as PERF-7 asked.
 * Raised to 175.3 on 2026-10-14 for the owner's joy picks, every one of which
 * is on the first paint by nature: the counts that turn (`Count`), the lit
 * tab's cold-open light, the first deal, the pen on every tick box, the print
 * on every picture, the robot tapping along and waking, the write box's words,
 * Tidy up's pile edge and report. Measured 173.25 on the PC with all of them
 * merged; ~2 KiB of room kept, as PERF-7 asked.
 * Raised to 177.3 on 2026-10-15 for the two bughunt passes, which are fixes in
 * code that runs on open by nature: sync, the outbox, the store's writes, the
 * capture bar, the dialog, sign-in, every request's deadline. Measured 175.21 on
 * the PC (the server built 175.39 and refused the deploy); ~2 KiB of room kept.
 * Raised to 179.3 on 2026-10-16 for the creature's speech bubble (owner
 * approved), which stands in the header and so is on the first paint by nature:
 * the bubble, what it says and when, and the turned faces. Measured 177.30 on
 * the PC with it merged; ~2 KiB of room kept, as PERF-7 asked.
 * Raised to 181.2 the same evening for the day's fixes on the open note and
 * the cards (owner asked): a code block that starts where the code does and
 * wraps a selection, and a row of pictures that slides. Both draw on open.
 * Measured 179.19 on the PC (the server built 179.37 and refused the deploy);
 * ~2 KiB of room kept.
 * Raised to 185.1 on 2026-10-17 (owner approved) for the robot's eleven
 * moments, which answer things done on the board and so load with it. The
 * hover hint that went up beside them is a chunk of its own and adds nothing.
 * Measured 183.10 on the server; ~2 KiB of room kept.
 * Raised to 187.6 on 2026-10-19 for the dogfooding fixes (owner approved), all
 * on paths that run with the board: the Move chooser's top match and arrows,
 * Ctrl+Z saying what it undid, focus handed back, a move naming its board, a
 * named board opening, the drop cue on the open note. Measured 185.62 on the
 * server, which refused the deploy; ~2 KiB of room kept.
 * Raised to 190.7 on 2026-10-23 for the owner's six asks, on paths that run with
 * the board: carrying notes on to the shelf (the merge drag's third target, the
 * drop rules, the strip's lit and dimmed tabs), the sync knowing a phone is
 * offline when it says it is not, Tidy up's Open, the robot growing in. The
 * weather and the phone's drop drawer are chunks of their own. Measured 188.50
 * on the PC; ~2 KiB of room kept, as PERF-7 asked.
 */
const INDEX_GZIP_CEILING_KB = 190.7;

const jsChunks = () =>
  readdirSync(ASSETS).filter((name) => name.endsWith(".js") || name.endsWith(".mjs"));

/**
 * The URLs the generated worker precaches. The worker also *mentions* pdf in
 * its runtime-caching rule — that rule is how the viewer gets cached on first
 * use — so the test reads the manifest entries, never the whole file.
 */
const precached = () => {
  const sw = readFileSync(join(DIST, "sw.js"), "utf8");
  return [...sw.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((m) => m[1]);
};

describe("build invariants", () => {
  it.runIf(built)("keeps the PDF viewer in its own chunk", () => {
    // Nothing on the 90% path may reach lib/pdf.ts (web/CLAUDE.md): the
    // dynamic import only splits while nothing else imports pdfjs statically.
    expect(jsChunks().some((name) => /^pdf-.+\.js$/.test(name))).toBe(true);
  });

  it.runIf(built)("keeps the PDF viewer out of the shell's precache", () => {
    const urls = precached();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes("pdf-") || url.includes("pdf.worker"))).toBe(false);
  });

  it.runIf(built)("keeps the picture-reading engine in its own chunk and out of the precache", () => {
    // FX-A-07. Ten megabytes a device fetches only if it holds a picture to
    // read: the library is a chunk of its own, and neither it nor anything under
    // /ocr/ may ride in the shell's cache (the runtime rule keeps them once used).
    expect(jsChunks().some((name) => /^tesseract-.+\.js$/.test(name))).toBe(true);
    const urls = precached();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((url) => url.includes("tesseract") || url.includes("ocr/"))).toBe(false);
    for (const file of ["worker.min.js", "eng.traineddata.gz", "fin.traineddata.gz"]) {
      expect(existsSync(join(DIST, "ocr", file))).toBe(true);
    }
  });

  it.runIf(built)("names the picture-reading engine's cache for the versions it holds", () => {
    // The /ocr/ files are not hashed, so the cache-first rule's name is what
    // makes a device drop an old engine: `ocrCacheName` in vite.config.ts
    // hashes the four package versions, and this recomputes it the same way.
    const packages = ["tesseract.js", "tesseract.js-core", "@tesseract.js-data/eng", "@tesseract.js-data/fin"];
    const versions = packages.map((name) => {
      const manifest = join(__dirname, "..", "..", "node_modules", name, "package.json");
      return `${name}@${(JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version}`;
    });
    const expected = `ocr-engine-${createHash("sha256").update(versions.join("\n")).digest("hex").slice(0, 8)}`;
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(sw.match(/ocr-engine-[0-9a-z]+/g) ?? []).toEqual([expected]);
  });

  it.runIf(built)("keeps the sync client split out, and still installable offline", () => {
    // Split: the supabase chunk exists and the entry chunk is the only
    // index-*.js — un-split, the client lands back inside it silently.
    expect(jsChunks().some((name) => /^supabase-.+\.js$/.test(name))).toBe(true);
    // Precached: unlike the PDF viewer, sign-in must work offline, so the
    // chunk rides in the shell's cache even though it loads on demand.
    expect(precached().some((url) => url.includes("supabase-"))).toBe(true);
  });

  // The three icon chunks: Lucide's drawings, its search words, and the older
  // Heroicons set kept for the marks folders chose before Lucide.
  const ICON_CHUNKS = ["lucideSet", "markSearch", "iconSet"];

  it.runIf(built)("keeps the icon sets in chunks of their own, off the first paint", () => {
    // web/CLAUDE.md: marks are imported one component at a time, never the
    // barrel — the barrel pulls a whole set and the build stops tree-shaking.
    // The board-look picker is the one place that genuinely needs a set, and
    // it reaches each the way lib/pdf.ts reaches pdfjs: a dynamic import, in a
    // chunk of its own, off every path but the one that asks for it. Un-split,
    // a whole set lands back inside the entry chunk silently — the gzip ceiling
    // below would catch it eventually, but not with a message that says why.
    //
    // Each chunk is named by its `lib/` file existing at all: Rollup names a
    // dynamic chunk after the module it imports, and Heroicons' own barrel is
    // `index.js` — which came out as a second `index-*.js` and broke the
    // "exactly one entry chunk" check below while the split was working fine.
    for (const chunk of ICON_CHUNKS) {
      expect(jsChunks().some((name) => name.startsWith(`${chunk}-`) && name.endsWith(".js")), chunk).toBe(true);
    }
    // And the entry carries none of their data: Lucide names that appear in
    // the drawings, the tags and the synonym list alike.
    const entry = jsChunks().find((name) => /^index-.+\.js$/.test(name))!;
    const code = readFileSync(join(ASSETS, entry), "utf8");
    expect(code).not.toContain("gamepad-2");
    expect(code).not.toContain("fishing-rod");
  });

  it.runIf(built)("keeps the icon sets out of the shell's precache", () => {
    // Unlike the sync client, dressing a board is not something that has to
    // work on a plane the first time it is ever asked for. The chunks are
    // fetched on demand and cached by using them, like the PDF viewer.
    for (const chunk of ICON_CHUNKS) {
      expect(precached().some((url) => url.includes(`${chunk}-`)), chunk).toBe(false);
    }
  });

  it.runIf(built)("keeps the open note split out, and still openable offline", () => {
    // `App.tsx` reaches `NoteView` through `lazy` and fetches it at idle after
    // the first paint. A static import of it anywhere puts the editor, the
    // insert panel and the picture viewer back on the first paint, silently.
    expect(jsChunks().some((name) => /^NoteView-.+\.js$/.test(name))).toBe(true);
    // And, like the sync client, it rides in the shell's cache: opening a
    // note is the 90% path and must work on a plane.
    expect(precached().some((url) => url.includes("NoteView-"))).toBe(true);
  });

  it.runIf(built && process.env.VITE_RUNTIME_CONFIG !== "1")(
    "carries no runtime configuration into a build with its values baked in",
    () => {
      // The owner's build answers from its own variables and never asks the
      // server for `/config.json` (store/backend/config.ts). `RUNTIME_CONFIG`
      // is a literal there, so the loader, the spår server backend and its
      // password form are dropped from the bundle entirely — present, they
      // would be a fetch waiting for a code path to reach it.
      const chunks = jsChunks();
      expect(chunks.some((name) => /^(sparServerBackend|PasswordSignIn)-/.test(name))).toBe(false);
      for (const name of chunks) {
        const code = readFileSync(join(ASSETS, name), "utf8");
        expect(code).not.toContain("/config.json");
        // Nor the spår server's own traces: its event stream, and the session
        // marker `hasStoredSession` reads only behind `RUNTIME_CONFIG`.
        expect(code).not.toContain("/api/events");
        expect(code).not.toContain("spar.server-session");
      }
    },
  );

  it.runIf(built)("keeps the Supabase backend in the client's chunk, off the first paint", () => {
    // `store/backend/supabaseBackend.ts` holds the store's query code and is
    // reached by a dynamic import once the client exists; `codeSplitting` puts
    // it beside the client so it costs no request of its own. The channel name
    // is a string only it spells.
    const entry = jsChunks().find((name) => /^index-.+\.js$/.test(name))!;
    const client = jsChunks().find((name) => /^supabase-.+\.js$/.test(name))!;
    expect(readFileSync(join(ASSETS, entry), "utf8")).not.toContain("notes-changes");
    expect(readFileSync(join(ASSETS, client), "utf8")).toContain("notes-changes");
  });

  it.runIf(built)("carries nothing of the public demo", () => {
    // `DEMO` (lib/demo.ts) is a literal false in this build, so the sample
    // notes' chunk is never emitted and every demo sentence is folded away —
    // the demo's differences may cost this build nothing at all. The strings
    // are the demo's own words, one from each place it speaks.
    const chunks = jsChunks();
    expect(chunks.some((name) => /^sampleNotes-/.test(name))).toBe(false);
    for (const name of chunks) {
      const code = readFileSync(join(ASSETS, name), "utf8");
      for (const words of ["Try it with sample notes", "this browser only", "the demo has none", "Lisbon in May", "Keep using spår"]) {
        expect(code, `${name} says "${words}"`).not.toContain(words);
      }
    }
    // And none of the static host's files either: nginx serves this build.
    for (const file of ["_headers", "privacy.html", "404.html"]) {
      expect(existsSync(join(DIST, file))).toBe(false);
    }
  });

  it.runIf(built)("holds the first paint's bundle under its ceiling", () => {
    const entries = jsChunks().filter((name) => /^index-.+\.js$/.test(name));
    expect(entries).toHaveLength(1);
    expect(firstPaint(DIST)).toEqual([`assets/${entries[0]}`, ...preloads(DIST)]);
    expect(firstPaintGzipKb(DIST)).toBeLessThan(INDEX_GZIP_CEILING_KB);
  });

  it.runIf(built)("loads the first paint from one file and the bundler's runtime", () => {
    // Vite 8's bundler (Rolldown) gives every set of modules shared between
    // the first paint and a lazy chunk a small file of its own unless
    // vite.config.ts gathers them back into the entry (`codeSplitting`). Left
    // to it, the first paint was twenty-three files, and `lib/pdf.ts` among them
    // under a `pdf-*` name the precache leaves out — an app that would not
    // open offline. The one file allowed beside the entry is Rolldown's runtime.
    expect(preloads(DIST).every((url) => /^assets\/rolldown-runtime-.+\.js$/.test(url))).toBe(true);
    // And everything the first paint loads is in the shell's cache.
    const urls = precached();
    for (const url of firstPaint(DIST)) expect(urls, url).toContain(url);
  });

  it.runIf(built)("precaches the theme's boot script, which the head waits on", () => {
    // public/theme-boot.js is a synchronous <script src> (the CSP allows no
    // inline one), so the page waits for it; an installed app must have it
    // offline, or it would open on the browser's error page instead.
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).toContain('<script src="/theme-boot.js"></script>');
    expect(existsSync(join(DIST, "theme-boot.js"))).toBe(true);
    expect(precached()).toContain("theme-boot.js");
  });

  it.runIf(built)("writes no chunk that nothing loads", () => {
    // `foldedImports` in vite.config.ts: a dynamic import in a branch the
    // build folds away still leaves its chunk behind under Rolldown, and the
    // precache would carry it to every device. Every chunk but the entry is
    // named somewhere in another file.
    const chunks = jsChunks().filter((name) => name.endsWith(".js"));
    const texts = chunks.map((name) => readFileSync(join(ASSETS, name), "utf8"));
    texts.push(readFileSync(join(DIST, "index.html"), "utf8"));
    for (const name of chunks) {
      if (/^index-.+\.js$/.test(name)) continue;
      const own = readFileSync(join(ASSETS, name), "utf8");
      expect(texts.some((text) => text !== own && text.includes(name)), name).toBe(true);
    }
  });
});

/** The module script `index.html` starts, then the files it preloads beside it. */
function firstPaint(dist: string): string[] {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  const entry = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"/g)].map((m) => m[1]);
  return [...entry, ...preloads(dist)];
}

function preloads(dist: string): string[] {
  const html = readFileSync(join(dist, "index.html"), "utf8");
  return [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map((m) => m[1]);
}

/** Each file gzipped on its own, as the browser fetches them, and summed. */
function firstPaintGzipKb(dist: string): number {
  return firstPaint(dist).reduce((sum, url) => sum + gzipSync(readFileSync(join(dist, url))).length, 0) / 1024;
}

/**
 * The public demo (`npm run build:demo`, into dist-demo/). Stands down when it
 * has not been built, like the block above.
 */
const DEMO_DIST = join(__dirname, "..", "..", "dist-demo");
const DEMO_ASSETS = join(DEMO_DIST, "assets");
const demoBuilt = existsSync(join(DEMO_DIST, "sw.js")) && existsSync(DEMO_ASSETS);
const demoChunks = () =>
  readdirSync(DEMO_ASSETS).filter((name) => name.endsWith(".js") || name.endsWith(".mjs"));

describe("the demo's build", () => {
  it.runIf(demoBuilt)("keeps the sample notes in a chunk of their own, off the first paint", () => {
    const chunks = demoChunks();
    const samples = chunks.find((name) => /^sampleNotes-.+\.js$/.test(name));
    expect(samples).toBeDefined();
    expect(readFileSync(join(DEMO_ASSETS, samples!), "utf8")).toContain("Lisbon in May");
    const entry = chunks.filter((name) => /^index-.+\.js$/.test(name));
    expect(entry).toHaveLength(1);
    const code = readFileSync(join(DEMO_ASSETS, entry[0]), "utf8");
    // The offer is on the first paint; the forty notes behind it are not.
    expect(code).toContain("Try it with sample notes");
    expect(code).not.toContain("Lisbon in May");
    expect(preloads(DEMO_DIST).every((url) => /^assets\/rolldown-runtime-.+\.js$/.test(url))).toBe(true);
    expect(firstPaintGzipKb(DEMO_DIST)).toBeLessThan(INDEX_GZIP_CEILING_KB);
  });

  it.runIf(demoBuilt)("carries no server: no client, no backend, no project, no /config.json", () => {
    const chunks = demoChunks();
    expect(chunks.some((name) => /^(supabase|sparServerBackend|PasswordSignIn)-/.test(name))).toBe(false);
    for (const name of chunks) {
      const code = readFileSync(join(DEMO_ASSETS, name), "utf8");
      for (const words of ["supabase.co", "notes-changes", "/config.json"]) {
        expect(code, `${name} mentions ${words}`).not.toContain(words);
      }
    }
  });

  it.runIf(demoBuilt)("ships the host's headers, its privacy page and a real 404", () => {
    const headers = readFileSync(join(DEMO_DIST, "_headers"), "utf8");
    expect(headers).toMatch(/connect-src 'self';/);
    expect(existsSync(join(DEMO_DIST, "privacy.html"))).toBe(true);
    expect(existsSync(join(DEMO_DIST, "404.html"))).toBe(true);
    // Precached, so the privacy page opens offline and is never answered with
    // the app's shell by the service worker's navigation fallback.
    const sw = readFileSync(join(DEMO_DIST, "sw.js"), "utf8");
    expect(sw).toMatch(/["']?url["']?\s*:\s*["']privacy\.html["']/);
  });

  it.runIf(demoBuilt)("ships its share picture, named by its full address (review PS-02)", () => {
    expect(existsSync(join(DEMO_DIST, "og.png"))).toBe(true);
    const html = readFileSync(join(DEMO_DIST, "index.html"), "utf8");
    expect(html).toContain('<meta property="og:image" content="https://spar.willemaki.com/og.png" />');
    expect(html).toContain('<meta name="twitter:image" content="https://spar.willemaki.com/og.png" />');
  });
});
