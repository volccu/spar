import { describe, expect, it } from "vitest";
import { leftToBack } from "./useModePiles";

describe("leftToBack", () => {
  it("sends the notes the last run left to the back, each group in its own order", () => {
    expect(leftToBack(["a", "b", "c", "d"], new Set(["a", "c"]))).toEqual(["b", "d", "a", "c"]);
  });

  it("changes nothing when nothing was left, or a left note is not in the pile", () => {
    const ids = ["a", "b"];
    expect(leftToBack(ids, new Set())).toBe(ids);
    expect(leftToBack(ids, new Set(["z"]))).toEqual(["a", "b"]);
  });
});
