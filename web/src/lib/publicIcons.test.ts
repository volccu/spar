// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { INTENTS, LAUNCH_PARAM } from "./launch";

/**
 * The files in web/public that the browser reads without the app's help: the
 * favicon and the manifest that installs it to a home screen.
 *
 * On 2026-09-02 icon.svg was redrawn as the mascot, and its comment named the
 * tones it used as `--paper`, `--muted`, `--ink`. A double hyphen is illegal
 * inside an XML comment, so every browser refused the whole file and the tab
 * showed a blank where the icon had been — for two days, through a second
 * commit that re-rendered the PNGs from the same drawing and checked them by
 * eye. Nothing checked the SVG by parser. This does, with the strict XML
 * parser a browser uses for an SVG favicon, which is the one that matters.
 */

const PUBLIC = join(__dirname, "..", "..", "public");
const read = (name: string) => readFileSync(join(PUBLIC, name), "utf8");

describe("the favicon and manifest in web/public", () => {
  it("icon.svg is well-formed XML, because a browser will not draw it otherwise", () => {
    const doc = new DOMParser().parseFromString(read("icon.svg"), "image/svg+xml");
    const error = doc.querySelector("parsererror");
    expect(error?.textContent ?? null).toBeNull();
    expect(doc.documentElement.tagName).toBe("svg");
  });

  it("icon.svg keeps a double hyphen out of its comments", () => {
    // The parser test above catches this too; this one says why it failed.
    for (const [comment] of read("icon.svg").matchAll(/<!--([\s\S]*?)-->/g)) {
      expect(comment.slice(4, -3)).not.toContain("--");
    }
  });

  it("every icon the manifest promises is a file that exists", () => {
    const manifest = JSON.parse(read("manifest.webmanifest")) as { icons: { src: string }[] };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const { src } of manifest.icons) {
      expect(existsSync(join(PUBLIC, src.replace(/^\//, ""))), src).toBe(true);
    }
  });

  /**
   * The launcher shortcut, from the other end. `lib/launch.ts` reads a
   * parameter off the address bar; this is the file that has to put it there,
   * and the two are only joined by the string `?do=capture` written out twice.
   * A shortcut is also the one part of the app nothing on screen can show you
   * is broken: it is drawn by Android's launcher and by the Windows taskbar,
   * from a manifest read at install time, so a typo here is invisible until
   * somebody long-presses the icon and gets a dead end.
   */
  it("every shortcut asks for something the app can answer, in its own scope", () => {
    const manifest = JSON.parse(read("manifest.webmanifest")) as {
      shortcuts?: { name: string; url: string }[];
    };
    const shortcuts = manifest.shortcuts ?? [];
    expect(shortcuts.length).toBeGreaterThan(0);
    for (const { name, url } of shortcuts) {
      // A name is the whole message: with one shortcut Android shows it alone
      // on a long-press, wearing the app's own icon.
      expect(name.length, url).toBeGreaterThan(0);
      // Same-origin and inside the scope `start_url` implies, or the launcher
      // opens a browser tab somewhere else instead of this app.
      expect(url.startsWith("/"), url).toBe(true);
      const asked = new URL(url, "https://example.test").searchParams.get(LAUNCH_PARAM);
      expect(INTENTS as readonly string[], url).toContain(asked);
    }
  });
});
