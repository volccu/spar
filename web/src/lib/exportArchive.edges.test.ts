import { describe, expect, it } from "vitest";
import { safeSegment } from "./exportArchive";

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("export file names", () => {
  it("a name cut at 60 characters never ends in half an emoji", () => {
    const s = safeSegment(`${"a".repeat(59)}😀 and the rest`, "note");
    // a lone surrogate encodes to U+FFFD in the zip, so the re-import
    // (which replays this same name) can no longer find the file by path
    expect(LONE.test(s)).toBe(false);
    expect(new TextDecoder().decode(new TextEncoder().encode(s))).toBe(s);
  });
});
