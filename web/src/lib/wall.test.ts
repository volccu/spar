import { describe, expect, it } from "vitest";
import {
  clampRatio,
  placeTiles,
  tileHeight,
  viewerEntries,
  wallColumns,
  wallFace,
  WALL_CAPTION_PX,
  WALL_NOMINAL_PX,
  WALL_QUOTE_PX,
  WALL_SITE_PX,
  WALL_TITLE_PX,
  videoPlayback,
} from "./wall";
import { attachment, linkPreview, note } from "../test/fixtures";

const PIC = "data:image/jpeg;base64,xx";

describe("clampRatio", () => {
  it("is height over width", () => {
    expect(clampRatio(400, 300)).toBe(0.75);
    expect(clampRatio(300, 400)).toBeCloseTo(1.3333, 3);
  });

  it("never lets a panorama or a long screenshot take over a column", () => {
    expect(clampRatio(4000, 500)).toBe(0.5);
    expect(clampRatio(500, 9000)).toBe(2);
    expect(clampRatio(100, 50)).toBe(0.5);
    expect(clampRatio(100, 200)).toBe(2);
  });

  it("answers a plain 4:3 for a size nobody stored — never zero, never NaN", () => {
    const cases: [number | null | undefined, number | null | undefined][] = [
      [null, null],
      [undefined, 10],
      [10, undefined],
      [0, 0],
      [0, 10],
      [10, 0],
      [-4, 3],
      [3, -4],
      [NaN, 3],
      [3, NaN],
      [Infinity, 3],
      [3, Infinity],
    ];
    for (const [w, h] of cases) expect(clampRatio(w, h), `${w}x${h}`).toBe(0.75);
  });
});

describe("wallColumns", () => {
  it("is two down to 360px and below it", () => {
    expect(wallColumns(320)).toBe(2);
    expect(wallColumns(360)).toBe(2);
    expect(wallColumns(479)).toBe(2);
    expect(wallColumns(600)).toBe(2);
  });

  it("adds a column as soon as the columns would be wider than 300px", () => {
    expect(wallColumns(601)).toBe(3);
    expect(wallColumns(720)).toBe(3);
    expect(wallColumns(900)).toBe(3);
    expect(wallColumns(901)).toBe(4);
    expect(wallColumns(1200)).toBe(4);
    expect(wallColumns(1500)).toBe(5);
  });

  it("never lets a column grow past 300px at any width", () => {
    for (let width = 320; width <= 2400; width += 7) {
      expect(width / wallColumns(width), `${width}`).toBeLessThanOrEqual(300);
    }
  });

  it("answers two when the width is not known — jsdom, a hidden tab", () => {
    for (const width of [0, -1, NaN, Infinity, -Infinity]) expect(wallColumns(width), `${width}`).toBe(2);
  });
});

describe("placeTiles", () => {
  it("puts each tile into the currently shortest column, in board order", () => {
    // heights: 100, 40, 40, 40, 200  into 2 columns
    // t0 -> c0 (100); t1 -> c1 (40); t2 -> c1 (80); t3 -> c1 (120); t4 -> c0 (300)
    expect(placeTiles([100, 40, 40, 40, 200], 2)).toEqual([[0, 4], [1, 2, 3]]);
  });

  it("breaks a tie towards the left, so reading order is left to right then down", () => {
    expect(placeTiles([10, 10, 10, 10, 10], 3)).toEqual([[0, 3], [1, 4], [2]]);
  });

  it("keeps every tile when there are fewer tiles than columns, and none when there are none", () => {
    expect(placeTiles([50, 60], 5)).toEqual([[0], [1], [], [], []]);
    expect(placeTiles([50], 3)).toEqual([[0], [], []]);
    expect(placeTiles([], 3)).toEqual([[], [], []]);
  });

  it("never throws on a column count that is not a count, and never drops a tile", () => {
    expect(placeTiles([5, 5], 0)).toEqual([[0, 1]]);
    expect(placeTiles([5, 5], -3)).toEqual([[0, 1]]);
    expect(placeTiles([5, 5], NaN)).toEqual([[0, 1]]);
    expect(placeTiles([5, 5], Infinity)).toEqual([[0, 1]]);
    expect(placeTiles([5, 5], 2.9)).toEqual([[0], [1]]);
  });

  it("still places a tile whose height is not a number, into the shortest column", () => {
    const placed = placeTiles([NaN, 10, 0, -5], 2);
    expect(placed.flat().sort()).toEqual([0, 1, 2, 3]);
  });

  it("places the first row of tiles at the top of each column, so the keyboard's row count is the column count", () => {
    const placed = placeTiles([30, 90, 20, 70, 10, 10], 3);
    expect(placed.map((c) => c[0])).toEqual([0, 1, 2]);
  });
});

