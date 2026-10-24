import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENTER, EXIT, NAV_MARK_MS, NUDGE } from "./lib/motion";
import { readStyles } from "./test/readStyles.node";

/**
 * The design system, enforced.
 *
 * `DESIGN.md` is the source of truth for everything the app looks like, and
 * until this file existed it was a document that asked nicely. A stylesheet is
 * where a design system actually lives or quietly dies: one hardcoded hex, one
 * `prefers-color-scheme` branch, one seventh font size, and the next person
 * reads the file rather than the doc and copies what is there.
 *
 * So the rules that can be checked mechanically are checked here. Each one is a
 * line in DESIGN.md; if a rule below ever needs relaxing, the doc is what
 * changes first and this file follows it, never the other way round.
 *
 * Everything is read from the source stylesheet with comments stripped, since
 * the comments discuss the very values they are not allowed to contain.
 */

// Carriage returns are stripped because several assertions look for a selector
// written across more than one line, joined here with "\n". The Windows
// checkout has core.autocrlf=true and hands this file over with CRLF, so those
// searches found nothing there while passing on the Linux server — the same
// commit, red on one machine and green on the other.
const source = readStyles().replace(/\r\n/g, "\n");

/** Comments explain the forbidden values, so they can never be scanned. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The two token blocks: `:root`, the dark ramp and every other token, and the
 * light ramp straight after it, which restates the colour tokens for a device
 * that chose light (DESIGN.md §2, "The light ramp"; 2026-10-11, owner
 * approved). Neither holds a nested brace — the cursors' data URIs are
 * URL-encoded — so each ends at its first `}`.
 */
const LIGHT_SELECTOR = ':root[data-theme="light"] {';

function blockAt(start: number): string {
  return code.slice(start, code.indexOf("}", start) + 1);
}

const darkBlock = (() => {
  const start = code.indexOf(":root {");
  expect(start, "styles.css must declare a :root token block").toBeGreaterThan(-1);
  return blockAt(start);
})();

const lightBlock = (() => {
  const start = code.indexOf(LIGHT_SELECTOR);
  expect(start, "styles.css must declare the light ramp's token block").toBeGreaterThan(-1);
  return blockAt(start);
})();

/** The two ramps, for every rule that has to hold on both. */
const RAMPS = [
  { theme: "dark", block: darkBlock },
  { theme: "light", block: lightBlock },
] as const;

/**
 * Everything after the token blocks. They are the one place a literal value is
 * allowed to appear, because they are the place they are all defined.
 */
const afterTokens = (() => {
  const rest = code.slice(code.indexOf(darkBlock) + darkBlock.length);
  expect(rest.trimStart().startsWith(LIGHT_SELECTOR), "the light ramp follows the token block").toBe(
    true,
  );
  return rest.replace(lightBlock, "");
})();

/**
 * The literals allowed to survive, each for a reason that is not about the
 * app's own appearance:
 *
 *   #000 / rgba(0,0,0,a)  — pure black, with or without alpha. It carries no
 *              hue by definition, and it is never used here as a colour: it is
 *              a mask stop (a mask reads the alpha channel only, so the colour
 *              is never painted). The dialog's backdrop was the other one; it
 *              is the paper at an alpha now, `--scrim`, and is pinned below.
 *   #ffffff  — a PDF page. That is the *document's* paper, not the app's, and
 *              rendering someone's document on a tinted ground misrepresents
 *              it. The same white is baked into the page bitmaps by lib/pdf.ts.
 */
const ALLOWED_LITERALS = [/#000\b/g, /#ffffff\b/g, /rgba\(0,\s*0,\s*0,\s*[\d.]+\)/g];

function withoutAllowedLiterals(css: string): string {
  return ALLOWED_LITERALS.reduce((acc, re) => acc.replace(re, ""), css);
}

/** Every six-digit token value except the board tints, which are checked
 *  against their own targets further down rather than against the greyscale. */
function rampTokens(): string[] {
  const all = [...code.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)];
  const ramp = all.filter((m) => !m[1].startsWith("--board-")).map((m) => m[2]);
  expect(ramp.length, "the ramp should be declared as six-digit hex").toBeGreaterThan(5);
  return ramp;
}

/** The sixteen tints. A `-rule` twin is caught too, so the test that wants none can see one. */
function tintTokens(suffix: "" | "-rule", block: string = darkBlock): { name: string; hex: string }[] {
  return [...block.matchAll(/--board-([a-z]+)(-rule)?:\s*(#[0-9a-fA-F]{6});/g)]
    .filter((m) => (m[2] ?? "") === suffix)
    .map((m) => ({ name: m[1], hex: m[3] }));
}

/** A ramp token's value — the dark ramp's unless a block is named. */
function tokenValue(name: string, block: string = darkBlock): string {
  const found = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`));
  expect(found, `${name} should be declared as six-digit hex`).not.toBeNull();
  return found![1];
}

/** WCAG 2.1 contrast between two hex tones. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.1 relative luminance, the same arithmetic DESIGN.md §2 was measured with. */
function luminance(hex: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

describe("the ramp is the only source of colour", () => {
  it("declares no colour outside the token block", () => {
    const stray = withoutAllowedLiterals(afterTokens).match(
      /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g,
    );
    expect(stray ?? [], "every colour comes from a token in :root").toEqual([]);
  });

  it("darkens behind a dialog with --scrim, the paper at an alpha", () => {
    // DESIGN.md §2: the fourth alpha token, after the three on-ink values —
    // in each ramp its own paper, so the room recedes into its own ground.
    expect(darkBlock).toMatch(/--scrim:\s*rgba\(12,\s*10,\s*8,\s*0\.62\);/);
    expect(lightBlock).toMatch(/--scrim:\s*rgba\(243,\s*239,\s*231,\s*0\.55\);/);
    const at = afterTokens.indexOf("\n.dialog-scrim {");
    expect(at, "styles.css must define .dialog-scrim").toBeGreaterThan(-1);
    const block = afterTokens.slice(at, afterTokens.indexOf("}", at));
    expect(block).toMatch(/background:\s*var\(--scrim\);/);
  });

  it("has no hue anywhere in the ramp", () => {
    // Every ramp token is a warm greyscale: R >= G >= B, always. A tone that
    // breaks that ordering has a colour cast, which this app does not have.
    //
    // `--board-*` is the one exception in the stylesheet and is checked by the
    // block below instead — the argument for it is in lib/boardLook.ts and in
    // DESIGN.md §12. It is excluded **by name**, so a second family of hues
    // cannot be smuggled in under a different prefix.
    for (const hex of rampTokens()) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(r >= g && g >= b, `${hex} is not on the warm greyscale (needs R >= G >= B)`).toBe(true);
    }
  });

  it("keeps dark the ground, and the light ramp one block keyed on the resolved theme", () => {
    // "System" is resolved in lib/theme.ts and lands as data-theme, so there
    // is no media-query copy of the ramp to drift from this one.
    expect(code).not.toMatch(/prefers-color-scheme/);
    expect(darkBlock).toMatch(/color-scheme:\s*dark;/);
    expect(lightBlock).toMatch(/color-scheme:\s*light;/);
    // At the left margin: the touch block's cursor reset names the selector
    // too, indented inside its media query, and restates no colour.
    expect(code.match(/^:root\[data-theme="light"\] \{/gm), "one light block, and no second")
      .toHaveLength(1);
  });

  it("restates every colour the dark ramp declares, and nothing else", () => {
    // A token the light block forgets is drawn in the dark ramp's value on
    // paper — a black hairline, or a near-white mark nobody can see.
    const names = (block: string, keep: (value: string) => boolean) =>
      [...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)]
        .filter(([, , value]) => keep(value))
        .map(([, name]) => name)
        .sort();
    const themed = (value: string) =>
      /#[0-9a-fA-F]{6}\b|rgba\(|url\("data:image\/svg/.test(value);
    const perTheme = ["--doc-filter", "--lamp-blend", "--lamp-scale", "--shot-opacity"];
    const dark = names(darkBlock, (v) => themed(v)).concat(perTheme).sort();
    const light = names(lightBlock, () => true);
    expect(light).toEqual(dark);
  });

  describe.each(RAMPS)("the $theme ramp", ({ theme, block }) => {
    const t = (name: string) => tokenValue(name, block);

    // DESIGN.md §2's table, both columns. The floors are the same for both
    // ramps: 7 for the user's words, 4.5 for everything secondary.
    it.each([
      ["--ink", "--paper", 7],
      ["--ink", "--raised", 7],
      ["--muted", "--paper", 4.5],
      ["--muted", "--raised", 4.5],
      ["--muted", "--lens-ground", 4.5],
      ["--signal", "--paper", 4.5],
      ["--paper", "--invert", 7],
      ["--signal-ink", "--signal", 7],
    ] as const)("sets %s on %s at %s:1 or better", (fg, bg, floor) => {
      expect(contrast(t(fg), t(bg)), `${theme}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(floor);
    });

    // Review LEAD-01 (2026-10-13, owner note): the light ramp was hard to read,
    // so its secondary text is held well above the 4.5 floor, not just over it.
    it.runIf(theme === "light")("keeps the light ramp's small text at 7:1 on paper", () => {
      expect(contrast(t("--muted"), t("--paper"))).toBeGreaterThanOrEqual(7);
      expect(contrast(t("--muted"), t("--raised"))).toBeGreaterThanOrEqual(6.5);
      expect(contrast(t("--muted"), t("--lens-ground"))).toBeGreaterThanOrEqual(7);
      expect(contrast(t("--ink"), t("--paper"))).toBeGreaterThanOrEqual(12);
    });

    it("puts the ground at the end of the ramp, and every tone toward the words", () => {
      // One ground: the darkest tone on the black, the lightest on paper.
      const order = [
        "--paper", "--lens-ground", "--rule-faint", "--raised", "--rule-soft", "--rule",
        "--muted", "--invert", "--ink", "--signal",
      ].map((name) => luminance(t(name)));
      const rising = theme === "dark";
      for (let i = 1; i < order.length; i++) {
        expect(rising ? order[i] > order[i - 1] : order[i] < order[i - 1], `${theme} step ${i}`).toBe(
          true,
        );
      }
      expect(t("--card"), "the card is the ground").toBe(t("--paper"));
    });

    it("leaves the signal headroom beyond the words", () => {
      // §3: the address is 1.37:1 past the ink — brighter on the black,
      // darker on paper — and the ink stops short of the end to allow it.
      expect(contrast(t("--signal"), t("--ink"))).toBeGreaterThan(1.3);
      expect(contrast(t("--ink"), t("--invert")), "--invert a clear step short of ink").toBeGreaterThan(
        1.3,
      );
    });
  });
});

/**
 * The one exception to "there is no colour", held to the terms it was granted
 * on.
 *
 * A board the user made may wear one of sixteen tints. The licence for that is
 * **not** that hues are allowed now — it is that these particular hues add no
 * step to the ramp: a mark tint lies between 0.24 and `--invert`'s own
 * brightness (so a pale one is possible and none outshines a selected card, and
 * `--ink` stays the only tone above it). No tint reaches a line.
 *
 * That is the whole argument, and it is only true while the numbers are. This
 * is the test that keeps them true — the palette was solved for these targets
 * rather than eyeballed, and an edit that drifts off them has quietly turned
 * the tint into emphasis.
 */
/**
 * §3, enforced. The top of the ramp means **a live address**, and the one thing
 * that borrows it is the focus ring, which the section grants by name as the
 * browser's accessibility contract rather than the app's vocabulary. "Never
 * give anything else the signal. Not an error, not a primary button, not a
 * selected state."
 *
 * There was a fourth: `.canvas-title:hover` lit an idea's name at it, so the
 * brightest tone in the app was a hover state on a piece of chrome. Nothing in
 * this file could see it — a token used where it should not be is not a colour
 * literal — so this is the check that would have.
 */
describe("the signal is a live address, and the ring", () => {
  function usersOf(token: string): string[] {
    return [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => body.includes(`var(${token})`))
      .map(([, selector]) => selector.trim())
      .sort();
  }

  it("is read by nothing else", () => {
    expect(usersOf("--signal"), "every use of --signal is named in DESIGN.md §3").toEqual(
      [".reader a", ".reader a:hover", ":focus-visible"],
    );
  });

  it("keeps --signal-ink to the one place the signal becomes a fill", () => {
    expect(usersOf("--signal-ink")).toEqual([".reader a:hover"]);
  });
});

/**
 * A field's focus is a state, not a link (DESIGN.md §3): one inset rule, never
 * the 2px signal ring — which a field matches on an ordinary *tap*, because
 * every engine treats a field as expecting the keyboard.
 *
 * The global `:focus-visible` rule is the trap. A field that says nothing about
 * its own outline simply falls through to it, silently, and three of them did:
 * the sign-in box, which is the first screen a new device ever shows; the field
 * that renames an idea, which is the very one §3 cites as the model for the
 * right answer; and the Move chooser's new-folder box. So every field is named
 * here and has to answer for itself.
 */
describe("no text field takes the signal ring", () => {
  /** Each field, and what its own answer is allowed to be. */
  const FIELDS: Array<[string, RegExp]> = [
    // The two write surfaces answer with the lamp instead, which is the whole
    // of DESIGN.md §2c and is held by "the film" block above.
    [".capture textarea:focus", /outline:\s*none/],
    [".editor:focus", /outline:\s*none/],
    // Everything else takes the inset rule.
    [".search:focus", /outline:\s*1px solid var\(--ink\)/],
    [".look-filter input:focus", /outline:\s*1px solid var\(--ink\)/],
    [".canvas-text-input:focus", /outline:\s*1px solid var\(--ink\)/],
    [".canvas-title-input:focus", /outline:\s*1px solid var\(--ink\)/],
    [".signin-input:focus", /outline:\s*1px solid var\(--ink\)/],
    // The panels are drawn on the ground now, so this field takes the same
    // inset rule as every other one.
    [".selpanel-row input:focus", /outline:\s*1px solid var\(--ink\)/],
    // The three name-a-new-folder fields are Rename's field (review UI-A-04):
    // the same inset rule while typing, said once for all three.
    [
      ".board-tab-new input:focus,\n.shelf-row-new input:focus,\n.sorter-dest-new input:focus",
      /outline:\s*1px solid var\(--ink\)/,
    ],
  ];

  for (const [selector, rule] of FIELDS) {
    it(`${selector} answers for its own focus`, () => {
      const at = code.indexOf(`\n${selector} {`);
      expect(at, `${selector} is declared`).toBeGreaterThan(-1);
      const open = code.indexOf("{", at);
      expect(code.slice(open, code.indexOf("}", open) + 1)).toMatch(rule);
    });
  }
});

