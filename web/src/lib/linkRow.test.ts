import { describe, expect, it } from "vitest";
import { linkRow, rowWords } from "./linkRow";
import { overlaySaved, previewsFor } from "./links";
import type { LinkPreview } from "../types";

const saved = (over: Partial<LinkPreview>): LinkPreview => ({
  href: "https://example.com/a",
  domain: "example.com",
  title: "",
  description: null,
  image: null,
  fetched_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

function rowFor(body: string, stored: LinkPreview[] = []) {
  const locals = previewsFor(body);
  return linkRow(overlaySaved(locals, stored), locals);
}

describe("linkRow", () => {
  it("is nothing for a note with no address", () => {
    expect(rowFor("just words")).toBeNull();
  });

  it("names the row by the user's own words before the page's title", () => {
    const row = rowFor("Saved link: worth a read\nhttps://example.com/a", [
      saved({ title: "Claude Artifact" }),
    ]);
    expect(row?.name).toBe("worth a read");
    expect(row?.site).toBe("example.com");
  });

  it("takes the page's title when the user wrote nothing, and refuses one that only names the site", () => {
    expect(rowFor("https://example.com/a", [saved({ title: "A Real Title" })])?.name).toBe(
      "A Real Title",
    );
    const bare = rowFor("https://example.com/a", [saved({ title: "www.example.com/" })]);
    expect(bare?.name).toBe("example.com");
    // The name had to be the site, so the footer says the path instead.
    expect(bare?.site).toBe("/a");
  });
});

describe("rowWords", () => {
  it("takes the sentence the title already says off the front of the words", () => {
    const row = rowFor("Saved link: worth a read\nhttps://example.com/a")!;
    expect(rowWords(row, "worth a read\nand then some")).toBe("and then some");
  });

  it("moves a cut that landed mid-word on to the end of that word", () => {
    const row = { ...rowFor("https://example.com/a")!, title: "a platform..." };
    expect(rowWords(row, "a platform (like Shopify) for shops")).toBe("(like Shopify) for shops");
  });

  it("leaves a body alone when a fetched title says something else", () => {
    const row = { ...rowFor("https://example.com/a")!, title: null };
    expect(rowWords(row, "my own words")).toBe("my own words");
  });
});
