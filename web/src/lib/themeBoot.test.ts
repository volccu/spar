// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStyles } from "../test/readStyles.node";
import { applyTheme, resolvedTheme } from "./theme";

/**
 * `public/theme-boot.js` is the theme before the app runs — a plain script,
 * because the CSP allows no inline one — and `lib/theme.ts` is the theme once
 * it does. If the two disagree, a device opens in one ramp and snaps to the
 * other a moment later. So the file itself is run here, against the same
 * storage and the same media answer, and has to land exactly where
 * applyTheme() lands.
 */

const BOOT = readFileSync(join(__dirname, "..", "..", "public", "theme-boot.js"), "utf8");
const root = document.documentElement;

function stubSystem(light: boolean | "none") {
  if (light === "none") {
    vi.stubGlobal("matchMedia", undefined);
    return;
  }
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === "(prefers-color-scheme: light)" ? light : false,
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

function clear() {
  root.removeAttribute("data-theme");
  root.removeAttribute("data-motion");
}

/** Runs the boot file and returns what it put on <html>. */
function boot() {
  clear();
  new Function(BOOT)();
  return { theme: root.dataset.theme, motion: root.dataset.motion };
}

/** Runs the app's own applyTheme() and returns what it put on <html>. */
function app() {
  clear();
  applyTheme();
  return { theme: root.dataset.theme, motion: root.dataset.motion };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  clear();
  document.head.querySelector('meta[name="theme-color"]')?.remove();
});

const THEMES = [null, "system", "light", "dark", "sepia"];
const MOTIONS = [null, "system", "reduced", "slow"];
const SYSTEMS = [true, false, "none"] as const;

describe("theme-boot.js agrees with lib/theme.ts", () => {
  for (const theme of THEMES) {
    for (const motion of MOTIONS) {
      for (const system of SYSTEMS) {
        it(`spar.theme=${theme} spar.motion=${motion} system light=${system}`, () => {
          stubSystem(system);
          if (theme !== null) localStorage.setItem("spar.theme", theme);
          if (motion !== null) localStorage.setItem("spar.motion", motion);
          const expected = app();
          expect(expected.theme).toBe(resolvedTheme());
          expect(boot()).toEqual(expected);
        });
      }
    }
  }

  it("opens dark when nothing is stored, even on a device set to light", () => {
    stubSystem(true);
    expect(boot()).toEqual({ theme: "dark", motion: undefined });
    expect(app()).toEqual({ theme: "dark", motion: undefined });
  });

  it("follows the device only when System was chosen", () => {
    localStorage.setItem("spar.theme", "system");
    stubSystem(true);
    expect(boot().theme).toBe("light");
    stubSystem(false);
    expect(boot().theme).toBe("dark");
  });

  it("opens dark when storage throws, the same as no choice", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    stubSystem(true);
    expect(boot()).toEqual(app());
    expect(root.dataset.theme).toBe("dark");
    stubSystem("none");
    expect(boot()).toEqual({ theme: "dark", motion: undefined });
  });

  it("gives the first paint's bars the light paper, and leaves the dark one alone", () => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#0c0a08";
    document.head.appendChild(meta);
    stubSystem(false);
    boot();
    expect(meta.content).toBe("#0c0a08");
    localStorage.setItem("spar.theme", "light");
    boot();
    expect(meta.content).toBe("#f3efe7");
  });

  it("is loaded by index.html as a plain script, ahead of the app", () => {
    const html = readFileSync(join(__dirname, "..", "..", "index.html"), "utf8");
    const boot = html.indexOf('<script src="/theme-boot.js"></script>');
    expect(boot, "a synchronous, same-origin script — no inline code under the CSP").toBeGreaterThan(-1);
    expect(boot).toBeLessThan(html.indexOf('<script type="module"'));
    expect(boot).toBeLessThan(html.indexOf("</head>"));
  });
});

describe("the light paper the boot file names is the stylesheet's", () => {
  it("matches --paper in the light ramp", () => {
    const css = readStyles();
    const light = css.slice(css.indexOf(':root[data-theme="light"] {'));
    const paper = light.match(/--paper:\s*(#[0-9a-f]{6});/)?.[1];
    expect(BOOT).toContain(`"${paper}"`);
  });
});