/**
 * A tone is a step along the ramp, and `opacity` is not one.
 *
 * `opacity: 0.5` on a ramp token mixes a colour at paint time that the palette
 * does not contain — and the "no colour outside the token block" check above
 * cannot see it, because no hex is written. The board counts were drawn that
 * way: `--muted` at half strength is `#504a42` on the ground, **2.26:1**,
 * against the 4.5 floor DESIGN.md verifies `--muted` at for this exact row
 * ("footers, board names", 5.88) — on every board you are not standing on, at
 * 10.5px, which on the phone's drawer is the whole shelf.
 */
describe("a quiet tone is a step along the ramp, not a fraction of one", () => {
  function block(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  const COUNTS = ".board-tab .tab-n,\n.board-trash .tab-n,\n.board-current .tab-n,\n.shelf-row .tab-n";

  it("draws every board count in --muted and dims nothing", () => {
    const b = block(COUNTS);
    expect(b, "the count takes a ramp tone outright").toMatch(/color:\s*var\(--muted\)/);
    expect(b, "and never a fraction of one").not.toMatch(/opacity:/);
  });

  it("draws the canvas note count the same way", () => {
    const b = block(".canvas-count");
    expect(b).toMatch(/color:\s*var\(--muted\)/);
    expect(b).not.toMatch(/opacity:/);
  });

  /**
   * The panels used to be the one place this rule could not be kept. They
   * were **inverted** slabs, and their secondary text was `--paper` at a
   * fraction — five of them, each measured under the 4.5 floor and left
   * alone, because there is no "muted on an inverted surface" on the ramp.
   * Since 2026-09-16 the panels are drawn on the ground (see `.selpanel`),
   * so every quiet thing on one takes `--muted` outright, and the exception
   * list is empty. It is still asserted, so that a panel going back to a
   * fraction is a deliberate act rather than a drift.
   *
   * A disabled row is not on the list and does not belong on one: dimming is
   * what "disabled" *means* everywhere, and a control nobody may press owes no
   * contrast.
   */
  it("dims nothing on a panel", () => {
    const dimmed = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /opacity:\s*0\.\d/.test(body))
      .map(([, selector]) => selector.trim())
      .filter((selector) => selector.startsWith(".selpanel") && !selector.includes(":disabled"))
      .sort();
    expect(dimmed).toEqual([]);
  });

  /**
   * A control nobody may press is drawn in a tone the ramp has — the claim in
   * the comment above ("dimming is what disabled means") was the reason four
   * of them faded to a grey the palette does not contain (review 2026-10-01,
   * UI-18). The hairline's tone for a mark, --muted for a row of words.
   */
  it("draws a disabled control in a ramp tone and never fades it", () => {
    const quiet = [
      [".sorter-done:disabled", "--rule"],
      [".attach-row .iconbtn:disabled", "--rule"],
      [".lightbox-step:disabled", "--rule"],
      [".selpanel-btn:disabled", "--muted"],
    ] as const;
    for (const [selector, tone] of quiet) {
      const b = block(selector);
      expect(b, `${selector} takes ${tone}`).toMatch(new RegExp(`color:\\s*var\\(${tone}\\)`));
      expect(b, `${selector} does not fade`).not.toMatch(/opacity:/);
    }
  });

  /** And the panel is the ground with an edge, not a bone slab. */
  it("draws the panel on the ground, in ink", () => {
    const b = block(".selpanel");
    expect(b).toMatch(/background:\s*var\(--paper\)/);
    expect(b).toMatch(/color:\s*var\(--ink\)/);
    expect(b).toMatch(/border:\s*1px solid var\(--rule\)/);
  });
});

/**
 * An installed app is served `viewport-fit=cover` and owns the whole screen,
 * so every band that lands on an edge has to pay the system's own inset — the
 * strip behind the status bar, and the one the phone's gesture bar sits in.
 * `.topbar` and `.capture` have paid it since the app was installable; what
 * had not was every band inside a **full-screen layer**, because those are
 * `inset: 0` and the padding belongs to the band rather than to the layer.
 * Four were missing it, two of them in layers whose *other* end already paid.
 */
describe("a band on the edge of a full-screen layer pays the system's inset", () => {
  function block(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  const BANDS: Array<[string, "top" | "bottom"]> = [
    [".topbar", "top"],
    [".canvas-bar", "top"],
    // A phone's drawing tools stand at the foot of the idea, on the very edge.
    [".canvas-dock", "bottom"],
    // The open note is the app's second screen and its bar held Back and the
    // six marks under the clock.
    [".sheet-bar", "top"],
    // The Sorter paid at the destinations end and not at the head.
    [".sorter-head", "top"],
    [".sorter-to", "bottom"],
    // The Ticker is the Sorter's shape, so it pays at both ends the same way.
    [".ticker-head", "top"],
    [".ticker-foot", "bottom"],
    // The viewer paid for its close mark and not for the row holding Save —
    // on the phone this whole feature exists for.
    [".lightbox-close", "top"],
    [".lightbox-bar", "bottom"],
    [".capture", "bottom"],
    [".look", "bottom"],
  ];

  for (const [selector, edge] of BANDS) {
    it(`${selector} pays the ${edge} inset`, () => {
      expect(block(selector)).toMatch(
        new RegExp(`env\\(safe-area-inset-${edge}\\)`),
      );
    });
  }

  it("gathers the Ticker's two bands to the note's column after their own rules, so a wide window keeps them", () => {
    // The rule is in the same file as the bands and after them: written before,
    // the bands' own `padding` shorthand overrode it and they ran edge to edge.
    const own = code.indexOf("\n.ticker-foot {");
    const gathered = code.indexOf("@media (min-width: 700px) {\n  .ticker-head,\n  .ticker-foot {");
    expect(own).toBeGreaterThan(-1);
    expect(gathered).toBeGreaterThan(own);
    expect(code.slice(gathered, code.indexOf("\n}\n", gathered))).toContain(
      "padding-left: max(var(--s-6), calc((100% - 33 * var(--t-read)) / 2))",
    );
  });

  it("pays both ends of the drawer, which stands the full height", () => {
    const b = block(".shelf");
    expect(b).toMatch(/env\(safe-area-inset-top\)/);
    expect(b).toMatch(/env\(safe-area-inset-bottom\)/);
  });
});

/**
 * Closing a full-screen page or mode is the same place every time: the header
 * cog's spot (review 2026-10-24, UI-02). One rule holds it for About, Settings
 * and the Keep import (`.about-close`), Tidy up and Tick off; the picture
 * viewer's own rule reads the same two tokens.
 */
describe("every exit mark stands in one place", () => {
  const rule = (selector: string) => {
    const at = code.lastIndexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf("}", at));
  };

  it("positions About, Tidy up and Tick off by the one shared rule", () => {
    const shared = rule(".about-close,\n.sorter-exit,\n.ticker-done");
    expect(shared).toContain("top: calc(var(--exit-top) + env(safe-area-inset-top))");
    expect(shared).toContain("right: var(--exit-right)");
    for (const own of [".about-close", ".sorter-done", ".ticker-done"]) {
      expect(rule(own), `${own} leaves its place to the shared rule`).not.toMatch(/\b(top|right|left|bottom):/);
    }
  });

  it("gives the picture viewer's mark the same two tokens", () => {
    const own = rule(".lightbox-close");
    expect(own).toContain("top: calc(var(--exit-top) + env(safe-area-inset-top))");
    expect(own).toContain("right: var(--exit-right)");
  });
});

/**
 * A bottom-right panel is anchored `right: 0` and sized by its contents, and
 * its rows are `nowrap`. The board chooser's rows are folder names of up to
 * `BOARD_NAME_MAX` (40), which in tracked mono plus the row's own mark, gap,
 * padding and count is ~390px — a Pixel exactly, and wider than a 360px phone.
 * Past that the panel grew off the *left* edge of the screen, taking the folder
 * marks and the first characters of every name with it, and nothing could
 * scroll to them: the overflow was past the viewport, not inside a box.
 */
describe("Tidy up on a desktop stands the destinations under the note", () => {
  it("does it for a wide window with a mouse only, on the app's one width", () => {
    // The phone and any touch screen keep them on the floor (review 2026-10-24, PL-06).
    const at = code.indexOf("@media (min-width: 700px) and (hover: hover) and (pointer: fine) {\n  .sorter-card {");
    expect(at).toBeGreaterThan(-1);
    const block = code.slice(at, code.indexOf("\n}\n", at));
    expect(block).toContain("flex: 0 1 calc(10 * var(--lh-read) * var(--t-read))");
    expect(block).toContain("margin-top: auto");
    expect(block).toContain("margin-bottom: auto");
    // The card's own rule still fills the screen's height elsewhere.
    expect(code).toMatch(/\n\.sorter-card \{[^}]*flex: 1 1 auto;/);
  });
});

