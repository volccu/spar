import { describe, expect, it } from "vitest";
import { markHits } from "./face";
import type { InlineSeg } from "./inline";

describe("highlight offsets", () => {
  it("marks the searched word itself when an earlier capital changes length on lowercasing", () => {
    // "İ" (U+0130) lowercases to two code units, so indexes in the lowercased
    // copy no longer line up with the note's own characters.
    const segs = [{ text: "İİ foo bar" } as InlineSeg];
    const hit = markHits(segs, ["foo"]).filter((s) => s.hit).map((s) => s.text);
    expect(hit).toEqual(["foo"]);
  });
});
