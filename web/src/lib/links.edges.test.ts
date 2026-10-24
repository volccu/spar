import { describe, expect, it } from "vitest";
import { previewsFor, linkify } from "./links";

describe("previewsFor title cut", () => {
  it("never leaves half an emoji at the cut", () => {
    const text = `${"a".repeat(86)}😀 and more words here https://example.com/x`;
    const [p] = previewsFor(text);
    expect(p.title.endsWith("...")).toBe(true);
    // a lone surrogate is rejected by Postgres jsonb on upload
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(p.title)).toBe(false);
  });
});

describe("addresses", () => {
  it("keeps an apostrophe inside an address (Wikipedia titles have them)", () => {
    const url = "https://en.wikipedia.org/wiki/Schindler's_List";
    expect(linkify(`see ${url}`).find((s) => s.href)?.href).toBe(url);
  });
  it("does not take the closing stars of a bold address into the address", () => {
    const hrefs = linkify("**https://example.com/page**").filter((s) => s.href).map((s) => s.href);
    expect(hrefs).toEqual(["https://example.com/page"]);
  });
});