describe("a panel never grows off the screen it is drawn on", () => {
  function block(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  it("caps the panel at the width of the window", () => {
    expect(block(".selpanel")).toMatch(/max-width:\s*100vw/);
  });

  it("lets the name be the thing that gives, and only the name", () => {
    const b = block(".selpanel-label");
    expect(b).toMatch(/min-width:\s*0/);
    expect(b).toMatch(/text-overflow:\s*ellipsis/);
  });

  /* Phone on its side, or a desktop at 200%: the Move chooser stood 142px
     above the top of the screen, Cancel first among what was lost (review
     QA-03). Every panel stops at the visible height and scrolls inside. */
  it("caps the panel at the visible height and scrolls inside it", () => {
    const b = block(".selpanel");
    expect(b).toMatch(/max-height:\s*calc\(var\(--visible-h, 100dvh\)/);
    expect(b).toMatch(/overflow-y:\s*auto/);
  });
});

/**
 * The heavier rule above Delete is a colour on a border the row's own
 * shorthand also sets. At equal weight the later rule wins, and the split was
 * written first — so the "heavier" line computed to the soft one on every
 * panel (review UI-B-10). The class test in BoardMenu.test.tsx only proved the
 * class was there, not that it drew.
 */
describe("the line that fences off Delete is drawn", () => {
  it("outranks the row's own soft rule", () => {
    const row = code.indexOf("\n.selpanel-btn {");
    expect(row).toBeGreaterThan(-1);
    const split = [...code.matchAll(/\n([^{}\n]*\.selpanel-split[^{}\n]*)\{([^}]*)\}/g)].filter(
      (m) => /border-top-color:\s*var\(--rule\)/.test(m[2]),
    );
    expect(split.length, "a rule colours the split's top border --rule").toBeGreaterThan(0);
    for (const m of split) {
      const selector = m[1].trim();
      const outranks = /\.selpanel-btn\.selpanel-split|\.selpanel-split\.selpanel-btn/.test(selector);
      expect(outranks || (m.index ?? 0) > row, `${selector} must beat .selpanel-btn`).toBe(true);
    }
  });
});

describe("the board tints", () => {
  /** A mark may be pale (bone, oat) but never brighter than --invert. */
  const MARK_FLOOR = 0.24;
  /** On paper a mark is never lighter than this against the ground. */
  const LIGHT_MARK_RATIO = 5.5;

  const NAMES = [
    "bone", "clay", "ember", "iris", "khaki", "moss", "oat", "ochre",
    "olive", "plum", "sage", "salvia", "sand", "steel", "stone", "teal",
  ];

  // OKLab, to measure how far apart two marks look (Björn Ottosson's matrices).
  function oklab(hex: string): [number, number, number] {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const [r, g, b] = [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16)));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }
  const distance = (a: string, b: string) => {
    const [p, q] = [oklab(a), oklab(b)];
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  };

  describe.each(RAMPS)("in the $theme ramp", ({ theme, block }) => {
    it("has sixteen of them, one strength each — no rule twins (withdrawn 2026-10-23)", () => {
      expect(tintTokens("", block).map((t) => t.name).sort()).toEqual(NAMES);
      expect(tintTokens("-rule", block)).toEqual([]);
    });

    it("keeps every mark inside the ramp, and never past --invert toward the words", () => {
      // Dark: between 0.24 and --invert's brightness. Light, the same span
      // turned over: never darker than --invert, never lighter than 5.5:1 on
      // the paper (§2b, "The light ramp's tints").
      const invert = luminance(tokenValue("--invert", block));
      const paper = luminance(tokenValue("--paper", block));
      const [floor, ceiling] =
        theme === "dark" ? [MARK_FLOOR, invert] : [invert, (paper + 0.05) / LIGHT_MARK_RATIO - 0.05];
      for (const { name, hex } of tintTokens("", block)) {
        const y = luminance(hex);
        expect(y, `${theme} --board-${name} (${hex}) is below the span`).toBeGreaterThanOrEqual(floor);
        expect(y, `${theme} --board-${name} (${hex}) is above the span`).toBeLessThanOrEqual(ceiling);
      }
    });

    it("leaves every mark legible on the ground", () => {
      const ground = tokenValue("--paper", block);
      for (const { name, hex } of tintTokens("", block)) {
        expect(contrast(hex, ground), `${theme} --board-${name} (${hex}) against the ground`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it("keeps any two marks, and any mark and --muted, visibly apart", () => {
      const marks = tintTokens("", block);
      const muted = tokenValue("--muted", block);
      for (let i = 0; i < marks.length; i++) {
        for (let j = i + 1; j < marks.length; j++) {
          expect(
            distance(marks[i].hex, marks[j].hex),
            `${theme}: ${marks[i].name} and ${marks[j].name} are too alike to tell on a shelf`,
          ).toBeGreaterThan(0.04);
        }
        expect(
          distance(marks[i].hex, muted),
          `${theme}: ${marks[i].name} is too close to untinted --muted to read as a colour`,
        ).toBeGreaterThan(0.04);
      }
    });
  });

  it("lets nothing but a mark read them", () => {
    // The tints reach the stylesheet through exactly one custom property,
    // `--board-tint`, set inline from the board's own colour. If another
    // appears, or a `--board-*` token is read directly by a fill, a background
    // or a text colour, the exception has grown past what it was granted and
    // needs re-arguing rather than extending.
    const reads = [...afterTokens.matchAll(/var\(--board-[a-z-]+\)/g)].map((m) => m[0]);
    expect(reads, "no rule outside :root may name a tint token directly").toEqual([]);
    expect(afterTokens).toMatch(/color: var\(--board-tint, currentColor\)/);
    // The coloured hairline under the board row was withdrawn (2026-10-23,
    // owner's ask): the row's line is plain --rule and no rule reads a tint.
    expect(afterTokens).not.toMatch(/--here-tint/);
  });
});

/**
 * The second exception, held to the terms it was granted on.
 *
 * DESIGN.md §2c allows the app exactly one texture: a paper grain shown only
 * through a pool of light. The licence is not "textures are allowed now" — it
 * is that *this* one adds no tone, is never seen whole, and lives on the two
 * surfaces the section names and nowhere else.
 *
 * Each of those is checkable, so each is checked. A second `--film-*` token, a
 * texture on a card, or a lamp whose fade is a gradient rather than a mask are
 * all the exception quietly growing into a rule, and all three would otherwise
 * ship in silence — the colour and gradient checks above cannot see any of
 * them, because a data URI carries no CSS colour and a mask is already
 * allowed.
 */

/**
 * Every surface the lamp is granted to, in the order the stylesheet lists
 * them. DESIGN.md §2c names three things: the focused write box, the open
 * note's editor, and the board you are on — which is five selectors, because a
 * board is named in the strip, in the trash tab beside it, and in the phone's
 * drawer, and being on one may not look like three different things.
 *
 * A sixth entry here is a change to §2c first. That is the whole point of
 * writing the list down.
 */
const LAMP_SURFACES = [
  ".capture-lamp",
  ".editor-lamp",
  '.board-tab[aria-selected="true"]::before',
  '.board-trash[aria-selected="true"]::before',
  '.shelf-row[aria-selected="true"]::before',
];

/**
 * The stylesheet was CRLF on disk for a while and is LF now; every lookup
 * below that spans a line break works on this normalised copy rather than on
 * `code` itself, so it is right either way.
 */
const lf = code.replace(/\r\n/g, "\n");

/**
 * The one rule that carries the film, the lift and the mask for all of them,
 * and the span it occupies. The span is needed because the shared selector
 * list *ends* in one of the surfaces, so a naive search for that surface's own
 * rule finds the shared one instead — and the surfaces' own rules sit both
 * before it (the boards, up in the strip) and after it (the write box).
 */
const [lampBlock, lampRuleStart, lampRuleEnd] = ((): [string, number, number] => {
  const at = lf.indexOf(LAMP_SURFACES.join(",\n"));
  expect(at, "the lamp surfaces must share one rule, listed in order").toBeGreaterThan(-1);
  const end = lf.indexOf("}", at);
  return [lf.slice(lf.indexOf("{", at), end), at, end];
})();

/** Where a surface says how bright and how wide its own pool is. */
function ownRule(surface: string): string {
  const needle = `\n${surface} {`;
  for (let at = lf.indexOf(needle); at !== -1; at = lf.indexOf(needle, at + 1)) {
    if (at >= lampRuleStart && at < lampRuleEnd) continue;
    return lf.slice(at, lf.indexOf("}", at));
  }
  return "";
}

describe("the film", () => {
  it("is declared once, in the token block, and names no colour", () => {
    const films = [...code.matchAll(/--film[a-z-]*:/g)].map((m) => m[0]);
    expect(films, "one film, and no family of them").toEqual(["--film:"]);

    // Matched to the closing paren rather than to a semicolon: a data URI has
    // several of its own inside it, and the stylesheet is CRLF, so both of the
    // obvious spellings of "to the end of the declaration" are wrong.
    const film = code.match(/--film:\s*(url\([\s\S]*?\));/)?.[1] ?? "";
    expect(film, "the film should be an inline SVG data URI").toMatch(/^url\('data:image\/svg/);
    expect(
      film.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g),
      "the grain is generated and desaturated, so it names no tone",
    ).toBeNull();
    expect(film, "turbulence, desaturated — never a painted fill").toMatch(/feTurbulence/);
    expect(film).toMatch(/feColorMatrix[^/]*saturate/);
  });

  it("is read by the lamp's own rule and by nothing else", () => {
    const readers = [...afterTokens.matchAll(/([^{}]+)\{[^{}]*var\(--film\)[^{}]*\}/g)].map((m) =>
      m[1]
        .trim()
        .split(",")
        .map((s) => s.trim()),
    );
    expect(
      readers,
      "the film belongs to the surfaces DESIGN.md §2c names, through one rule",
    ).toEqual([LAMP_SURFACES]);
  });

  it("is never shown whole", () => {
    // The mask is the entire argument: a grain spread evenly over a surface is
    // a finish, which is a different design. So the lamp must carry one, and
    // nothing may turn it off.
    expect(lampBlock, "the lamp must be masked").toMatch(/(^|\s)mask-image:\s*radial-gradient/);
    expect(
      afterTokens,
      "nothing may take the mask off the film",
    ).not.toMatch(/mask-image:\s*none/);
  });

  it("lights with --invert, never the signal", () => {
    expect(
      lampBlock,
      "the top of the ramp is a live address and nothing else — DESIGN.md §3",
    ).not.toMatch(/--signal/);
    expect(lampBlock, "the lift is a flat wash of --invert").toMatch(/--invert/);
  });

  it("lights a board the same way everywhere a board is named", () => {
    // DESIGN.md §2c: "Three selectors, one fact; a board that looks selected
    // one way on a desktop and another way on a phone is two designs." The
    // strip tab spent five days at 5% while the trash tab beside it stood at
    // 13%, and nothing here noticed, because the lift test only knew a
    // ceiling. One number, three surfaces.
    const boards = LAMP_SURFACES.filter((s) => !s.startsWith(".capture") && !s.startsWith(".editor"));
    const lifts = boards.map((s) => ownRule(s).match(/--lamp-lift:\s*([\d.]+)%/)?.[1]);
    expect(new Set(lifts).size, `one lift for ${boards.join(", ")}: got ${lifts.join(", ")}`).toBe(1);
  });

  it("gives every lit surface its own dial, and none of them the ramp", () => {
    // The shared rule paints; each surface says how brightly and how wide. A
    // surface that inherits someone else's pool is a rule that fits one box
    // and was never sized for the other, which is how a pool becomes a slab.
    for (const surface of LAMP_SURFACES) {
      const own = ownRule(surface);
      expect(own, `${surface} needs a rule of its own`).not.toBe("");
      expect(own, `${surface} must set --lamp-lift`).toMatch(/--lamp-lift:/);
      expect(own, `${surface} must set --lamp-pool`).toMatch(/--lamp-pool:/);
      // The lift is a wash of --invert scaled by this number. A board's is the
      // heaviest in the app because it replaced a flat --raised fill, and
      // --raised is --invert at roughly 16% over the paper — so past that the
      // lamp is brighter than the slab it was meant to be quieter than.
      const lift = Number(own.match(/--lamp-lift:\s*([\d.]+)%/)?.[1] ?? NaN);
      expect(lift, `${surface}'s lift should be a percentage`).not.toBeNaN();
      expect(lift, "a lamp may not out-shout the fill it replaced").toBeLessThanOrEqual(16);
    }
  });

  /**
   * The flicker and the breath, and the line they may not cross.
   *
   * A lit surface should not read as a printed one, so the two write surfaces
   * carry a slow swell and an irregular dip. The three board surfaces carry
   * neither, and that was asked for outright: the board you are on is a
   * *state*, and a state that flickers reads as a fault in the app rather than
   * as a light in the room.
   *
   * The gains are what makes one rule able to serve both — every surface
   * multiplies its lift by them, and a surface that runs no animation reads
   * the registered 1. So the check is not "is the board excluded from the
   * shared rule" (it cannot be, there is only one) but "does the board run an
   * animation", which is the thing that would actually be wrong.
   *
   * The one arrival (a cold open, once) is not in the stylesheet at all: see
   * "lets exactly one file light a board's lamp by animation" below.
   */
  it("breathes and flickers on the write surfaces, and on no board", () => {
    const writes = [".capture-lamp", ".editor-lamp"];
    for (const surface of writes) {
      const own = ownRule(surface);
      expect(own, `${surface} should breathe`).toMatch(/animation:[\s\S]*lamp-breathe/);
      expect(own, `${surface} should flicker`).toMatch(/animation:[\s\S]*lamp-flicker/);
    }

    for (const surface of LAMP_SURFACES.filter((s) => !writes.includes(s))) {
      expect(
        ownRule(surface),
        `${surface} is a state, not a flame — it may not animate`,
      ).not.toMatch(/animation/);
    }

    // Neither may the rule they all share breathe or flicker, which would
    // light every board. It may drift the grain — that touches no brightness,
    // so a board is exactly as lit at every frame — and nothing else.
    expect(lampBlock, "the shared rule may not breathe or flicker").not.toMatch(
      /lamp-breathe|lamp-flicker/,
    );
    const shared = lampBlock.match(/animation:\s*([^;]+);/)?.[1]?.trim() ?? "";
    expect(shared, "the shared rule's only loop is the grain's drift").toMatch(/^lamp-drift\s/);
  });

  it("drifts the grain on every lit surface, and moves nothing else with it", () => {
    // The film is laid twice and each copy glides its own way, so the grain
    // re-forms under the light instead of holding still. The keyframes may
    // move the paper and nothing else: a drift that touched opacity, colour or
    // the lift would be a breath on a board by another name.
    const at = lf.indexOf("@keyframes lamp-drift");
    expect(at, "lamp-drift must exist").toBeGreaterThan(-1);
    const end = lf.indexOf("\n}\n", at);
    const props = [...lf.slice(at, end).matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(new Set(props), "the drift moves the paper, nothing else").toEqual(
      new Set(["background-position"]),
    );
    expect(lampBlock).toMatch(/background-image:\s*var\(--film\),\s*var\(--film\)/);
    for (const surface of [".capture-lamp", ".editor-lamp"]) {
      expect(ownRule(surface), `${surface} replaces the shared animation, so restates the drift`)
        .toMatch(/animation:[\s\S]*lamp-drift/);
    }
  });

  /**
   * Both gains have to be registered, and both have to rest at 1.
   *
   * An unregistered custom property is a string: it would jump from keyframe
   * to keyframe instead of interpolating, so the breath would be a blink. And
   * an initial value of anything but 1 would change how all five surfaces
   * light the moment this file is loaded — including the three that never
   * animate, which is the exact failure this pair exists to avoid.
   */
  it("registers both lamp gains as numbers resting at 1", () => {
    for (const gain of ["--breath-gain", "--flicker-gain"]) {
      const block = lf.slice(lf.indexOf(`@property ${gain}`));
      const decl = block.slice(0, block.indexOf("}"));
      expect(decl, `${gain} must be registered`).toContain("@property");
      expect(decl, `${gain} must be a number, or it cannot interpolate`).toMatch(
        /syntax:\s*"<number>"/,
      );
      expect(decl, `${gain} must rest at 1, or it changes every lit surface`).toMatch(
        /initial-value:\s*1\s*;/,
      );
    }

    // The lift is what they turn. If the multiplication is ever dropped from
    // the shared rule the animations keep running, keep passing the test
    // above, and light nothing — the quietest way this could break.
    expect(
      lampBlock.replace(/\s+/g, " "),
      "the gains must multiply the lift, or they do nothing at all",
    ).toMatch(
      /calc\( ?var\(--lamp-lift\) \* var\(--lamp-scale\) \* var\(--breath-gain\) \* var\(--flicker-gain\) ?\)/,
    );
  });

  /**
   * The lamp on each ramp, and the ceiling it keeps on both (§2c). On the
   * black the wash screens — it can only lighten; on paper `screen` would draw
   * nothing, so it multiplies, and the light shows the tooth as its shade.
   * Either way the board you are on — the brightest dial — lands no further
   * from the paper than --raised, the slab it replaced.
   */
  it.each(RAMPS)("keeps the $theme lamp under --raised", ({ theme, block }) => {
    const blend = block.match(/--lamp-blend:\s*([a-z]+);/)?.[1];
    const scale = Number(block.match(/--lamp-scale:\s*([\d.]+);/)?.[1] ?? NaN);
    expect(blend).toBe(theme === "dark" ? "screen" : "multiply");
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
    expect(lampBlock).toMatch(/mix-blend-mode:\s*var\(--lamp-blend\);/);

    const channels = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
    const toHex = (cs: number[]) =>
      `#${cs.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`;
    const paper = tokenValue("--paper", block);
    const invert = channels(tokenValue("--invert", block));
    for (const surface of LAMP_SURFACES) {
      const lift = Number(ownRule(surface).match(/--lamp-lift:\s*([\d.]+)%/)?.[1] ?? NaN);
      const a = (lift / 100) * scale;
      const lit = toHex(
        channels(paper).map((b, k) => {
          const mixed = blend === "screen" ? 1 - (1 - b) * (1 - invert[k]) : b * invert[k];
          return b * (1 - a) + mixed * a;
        }),
      );
      expect(
        contrast(lit, paper),
        `${theme}: ${surface} may not stand further off the paper than --raised`,
      ).toBeLessThanOrEqual(contrast(tokenValue("--raised", block), paper));
    }
  });

  it("keeps the note editor's lamp under the write box's", () => {
    // Reading and writing a note happen in the same place, at the same size,
    // on the same line grid, and the swap between them is meant to be
    // invisible. So the editor's light may only ever be a mark that the words
    // have become editable — never a state the page enters — and it is held
    // below the capture bar's on both axes. DESIGN.md §2c states it; without
    // this, the two drift together the first time either is tuned.
    const lift = (surface: string) =>
      Number(ownRule(surface).match(/--lamp-lift:\s*([\d.]+)%/)?.[1] ?? NaN);
    const poolWidth = (surface: string) =>
      Number(ownRule(surface).match(/--lamp-pool:\s*([\d.]+)px/)?.[1] ?? NaN);

    expect(lift(".editor-lamp"), "the editor's light is the dimmer of the two").toBeLessThan(
      lift(".capture-lamp"),
    );
    expect(
      poolWidth(".editor-lamp"),
      "and the tighter — the measure here is three times a capture bar's",
    ).toBeLessThan(poolWidth(".capture-lamp"));
  });
});

describe("brutalist structure", () => {
  it("draws no shadows", () => {
    // Including a box-shadow used as a rule, which is the tempting one: it is
    // 1px of ink that takes no layout, and it is still a shadow. An absolutely
    // positioned pseudo-element does the same job honestly.
    expect(afterTokens).not.toMatch(/box-shadow\s*:(?!\s*none)/);
    expect(afterTokens).not.toMatch(/text-shadow\s*:(?!\s*none)/);
  });

  it("blurs nothing", () => {
    expect(afterTokens).not.toMatch(/blur\(/);
    expect(afterTokens).not.toMatch(/backdrop-filter\s*:(?!\s*none)/);
  });

  it("rounds no corners but a key cap's", () => {
    // One exception, owner approved 2026-10-08 (DESIGN.md §6): a key cap takes
    // `--r-key`. Everything else is 0, and the token is spent on `.kbd-cap`
    // alone — a second user of it would be the radius generalising.
    const decls = [...afterTokens.matchAll(/([^{}]*)\{([^{}]*)\}/g)].flatMap((rule) =>
      [...rule[2].matchAll(/border-radius\s*:\s*([^;}]+)/g)].map((m) => ({
        selector: rule[1].trim(),
        value: m[1].trim(),
      })),
    );
    for (const { selector, value } of decls) {
      if (value === "var(--r-key)") {
        expect(selector, "--r-key belongs to the key cap alone").toMatch(/(^|,\s*)\.kbd-cap$/);
      } else {
        expect(value, "the app has no border-radius").toMatch(/^0[a-z%]*$/);
      }
    }
    expect(decls.some((d) => d.value === "var(--r-key)"), "the key cap is rounded").toBe(true);
    expect(code, "the one radius is 3px").toMatch(/--r-key:\s*3px;/);
  });

  it("uses no gradient as a surface tone", () => {
    // A gradient is only ever allowed to do one of three things here, and
    // none of them is shading a surface:
    //
    //   a mask       reads the alpha channel only and paints no colour — the
    //                app currently has none of its own, but the rule stands.
    //   hard stops   the canvas graph paper, which is a repeating 1px *rule*
    //                written as a gradient because that is the only way CSS
    //                will tile one. Every stop lands on 1px and the rest is
    //                transparent, so there is no blend anywhere in it.
    //   the cut fade the last line of a cut card, covered by its own surface
    //                colour left to right rather than dimmed top to bottom.
    //                It is provably tied to a real surface and not a made-up
    //                tint because every stop routes through --cut-bg, which
    //                only ever resolves to --card or --invert — never a
    //                literal, and never a colour the card isn't already.
    //
    //   the pen     a ticked item's strike (`.pen`): one colour twice,
    //                `linear-gradient(currentColor, currentColor)`, sized to a
    //                1px line. A flat line written as a gradient because a
    //                background is the only thing that draws on every line of
    //                a wrapped item without moving a character; there is no
    //                blend in it, and it is the words' own tone.
    //
    //   (The undo offer's countdown was a fourth: a conic sweep painted into a
    //   transparent border. It is an SVG stroke now — see `.undo-clock` — and
    //   no longer a gradient.)
    //
    // Anything else is a soft fill, which this app has not got.
    const gradients = [...afterTokens.matchAll(/[a-z-]+\s*:[^;}]*gradient\([^;}]*/g)].map((m) =>
      m[0].trim().replace(/\s+/g, " "),
    );
    expect(gradients.length, "the cut fade and the graph paper both use one").toBeGreaterThan(0);

    for (const decl of gradients) {
      const isMask = /^(-webkit-)?mask-image/.test(decl);
      const isHardStops = /1px,\s*transparent 1px/.test(decl);
      const isCutFade = decl.includes("var(--cut-bg");
      const isPen = /linear-gradient\(currentColor, currentColor\)/.test(decl);
      // The undo clock used to be a fourth case here — a conic sweep with two
      // hard stops, painted into a transparent border. It is an SVG stroke
      // now (`.undo-clock`), drawn at one speed along the edge rather than by
      // angle, and so is not a gradient at all any more.
      expect(
        isMask || isHardStops || isCutFade || isPen,
        `a gradient may only be a mask, a hard-stop rule, the cut fade or the pen — got: ${decl}`,
      ).toBe(true);
    }
  });

  it("keeps the cut fade honest to a real surface", () => {
    // The fade's whole legitimacy rests on --cut-bg never being a colour
    // invented for the occasion. It must resolve only to tokens the card
    // itself already uses as a fill.
    const declared = [...afterTokens.matchAll(/--cut-bg\s*:\s*([^;}]+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(declared.length, "at least one state overrides --cut-bg").toBeGreaterThan(0);
    for (const value of declared) {
      expect(value, `--cut-bg: ${value} must be a surface token, not a new colour`).toMatch(
        /^var\(--(card|invert)\)$/,
      );
    }

    const fallback = afterTokens.match(/var\(--cut-bg,\s*var\(--card\)\)/g) ?? [];
    expect(fallback.length, "the fade must fall back to --card, never a literal").toBeGreaterThan(
      0,
    );
  });
});

describe("the app draws its own pointer", () => {
  /**
   * The last piece of the interface the operating system was still drawing.
   * Every cursor is a token, for the same reason every colour is: the drawings
   * carry two ramp values inside a data URI, and a data URI cannot reference a
   * custom property — so they have to live in the one place a literal is
   * allowed to appear, and nowhere else may write a bare keyword.
   */
  it("names every cursor from a token", () => {
    const used = [...afterTokens.matchAll(/[^-]cursor\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(used.length, "the stylesheet should be setting some cursors").toBeGreaterThan(10);
    for (const value of used) {
      expect(value, `cursor: ${value} is a keyword, not a token`).toMatch(
        /^var\(--cursor-[a-z-]+\)$/,
      );
    }
  });

  it("gives every cursor a keyword to fall back to", () => {
    // A browser that declines the SVG has to land back on exactly what the
    // token replaced, or a control silently loses its pointer.
    const tokens = [...code.matchAll(/--cursor-([a-z-]+):\s*([\s\S]*?);/g)];
    expect(tokens.length, "the cursor set should be declared").toBeGreaterThan(5);
    for (const [, name, value] of tokens) {
      if (!value.includes("url(")) continue;
      expect(value.trim().endsWith(name), `--cursor-${name} must fall back to \`${name}\``).toBe(
        true,
      );
    }
  });

  it("stands down entirely on a touch device", () => {
    // A phone has no pointer to draw, and a stylus wants the platform's own
    // hit behaviour rather than an app's opinion about it.
    expect(code).toMatch(/@media \(hover: none\), \(pointer: coarse\)/);
  });
});

describe("the scale", () => {
  it("invents no seventh type size", () => {
    const sizes = [...afterTokens.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((m) => m[1].trim());
    expect(sizes.length, "the stylesheet should be setting some type").toBeGreaterThan(10);

    for (const value of sizes) {
      // A token, or a *relative* size. Relative is allowed because it is an
      // optical correction rather than a new step: `.inline-code` is set at
      // 0.86em so mono's larger x-height sits with the serif around it, which
      // follows whichever of the six sizes the surrounding text is using.
      expect(value, `font-size: ${value} is neither a token nor a relative correction`).toMatch(
        /^var\(--t-[a-z]+\)$|^[\d.]+(em|%)$|^inherit$/,
      );
    }
  });

  it("takes every face from a token", () => {
    const families = [...afterTokens.matchAll(/font-family\s*:\s*([^;}]+)/g)].map((m) =>
      m[1].trim(),
    );
    for (const value of families) {
      expect(value, `font-family: ${value} should be var(--body|--body-roman|--display|--mono)`).toMatch(
        /^var\(--(body|body-roman|display|mono)\)$|^inherit$/,
      );
    }
  });

  it("hard-codes no icon size", () => {
    // Three tiers, and the tier is a prop. A mark with its own width means the
    // layout is wrong, not that the scale is short.
    //
    // This is about the *mark*, not the control holding it: `.iconbtn` is a
    // 40px tap target and has every right to be, because a thumb is 40px
    // whatever is drawn in the middle of it.
    // The lookbehind keeps `stroke-width` on `.icon` out of this: that one is
    // the mapped stroke, and it is supposed to be a calc.
    const widths = [
      ...afterTokens.matchAll(
        /\.icon(?:-(?:nav|inline|data))?\s*\{[^}]*?(?<![\w-])width\s*:\s*([^;}]+)/g,
      ),
    ].map((m) => m[1].trim());
    expect(widths.length, "the three mark tiers each set a width").toBe(3);

    for (const value of widths) {
      expect(value).toMatch(/^var\(--icon-(nav|inline|data)\)$/);
    }
  });
});

/**
 * The stylesheet is not the only place a design system dies. An inline
 * `style={{ color: "#fff" }}` in a component bypasses every rule above, and it
 * is the most natural thing in the world to write while wiring something up.
 */
const SRC_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * The three places colour literals are allowed to exist in component source,
 * all because they are not the app describing itself:
 *
 *   lib/pdf.ts           fills a page bitmap white. That is the *document's* paper.
 *   themeColor.ts        mirrors --paper as a last-resort fallback, reached only if
 *                        the stylesheet has not resolved — it exists precisely to
 *                        read the token, so it cannot read the token to get it.
 *   demo/sampleNotes.ts  paints the public demo's sample *photograph* on a canvas
 *                        (`drawPicture`). A picture a person keeps is content, in
 *                        whatever colours it has, like every photo in the archive.
 */
const LITERAL_EXEMPT = new Set(["lib/pdf.ts", "themeColor.ts", "demo/sampleNotes.ts"]);

function sourceFiles(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full, base);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (/\.test\.tsx?$/.test(entry.name)) return [];
    return [path.relative(base, full).split(path.sep).join("/")];
  });
}

describe("components take their values from the system too", () => {
  const files = sourceFiles(SRC_DIR);

  it("finds the component source", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  /**
   * The one exception to "the board you are on does not animate" (DESIGN.md
   * §2c; owner approved 2026-10-14, joy review #10): on a cold open the lit
   * board's lamp rises from dark, once. The stylesheet test above still holds
   * in full (no board surface carries an `animation`); the arrival is a
   * hand-started animation in `lib/coldLight.ts`, and this is what keeps it
   * the only one: nothing else may animate a pseudo-element of a board.
   */
  it("lets exactly one file light a board's lamp by animation", () => {
    const lighting = files.filter((file) =>
      /pseudoElement:\s*["']::before["']/.test(readFileSync(path.join(SRC_DIR, file), "utf8")),
    );
    expect(lighting, "the cold-open arrival is the lamp's one animation").toEqual([
      "lib/coldLight.ts",
    ]);
    const body = readFileSync(path.join(SRC_DIR, "lib/coldLight.ts"), "utf8");
    expect(body, "it animates opacity and nothing else").toMatch(
      /\[\{ opacity: 0 \}, \{ opacity: 1 \}\]/,
    );
    expect(body, "it is armed once per session").toMatch(/let spent = false/);
  });

  it("writes no colour literal in a component", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (LITERAL_EXEMPT.has(file)) continue;
      const body = readFileSync(path.join(SRC_DIR, file), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        "",
      );
      const found = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g);
      if (found) offenders.push(`${file}: ${[...new Set(found)].join(", ")}`);
    }
    expect(offenders, "colours belong to the ramp in styles.css").toEqual([]);
  });

  it("sets no typography from an inline style", () => {
    // Geometry inline is fine and necessary — a note on the spatial canvas has
    // to carry its own x and y. Type and colour never are: they have tokens.
    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(path.join(SRC_DIR, file), "utf8");
      for (const m of body.matchAll(/\b(fontSize|fontFamily|fontWeight|letterSpacing)\s*:/g)) {
        offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders, "type comes from a class, never from an inline style").toEqual([]);
  });
});

describe("the fonts are self-hosted", () => {
  it("reaches no font CDN", () => {
    // The 90% path may not wait on a network round-trip, and the app has to
    // open offline in the right faces.
    expect(source).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit/);
    const sources = [...code.matchAll(/src:\s*url\(["']?([^"')]+)/g)].map((m) => m[1]);
    expect(sources.length, "the three faces should be declared").toBeGreaterThan(5);
    for (const url of sources) {
      expect(url, `${url} must be a local font file`).toMatch(/^\/fonts\/[\w.-]+\.woff2$/);
    }
  });

  it("declares one weight per file", () => {
    // A face that claims "400 700" while being a single static cut makes the
    // browser match bold to the regular file and correctly decline to
    // synthesise, so bold renders as regular: emphasis present in the markup
    // and invisible on the page.
    const weights = [...code.matchAll(/@font-face\s*\{[^}]*font-weight:\s*([^;}]+)/g)].map((m) =>
      m[1].trim(),
    );
    expect(weights.length).toBeGreaterThan(5);
    for (const weight of weights) {
      expect(weight, `@font-face font-weight: ${weight} must name one weight`).toMatch(/^\d+$/);
    }
  });
});

/**
 * Motion, enforced the same way colour already is.
 *
 * `lib/motion.ts` exports exactly two curves and a fixed set of durations,
 * and nothing is supposed to invent its own. CSS cannot import a JS export,
 * so styles.css restates the two curves as `--ease-enter`/`--ease-exit` —
 * a second copy of one decision, checked byte-for-byte against motion.ts
 * below so the two cannot quietly drift apart.
 */
describe("motion in the stylesheet matches lib/motion.ts", () => {
  it("declares --ease-enter/--ease-exit identical to ENTER/EXIT", () => {
    const enter = code.match(/--ease-enter:\s*([^;]+);/)?.[1]?.trim();
    const exit = code.match(/--ease-exit:\s*([^;]+);/)?.[1]?.trim();
    expect(enter, "--ease-enter must exist and match motion.ts's ENTER").toBe(ENTER);
    expect(exit, "--ease-exit must exist and match motion.ts's EXIT").toBe(EXIT);
  });

  /**
   * The third curve, pinned deliberately.
   *
   * The allowlist below cannot see this one: it scans for *literal* easings,
   * and a curve reached through `var(--ease-nudge)` is a custom property like
   * the other two — so adding it to the token block widened the vocabulary
   * without tripping a single check. That silence is the problem this test
   * exists to remove. It is now one of exactly three curves, it is named in
   * motion.ts with the argument for why it may exist, and a fourth added the
   * same quiet way still has nothing standing in front of it — which is why
   * the count is asserted here too, not just the value.
   */
  it("declares --ease-nudge identical to NUDGE, and invents no fourth curve", () => {
    const nudge = code.match(/--ease-nudge:\s*([^;]+);/)?.[1]?.trim();
    expect(nudge, "--ease-nudge must exist and match motion.ts's NUDGE").toBe(NUDGE);

    const declared = [...code.matchAll(/--ease-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(
      declared.sort(),
      "the app has three curves: ENTER, EXIT, and the one hover NUDGE",
    ).toEqual([ENTER, EXIT, NUDGE].sort());
  });

  /**
   * The one duration restated in CSS, pinned the same way the curves are.
   *
   * Every other duration reaches the stylesheet as a number a component passes
   * in, so motion.ts is the only copy. `--nav-mark-ms` is the exception: no
   * component animates a mark from JS, so the value lives in the stylesheet and
   * `NAV_MARK_MS` is the note in motion.ts saying where it lives. That made it
   * the one duration with two copies and nothing standing between them — an
   * export nothing reads cannot fail, so it could have said 380 while the
   * stylesheet said 500 and no test would have noticed.
   *
   * The count is asserted for the same reason the curve count is: a second
   * duration custom property added the quiet way would be another unchecked
   * copy, and the silence is the problem this test exists to remove.
   */
  it("declares --nav-mark-ms identical to NAV_MARK_MS, and invents no second duration", () => {
    const declared = [...code.matchAll(/--([a-z-]*-ms):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]);
    expect(
      declared,
      "the stylesheet holds exactly one duration: --nav-mark-ms, from motion.ts's NAV_MARK_MS",
    ).toEqual([["nav-mark-ms", `${NAV_MARK_MS}ms`]]);
  });

  /**
   * Every easing keyword or curve in styles.css that is not one of the two
   * custom properties above, named by the selector that carries it and the
   * literal value it is allowed to keep. Nothing here may be widened by
   * pattern — a new violation has to be named explicitly, which is the
   * point: this list is a visible backlog, not a way to go quiet.
   *
   * Two different reasons an entry can be here:
   *
   *  - permanent: the undo clock (`.undo-clock rect`) is the one named linear exception —
   *    DESIGN.md §10 and web/CLAUDE.md's "undo offer" note both call it out:
   *    it is a clock counting down, not a move, and a curve would misreport
   *    the time left. The sync-mark and spinner loops are the other permanent
   *    kind — styles.css's own section comments already say they live outside
   *    lib/motion.ts on purpose: "a picture that happens to loop." The
   *    mascot's loops are the same exception and are no longer in this file at
   *    all; they moved into the element's shadow root, where nothing here can
   *    see them (components/mascot-element.ts).
   *  - inherited, needs a design decision: a value nobody chose on purpose
   *    for this system and nobody has revisited since. Changing it here
   *    would retime a real animation, which is out of scope for a
   *    centralising pass — so it is named and left, not fixed and not
   *    hidden.
   */
  const CSS_EASING_ALLOWLIST: Array<{ selector: string; easing: string; reason: string }> = [
    // --- permanent: the one named linear clock -----------------------------
    {
      selector: ".undo-clock rect",
      easing: "linear",
      reason: "the undo countdown — a clock, not a move; must stay linear",
    },
    {
      selector: ".speech-clock",
      easing: "linear",
      reason: "the same undo countdown, drawn under the words of the creature's speech bubble",
    },

    // The mascot's loops used to be listed here. They are not in this
    // stylesheet any more: the drawing became a custom element and its
    // keyframes moved into its own shadow root, where this file cannot see
    // them and neither can anything else. They are the same permanent
    // exception they always were — a picture that happens to loop — and
    // components/mascot-element.ts says so at the top.

    // --- permanent: documented decorative loops (sync mark) ----------------
    {
      selector: '.mark-state[data-state="working"] .jelly-pulse-l',
      easing: "ease-in-out",
      reason: "sync-jelly-l — decorative sync-mark loop",
    },
    {
      selector: '.mark-state[data-state="working"] .jelly-pulse-r',
      easing: "ease-in-out",
      reason: "sync-jelly-r — decorative sync-mark loop",
    },
    {
      selector: '.mark-state[data-state="working"] .syncmark-stream',
      easing: "linear",
      reason: "sync-flow — decorative sync-mark loop",
    },

    // --- inherited, needs a design decision: a third curve ------------------
    // motion.ts defines only ENTER and EXIT. cubic-bezier(0.4, 0, 0.2, 1) is
    // neither, and it drives the sync-mark and spinner loops — decorative,
    // so retiming it is not this task, but it should not read as normal.
    {
      selector: '.mark-state[data-state="working"] .syncmark-a',
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      reason: "sync-part-a — inherited third curve, needs a design decision",
    },
    {
      selector: '.mark-state[data-state="working"] .syncmark-b',
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      reason: "sync-part-b — inherited third curve, needs a design decision",
    },
    {
      selector: '.mark-state[data-state="working"] .syncmark-stream',
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      reason: "sync-stretch — inherited third curve, needs a design decision",
    },
    {
      selector: ".spinner-flip",
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      reason: "spinner-rotate — inherited third curve, needs a design decision",
    },
    {
      selector: ".spinner-sand-top",
      easing: "linear",
      reason: "spinner-drain-top — decorative loading loop",
    },
    {
      selector: ".spinner-sand-bottom",
      easing: "linear",
      reason: "spinner-fill-bottom — decorative loading loop",
    },
    {
      selector: ".spinner-stream",
      easing: "linear",
      reason: "spinner-flow — decorative loading loop",
    },

    // --- permanent: the grain drifting under a lamp --------------------------
    // DESIGN.md §2c. A picture that loops, not a move with an arrival: an
    // eased drift would visibly pulse once per lap. The shared lamp rule
    // carries it for the boards; the two write surfaces restate it because
    // their own `animation` list replaces the shared one.
    {
      selector: LAMP_SURFACES.join(",\n"),
      easing: "linear",
      reason: "lamp-drift — the film's slow drift under every lit surface",
    },
    {
      selector: ".capture-lamp",
      easing: "linear",
      reason: "lamp-drift — restated beside the breath and the flicker",
    },
    {
      selector: ".editor-lamp",
      easing: "linear",
      reason: "lamp-drift — restated beside the breath and the flicker",
    },

    // The trace used to stand here, as an open question: a border stroke drawn
    // at a constant rate, on the same reasoning lib/motion.ts's LINEAR gave a
    // fade, but never argued for. The question has been answered — nothing in
    // the app moves at a constant rate unless it is a picture of one — so the
    // trace now draws on ENTER and fades on EXIT, and needs no exception.

    // The three bare `ease` opacity fades that predated lib/motion.ts (the card,
    // the canvas's resize handle, a file card's picture) take ENTER at their own
    // durations since the 2026-10-18 UX pass, and need no exception.
  ];

  it("uses no easing outside --ease-enter/--ease-exit except the named allowlist", () => {
    // Every `{ selector { ... } }` block, the same technique the cursor and
    // colour checks above already use — it finds inner rules correctly even
    // nested inside a @media block, because it does not try to balance more
    // than one level of braces.
    const blocks = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const EASING_RE =
      /cubic-bezier\([^)]*\)|ease-in-out|ease-in|ease-out|(?<![\w-])ease(?![\w-])|(?<![\w-])linear(?![\w-])/g;

    const offenders: string[] = [];
    const usedAllowlist = new Set<number>();

    for (const [, rawSelector, rawBody] of blocks) {
      const selector = rawSelector.trim();
      if (!/\b(animation|transition)(?:-[\w-]+)?\s*:/.test(rawBody)) continue;
      // The custom properties are the whole point — never flag them.
      const body = rawBody.replace(/var\(--ease-(?:enter|exit)\)/g, "");
      for (const [easing] of body.matchAll(EASING_RE)) {
        const idx = CSS_EASING_ALLOWLIST.findIndex(
          (entry, i) => !usedAllowlist.has(i) && entry.selector === selector && entry.easing === easing,
        );
        if (idx === -1) {
          offenders.push(`${selector} { ...${easing}... }`);
        } else {
          usedAllowlist.add(idx);
        }
      }
    }

    expect(offenders, "an easing that is neither a token nor a named allowlist entry").toEqual([]);
    expect(
      CSS_EASING_ALLOWLIST.filter((_, i) => !usedAllowlist.has(i)),
      "every allowlist entry must match something real in the stylesheet, or it is dead weight",
    ).toEqual([]);
  });

  /**
   * A folder's picked mark (a stock glyph with no named parts) moves as a whole
   * under the same row triggers as the hand-drawn marks: `.icon-picked` names
   * its keyframes in `--nav-anim`, takes the shared duration and curve, and is
   * wired up inside the reduced-motion + fine-pointer guard (2026-10-08).
   */
  it("gives a picked mark one hover answer, on the shared tokens and inside the motion guard", () => {
    const rule = code.match(/\.icon-picked\s*\{([^}]*)\}/);
    expect(rule, "an .icon-picked rule").toBeTruthy();
    const body = rule![1];
    expect(body).toContain("--nav-anim: nav-picked");
    expect(body).toContain("animation-duration: var(--nav-mark-ms)");
    expect(body).toContain("animation-timing-function: var(--ease-nudge)");
    expect(code).toMatch(/@keyframes nav-picked\s*\{/);

    const guard = code.indexOf(
      "@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    const trigger = code.search(/\.icon-merge-front,\s*\.icon-picked\s*\)\s*\{\s*animation-name: var\(--nav-anim\)/);
    expect(guard).toBeGreaterThan(-1);
    expect(trigger, "the shared trigger lists .icon-picked").toBeGreaterThan(guard);
    expect(code.slice(0, guard)).not.toMatch(/\.icon-picked[^{]*\{[^}]*animation-name/);
  });
});

describe("components take their duration and easing from motion.ts", () => {
  const files = sourceFiles(SRC_DIR);
  const MOTION_FILE = "lib/motion.ts";

  /**
   * Deliberately empty, and worth keeping that way. Every duration and easing
   * a component reaches for now has a name in `motion.ts` — including the two
   * that were briefly listed here, `useBoardPaging`'s `settleDeck` and
   * `useNoteSwiping`'s `settle`, which turned out to be the same move written
   * twice and are now one `settleBack` (`lib/swipe.ts`). An entry added here is a
   * statement that some move cannot be named, which `web/CLAUDE.md` answers
   * directly: if no constant fits, the move is wrong.
   */
  const COMPONENT_ALLOWLIST = new Set<string>([]);

  it("never gives .animate() a raw number or a quoted easing string", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === MOTION_FILE) continue;
      const body = readFileSync(path.join(SRC_DIR, file), "utf8");
      for (const call of body.matchAll(/\.animate\(\s*[\s\S]*?\{([\s\S]*?)\}\s*\)/g)) {
        const opts = call[1];
        const duration = opts.match(/duration\s*:\s*([^,\n}]+)/)?.[1]?.trim();
        const delay = opts.match(/delay\s*:\s*([^,\n}]+)/)?.[1]?.trim();
        const easing = opts.match(/easing\s*:\s*([^,\n}]+)/)?.[1]?.trim();
        if (duration && /^\d/.test(duration)) {
          const entry = `${file}: duration: ${duration}`;
          if (!COMPONENT_ALLOWLIST.has(entry)) offenders.push(entry);
        }
        if (delay && /^\d/.test(delay)) {
          const entry = `${file}: delay: ${delay}`;
          if (!COMPONENT_ALLOWLIST.has(entry)) offenders.push(entry);
        }
        if (easing && /^["']/.test(easing)) {
          offenders.push(`${file}: easing: ${easing}`);
        }
      }
      // The narrower blind spot: a raw ms literal handed to a local helper
      // whose own parameter is named `duration` (e.g. the old
      // `fadeOut(parts, 90)`), which the check above can't see through
      // without an AST.
      for (const m of body.matchAll(/\b(\w+)\(\s*\w+\s*,\s*(\d+)\s*\)/g)) {
        const [, fn, ms] = m;
        const isDurationHelper = new RegExp(
          `function\\s+${fn}\\s*\\([^)]*duration\\s*:\\s*number`,
        ).test(body);
        if (isDurationHelper) offenders.push(`${file}: ${fn}(..., ${ms}) — raw ms into a duration param`);
      }
    }
    expect(offenders, "duration and easing come from lib/motion.ts, never a literal").toEqual([]);
  });
});

/**
 * The measure is a number of ems, so it is only a width once you know whose
 * ems. `.reader` is set at --t-read and `.sheet-verbs` in the data face at
 * --t-data, and the same "33em" in each buys two different columns — the
 * strip came out barely two thirds as wide and, centred, sat indented from
 * the first letter of every line above it. Whatever the two say, they have
 * to say it at the same size.
 */
describe("the note and its verbs share one measure", () => {
  function declarations(selector: string): string {
    const at = code.indexOf(`${selector} {`);
    expect(at, `styles.css must define ${selector}`).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf("}", at));
  }

  it("states the strip's width in the same ems as the text", () => {
    // The first `.reader {` in the file is the block it shares with `.editor`,
    // which is where the measure and the reading size are both set.
    const text = declarations(".reader");
    const verbs = declarations(".sheet-verbs");
    const measure = /max-width:\s*([^;]+);/;

    const textWide = (text.match(measure) ?? [])[1]?.trim();
    expect(textWide, "the text states a measure").toBeTruthy();
    const stripWide = (verbs.match(measure) ?? [])[1]?.trim();
    expect(stripWide, "the strip carries the text's measure").toBe(textWide);

    // ...and buys it at the text's size, or the number is not the same width.
    expect(text).toMatch(/font-size:\s*var\(--t-read\)/);
    expect(verbs).toMatch(/font-size:\s*var\(--t-read\)/);
  });

  /**
   * The editor sits inside `.editor-field`, which carries the same 33em. Left
   * at the page's 16px it was 16.5px narrower than the reader, so tapping into
   * a note stepped every line ~8px sideways and re-broke them.
   */
  it("holds the editor's wrapper to the text's measure, at the text's size", () => {
    const text = declarations(".reader");
    const field = declarations(".editor-field");
    const measure = /max-width:\s*([^;]+);/;
    expect((field.match(measure) ?? [])[1]?.trim()).toBe((text.match(measure) ?? [])[1]?.trim());
    expect(field).toMatch(/font-size:\s*var\(--t-read\)/);
  });

  /** No rule over the strip: it is already small, muted and set apart. */
  it("draws no rule above the strip", () => {
    expect(declarations(".sheet-verbs")).not.toMatch(/border/);
  });
});

/**
 * The ✕ that empties the write box has to be *on top of* the write box.
 *
 * It was not, and the bug it caused looks like nothing at all: the button
 * draws, lights, and takes no click. `.capture-field` isolates; the textarea
 * inside it is lifted (`position: relative; z-index: 1`) so the words sit over
 * the lamp; and this button is absolutely positioned in the same stacking
 * context. With no z-index of its own it painted *under* the field, whose box
 * covers the whole corner — `padding-right` reserves the room the mark is
 * drawn in but does not shorten the element. So the field ate every press.
 *
 * Checked here rather than in a component test because nothing about it is
 * visible to jsdom: it has no layout, so both elements are at the origin with
 * zero size and a synthetic click reaches whatever is asked for it.
 */
describe("the write box's clear mark can be pressed", () => {
  function zIndex(selector: string): number {
    const at = code.indexOf(`${selector} {`);
    expect(at, `styles.css must define ${selector}`).toBeGreaterThan(-1);
    const block = code.slice(at, code.indexOf("}", at));
    const found = block.match(/z-index:\s*(-?\d+)/);
    expect(found, `${selector} must state a z-index`).toBeTruthy();
    return Number(found![1]);
  }

  it("stands above the field it clears", () => {
    expect(zIndex(".capture button.field-clear")).toBeGreaterThan(
      zIndex(".capture textarea"),
    );
  });
});

/**
 * The drawer opened from inside a note has to open over the note.
 *
 * The note is a full-screen sheet at its own step, above the board, and the
 * drawer was built for the board: at `.shelf`'s step it would slide in under
 * the sheet, and so would the menu and the Look sheet a long-press in it
 * opens. jsdom has no layout, so a component test would tap straight through.
 */
describe("the shelf opened from inside a note stands over it", () => {
  function zIndex(selector: string): number {
    // Anchored to a line start: `.sheet {` is also the tail of `.canvas-sheet {`.
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `styles.css must define ${selector}`).toBeGreaterThan(-1);
    const block = code.slice(at, code.indexOf("}", at));
    const found = block.match(/z-index:\s*(-?\d+)/);
    expect(found, `${selector} must state a z-index`).toBeTruthy();
    return Number(found![1]);
  }

  it("lifts the drawer, its scrim and what it opens above the sheet", () => {
    const sheet = zIndex(".sheet");
    for (const over of [".shelf-over", ".menu-dismiss-over", ".selpanel-over", ".look-over"]) {
      expect(zIndex(over), over).toBeGreaterThan(sheet);
    }
    // ...and the drawer over its own scrim, or a tap on a row would close it.
    expect(zIndex(".shelf-over")).toBeGreaterThan(zIndex(".menu-dismiss-over"));
  });
});

/**
 * A folder's Look sheet opened from the drawer stands on the drawer's lower
 * part, and the drawer makes room for it: its rows stand above the sheet, where
 * the folder being dressed can be seen taking its mark and tint (review
 * 2026-10-01 follow-up). On a phone the rows stand at the drawer's foot
 * (UX-17), which is exactly where the sheet lands — so without the room the
 * sheet covered the very row it was dressing and left an empty drawer showing
 * above it. The room is the sheet's own height, one token for both.
 */
describe("the drawer makes room for a Look sheet over it", () => {
  function block(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `styles.css must define ${selector}`).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf("}", at));
  }

  it("keeps the drawer's rows clear of the sheet by the sheet's own height", () => {
    expect(block(":root")).toMatch(/--look-h:\s*[^;]+;/);
    expect(block(".look")).toMatch(/max-height:\s*var\(--look-h\)/);
    // Held at that height while a search narrows the marks, or the field and
    // swatches slide away from under the pointer.
    expect(block(".look")).toMatch(/\n\s*height:\s*var\(--look-h\)/);
    const dressing = block(".shelf[data-dressing]");
    expect(dressing).toMatch(/padding-bottom:\s*calc\(var\(--look-h\)/);
    // So bringing the row into view puts it above the sheet, not under it.
    expect(dressing).toMatch(/scroll-padding-bottom:\s*var\(--look-h\)/);
  });
});

