import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The stylesheet, whole, for the tests that read it as text.
 *
 * `styles.css` is only an entry now: a comment and one `@import` per area file
 * under `styles/`, in cascade order. Vite inlines those imports when it builds,
 * and this does the same by hand, so a test that looks for a rule, a token or a
 * duration in "the stylesheet" sees the same text it saw when the stylesheet
 * was one file. The imported files are concatenated in import order and
 * nothing else is added: the entry's own comment is left out. A test that
 * wants the stylesheet imports this and never opens `styles.css` itself.
 *
 * It reads with `node:fs`, which the web build has no types for, so
 * `tsconfig.json` leaves `*.node.ts` out of `tsc -b`, as it does the tests.
 * Vitest's own `?raw` import is no way round that: it hands back an empty
 * string for a `.css` file, since Vitest does not process stylesheets.
 */
const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY_PATH = path.join(SRC_DIR, "styles.css");
export const STYLES_DIR = path.join(SRC_DIR, "styles");

const IMPORT = /@import\s+(?:url\()?["']([^"']+)["']\)?[^;]*;/g;

/** Every `@import "...";` in a stylesheet, in order, comments ignored. */
export function importsOf(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(IMPORT)].map((m) => m[1]);
}

/** One file with each of its @imports replaced, where it stands, by that file inlined. */
function inlineIn(css: string, file: string, seen: string[]): string {
  return css.replace(IMPORT, (_all, spec: string) => inlineFile(path.resolve(path.dirname(file), spec), seen));
}

function inlineFile(file: string, seen: string[]): string {
  seen.push(file);
  return inlineIn(readFileSync(file, "utf8"), file, seen);
}

/** The entry contributes only what it imports: its comment is not stylesheet. */
function inlineEntry(seen: string[]): string {
  return importsOf(readFileSync(ENTRY_PATH, "utf8"))
    .map((spec) => inlineFile(path.resolve(path.dirname(ENTRY_PATH), spec), seen))
    .join("");
}

/** The whole stylesheet: every imported file, in order, imports inlined. */
export function readStyles(): string {
  return inlineEntry([]);
}

/** The entry file's own text (its comment and its imports). */
export function readStylesEntry(): string {
  return readFileSync(ENTRY_PATH, "utf8");
}

/** The area files the entry reaches, as absolute paths, in import order. */
export function importedStyleFiles(): string[] {
  const seen: string[] = [];
  inlineEntry(seen);
  return seen;
}

/** The area files that exist in `styles/`, as absolute paths, sorted. */
export function existingStyleFiles(): string[] {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort()
    .map((name) => path.join(STYLES_DIR, name));
}
