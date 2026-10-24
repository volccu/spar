import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStyles } from "../test/readStyles.node";
import { PHONE_MAX, SHORT_MAX } from "./breakpoint";

/**
 * One number in two languages.
 *
 * The app changes *shape* at 700px in the stylesheet (card lines, grid
 * columns, the dialog, the selection panel lying down as a strip) and changes
 * *structure* at the same width in JS — the board shelf is a tab strip above it
 * and a drawer behind a burger below it. Nothing but a comment connected the
 * two, which is the silent drift `lib/constants.test.ts` exists to catch
 * elsewhere: move one and there is a band of widths showing a burger with no
 * drawer rules behind it, or a tab strip laid out for a phone.
 *
 * Read in a plain Node environment, because `import.meta.url` is only a real
 * file URL outside jsdom — the same reason `styles.test.ts` is not a jsdom
 * test either.
 */
describe("the phone breakpoint", () => {
  const css = readStyles();

  it("is the same number in breakpoint.ts and in styles.css", () => {
    const below = [...css.matchAll(/@media \(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    const above = [...css.matchAll(/@media \(min-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]));

    expect(below.length, "the stylesheet should have a phone breakpoint").toBeGreaterThan(0);
    expect(above.length, "the stylesheet should have a desktop breakpoint").toBeGreaterThan(0);
    for (const px of below) expect(px).toBe(PHONE_MAX);
    for (const px of above) expect(px).toBe(PHONE_MAX + 1);
  });

  // The short screen is the other question asked in both languages: the
  // header folds into the board row there, and the row refuses the foot.
  it("asks the short-screen height with the same number in both", () => {
    const short = [...css.matchAll(/@media \(max-height:\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    expect(short.length, "the stylesheet should fold the header on a short screen").toBeGreaterThan(0);
    for (const px of short) expect(px).toBe(SHORT_MAX);
  });
});

/**
 * One question, one query.
 *
 * *Does this device have a hardware keyboard* was asked two ways: the drawn
 * shortcut hint read `(hover: hover) and (pointer: fine)` and the capture bar
 * read `(pointer: coarse)`, so the app held two definitions of the same fact
 * and they were free to disagree — the drift `markerOf`, `isLinkNote` and
 * `searchTerms` each exist as a single exported predicate to prevent. There is
 * now one predicate (`hasKeyboard` in `lib/hotkeys.ts`) and it owns the only
 * copy of the query string.
 *
 * The stylesheet is not covered by this and must not be: `(pointer: coarse)`
 * is still exactly the right thing for CSS to ask about a *pointer*, which is
 * what `styles.css` asks it about. What may not happen again is a second file
 * in TypeScript deciding for itself what a keyboard is.
 */
describe("the keyboard question", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      if (!/\.tsx?$/.test(entry.name)) return [];
      // A test may name a query in order to stub one; that is the test
      // describing the platform, not the app deciding what it is.
      if (/\.test\.tsx?$/.test(entry.name)) return [];
      return [full];
    });
  }

  /** Comments are stripped first: recalling the query a file used to ask is
   *  history, and history is the part of a comment worth keeping. What is
   *  being counted is the files that still *ask*. */
  function code(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  }

  it("is spelled in exactly one file", () => {
    const owner = path.join(root, "lib", "hotkeys.ts");
    for (const file of sources(root)) {
      const src = code(file);
      if (!src.includes("(pointer: coarse)") && !src.includes("(pointer: fine)")) continue;
      expect(file, `${path.relative(root, file)} asks about the pointer itself`).toBe(owner);
    }
  });
});