/**
 * The capture bar paints one control, and it is Save.
 *
 * Everything else on that row — the three marks, Attach, Menu — is chrome: a
 * glyph on the bar's own ground that raises when it is on. The bar spent a
 * long time doing the exact opposite, and by accident. The shared rule was
 * written as `.capture button`, which is a class *and an element* and so
 * outranks the plain `.capture-icon` beneath it: every button in the bar came
 * out in full ink, and since `.capture-icon[aria-pressed="true"]` carries two
 * classes and does win, a mark that was *off* was brighter than a mark that
 * was *on*. The marks read backwards for as long as they had existed.
 *
 * The same selector reached past the bar entirely, into the add panel and the
 * board chooser that the form renders inside itself, and gave their rows a
 * bar's height and a caps tracking they are drawn without everywhere else.
 *
 * None of it is visible to jsdom, which does not cascade — so it is held here,
 * as a rule about the stylesheet rather than about a rendered tree.
 */
describe("the capture bar's paint", () => {
  /** The declarations of the first rule whose selector starts exactly here. */
  function from(anchor: string): string {
    const found = code.indexOf(anchor);
    expect(found, `styles.css must contain ${anchor}`).toBeGreaterThan(-1);
    return code.slice(found, code.indexOf("}", found));
  }

  it("has no blanket rule over every button in the bar", () => {
    expect(
      code.includes(".capture button {"),
      "that selector outranks .capture-icon and reaches the panels the form " +
        "renders — state the geometry on the classes that want it",
    ).toBe(false);
  });

  it("leaves the chrome unpainted", () => {
    const icon = from(".capture-icon {");
    expect(icon).toContain("background: transparent");
    expect(icon).toContain("color: var(--muted)");
  });

  it("raises a mark that is on, rather than the one that is off", () => {
    const on = from('.capture-icon[aria-pressed="true"] {');
    expect(on).toContain("background: var(--raised)");
    expect(on).toContain("color: var(--ink)");
  });

  it("keeps the ink for Save alone", () => {
    // The last one at the left margin: the first .capture-save is the
    // geometry it shares with .capture-icon, and the paint is the standalone
    // rule after it. (The phone's row restates its size, indented inside a
    // media block, and that is not the paint.)
    const paint = code.lastIndexOf("\n.capture-save {");
    expect(paint, "styles.css must define .capture-save").toBeGreaterThan(-1);
    expect(code.slice(paint, code.indexOf("}", paint))).toContain(
      "background: var(--invert)",
    );
  });
});

