import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every relative link in the public documents points at something that is
 * there: a file in the repository, and — for a link into a Markdown file with a
 * `#fragment` — a heading in it, spelled the way GitHub makes its anchors.
 * A README is the project's front page, and a dead link on it reads as a
 * project nobody looks after.
 *
 * Links to web addresses are not fetched. The demo's address is deliberately a
 * placeholder until it is chosen, so it is not checked here either.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const PUBLIC_DOCS = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "SPEC.md",
  "DESIGN.md",
  "docs/self-hosting.md",
  "docs/demo.md",
  "docs/ios.md",
  "docs/server-api.md",
  "docs/sync-contract.md",
];

/** GitHub's heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!heading) continue;
    const base = slug(heading[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** The link targets in a document, outside code blocks and inline code. */
function linksOf(markdown: string): string[] {
  const prose = markdown
    .replace(/^\s*(```|~~~)[\s\S]*?^\s*\1/gm, "")
    .replace(/`[^`\n]*`/g, "");
  const found: string[] = [];
  for (const m of prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.push(m[1]);
  for (const m of prose.matchAll(/<(?:a|img)\b[^>]*?\b(?:href|src)="([^"]+)"/g)) found.push(m[1]);
  return found;
}

/** The paths `.publishignore` leaves out of the public tree, where that file exists. */
function unpublished(): ((path: string) => boolean) | null {
  const file = join(ROOT, ".publishignore");
  if (!existsSync(file)) return null;
  const rules = readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((rule) => {
      const body = rule.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
      return new RegExp(rule.endsWith("/") ? `^${body}` : `^${body}$`);
    });
  return (path) => rules.some((rule) => rule.test(path));
}

describe("links in the public documents", () => {
  const leftOut = unpublished();

  for (const doc of PUBLIC_DOCS) {
    it(`${doc}: every relative link resolves`, () => {
      const path = join(ROOT, doc);
      expect(existsSync(path), `${doc} is missing`).toBe(true);
      const broken: string[] = [];
      for (const target of linksOf(readFileSync(path, "utf8"))) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // https:, mailto:
        const [file, fragment] = target.split("#");
        const into = file ? resolve(dirname(path), decodeURIComponent(file)) : path;
        const inRepo = relative(ROOT, into).split("\\").join("/");
        if (!existsSync(into)) {
          broken.push(`${target} (no such file)`);
          continue;
        }
        if (leftOut?.(inRepo)) broken.push(`${target} (left out of the public tree by .publishignore)`);
        if (fragment && into.endsWith(".md") && !anchorsOf(readFileSync(into, "utf8")).has(fragment)) {
          broken.push(`${target} (no heading with that anchor)`);
        }
      }
      expect(broken).toEqual([]);
    });
  }

  it("makes GitHub's anchors", () => {
    expect(slug("Run it with Docker")).toBe("run-it-with-docker");
    expect(slug("`GET /config.json` · `GET /api/config`")).toBe("get-configjson--get-apiconfig");
    expect(slug("On iPhone and iPad")).toBe("on-iphone-and-ipad");
    expect(slug("Mapping the client's operations")).toBe("mapping-the-clients-operations");
  });
});
