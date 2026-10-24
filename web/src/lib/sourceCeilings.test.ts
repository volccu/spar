// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The two biggest files may not grow (review 2026-10-13, EH-02).
 *
 * `App.tsx` was split to 4,374 lines on 2026-10-02 and stood at 4,931 six days
 * later: every clean-up was undone by the next feature landing in the file
 * that was already open. The same move as the entry chunk's ceiling in
 * `buildInvariants.test.ts`: a number that fails the checks when crossed.
 *
 * Set at the size each file had on 2026-10-13. **Lower a number whenever an
 * extraction makes the file smaller**, so the room it freed is not spent on the
 * next feature. Raising one needs a written reason here, as the bundle's does.
 */
const CEILINGS: { file: string; lines: number; hooks: number }[] = [
  { file: "App.tsx", lines: 4730, hooks: 134 },
  { file: "components/NoteView.tsx", lines: 2302, hooks: 61 },
];

/** React's own hooks called in the file: the state a component keeps. */
const HOOK = /\buse(State|Ref|Effect|LayoutEffect|Memo|Callback|Reducer)\b(<[^>]*>)?\(/g;

function measure(file: string): { lines: number; hooks: number } {
  const text = readFileSync(join(__dirname, "..", file), "utf8");
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return { lines, hooks: (text.match(HOOK) ?? []).length };
}

describe("the biggest files do not grow", () => {
  for (const { file, lines, hooks } of CEILINGS) {
    it(`${file} stays within ${lines} lines and ${hooks} hooks`, () => {
      const now = measure(file);
      const advice = `${file} has grown past its ceiling: put new work in its own file (a hook in lib/ or a component), not here.`;
      expect(now.lines, advice).toBeLessThanOrEqual(lines);
      expect(now.hooks, advice).toBeLessThanOrEqual(hooks);
    });
  }
});