/**
 * The field may not ask for a width of its own.
 *
 * A flex container measures each item at its *hypothetical* size — its basis
 * — before it shrinks anything, so a field with `flex-basis: auto` was
 * measured at the textarea's own natural width (some twenty characters plus
 * its padding) and, while the bar still wrapped, pushed the last button in
 * the bar onto a line by itself, in the bottom-left corner under nothing. The
 * bar is a column of rows now and cannot wrap, but the basis of 0 is still
 * what lets the corner cells keep their size on a narrow row while the field
 * grows into whatever they leave. jsdom does no layout, so this too is a rule
 * about the stylesheet rather than about a rendered tree.
 */
describe("the write box asks for no width of its own", () => {
  it("states a zero flex basis", () => {
    const found = code.indexOf(".capture-field {");
    expect(found, "styles.css must define .capture-field").toBeGreaterThan(-1);
    expect(
      code.slice(found, code.indexOf("}", found)),
      "a content-sized basis wraps a control off the row on a phone",
    ).toContain("flex: 1 1 0;");
  });
});

/**
 * On a phone, the words take the whole width and the marks and Save stand on a
 * row under them (owner, 2026-09-29, with the Claude app's message box as the
 * reference). On a desktop the bar is the one row it has been since the owner
 * chose it on 2026-09-04, and nothing here may leak into it.
 *
 * jsdom lays nothing out, so the shape is read from the stylesheet: the two
 * rows are named grid areas, every rule keyed on `data-ready` sits inside the
 * phone's media block, and the field's cap there is measured against the
 * visible height rather than the whole screen.
 */
