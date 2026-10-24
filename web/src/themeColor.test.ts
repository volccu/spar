// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackThemeColor } from "./themeColor";

/**
 * The bars round an installed app follow the ground the stylesheet resolved,
 * and follow it again when the theme on <html> changes (Settings, or System
 * following the device). jsdom does not apply styles.css, so the resolved
 * --paper is stood in for by reading data-theme.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  for (const tag of document.head.querySelectorAll('meta[name="theme-color"]')) tag.remove();
});

describe("trackThemeColor", () => {
  it("rewrites the bar colour from --paper when data-theme changes", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      const paper = document.documentElement.dataset.theme === "light" ? "#f3efe7" : "#0c0a08";
      return new Proxy(style, {
        get(target, key) {
          if (key === "getPropertyValue") {
            return (name: string) => (name === "--paper" ? paper : target.getPropertyValue(name));
          }
          return Reflect.get(target, key, target);
        },
      });
    });

    trackThemeColor();
    const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    expect(meta()?.content).toBe("#0c0a08");

    document.documentElement.dataset.theme = "light";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(meta()?.content).toBe("#f3efe7");

    document.documentElement.dataset.theme = "dark";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(meta()?.content).toBe("#0c0a08");
  });
});
