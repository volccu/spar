import { describe, expect, it } from "vitest";
import type { Attachment } from "../types";
import {
  dropMarkers,
  findMarked,
  kindOf,
  markerFor,
  numberAttachments,
  pendingMarkers,
  refsFor,
  stripMarkers,
  withMarkers,
} from "./attachRefs";

const att = (id: string, mime: string, ref?: number, name = id): Attachment => ({
  id,
  name,
  mime,
  size: 1,
  width: null,
  height: null,
  thumb: null,
  path: null,
  added_at: "2026-10-26T00:00:00.000Z",
  ...(ref === undefined ? {} : { ref }),
});

describe("file markers", () => {
  it("knows a picture by its type, or by its ending when the browser gave none", () => {
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("", "IMG_0001.HEIC")).toBe("image");
    expect(kindOf("application/pdf", "bill.pdf")).toBe("file");
    expect(kindOf("")).toBe("file");
  });

  it("numbers new files per kind, after the highest number the note has used", () => {
    const had = [att("a", "image/png", 1), att("b", "image/png", 3), att("c", "application/pdf", 1), att("old", "image/png")];
    const added = numberAttachments(had, [att("d", "image/jpeg"), att("e", "audio/mpeg"), att("f", "image/png")]);
    expect(added.map((a) => markerFor(a))).toEqual(["[image 4]", "[file 2]", "[image 5]"]);
  });

  it("keeps a number handed in with a file, and numbers the rest after it", () => {
    // A refused first picture left its number unused: the second keeps 2, not 1.
    const added = numberAttachments([], [att("b", "image/png"), att("c", "image/png")], [2]);
    expect(added.map((a) => a.ref)).toEqual([2, 3]);
    expect(refsFor([att("a", "image/png", 4)], [{ type: "image/png", name: "x.png" }, { type: "", name: "y.pdf" }])).toEqual([5, 1]);
  });

  it("finds the file a marker points at, and nothing once it is gone", () => {
    const atts = [att("a", "image/png", 1), att("b", "application/pdf", 1)];
    expect(findMarked(atts, "file", 1)?.id).toBe("b");
    expect(findMarked(atts, "image", 2)).toBeUndefined();
  });

  it("writes markers at the caret with a space against a word, and the caret after them", () => {
    expect(withMarkers("look here", 4, ["[image 1]"])).toEqual({ value: "look [image 1] here", caret: 14 });
    expect(withMarkers("look ", 5, ["[image 1]", "[image 2]"])).toEqual({ value: "look [image 1] [image 2]", caret: 24 });
    expect(withMarkers("a", 0, ["[file 1]"])).toEqual({ value: "[file 1] a", caret: 9 });
  });

  it("numbers files waiting in the capture bar on from the ones already waiting", () => {
    const f = (name: string, type: string) => new File(["x"], name, { type });
    expect(pendingMarkers([f("a.png", "image/png")], [f("b.jpg", "image/jpeg"), f("c.pdf", "application/pdf")])).toEqual([
      "[image 2]",
      "[file 1]",
    ]);
  });

  it("takes markers out of a text", () => {
    expect(stripMarkers("[image 1]  ").trim()).toBe("");
    expect(dropMarkers("look [image 1] here [file 2]")).toBe("look here");
    expect(dropMarkers("[image] stays")).toBe("[image] stays");
  });
});
