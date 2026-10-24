import { describe, expect, it } from "vitest";
import { parseInline, plainInline } from "./inline";

/** The segments read back as text — the card draws them, it never joins them. */
const plainText = (src: string) => plainInline(src).map((seg) => seg.text).join("");
import { archiveBodies, REAL_ARCHIVE } from "../seed/archive";

/** The invariant the caret arithmetic rests on. */
function rebuild(src: string): string {
  return parseInline(src)
    .map((s) => s.text)
    .join("");
}

/** Every note in the real archive, as one flat list of strings. */
const archive: string[] = archiveBodies;

describe("parseInline", () => {
  it("reproduces the source exactly, whatever is in it", () => {
    const cases = [
      "",
      "plain words",
      "**bold**",
      "*italic*",
      "`code`",
      "a **b** c *d* e `f` g",
      "**unclosed",
      "* * *",
      "3*4*5",
      "a ** b",
      "``",
      "**",
      "*",
      "**bold with *italic* inside**",
      "see https://example.com/a and **https://example.com/b**",
      "star at end *",
      "*multi\nline*",
      "**a** **b** **c**",
      "trailing space inside * a *",
    ];
    for (const src of cases) expect(rebuild(src)).toBe(src);
  });

  it("reproduces every note in the real archive, character for character", () => {
    for (const body of archive) {
      // Line by line as well as whole, because a note is rendered a prose block
      // at a time and a mark must never reach across the break between two.
      expect(rebuild(body)).toBe(body);
      for (const line of body.split("\n")) expect(rebuild(line)).toBe(line);
    }
  });

  it("hides the delimiters and keeps them in the text", () => {
    const segs = parseInline("a **b** c");
    expect(segs.filter((s) => s.hidden).map((s) => s.text)).toEqual(["**", "**"]);
    const shown = segs.filter((s) => !s.hidden);
    expect(shown.find((s) => s.strong)?.text).toBe("b");
  });

  it("reads a lone star as a star", () => {
    // Six of these sit in the real archive as separators. A loose rule set
    // every one of them in italic and swallowed the line between them.
    expect(parseInline("* *").some((s) => s.em)).toBe(false);
    expect(parseInline("a * b * c").some((s) => s.em)).toBe(false);
  });

  it("leaves sums alone", () => {
    expect(parseInline("3*4*5").some((s) => s.em)).toBe(false);
  });

  it("never lets a mark cross a line break", () => {
    expect(parseInline("*one\ntwo*").some((s) => s.em)).toBe(false);
  });

  it("nests italic inside bold", () => {
    const segs = parseInline("**a *b* c**");
    const inner = segs.find((s) => s.em);
    expect(inner?.text).toBe("b");
    expect(inner?.strong).toBe(true);
  });

  it("takes a link inside emphasis and leaves one in code alone", () => {
    const bolded = parseInline("**https://example.com/x**").find((s) => s.href);
    expect(bolded?.strong).toBe(true);
    expect(parseInline("`https://example.com/x`").some((s) => s.href)).toBe(false);
  });

  it.runIf(REAL_ARCHIVE)("finds exactly what the real archive holds and no more", () => {
    // Nine notes carry marks, pasted in from elsewhere long before this could
    // draw them. These counts are the guard: a looser rule inflates them, and
    // 241 notes are what tells you it did.
    let strong = 0;
    let em = 0;
    let code = 0;
    for (const body of archive) {
      for (const seg of parseInline(body)) {
        if (seg.hidden) continue;
        if (seg.strong) strong++;
        if (seg.em) em++;
        if (seg.code) code++;
      }
    }
    expect({ strong, em, code }).toEqual({ strong: 121, em: 6, code: 16 });
  });

  it("never marks whitespace as emphasis anywhere in the archive", () => {
    for (const body of archive) {
      for (const seg of parseInline(body)) {
        if (seg.hidden) continue;
        if (seg.strong || seg.em || seg.code) expect(seg.text.trim()).not.toBe("");
      }
    }
  });
});

/**
 * `#word` used to be a hand-typed tag, detected structurally like `**bold**`
 * and `` `code` ``. Tagging is gone (see git history): a `#word` is now
 * ordinary text, and this file's only job left is to make sure removing that
 * detection didn't cost the round trip anything, including where a URL's own
 * `#fragment` sits right next to one.
 */
describe("parseInline and #word", () => {
  it("renders #word as plain text, not a segment of its own", () => {
    const segs = parseInline("remember #todo");
    expect(segs.every((s) => s.href === undefined)).toBe(true);
    expect(segs.map((s) => s.text).join("")).toBe("remember #todo");
  });

  it("still never confuses a URL's own #fragment with anything else", () => {
    const segs = parseInline("see https://example.com/page#section");
    const link = segs.find((s) => s.href);
    expect(link?.text).toBe("https://example.com/page#section");
  });

  it("reproduces every note in the real archive character for character", () => {
    for (const body of archive) expect(rebuild(body)).toBe(body);
  });
});

describe("plainInline", () => {
  it("drops the delimiters rather than hiding them", () => {
    expect(plainText("a **b** c")).toBe("a b c");
    expect(plainInline("a **b** c").some((s) => s.hidden)).toBe(false);
  });

  it("leaves text with no marks in it untouched", () => {
    for (const body of archive.slice(0, 60)) {
      if (!/[*`]/.test(body)) expect(plainText(body)).toBe(body);
    }
  });
});

// bughunt 2026-10-15: a long pasted line of unpaired marks froze the page for
// half a minute, searched to its end once per mark.
describe("a very long line of unpaired marks", () => {
  it("is read in one pass, not one pass per mark", () => {
    for (const unit of ["*a ", "`a ", "**a "]) {
      const line = unit.repeat(30_000);
      const started = performance.now();
      const segs = parseInline(line);
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(segs.map((s) => s.text).join("")).toBe(line);
    }
  });
});
