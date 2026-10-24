import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  existingStyleFiles,
  importedStyleFiles,
  importsOf,
  readStyles,
  readStylesEntry,
} from "./readStyles.node";

/**
 * `styles.css` is the entry to a stylesheet split into area files, and the
 * order of its imports is the cascade. These hold the ways that can go quietly
 * wrong: a file nothing imports (its rules never reach the browser), a file
 * imported twice (its rules run twice, the second time out of order), and the
 * helper the other tests read the stylesheet through drifting away from the
 * text the files really hold.
 */
const files = existingStyleFiles();
const names = files.map((file) => path.basename(file));

describe("the split stylesheet", () => {
  it("has area files, numbered", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const name of names) expect(name, "NN-name.css").toMatch(/^\d\d-[a-z0-9-]+\.css$/);
  });

  it("imports every area file exactly once, in the order of their numbers", () => {
    const imported = importsOf(readStylesEntry());
    expect(imported).toEqual(names.map((name) => `./styles/${name}`));
    expect(new Set(imported).size).toBe(imported.length);
    expect(importedStyleFiles()).toEqual(files);
  });

  it("keeps nothing in the entry but comments and imports", () => {
    const rest = readStylesEntry()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@import[^;]*;/g, "");
    expect(rest.trim()).toBe("");
  });

  it("hands the other tests exactly the area files, end to end", () => {
    const joined = files.map((file) => readFileSync(file, "utf8")).join("");
    expect(readStyles()).toBe(joined);
  });

  it("leaves no area file importing another or pointing at a relative url()", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(importsOf(text), `${path.basename(file)} imports`).toEqual([]);
      // A relative url() would resolve against the file it sits in, not against
      // the entry, so it would change meaning with the move.
      const relative = [...text.matchAll(/url\(\s*(?!["']?(?:data:|\/|#|%23|https?:))["']?([^)"']+)/g)];
      expect(
        relative.map((m) => m[1]),
        `${path.basename(file)} relative url()`,
      ).toEqual([]);
    }
  });
});