describe("the phone's capture bar: the words on top, the marks and Save underneath", () => {
  /** The whole `@media (...) { ... }` block that encloses `index`. */
  function enclosingMedia(index: number): { query: string; body: string } | null {
    let at = code.lastIndexOf("@media", index);
    while (at > -1) {
      const open = code.indexOf("{", at);
      let depth = 0;
      let end = open;
      for (; end < code.length; end++) {
        if (code[end] === "{") depth++;
        else if (code[end] === "}" && --depth === 0) break;
      }
      if (end > index) {
        return { query: code.slice(at, open).trim(), body: code.slice(open + 1, end) };
      }
      at = code.lastIndexOf("@media", at - 1);
    }
    return null;
  }

  const PHONE = "@media (max-width: 699px)";

  function phoneBlock(): string {
    const at = code.indexOf(".capture[data-ready] {");
    expect(at, "styles.css lays out .capture[data-ready]").toBeGreaterThan(-1);
    const media = enclosingMedia(at);
    expect(media?.query).toBe(PHONE);
    return media!.body;
  }

  /** One rule's declarations, inside a given body of CSS. */
  function rule(body: string, selector: string): string {
    const at = body.indexOf(`${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    return body.slice(at, body.indexOf("}", at));
  }

  it("keys every rule about the two-row shape to the phone's width", () => {
    const uses = [...code.matchAll(/\.capture\[data-ready\]/g)].map((m) => m.index);
    expect(uses.length).toBeGreaterThan(0);
    for (const at of uses) {
      expect(enclosingMedia(at)?.query, "a desktop bar is one row").toBe(PHONE);
    }
  });

  it("names the rows: the field across the top, the marks left and Save right beneath", () => {
    const bar = rule(phoneBlock(), ".capture[data-ready]");
    expect(bar).toMatch(/display:\s*grid/);
    // The undo cell, while one stands (a short screen only since 2026-10-16),
    // joins the lower row just short of Save; with none, its column takes no width.
    expect(bar).toMatch(/grid-template-areas:\s*"field field field"\s*"marks undo save"/);
    expect(rule(phoneBlock(), ".capture[data-ready] .undo-slot-bar")).toMatch(/grid-area:\s*undo/);
    expect(rule(phoneBlock(), ".capture[data-ready] .capture-field")).toMatch(/grid-area:\s*field/);
    expect(rule(phoneBlock(), ".capture[data-ready] .capture-marks")).toMatch(/grid-area:\s*marks/);
    expect(rule(phoneBlock(), ".capture[data-ready] .capture-save")).toMatch(/grid-area:\s*save/);
  });

  it("leaves the desktop bar a single flex row", () => {
    const at = code.indexOf("\n.capture {");
    expect(at).toBeGreaterThan(-1);
    expect(enclosingMedia(at), "the bar's own rule is not inside a media block").toBeNull();
    expect(code.slice(at, code.indexOf("}", at))).toMatch(/display:\s*flex/);
  });

  it("caps the field against the visible height, between three rows and --capture-max", () => {
    const cap = rule(phoneBlock(), ".capture-field textarea");
    expect(cap).toMatch(/max-height:\s*clamp\(/);
    expect(cap).toContain("var(--visible-h, 100dvh)");
    expect(cap).toContain("var(--capture-max)");
  });
});

/**
 * Every pointer target is a thumb's worth. The design's own rule — "rows are
 * ~44px so a thumb can hit them" — is one token, `--hit`, and on 2026-09-04
 * sixteen controls were under it (audit F6): the sign-in link, the header's
 * device-state button, the open note's six bar marks, its three
 * footer verbs, the reminder stamp, the custom reminder date, every dialog's
 * buttons, the Sorter's ✕, the search ✕, the capture marks and the H/B/I row.
 * jsdom lays nothing out, so this reads the declarations rather than the
 * boxes: each of those controls has to take its height, or its hit box, from
 * the token. The drawn size can be whatever the design fixes; the box around
 * it cannot be smaller than this.
 */
describe("every pointer target is a thumb's worth", () => {
  it("declares the floor once, as a token", () => {
    expect(code).toMatch(/--hit:\s*44px/);
  });

  /** The first `{ ... }` block whose selector line matches, exactly — at the
   *  left margin, or indented once inside a media block. */
  function block(selector: string): string {
    const flush = code.indexOf(`\n${selector} {`);
    const at = flush > -1 ? flush : code.indexOf(`\n  ${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  const takeTheToken: Array<[string, RegExp]> = [
    [".signin-skip", /min-height:\s*var\(--hit\)/],
    ["button.sync-state", /min-height:\s*var\(--hit\)/],
    [".iconbtn", /height:\s*var\(--hit\)/],
    [".meta-verb", /min-height:\s*var\(--hit\)/],
    [".meta-stamp", /min-height:\s*var\(--hit\)/],
    // "Add a name" over the open note's text (review 2026-10-01, UX-23).
    [".sheet-name-offer", /min-height:\s*var\(--hit\)/],
    [".selpanel-row input", /min-height:\s*var\(--hit\)/],
    [".dialog-actions .btn", /min-height:\s*var\(--hit\)/],
    [".sorter-done", /height:\s*var\(--hit\)/],
    [".board-search", /min-height:\s*var\(--hit\)/],
    [".fmtbtn", /min-height:\s*var\(--hit\)/],
    // The capture marks. They were drawn at 40 on a phone, to leave the field
    // room beside them, and answered the finger at 44 through a pseudo-element
    // reaching past both edges. Since 2026-09-29 a phone puts them on a row of
    // their own under the words, so they are a thumb's worth each way on every
    // width: wide by the token everywhere, and tall by it on that row.
    [".capture-marks .capture-mark", /width:\s*var\(--hit\)/],
    [".capture[data-ready] .capture-mark", /height:\s*var\(--hit\)/],
    // The open note's tick box, on the same terms and for a sharper reason: it
    // stood 30x18 in the middle of a paragraph, and missing it puts the caret
    // in the text and raises a phone's keyboard. It cannot *grow* to 44 the way
    // a footer verb does — it sits inside a line, so its `:active` inversion
    // would become a three-line slab — so the box stays the marker's own and
    // the target is laid over it: under the drag grip (which stands over it)
    // and in over the item's first characters, a thumb's worth wide whatever
    // the reading size (2026-10-13, review QA-03).
    [".check-hit::after", /height:\s*var\(--hit\)/],
    [".check-hit::after", /width:\s*calc\(20px \+ var\(--hit\)\)/],
    // The confirm panel's ✕, which was 40 while the panel's own buttons
    // already read the token — on the one panel that asks before it destroys.
    [".dialog-close", /height:\s*var\(--hit\)/],
    // The canvas toolbar, which was the last row of 40s and 34s and 22s in the
    // app — on the one surface that is *drawn on* with a finger. Height only
    // for the last three: each of those controls is a sample of what it draws,
    // so widening it means redrawing it, and that is a layout decision rather
    // than a token one. It is written down in the stylesheet beside them.
    [".canvas-tool-btn", /height:\s*var\(--hit\)/],
    [".canvas-color-btn", /height:\s*var\(--hit\)/],
    [".canvas-width-btn", /height:\s*var\(--hit\)/],
    [".canvas-zoom-btn", /height:\s*var\(--hit\)/],
    // The empty Inbox's offers, the first thing a new user presses.
    [".empty-offer", /min-height:\s*var\(--hit\)/],
  ];

  for (const [selector, rule] of takeTheToken) {
    it(`${selector} takes its box from the token`, () => {
      expect(block(selector)).toMatch(rule);
    });
  }

  /**
   * The board row is one height in every shape (audit 2026-09-04, F9). The
   * strip stood 49 inside a row pinned at 44 because the tabs brought 12px of
   * padding around a 24px mark, so the desktop board moved 5px whenever search
   * opened. Now the row and everything that fills it read one token, and none
   * of the contents carries vertical padding of its own.
   */
  it("holds the board row at one height whatever fills it", () => {
    expect(code).toMatch(/--shelf-row-h:\s*44px/);
    for (const selector of [".board-row", ".board-tab", ".board-tab-new", ".board-mode", ".search", ".board-current"]) {
      const b = block(selector);
      expect(b, `${selector} takes the row's height`).toMatch(/min-height:\s*var\(--shelf-row-h\)/);
      expect(b, `${selector} brings no vertical padding of its own`).not.toMatch(/padding:\s*[1-9]/);
    }
  });

  it("keeps the meta verbs and the stamp from growing the footer row", () => {
    // 44 less twice 6 is the 32 the row has always been.
    expect(block(".meta-verb")).toMatch(/margin:\s*-6px 0/);
    expect(block(".meta-stamp")).toMatch(/margin:\s*-6px 0/);
  });
});

/**
 * Who owns a touch, said out loud on every surface that has an opinion.
 *
 * `touch-action` is the only way to tell the browser it may not take a gesture
 * away, and the app already declares it on the four surfaces that hear two
 * fingers (`.canvas-surface`, `.spatial-note`, `.item-grip`, `.lightbox-frame`
 * — all `none`) and on the note sheet, which keeps the vertical scroll and
 * spends the horizontal one itself. The board was the hole in that: `.card`
 * and `.grid` said nothing, so the browser watched the first pixels of every
 * touch on a card and, deciding the finger was scrolling, took the pointer and
 * sent `pointercancel` — in the middle of a merge drag, which NoteCard was
 * committing as a merge.
 *
 * `pan-y` is the value and neither neighbour will do. `auto` is the hole
 * itself; `none` would be a board that cannot be scrolled, since the grid is
 * nothing but cards. Horizontal paging is untouched either way — it lives on
 * `.scroll` as touch handlers driving `.deck`'s transform, and `touch-action`
 * governs the browser's own scrolling, never whether an ancestor hears a
 * touch.
 */
describe("who owns a touch on the board", () => {
  function block(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  it("keeps the vertical scroll on a card and refuses the rest", () => {
    const b = block(".card");
    expect(b, "a card must say who owns a touch").toMatch(/touch-action:\s*pan-y\s*;/);
    expect(
      b,
      "`none` here would be a board that cannot be scrolled — the grid is all card",
    ).not.toMatch(/touch-action:\s*none/);
  });

  it("says the same thing on the sheet, in the same word", () => {
    // Named so the two cannot drift apart quietly: the note sheet and the card
    // it grew out of make the identical trade, and a reader who finds one
    // should find the other.
    expect(block(".sheet")).toMatch(/touch-action:\s*pan-y\s*;/);
  });

  it("leaves every surface that hears two fingers refusing outright", () => {
    for (const selector of [".canvas-surface", ".spatial-note", ".item-grip", ".lightbox-frame"]) {
      expect(block(selector), `${selector} must keep both pointers`).toMatch(
        /touch-action:\s*none\s*;/,
      );
    }
  });
});

describe("the open note's marks", () => {
  /**
   * The furniture raises, the content inverts. `.iconbtn` is the open note's
   * six marks (and the lightbox's and the idea's), and an engaged one was an
   * ink slab held on screen for as long as the note was open.
   */
  it("raise when on or pressed, never invert", () => {
    const at = source.indexOf('.iconbtn[data-on="true"] {');
    expect(at, "styles.css must define the engaged .iconbtn").toBeGreaterThan(-1);
    const rule = source.slice(at, source.indexOf("}", at));
    expect(rule).toContain("background: var(--raised)");
    expect(rule).toContain("color: var(--ink)");
    expect(rule).not.toContain("--invert");
  });
});

/**
 * An empty board stands in the middle of the room it has (2026-09-29, the
 * owner's ask), and it must never be pushed out of reach doing it. Centring by
 * alignment — `justify-content: center` — overflows *both* ways when the room
 * is shorter than the state, which on a phone on its side puts the mascot and
 * the heading above the top of the scroller where nothing can scroll to them.
 * Auto margins collapse to nothing instead, so a short screen gets the state
 * top-aligned and scrollable. The rule is checked as written because jsdom
 * lays nothing out.
 */
describe("the empty board is centred, and never out of reach", () => {
  function rule(selector: string): string {
    const at = code.indexOf(`
${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  it("makes the scroller a column while it holds an empty board", () => {
    // The deck stands in the tab panel inside the <main> (review QA-02), so
    // the column runs through the panel as well.
    expect(rule(".scroll:has(> .board-panel > .deck > .empty)")).toMatch(/display:\s*flex;[\s\S]*flex-direction:\s*column;/);
    for (const selector of [
      ".scroll:has(> .board-panel > .deck > .empty) > .board-panel",
      ".board-panel:has(> .deck > .empty) > .deck",
    ]) {
      // At least the scroller's height, and free to grow past it.
      expect(rule(selector), selector).toMatch(/flex:\s*1 0 auto;/);
      expect(rule(selector), selector).toMatch(/flex-direction:\s*column;/);
    }
  });

  it("centres with auto margins, never by alignment", () => {
    expect(rule(".deck > .empty")).toMatch(/margin:\s*auto;/);
    for (const selector of [
      ".scroll:has(> .board-panel > .deck > .empty)",
      ".scroll:has(> .board-panel > .deck > .empty) > .board-panel",
      ".board-panel:has(> .deck > .empty) > .deck",
      ".deck > .empty",
    ]) {
      expect(rule(selector), selector).not.toMatch(/justify-content|align-items:\s*center/);
    }
  });

  /**
   * The offers under it are the invitation finished, not the machine
   * speaking: the words' face at the words' size, not uppercase mono, and the
   * first of them one step up the ramp and nothing more.
   */
  it("says its offers in the words' face, the first one step up the ramp", () => {
    const offer = rule(".empty-offer");
    expect(offer).toMatch(/font-family:\s*var\(--body\);/);
    expect(offer).toMatch(/font-size:\s*var\(--t-text\);/);
    expect(offer).not.toMatch(/text-transform|--mono/);
    const first = rule(".empty-offer-first");
    expect(first).toMatch(/color:\s*var\(--ink\);/);
    expect(first).toMatch(/border-color:\s*var\(--muted\);/);
    expect(first).not.toMatch(/background/);
  });

  // Review UI-19: centred in what the mark left over, each label broke onto
  // two cramped lines. One line, the mark and the words together from the left.
  it("keeps each offer on one line, its label beside its mark", () => {
    const offer = rule(".empty-offer");
    expect(offer).toMatch(/white-space:\s*nowrap;/);
    expect(offer).toMatch(/justify-content:\s*flex-start;/);
  });
});

/**
 * The About page names the app with the header's own wordmark (review UI-20):
 * the same face, size and tracking, and capitals, since only capitals and
 * monospace are ever tracked (DESIGN.md §4).
 */
describe("the About page's wordmark is the header's", () => {
  function rule(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `${selector} is declared`).toBeGreaterThan(-1);
    const open = code.indexOf("{", at);
    return code.slice(open, code.indexOf("}", open) + 1);
  }

  it("is set in tracked capitals, exactly as the header sets it", () => {
    for (const selector of [".wordmark", ".about-mark"]) {
      const mark = rule(selector);
      expect(mark, selector).toMatch(/text-transform:\s*uppercase;/);
      expect(mark, selector).toMatch(/letter-spacing:\s*var\(--track-mark\);/);
      expect(mark, selector).toMatch(/font-size:\s*var\(--t-read\);/);
    }
  });

  it("folds the header away on a short screen and carries the creature in the board row (review UI-B-06)", () => {
    const at = code.indexOf("@media (max-height: 500px) {\n  .app {");
    expect(at, "the short-screen block is declared").toBeGreaterThan(-1);
    const block = code.slice(at, code.indexOf("\n}\n", code.indexOf(".board-row {", at)) + 3);
    // The band is gone but the one creature stays, in the row's own corner.
    expect(block).toMatch(/\.topbar \{[^}]*position: absolute;/);
    expect(block).toMatch(/\.topbar spar-mascot \{[^}]*transform: scale/);
    // What the creature says still stands, as a plate under the row.
    expect(block).not.toMatch(/\.topbar-words \{[^}]*display:\s*none/);
    expect(block).toMatch(/\.board-row \{[^}]*padding-left: var\(--shelf-row-h\);/);
    expect(block).not.toMatch(/spar-mascot[^{]*\{[^}]*display:\s*none/);
  });

  it("stands where the header's does, so opening it moves nothing (review UI-B-11)", () => {
    const head = rule(".topbar");
    const about = rule(".about-head");
    // The same gap, and the same padding on the three edges the Close button
    // does not share (the right edge keeps the exit mark's place free).
    expect(about).toContain("gap: var(--head-gap);");
    expect(head).toContain("gap: var(--head-gap);");
    expect(about).toContain(
      "padding: calc(var(--head-top) + env(safe-area-inset-top)) var(--exit-clear) var(--head-bottom) var(--head-x);",
    );
    expect(head).toContain(
      "padding: calc(var(--head-top) + env(safe-area-inset-top)) var(--head-x) var(--head-bottom);",
    );
    // The masthead is on the 8px grid (2026-10-08): a 56 box, 8 above, 16 below.
    expect(code).toMatch(/--mascot-box:\s*56px;/);
    expect(code).toMatch(/--head-top:\s*var\(--s-4\);/);
    expect(code).toMatch(/--head-bottom:\s*var\(--s-6\);/);
    expect(code).toMatch(/--head-x:\s*var\(--s-6\);/);
    expect(code).toMatch(/--head-gap:\s*var\(--s-6\);/);
  });
});

/**
 * The open note's files are a grid of small squares under the words (owner,
 * 2026-10-17). A square is the picture and nothing else: its name, Save and
 * Remove are in the viewer it opens. It is fixed before the picture decodes,
 * on film at rest so screenshots never outshine the words, and lit under a
 * mouse or a keyboard's focus.
 */
describe("a picture in the open note is a quiet square", () => {
  function rule(selector: string): string {
    const at = code.indexOf(`\n${selector} {`);
    expect(at, `styles.css must define ${selector}`).toBeGreaterThan(-1);
    return code.slice(at, code.indexOf("}", at));
  }

  it("is a square fixed before anything is known about the picture", () => {
    expect(rule(".attach-tile")).toMatch(/aspect-ratio:\s*1;/);
    expect(rule(".attach-tile .attach-shot")).toMatch(/object-fit:\s*cover/);
  });

  it("rests on the cards' film, never a fraction of its own", () => {
    expect(rule(".attach-tile .attach-shot")).toMatch(/opacity:\s*var\(--shot-opacity\)/);
    expect(rule(".attach-tile:focus-visible .attach-shot")).toMatch(/opacity:\s*1/);
  });

  it("lights under a mouse only where there is one", () => {
    const at = code.indexOf("\n  .attach-tile:hover .attach-shot {");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(code.lastIndexOf("@media", at), at)).toMatch(/\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  });

  it("stamps no control over the picture", () => {
    expect(code).not.toMatch(/\.attach-tile[^{]*\.attach-remove/);
  });

  it("shows a document's first page as itself, never dimmed", () => {
    const doc = rule('.attach-tile .attach-shot[data-doc="true"]');
    expect(doc).toMatch(/filter:\s*var\(--doc-filter\)/);
    expect(doc).toMatch(/opacity:\s*1/);
  });

  /** Six controls and a name do not fit a 360px phone: Remove went off the edge. */
  it("lets the viewer's bar take two lines on a phone", () => {
    const at = code.indexOf("\n  .lightbox-bar {\n    flex-wrap: wrap;");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(code.lastIndexOf("@media", at), at)).toMatch(/max-width:\s*699px/);
  });
});

/**
 * The lens run's ground (DESIGN.md §2, `--lens-ground`, 2026-10-08, owner
 * approved): Todos, Links, Files, All and Trash stand on a slightly lifted
 * ground, so the built-in ways of looking read differently from the boards
 * the user made. It must stay the quietest lift there is.
 */
describe("the lens run stands on one quiet lifted ground", () => {
  it.each(RAMPS)(
    "is one quiet step off the $theme paper, short of the engaged chrome",
    ({ block }) => {
      const t = (name: string) => tokenValue(name, block);
      // Between the paper and --raised, whichever way the ramp runs.
      const [paper, ground, raised] = ["--paper", "--lens-ground", "--raised"].map((n) =>
        luminance(t(n)),
      );
      expect((ground - paper) * (raised - ground)).toBeGreaterThan(0);
      // 1.0x–1.15x of the paper: a lift you notice by comparison, not a fill.
      expect(contrast(t("--lens-ground"), t("--paper"))).toBeLessThan(1.15);
      // Secondary text still clears its floor on it.
      expect(contrast(t("--muted"), t("--lens-ground"))).toBeGreaterThan(4.5);
    },
  );

  it("fills the lens tabs, the trash tab and the drawer rows, and nothing else", () => {
    const uses = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*var\(--lens-ground\)[^{}]*)\}/g)];
    expect(uses).toHaveLength(1);
    const selector = uses[0][1].replace(/\s+/g, " ").trim();
    expect(selector).toBe(
      ':where(.board-tab, .board-trash, .shelf-row)[data-lens="true"]',
    );
    expect(uses[0][2]).toMatch(/background:\s*var\(--lens-ground\)/);
  });
});

/**
 * The Inspiration wall is the one masonry (DESIGN.md §8, 2026-10-08): every
 * rule that gives a tile a height of its own is scoped to `.wall` or to a
 * `[data-wall]` card, and the grid every other board draws is untouched.
 */
describe("the Inspiration wall stays the one masonry", () => {
  it("leaves the uniform grid exactly as it was", () => {
    expect(afterTokens).toMatch(/\.grid\s*\{[^}]*grid-auto-rows:\s*var\(--card-h\)/);
    expect(afterTokens).toMatch(/\.card\s*\{[^}]*height:\s*var\(--card-h\)/);
  });

  it("scopes every rule that frees a card's height to the wall", () => {
    const rules = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const [, selector, body] of rules) {
      if (!/\.card\b/.test(selector) || !/height:\s*auto/.test(body)) continue;
      // peek, a Links row and a hovered card free their own height already; a
      // named picture sizes the picture inside the card, never the card
      if (/data-peek|data-row|data-wall|\.card-idea-name\s*\+\s*\.card-shot/.test(selector)) continue;
      throw new Error(`a rule frees a card's height outside the wall: ${selector.trim()}`);
    }
  });

  it("draws no gutter: a tile has its right and bottom hairline and the columns do not gap", () => {
    expect(afterTokens).toMatch(/\.wall\s*\{[^}]*display:\s*flex/);
    expect(afterTokens).not.toMatch(/\.wall(?:-col)?\s*\{[^}]*\bgap:\s*[1-9]/);
    expect(afterTokens).toMatch(/\.card\[data-wall="true"\]\s*\{[^}]*border-right:\s*1px solid var\(--rule\)/);
    expect(afterTokens).toMatch(/\.card\[data-wall="true"\]\s*\{[^}]*border-bottom:\s*1px solid var\(--rule\)/);
  });

  it("states the pinned heights the arithmetic in lib/wall.ts assumes", async () => {
    const wall = await import("./lib/wall");
    const px = (name: string) => {
      const m = new RegExp(`${name}:\\s*(\\d+)px`).exec(code);
      expect(m, name).toBeTruthy();
      return Number(m![1]);
    };
    expect(px("--wall-caption-h")).toBe(wall.WALL_CAPTION_PX);
    expect(px("--wall-site-h")).toBe(wall.WALL_SITE_PX);
    expect(px("--wall-title-h")).toBe(wall.WALL_TITLE_PX);
    expect(px("--wall-quote-h")).toBe(wall.WALL_QUOTE_PX);
  });

  it("pins the caption and the site to the height the arithmetic reserves for them", () => {
    expect(afterTokens).toMatch(/\.wall-caption\s*\{[^}]*height:\s*var\(--wall-caption-h\)/);
    expect(afterTokens).toMatch(/\.wall-site\s*\{[^}]*height:\s*var\(--wall-site-h\)/);
    expect(afterTokens).toMatch(/\.card\[data-tile="title"\]\s*\{[^}]*height:\s*var\(--wall-title-h\)/);
    expect(afterTokens).toMatch(/\.card\[data-tile="quote"\]\s*\{[^}]*height:\s*var\(--wall-quote-h\)/);
  });

  it("lets a long title or address give way — an ellipsis, never a wider column", () => {
    expect(afterTokens).toMatch(/\.wall-col\s*\{[^}]*min-width:\s*0/);
    expect(afterTokens).toMatch(/\.wall-site\s*\{[^}]*text-overflow:\s*ellipsis/);
  });

  it("inverts a picked tile's ground and every word on it, and never the photograph", () => {
    const rules = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) =>
      /\[data-wall="true"\]\[data-selected="true"\]/.test(selector),
    );
    const selectors = rules.map(([, s]) => s.replace(/\s+/g, " ")).join(" | ");
    const inPaper = rules
      .filter(([, , body]) => /(^|[\s;])color:\s*var\(--paper\)/.test(body))
      .map(([, s]) => s)
      .join(" ");
    // Names, captions, title-card text, the site; the quote's words are
    // `.card-body`, which the generic selected rule already takes to --paper.
    for (const word of [".wall-caption", ".wall-site", ".wall-title-name", ".wall-tick"]) {
      expect(inPaper, `${word} goes to --paper on a picked tile`).toContain(word);
    }
    // A photograph keeps its own tones: nothing selected-and-wall touches the
    // picture itself. Its frame is a pseudo-element drawn over it (below).
    expect(selectors.replace(/\.wall-pic::after/g, "")).not.toMatch(/\.wall-img|\.wall-pic/);
    // The slab itself is the existing selected rule, which the wall's own
    // border must not override with a hairline of its own tone.
    expect(afterTokens).toMatch(/\.card\[data-selected="true"\]\s*\{[^}]*background:\s*var\(--invert\)/);
    const order = (re: RegExp) => afterTokens.search(re);
    expect(order(/\.card\[data-wall="true"\]\s*\{/)).toBeLessThan(
      order(/\.card\[data-selected="true"\]\s*\{/),
    );
  });

  it("keeps the picking chip off every text tile's words, inside the pinned height", () => {
    // The chip is one fixed row, so the room taken for it is exact.
    expect(afterTokens).toMatch(/\.wall-tick\s*\{[^}]*height:\s*var\(--s-7\)/);
    // A quote (and a file tile, which is one) and a title card start their words
    // below it while a selection runs — padding inside the tile, never a height.
    const quote = /\.card\[data-tile="quote"\]:has\(>\s*\.wall-tick\)\s*\{([^}]*)\}/.exec(afterTokens);
    expect(quote, "quote tile reserves the chip's row").toBeTruthy();
    expect(quote![1]).toMatch(/padding-top:\s*var\(--s-7\)/);
    expect(quote![1]).not.toMatch(/height:/);
    const title = /\.wall-tick\s*~\s*\.wall-title\s*\{([^}]*)\}/.exec(afterTokens);
    expect(title, "title card reserves the chip's row").toBeTruthy();
    expect(title![1]).toMatch(/padding-top:\s*var\(--s-7\)/);
    expect(title![1]).not.toMatch(/height:/);
  });

  it("marks a picked picture with a 1px frame in --invert over it, never touching the photograph", () => {
    const frame = /\.card\[data-wall="true"\]\[data-selected="true"\]\s+\.wall-pic::after\s*\{([^}]*)\}/.exec(
      afterTokens,
    );
    expect(frame, "a picked picture draws a frame").toBeTruthy();
    expect(frame![1]).toMatch(/border:\s*1px solid var\(--invert\)/);
    expect(frame![1]).toMatch(/inset:\s*0/);
    expect(frame![1]).toMatch(/pointer-events:\s*none/);
    expect(frame![1]).not.toMatch(/shadow|radius|filter|opacity/);
  });
});

describe("a mark's stroke", () => {
  // Firefox drops a unitless calc() for stroke-width, falls back to 1 user unit
  // and draws every mark at a third of its weight. A length is read by every
  // engine, and a px in an SVG is a user unit, so the drawing is unchanged.
  it("is a length, which Firefox reads as well as Chromium", () => {
    const icon = /\n\.icon\s*\{([^}]*)\}/.exec(code);
    expect(icon, ".icon is declared").toBeTruthy();
    expect(icon![1]).toMatch(/stroke-width:\s*calc\(var\(--icon-stroke\)\s*\*\s*1px/);
  });
});

describe("a control says what it does in words (review UI-01)", () => {
  // Menu and panel rows, dialog and settings buttons: the reading face, sentence
  // case, no tracking. The machine's capitals are for data (counts, key caps).
  const rules = [...afterTokens.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector.split(",").map((s) => s.replace(/\s+/g, " ").trim()),
    body,
  }));
  const rulesFor = (selector: string) => rules.filter((r) => r.selectors.includes(selector));

  const VERBS = [
    ".selpanel-btn.mono", // the menu, the selection's verbs, the Move chooser
    ".btn.mono", // dialog buttons and Settings' buttons
    ".fmtbtn.mono",
    ".sorter-skip.mono",
    ".ticker-skip.mono",
    ".signin-skip.mono",
  ];

  it.each(VERBS)("sets %s in the reading face, sentence case and untracked", (selector) => {
    const group = rules.find((r) => r.selectors.includes(selector) && /font-family:\s*var\(--body\)/.test(r.body));
    expect(group, `${selector} is set in --body`).toBeTruthy();
    expect(group!.body).toMatch(/font-size:\s*var\(--t-text\)/);
    expect(group!.body).toMatch(/text-transform:\s*none/);
    expect(group!.body).toMatch(/letter-spacing:\s*normal/);
  });

  it("lets no later rule put the capitals or the machine face back on a control", () => {
    const controls = [...VERBS, ".selpanel-btn", ".btn", ".settings-btn", ".settings-seg button", ".sorter-skip", ".ticker-skip"];
    for (const selector of controls) {
      for (const rule of rulesFor(selector)) {
        expect(rule.body, `${selector} must not be uppercase`).not.toMatch(/text-transform:\s*uppercase/);
        expect(rule.body, `${selector} must not be tracked`).not.toMatch(/letter-spacing:\s*var\(--track/);
        expect(rule.body, `${selector} must not be mono`).not.toMatch(/font-family:\s*var\(--mono\)/);
      }
    }
  });

  it("sets Settings' segments and navigation in the reading face", () => {
    for (const selector of [".settings-seg button", ".settings-section"]) {
      const body = rulesFor(selector).map((r) => r.body).join(";");
      expect(body, selector).toMatch(/font-family:\s*var\(--body\)/);
      expect(body, selector).toMatch(/font-size:\s*var\(--t-text\)/);
    }
  });

  it("keeps the machine's capitals for counts and key caps", () => {
    const mono = rulesFor(".mono").map((r) => r.body).join(";");
    expect(mono).toMatch(/font-family:\s*var\(--mono\)/);
    expect(mono).toMatch(/text-transform:\s*uppercase/);
    expect(rulesFor(".selpanel-n").map((r) => r.body).join(";")).toMatch(/font-family:\s*var\(--mono\)/);
    expect(rulesFor(".kbd-cap").map((r) => r.body).join(";")).toMatch(/font-size:\s*var\(--t-data\)/);
  });
});

describe("the footer's link, file and code marks", () => {
  // The chain was drawn at 4.5 units (2.6px on 14px) against 1.5px for every
  // other mark (review UIB-02); later a count beside it still made it bold, and
  // the owner saw a thicker icon (2026-10-19). One stroke, count or not.
  it("keep the set's stroke, with or without a count", () => {
    const base = /\n\.card-link\s*\{([^}]*)\}/.exec(code);
    expect(base, ".card-link is declared").toBeTruthy();
    expect(base![1]).not.toMatch(/--icon-weight/);
    expect(code).not.toMatch(/\.card-link:has\(\.link-n\)/);
  });
});

