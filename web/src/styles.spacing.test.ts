import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STYLES_DIR } from "./test/readStyles.node";

/**
 * Space comes from the scale, and this keeps it from drifting further.
 *
 * DESIGN.md §8: "New and touched rules take their space from it; existing
 * values are not rewritten wholesale." So the px literals already in padding,
 * margin, gap and inset stay where they are — many are optical corrections
 * against a line box, or arithmetic on a 44px target — and this test is a
 * ratchet over them: each area file may hold exactly the count below, never
 * more. A new rule that needs space takes `var(--s-*)` or `var(--gutter)`;
 * one that truly needs a correction says so in a comment and raises its
 * file's number in the same commit, where a reviewer sees it. A count that
 * falls because a literal became a token is the point: lower the number.
 *
 * `0` and `1px` are not space (no gap, and a rule's own width), so they are not
 * counted. Found by the 2026-10-18 UX review (docs/audits/AUDIT-2026-10-18-ux.md).
 */
const SPACING_LITERALS: Record<string, number> = {
  "00-foundation.css": 0,
  "10-shell.css": 12,
  "20-boards-and-shortcuts.css": 34,
  "30-grid-and-card.css": 7,
  "40-canvas.css": 32,
  "50-card-faces-links-wall.css": 27,
  "60-capture.css": 7,
  "70-note-view-and-motion.css": 17,
  "75-note-reading.css": 14,
  "76-files-viewer-code.css": 55,
  "80-empty-mascot-selection.css": 27,
  "82-dialogs-and-undo.css": 19,
  "84-sync-signin-phone-shelf.css": 21,
  "88-sorter.css": 17,
  "90-about-and-settings.css": 9,
  "95-keep-import.css": 29,
  "99-hover-tip.css": 0,
};

const SPACE = /(?:^|[;{\s])(padding|margin|gap|row-gap|column-gap|inset)(?:-[a-z-]+)?\s*:\s*([^;{}]+);/g;

function spacingLiterals(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const [, property, value] of bare.matchAll(SPACE)) {
    for (const [px, n] of value.replace(/var\([^)]*\)/g, "").matchAll(/-?(\d+(?:\.\d+)?)px/g)) {
      if (n !== "0" && n !== "1") found.push(`${property}: ${px}`);
    }
  }
  return found;
}

describe("spacing literals", () => {
  const files = readdirSync(STYLES_DIR).filter((f) => f.endsWith(".css")).sort();

  it("names every area file, so a new one starts from the scale", () => {
    expect(files).toEqual(Object.keys(SPACING_LITERALS).sort());
  });

  for (const file of files) {
    it(`${file} holds no more px space than it did`, () => {
      const found = spacingLiterals(readFileSync(path.join(STYLES_DIR, file), "utf8"));
      expect(
        found.length,
        `${file}: take new space from --s-1…--s-8 or --gutter; if a count fell, lower it here`,
      ).toBe(SPACING_LITERALS[file]);
    });
  }
});
