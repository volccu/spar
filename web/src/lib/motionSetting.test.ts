// @vitest-environment jsdom
import postcss, { type AtRule, type Rule } from "postcss";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStyles } from "../test/readStyles.node";
import { animates, reducedMotion } from "./motion";
import { motionSetting } from "./motionSetting";
import { applyTheme } from "./theme";
import { writeSetting } from "./settings";

/**
 * Settings → Motion → Reduced (2026-10-11, owner approved) adds to the
 * system's `prefers-reduced-motion` and never takes it away. Script asks
 * `reducedMotion()`; the stylesheet's reduced-motion blocks are copied under
 * `data-motion="reduced"` at build. Both are held here.
 */

function stubSystem(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.motion;
  delete document.documentElement.dataset.theme;
});

describe("reducedMotion()", () => {
  it("follows the system when the device has not chosen", () => {
    stubSystem(false);
    applyTheme();
    expect(reducedMotion()).toBe(false);
    stubSystem(true);
    expect(reducedMotion()).toBe(true);
  });

  it("is true when this device chose Reduced, whatever the system says", () => {
    stubSystem(false);
    writeSetting("motion", "reduced");
    applyTheme();
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(reducedMotion()).toBe(true);
    // And animates() folds it in, so no caller can forget it.
    const el = document.createElement("div");
    (el as unknown as { animate: () => void }).animate = () => {};
    expect(animates(el)).toBe(false);
  });

  it("never takes the system's answer away", () => {
    stubSystem(true);
    writeSetting("motion", "system");
    applyTheme();
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(reducedMotion()).toBe(true);
  });
});

describe("the stylesheet's reduced-motion blocks follow the setting", () => {
  const source = readStyles();
  const out = postcss([motionSetting()]).process(source, { from: undefined }).root;

  const selectorsIn = (container: AtRule) => {
    const found: string[] = [];
    container.walkRules((rule: Rule) => {
      found.push(...rule.selectors);
    });
    return found;
  };

  it("writes every rule of every reduce block again, behind the setting, straight after it", () => {
    const blocks: AtRule[] = [];
    out.walkAtRules("media", (at) => {
      if (at.params.trim() === "(prefers-reduced-motion: reduce)") blocks.push(at);
    });
    expect(blocks.length, "styles.css has reduced-motion blocks").toBeGreaterThan(3);
    for (const block of blocks) {
      const selectors = selectorsIn(block);
      // The copies are the siblings that follow the block, up to the next
      // thing the source itself wrote.
      const copies: string[] = [];
      for (let node = block.next(); node?.type === "rule"; node = node.next()) {
        const rule = node as Rule;
        if (!rule.selector.startsWith(':where(:root[data-motion="reduced"])')) break;
        copies.push(...rule.selectors);
      }
      expect(copies).toEqual(
        selectors.map((s) => `:where(:root[data-motion="reduced"]) ${s}`),
      );
    }
  });

  it("turns the no-preference hovers off under the setting too", () => {
    let seen = 0;
    out.walkAtRules("media", (at) => {
      if (!at.params.includes("prefers-reduced-motion: no-preference")) return;
      seen++;
      for (const selector of selectorsIn(at)) {
        expect(selector.startsWith(':where(:root:not([data-motion="reduced"])) ')).toBe(true);
      }
    });
    expect(seen).toBeGreaterThan(0);
  });

  it("refuses a query that mixes the preference with another condition", () => {
    const mixed = "@media (hover: hover) and (prefers-reduced-motion: reduce) { a { color: red } }";
    expect(() => postcss([motionSetting()]).process(mixed, { from: undefined }).css).toThrow(
      /its own/,
    );
  });
});