describe("wallFace — one note, one tile, chosen in the spec's order", () => {
  it("is the first image of an attachment note, at its true shape, counting the rest", () => {
    const face = wallFace(
      note({
        body: "",
        attachments: [
          attachment({ id: "a", width: 400, height: 200 }),
          attachment({ id: "b" }),
          attachment({ id: "c" }),
        ],
      }),
    );
    expect(face).toMatchObject({ kind: "picture", from: "file", ratio: 0.5, more: 2, caption: "" });
  });

  it("has a single muted line of the note's own words under a picture", () => {
    const face = wallFace(
      note({ body: "# Kitchen\n\nlate light on the table\nsecond line", attachments: [attachment()] }),
    );
    expect(face).toMatchObject({ kind: "picture", caption: "Kitchen" });
  });

  it("cuts a very long first line short rather than letting it run", () => {
    const face = wallFace(note({ body: "x".repeat(400), attachments: [attachment()] }));
    expect(face.kind === "picture" && face.caption.length).toBeLessThanOrEqual(140);
    expect(face.kind === "picture" && face.caption.endsWith("…")).toBe(true);
  });

  it("gives a picture with no words no caption at all", () => {
    const face = wallFace(note({ body: " \n\n", attachments: [attachment()] }));
    expect(face).toMatchObject({ kind: "picture", from: "file", caption: "" });
  });

  it("gives an attachment with no stored size a 4:3 shape — never zero, never NaN", () => {
    for (const [width, height] of [[undefined, undefined], [0, 0], [NaN, NaN], [0, 300]] as const) {
      const face = wallFace(note({ body: "", attachments: [attachment({ width, height })] }));
      expect(face, `${width}x${height}`).toMatchObject({ kind: "picture", ratio: 0.75 });
      expect(tileHeight(face)).toBeGreaterThan(0);
      expect(tileHeight(face)).toBe(WALL_NOMINAL_PX * 0.75);
    }
  });

  it("passes over an attachment that cannot be drawn", () => {
    const face = wallFace(
      note({
        body: "words",
        attachments: [attachment({ mime: "audio/mpeg", name: "memo.mp3", thumb: null, width: undefined, height: undefined })],
      }),
    );
    expect(face).toEqual({ kind: "quote" });
  });

  it("names the first file of a note that has only files it cannot draw and no words", () => {
    const zip = attachment({ id: "z", mime: "application/zip", name: "refs.zip", thumb: null, width: undefined, height: undefined });
    const mp3 = attachment({ id: "m", mime: "audio/mpeg", name: "memo.mp3", thumb: null, width: undefined, height: undefined });
    expect(wallFace(note({ body: "", attachments: [zip, mp3] }))).toEqual({ kind: "quote", file: zip, more: 1 });
    expect(tileHeight(wallFace(note({ body: "", attachments: [zip] })))).toBe(WALL_QUOTE_PX);
  });

  it("has the picture of a link, its shape from the stored size, the site in mono", () => {
    const face = wallFace(
      note({
        body: "https://example.com/a",
        link_previews: [linkPreview({ image: PIC, width: 480, height: 320, media: "video" })],
      }),
    );
    expect(face).toMatchObject({ kind: "picture", from: "link", ratio: 320 / 480, video: true, site: "example.com", caption: "" });
  });

  it("puts the words beside a link under its picture as the one muted line", () => {
    const face = wallFace(
      note({ body: "the cover I like https://example.com/a", link_previews: [linkPreview({ image: PIC })] }),
    );
    expect(face).toMatchObject({ kind: "picture", from: "link", caption: "the cover I like" });
  });

  it("falls back to 4:3 for a link picture whose size was never stored", () => {
    const face = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC })] }),
    );
    expect(face).toMatchObject({ kind: "picture", ratio: 0.75, video: false });
  });

  it("falls back to 4:3 for a link picture whose stored size is zero or not a number", () => {
    for (const [width, height] of [[0, 0], [NaN, 200], [300, 0]] as const) {
      const face = wallFace(
        note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC, width, height })] }),
      );
      expect(face, `${width}x${height}`).toMatchObject({ kind: "picture", ratio: 0.75 });
    }
  });

  it("clamps the shape of a link picture too", () => {
    const wide = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC, width: 1000, height: 100 })] }),
    );
    expect(wide).toMatchObject({ ratio: 0.5 });
    const tall = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC, width: 100, height: 1000 })] }),
    );
    expect(tall).toMatchObject({ ratio: 2 });
  });

  it("is a title card for a link with no picture", () => {
    const face = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ title: "A recipe" })] }),
    );
    expect(face).toEqual({ kind: "title", title: "A recipe", site: "example.com" });
  });

  it("names a title card after its site when the page gave no title", () => {
    const face = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ title: "" })] }),
    );
    // the name is the site, so the footer says the path rather than the site twice
    expect(face).toEqual({ kind: "title", title: "example.com", site: "/a" });
  });

  it("leaves the footer empty when the title is the bare site and there is no path", () => {
    const face = wallFace(
      note({ body: "https://www.example.com/", link_previews: [linkPreview({ href: "https://www.example.com/", title: "WWW.example.com/" })] }),
    );
    expect(face).toEqual({ kind: "title", title: "example.com", site: "" });
  });

  it("takes a later link's picture over an earlier link with none", () => {
    const face = wallFace(
      note({
        body: "https://example.com/a and https://example.org/b",
        link_previews: [
          linkPreview({ href: "https://example.com/a" }),
          linkPreview({ href: "https://example.org/b", domain: "example.org", image: PIC }),
        ],
      }),
    );
    expect(face).toMatchObject({ kind: "picture", from: "link", site: "example.org" });
  });

  it("does not make a picture tile of a preview the owner put away", () => {
    const face = wallFace(
      note({
        body: "https://example.com/a",
        link_previews: [linkPreview({ image: PIC, hidden: true })],
      }),
    );
    expect(face.kind).toBe("quote");
  });

  it("skips a hidden preview for a visible one beside it", () => {
    const face = wallFace(
      note({
        body: "https://example.com/a https://example.org/b",
        link_previews: [
          linkPreview({ href: "https://example.com/a", image: PIC, hidden: true }),
          linkPreview({ href: "https://example.org/b", domain: "example.org", title: "B" }),
        ],
      }),
    );
    expect(face).toEqual({ kind: "title", title: "B", site: "example.org" });
  });

  it("is a quote card for words alone", () => {
    expect(wallFace(note({ body: "a thought" }))).toEqual({ kind: "quote" });
  });

  it("is a quote card for an empty note", () => {
    expect(wallFace(note({ body: "" }))).toEqual({ kind: "quote" });
  });

  it("prefers an attachment to a link picture", () => {
    const face = wallFace(
      note({
        body: "https://example.com/a",
        attachments: [attachment()],
        link_previews: [linkPreview({ image: PIC })],
      }),
    );
    expect(face).toMatchObject({ from: "file" });
  });
});

