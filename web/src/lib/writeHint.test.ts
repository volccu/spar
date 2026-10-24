import { describe, expect, it } from "vitest";
import { HINT_NAME_MAX, writeHint } from "./writeHint";

describe("writeHint", () => {
  it("is the plain word on the Inbox and wherever a capture falls through to it", () => {
    expect(writeHint(null, false)).toBe("Write…");
  });
  it("names a folder as the user wrote it", () => {
    expect(writeHint({ name: "Recipes" }, false)).toBe("Write into Recipes…");
    expect(writeHint({ name: "Åland trip" }, false)).toBe("Write into Åland trip…");
  });
  it("takes pasting on Inspiration, and says to-do on Todos", () => {
    expect(writeHint({ name: "Inspiration", kind: "inspiration" }, false)).toBe("Paste or write…");
    expect(writeHint(null, true)).toBe("Write a to-do…");
  });
  it("cuts a long name to one ellipsis, on a word when it can", () => {
    const hint = writeHint({ name: "Recipes for the whole family" }, false);
    expect(hint).toBe("Write into Recipes for the…");
    expect(hint.match(/…/g)).toHaveLength(1);
  });
  it("cuts a long single word, never in the middle of a character", () => {
    const hint = writeHint({ name: "Verylongfoldernamethatgoeson" }, false);
    expect(hint).toBe(`Write into ${"Verylongfoldern".slice(0, HINT_NAME_MAX - 1)}…`);
    const emoji = writeHint({ name: "🍝".repeat(30) }, false);
    expect(emoji).toBe(`Write into ${"🍝".repeat(HINT_NAME_MAX - 1)}…`);
  });
  it("falls back to the plain word for a blank name", () => {
    expect(writeHint({ name: "  " }, false)).toBe("Write…");
  });
});