describe("the open note's date line", () => {
  // `letter-spacing: inherit` carried the length the footer worked out at its
  // 16.5px reading size (1.65px) down onto 10.5px mono, half again as wide as
  // every other label (review UI-09). It is stated on the box that is 10.5px.
  it("is tracked on its own 10.5px box, never inherited from the reading-size strip", () => {
    const stamp = /\n\.meta-stamp\s*\{([^}]*)\}/.exec(code);
    expect(stamp, ".meta-stamp is declared").toBeTruthy();
    expect(stamp![1]).toMatch(/font-size:\s*var\(--t-data\);/);
    expect(stamp![1]).toMatch(/letter-spacing:\s*var\(--track-data\);/);
  });
});

describe("a closing note", () => {
  it("lets a click through to the board under it, never onto its own marks", () => {
    expect(code).toMatch(/\.sheet\[data-closing\]\s*\{[^}]*pointer-events:\s*none/);
  });
});

/** The UI/UX review of 2026-10-24 (docs/audits/ux_audit_report.json). */
describe("a card says what it is in every state", () => {
  it("drops a code line's strip when the card is picked (UX-001)", () => {
    // A --rule-faint strip under --paper words on the inverted slab was 1.2:1.
    expect(code).toMatch(
      /\.card\[data-selected="true"\]\s*:is\([^{]*\.card-line\[data-code="true"\][^{]*\)\s*\{\s*background:\s*transparent;/,
    );
  });

  it("draws an archived card's words in --muted, and the peek lifts them (UX-003)", () => {
    // `.card-body` sets --ink of its own, so the card's --muted never reached it.
    expect(code).toMatch(
      /\.card\[data-archived="true"\] :is\(\.card-body, \.card-row-title\) \{\s*color: var\(--muted\);/,
    );
    expect(code).toMatch(
      /\.card\[data-peek="true"\]\[data-archived="true"\] :is\(\.card-body, \.card-row-title\):not\(\[data-dim="true"\]\) \{\s*color: var\(--ink\);/,
    );
  });
});