describe("tileHeight", () => {
  it("is the picture at the nominal column plus what is printed under it", () => {
    const bare = wallFace(note({ body: "", attachments: [attachment({ width: 100, height: 100 })] }));
    expect(tileHeight(bare)).toBe(WALL_NOMINAL_PX);
    const captioned = wallFace(note({ body: "words", attachments: [attachment({ width: 100, height: 100 })] }));
    expect(tileHeight(captioned)).toBe(WALL_NOMINAL_PX + WALL_CAPTION_PX);
    const link = wallFace(
      note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC, width: 100, height: 200 })] }),
    );
    expect(tileHeight(link)).toBe(WALL_NOMINAL_PX * 2 + WALL_SITE_PX);
  });

  it("adds both the site row and the caption to a link picture that has words", () => {
    const face = wallFace(
      note({
        body: "words https://example.com/a",
        link_previews: [linkPreview({ image: PIC, width: 100, height: 100 })],
      }),
    );
    expect(tileHeight(face)).toBe(WALL_NOMINAL_PX + WALL_SITE_PX + WALL_CAPTION_PX);
  });

  it("is fixed for the two text tiles", () => {
    expect(tileHeight({ kind: "title", title: "t", site: "s" })).toBe(WALL_TITLE_PX);
    expect(tileHeight({ kind: "quote" })).toBe(WALL_QUOTE_PX);
  });
});

