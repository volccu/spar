import { describe, expect, it } from "vitest";
import { RECENT_SEARCH_MAX, withRecentSearch } from "./recentSearches";

describe("withRecentSearch", () => {
  it("adds a new term to the front", () => {
    expect(withRecentSearch([], "milk")).toEqual(["milk"]);
    expect(withRecentSearch(["bread"], "milk")).toEqual(["milk", "bread"]);
  });

  it("moves a repeated term back to the front rather than duplicating it", () => {
    expect(withRecentSearch(["bread", "milk", "eggs"], "milk")).toEqual([
      "milk",
      "bread",
      "eggs",
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(withRecentSearch(["Milk"], "milk")).toEqual(["milk"]);
  });

  it("ignores an empty or all-whitespace term", () => {
    const prev = ["milk"];
    expect(withRecentSearch(prev, "")).toBe(prev);
    expect(withRecentSearch(prev, "   ")).toBe(prev);
  });

  it("trims the term it stores", () => {
    expect(withRecentSearch([], "  milk  ")).toEqual(["milk"]);
  });

  it("caps the list rather than growing it forever", () => {
    const full = Array.from({ length: RECENT_SEARCH_MAX }, (_, i) => `term${i}`);
    const next = withRecentSearch(full, "new");
    expect(next).toHaveLength(RECENT_SEARCH_MAX);
    expect(next[0]).toBe("new");
    expect(next).not.toContain(`term${RECENT_SEARCH_MAX - 1}`);
  });
});
