// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The UI rulebook may not grow back (review 2026-10-13, EH-01).
 *
 * `web/CLAUDE.md` loads at the start of every session under `web/`. It had grown
 * to 2,287 lines of dated stories, and long rules get skimmed. It holds current
 * rules only; the story behind a rule goes in `docs/decisions/web-ui.md`.
 * The same move as `sourceCeilings.test.ts`: a number that fails the checks
 * when crossed. Raising one needs a written reason here. Lines alone can be
 * dodged by writing longer lines, so the size in bytes is capped too.
 */
const MAX_LINES = 500;
const MAX_BYTES = 64 * 1024;

const advice = (what: string) =>
  `web/CLAUDE.md is ${what}: stories, dates and was/now/why belong in docs/decisions/web-ui.md, not here.`;

describe("web/CLAUDE.md stays short", () => {
  const text = readFileSync(join(__dirname, "..", "..", "CLAUDE.md"), "utf8");

  it(`has at most ${MAX_LINES} lines`, () => {
    const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
    expect(lines, advice(`${lines} lines (limit ${MAX_LINES})`)).toBeLessThanOrEqual(MAX_LINES);
  });

  it(`is at most ${MAX_BYTES / 1024} KB`, () => {
    const bytes = Buffer.byteLength(text, "utf8");
    expect(bytes, advice(`${bytes} bytes (limit ${MAX_BYTES})`)).toBeLessThanOrEqual(MAX_BYTES);
  });
});
