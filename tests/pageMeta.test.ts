import { describe, expect, it } from "vitest";
import { decode, readCapped, readHtml, readMeta } from "../supabase/functions/_shared/pageMeta";

// What a fetched page says about itself — the parsing link-preview and the
// self-hosted server's previewer share. Each side's fetching is tested on its
// own; the server's reads real pages in `server/test/linkPreview.test.ts`.

/** A response whose body arrives in exactly these chunks. */
function streamed(chunks: Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("reading a page's bytes", () => {
  it("reads a short page whole", async () => {
    expect(await readHtml(streamed([bytes("<title>A</title>"), bytes("<p>b</p>")]), 1024)).toBe("<title>A</title><p>b</p>");
  });

  it("cuts a long page at the cap, inside the chunk that crossed it", async () => {
    expect(await readHtml(streamed([bytes("<title>Head</title>"), bytes("x".repeat(100))]), 25)).toBe("<title>Head</title>xxxxxx");
  });

  it("keeps a first chunk that alone runs past the cap, rather than reading NULs", async () => {
    const text = await readHtml(streamed([bytes(`<title>Big</title>${"x".repeat(100)}`)]), 30);
    expect(text).toBe(`<title>Big</title>${"x".repeat(12)}`);
    expect(readMeta(text).title).toBe("Big");
  });

  it("reads an empty body as no page", async () => {
    expect(await readHtml(new Response(null), 10)).toBe("");
  });

  it("reads a picture whole or not at all", async () => {
    expect(await readCapped(streamed([bytes("abc"), bytes("def")]), 6)).toEqual(bytes("abcdef"));
    expect(await readCapped(streamed([bytes("abc"), bytes("defg")]), 6)).toBeNull();
    expect(await readCapped(new Response(null), 6)).toBeNull();
  });
});

describe("reading a page", () => {
  it("does not decode a numeric `&` twice", () => {
    expect(decode("&#38;lt;b&#38;gt;")).toBe("&lt;b&gt;");
    expect(decode("&#x26;amp;")).toBe("&amp;");
  });

  it("decodes entities, `&amp;` last, and trims", () => {
    expect(decode("  Fish &amp; chips  ")).toBe("Fish & chips");
    expect(decode("a title that says &amp;lt;")).toBe("a title that says &lt;");
    expect(decode("&quot;q&quot; &apos;a&#39; &LT;b&GT;")).toBe(`"q" 'a' <b>`);
    expect(decode("caf&#233; caf&#xE9;")).toBe("café café");
  });

  it("turns a reference that names no character into U+FFFD instead of throwing", () => {
    expect(decode("&#x110000;")).toBe("\uFFFD");
    expect(decode("&#99999999999999999999;")).toBe("\uFFFD");
    expect(decode("&#xD800;")).toBe("\uFFFD");
  });

  it("prefers Open Graph, then Twitter, then the page's own title and description", () => {
    const html = `<title>Tab &amp; title</title>
      <meta name="twitter:title" content="Twitter title">
      <meta property="og:title" content="OG title">
      <meta name="description" content="Plain description">
      <meta name="twitter:description" content='Twitter description'>`;
    expect(readMeta(html)).toEqual({ title: "OG title", description: "Twitter description", candidates: [] });
    expect(readMeta("<title>Tab &amp; title</title>")).toEqual({ title: "Tab & title", description: null, candidates: [] });
    expect(readMeta("<p>nothing</p>")).toEqual({ title: "", description: null, candidates: [] });
  });

  it("keeps the first value a key is given, whatever its case", () => {
    const html = `<meta property="OG:TITLE" content="First"><meta property="og:title" content="Second">`;
    expect(readMeta(html).title).toBe("First");
  });

  it("lists every picture a page names, best first, skipping blanks", () => {
    const html = `<link rel="icon" href="/favicon.ico">
      <link rel="image_src preload" href="/link.png">
      <meta itemprop="image" content="/micro.png">
      <meta name="twitter:image:src" content="/tw-src.png">
      <meta name="twitter:image" content="/tw.png">
      <meta property="og:image:secure_url" content="https://x/secure.png">
      <meta property="og:image:url" content="  ">
      <meta property="og:image" content="/og.png">`;
    expect(readMeta(html).candidates).toEqual(["/og.png", "https://x/secure.png", "/tw.png", "/tw-src.png", "/micro.png", "/link.png"]);
  });

  it("keeps a tag whose quoted value contains a `>`", () => {
    const html = `<meta property="og:description" content="a > b">
      <meta name="description" content="plain">
      <meta property="og:image" content="https://x/i.png?a=1>2">`;
    const meta = readMeta(html);
    expect(meta.description).toBe("a > b");
    expect(meta.candidates[0]).toBe("https://x/i.png?a=1>2");
  });
});

describe("readMeta attribute names", () => {
  it("does not read data-content as content", () => {
    const html = `<meta data-content="z" property="og:title" content="T">`;
    expect(readMeta(html).title).toBe("T");
  });
});