describe("viewerEntries — what the viewer walks", () => {
  it("is every picture tile in board order, and skips the tiles that are only words", () => {
    const notes = [
      note({ id: "a", body: "", attachments: [attachment({ name: "a.png" })] }),
      note({ id: "words", body: "just words" }),
      note({ id: "title", body: "https://example.com/t", link_previews: [linkPreview({ title: "No picture" })] }),
      note({
        id: "link",
        body: "https://example.com/l",
        link_previews: [
          linkPreview({
            href: "https://example.com/l",
            title: "A page",
            image: PIC,
            media: "video",
            video: { kind: "youtube", src: "dQw4w9WgXcQ" },
          }),
        ],
      }),
    ];
    const entries = viewerEntries(notes);
    expect(entries.map((e) => [e.noteId, e.kind, e.title])).toEqual([
      ["a", "file", "a.png"],
      ["link", "link", "A page"],
    ]);
    expect(entries[1].link?.video).toEqual({ kind: "youtube", src: "dQw4w9WgXcQ" });
  });

  it("names a link entry after its site when the page gave no title", () => {
    const [entry] = viewerEntries([
      note({ body: "https://example.com/a", link_previews: [linkPreview({ title: "", image: PIC })] }),
    ]);
    expect(entry.title).toBe("example.com");
  });

  it("does not walk a hidden preview", () => {
    expect(
      viewerEntries([
        note({ body: "https://example.com/a", link_previews: [linkPreview({ image: PIC, hidden: true })] }),
      ]),
    ).toEqual([]);
  });

  it("is empty for an empty board", () => {
    expect(viewerEntries([])).toEqual([]);
  });
});

describe("videoPlayback — the only door a stored video source passes through", () => {
  it("plays a direct stream from Reddit's host or any https file that is a video", () => {
    expect(videoPlayback({ kind: "file", src: "https://v.redd.it/abc123/DASH_720.mp4?source=fallback" })).toEqual({
      mode: "file",
      src: "https://v.redd.it/abc123/DASH_720.mp4?source=fallback",
    });
    expect(videoPlayback({ kind: "file", src: "https://cdn.example.com/clip.webm" })).toEqual({
      mode: "file",
      src: "https://cdn.example.com/clip.webm",
    });
  });

  it("embeds YouTube through the privacy host and Vimeo through its player, by id", () => {
    expect(videoPlayback({ kind: "youtube", src: "dQw4w9WgXcQ" })).toEqual({
      mode: "embed",
      src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1",
    });
    expect(videoPlayback({ kind: "vimeo", src: "76979871" })).toEqual({
      mode: "embed",
      src: "https://player.vimeo.com/video/76979871?playsinline=1",
    });
  });

  it("refuses anything an entry from another device could use to smuggle a source in", () => {
    for (const video of [
      { kind: "file", src: "javascript:alert(1)" },
      { kind: "file", src: "data:video/mp4;base64,AAAA" },
      { kind: "file", src: "http://cdn.example.com/clip.mp4" },
      { kind: "file", src: "//cdn.example.com/clip.mp4" },
      { kind: "file", src: "https://cdn.example.com/page.html" },
      { kind: "file", src: "not a url" },
      { kind: "youtube", src: "https://evil.example/embed/x" },
      { kind: "youtube", src: "short" },
      { kind: "youtube", src: "dQw4w9WgXcQ\"><script>" },
      { kind: "vimeo", src: "abc" },
      { kind: "vimeo", src: "123/../456" },
      { kind: "flash", src: "x" },
      { kind: "file" },
      null,
      undefined,
    ] as const) {
      expect(videoPlayback(video as never), JSON.stringify(video)).toBeNull();
    }
  });
});
