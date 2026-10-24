import { describe, expect, it } from "vitest";
import { WALL_THUMB_PX } from "./files";
import {
  dueForRecheck,
  goneCount,
  hiddenCount,
  lastAsked,
  linkify,
  mergedPreviews,
  needsUnfurl,
  PREVIEW_IMAGE_SINCE,
  previewsFor,
  RECHECK_AT_ONCE,
  RECHECK_DAYS,
  visiblePreviews,
  WALL_PICTURE_SINCE,
  BLANK_PICTURES_FROM,
  BLANK_PICTURES_UNTIL,
  withPreviewsHidden,
  type LinkPreviewData,
} from "./links";

/** The invariant everything else depends on. */
function roundTrips(text: string) {
  return linkify(text).map((s) => s.text).join("") === text;
}

describe("linkify", () => {
  it("returns the text unchanged when there is nothing to link", () => {
    const segments = linkify("kanelipullat sunnuntaina");
    expect(segments).toEqual([{ text: "kanelipullat sunnuntaina", href: null }]);
  });

  it("finds a url in the middle of prose", () => {
    const segments = linkify("recipe here https://example.com/buns and it works");
    expect(segments.map((s) => s.href)).toEqual([
      null,
      "https://example.com/buns",
      null,
    ]);
    expect(segments[1].text).toBe("https://example.com/buns");
  });

  it("leaves sentence punctuation out of the address", () => {
    const [, link] = linkify("see https://example.com/a.");
    expect(link.href).toBe("https://example.com/a");
  });

  it("keeps a bracket that was opened inside the address", () => {
    const [link] = linkify("https://sv.wikipedia.org/wiki/Kanel_(krydda)");
    expect(link.href).toBe("https://sv.wikipedia.org/wiki/Kanel_(krydda)");
  });

  it("gives a bare www. address a scheme so the browser accepts it", () => {
    const [link] = linkify("www.example.com/x");
    expect(link.href).toBe("https://www.example.com/x");
    expect(link.text).toBe("www.example.com/x");
  });

  it("handles several links in one note", () => {
    const segments = linkify("a https://one.com b https://two.com");
    expect(segments.filter((s) => s.href).length).toBe(2);
  });

  it("puts every character back exactly where it was", () => {
    expect(roundTrips("plain text")).toBe(true);
    expect(roundTrips("a https://one.com, b www.two.com. c")).toBe(true);
    expect(roundTrips("https://one.com")).toBe(true);
    expect(roundTrips("")).toBe(true);
    expect(roundTrips("Saved link: Bread baking — https://example.com/bread\n\nnotes")).toBe(
      true,
    );
  });

  it("does not treat a lone www. as an address", () => {
    expect(linkify("www.").every((s) => s.href === null)).toBe(true);
  });
});

describe("previewsFor", () => {
  it("uses a saved link's words and domain for a local preview", () => {
    expect(previewsFor("Saved link: Kanelbullar — https://example.com/buns")[0]).toEqual({
      href: "https://example.com/buns",
      domain: "example.com",
      title: "Kanelbullar",
      description: null,
      image: null,
      fetched_at: null,
    });
  });

  it("falls back to the domain when a note is only a URL", () => {
    expect(previewsFor("https://example.com/buns")[0]?.title).toBe("example.com");
  });

  it("returns every distinct link in a note", () => {
    expect(previewsFor("https://one.example/a and https://two.example/b")).toHaveLength(2);
  });

  /**
   * The bug the owner reported on 2026-09-19, in one test.
   *
   * A name used to be cut from everything before the link, so the second spot
   * in a list was called "Spot 1 https://… Spot 2" and every spot after it was
   * called the same 90-character run off the top of the note, ellipsis and all.
   * Ten links, and one of them legible.
   */
  it("names each address from its own line, not from the whole note above it", () => {
    const spots = [
      "Spot 1 https://maps.example/a",
      "Spot 2 https://maps.example/b",
      "Spot 3 https://maps.example/c",
    ].join("\n");
    expect(previewsFor(spots).map((p) => p.title)).toEqual(["Spot 1", "Spot 2", "Spot 3"]);
  });

  it("takes the words behind an address when there are none in front of it", () => {
    expect(previewsFor("https://maps.example/a north bay")[0]?.title).toBe("north bay");
  });

  it("keeps naming a link from the words in front of it on the same line", () => {
    // The established shape, and the one the line rule must not widen: the
    // words after the address belong to the sentence, not to the link.
    expect(
      previewsFor("Row fit test https://example.com/spar and a line of my own")[0]?.title,
    ).toBe("Row fit test");
  });

  it("still reads the two lines of prose a note opens with", () => {
    // Nothing on the address's own line, so the name falls back to everything
    // written since the previous address — here, the whole note.
    expect(previewsFor("Great article\nWorth reading\nhttps://example.com")[0]?.title).toBe(
      "Great article Worth reading",
    );
  });

  it("never lets one address reach back over the one before it", () => {
    const [first, second] = previewsFor("https://one.example/a\nSome words\nhttps://two.example/b");
    expect(first?.title).toBe("one.example");
    expect(second?.title).toBe("Some words");
  });

  it("falls back to the site when a line holds two addresses and no name", () => {
    expect(previewsFor("https://one.example/a\nhttps://two.example/b").map((p) => p.title)).toEqual(
      ["one.example", "two.example"],
    );
  });

  it("drops a bullet or a dangling dash left where the address was", () => {
    expect(previewsFor("- Spot 3 — https://maps.example/c")[0]?.title).toBe("Spot 3");
  });
});

describe("needsUnfurl", () => {
  const stored = (over: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
    href: "https://example.com/a",
    domain: "example.com",
    title: "a",
    description: null,
    image: null as string | null,
    fetched_at: null as string | null,
    ...over,
  });
  const before = "2026-01-01T00:00:00.000Z";
  const after = "2026-12-01T00:00:00.000Z";

  it("asks about a link nothing is stored for", () => {
    expect(needsUnfurl(undefined)).toBe(true);
  });

  it("asks about a preview that was never fetched", () => {
    expect(needsUnfurl(stored({ fetched_at: null }))).toBe(true);
  });

  it("asks once more about a picture-less preview from before pictures existed", () => {
    expect(before < PREVIEW_IMAGE_SINCE).toBe(true);
    expect(needsUnfurl(stored({ fetched_at: before, image: null }))).toBe(true);
  });

  it("leaves a picture-less preview alone once it has been asked since", () => {
    expect(needsUnfurl(stored({ fetched_at: after, image: null }))).toBe(false);
  });

  it("never re-asks about a preview that already carries a picture", () => {
    expect(needsUnfurl(stored({ fetched_at: before, image: "data:image/jpeg;base64,AA" }))).toBe(
      false,
    );
  });
});

describe("needsUnfurl on the wall", () => {
  const modern = (over: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
    href: "https://example.com/a",
    domain: "example.com",
    title: "a",
    description: null,
    fetched_at: "2026-10-01T00:00:00.000Z",
    image: "data:image/jpeg;base64,xx",
    ...over,
  });

  it("is unchanged off the wall", () => {
    expect(needsUnfurl(modern())).toBe(false);
    expect(needsUnfurl(modern(), false)).toBe(false);
    expect(needsUnfurl(undefined)).toBe(true);
  });

  it("asks once more on the wall for a link fetched before the function could say what the picture is", () => {
    expect(needsUnfurl(modern(), true)).toBe(true); // media undefined
    expect(needsUnfurl(modern({ media: null, thumb_px: WALL_THUMB_PX }), true)).toBe(false);
  });

  it("asks once more on the wall for a bigger picture when the stored one is the small size", () => {
    expect(needsUnfurl(modern({ media: "image", thumb_px: 200 }), true)).toBe(true);
    expect(needsUnfurl(modern({ media: "image" }), true)).toBe(true); // size unknown: written before thumb_px
    expect(needsUnfurl(modern({ media: "image", thumb_px: WALL_THUMB_PX }), true)).toBe(false);
  });

  it("does not ask again for a page that has no picture to enlarge, once the function has answered", () => {
    expect(needsUnfurl(modern({ image: null, media: null }), true)).toBe(false);
  });

  it("leaves a gone page to the monthly re-check", () => {
    expect(needsUnfurl(modern({ gone: true }), true)).toBe(false);
  });

  it("does not ask twice: the stamp of the wall's one ask ends it, whatever the answer held", () => {
    // An older function never sends `media`, and a page may have no bigger
    // picture to give; neither may make every open ask again.
    const asked = "2026-10-11T00:00:00.000Z";
    expect(needsUnfurl(modern({ wall_asked_at: asked }), true)).toBe(false);
    expect(needsUnfurl(modern({ media: "image", thumb_px: 200, wall_asked_at: asked }), true)).toBe(false);
  });

  it("asks once more on the wall when the wall's ask came before the function could read Reddit, Pinterest or take a screenshot", () => {
    // 2026-10-09: the answers stamped before WALL_PICTURE_SINCE were a
    // statement about the function, not the page — a blank Reddit tile, a
    // Pinterest pin with no poster, a front page with no screenshot.
    const before = "2026-10-08T22:00:00.000Z";
    expect(before < WALL_PICTURE_SINCE).toBe(true);
    expect(needsUnfurl(modern({ image: null, media: null, wall_asked_at: before }), true)).toBe(true);
    expect(needsUnfurl(modern({ media: "image", thumb_px: WALL_THUMB_PX, wall_asked_at: before }), true)).toBe(true);
    // Off the wall, and once gone, it is not asked.
    expect(needsUnfurl(modern({ image: null, media: null, wall_asked_at: before }), false)).toBe(false);
    expect(needsUnfurl(modern({ gone: true, wall_asked_at: before }), true)).toBe(false);
  });

  it("asks once more about every wall entry the black-picture burst answered", () => {
    // The burst ran at 08:56 on 2026-10-09; WALL_PICTURE_SINCE was moved past it.
    const burst = "2026-10-09T08:56:56.243Z";
    expect(burst < WALL_PICTURE_SINCE).toBe(true);
    expect(needsUnfurl(modern({ media: null, image: null, wall_asked_at: burst }), true)).toBe(true);
  });
});

/**
 * 2026-10-09: pictures shrunk in one browser's burst of re-asks came out solid
 * black and were stored as the links' pictures. Each is asked about once more.
 */
describe("needsUnfurl for a picture from the black-picture window", () => {
  const entry = (fetched_at: string, over: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
    href: "https://www.reddit.com/r/x/comments/1/",
    domain: "reddit.com",
    title: "a",
    description: null,
    image: "data:image/jpeg;base64,AA",
    media: "image",
    thumb_px: 200,
    fetched_at,
    ...over,
  });
  const inside = "2026-10-09T08:56:54.483Z";

  it("is the window the burst fell in", () => {
    expect(BLANK_PICTURES_FROM <= inside && inside < BLANK_PICTURES_UNTIL).toBe(true);
  });

  it("asks again on the wall and off it", () => {
    expect(needsUnfurl(entry(inside))).toBe(true);
    expect(needsUnfurl(entry(inside, { thumb_px: WALL_THUMB_PX, wall_asked_at: inside }), true)).toBe(true);
  });

  it("asks only once: the answer is stamped after the window", () => {
    expect(needsUnfurl(entry(BLANK_PICTURES_UNTIL))).toBe(false);
    // Moving the wall's re-ask date does not widen the window.
    expect(needsUnfurl(entry("2026-10-09T10:30:00.000Z"))).toBe(false);
    expect(needsUnfurl(entry("2026-10-09T08:53:59.000Z"))).toBe(false);
  });

  it("leaves an entry with no picture alone", () => {
    expect(needsUnfurl(entry(inside, { image: null }))).toBe(false);
  });
});

/**
 * The re-check on open: which links are asked again whether they are still
 * there. Oldest answer first, never more than asked for, and never a link the
 * first-time scan still wants, one in the trash, or one edited out of the text.
 */
describe("dueForRecheck", () => {
  const now = Date.parse("2026-12-01T00:00:00.000Z");
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
  const preview = (href: string, over: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
    href,
    domain: "example.com",
    title: "a",
    description: null,
    // A picture, so no stamp here falls into `needsUnfurl`'s one extra ask
    // for picture-less previews from before PREVIEW_IMAGE_SINCE.
    image: "data:image/jpeg;base64,AA",
    fetched_at: daysAgo(40),
    ...over,
  });
  const linked = (
    id: string,
    previews: LinkPreviewData[],
    over: { body?: string; status?: string } = {},
  ) => ({
    id,
    body: over.body ?? previews.map((p) => p.href).join("\n"),
    status: over.status ?? "active",
    link_previews: previews,
  });

  it("asks about a link whose last answer is past the month, and not one inside it", () => {
    const old = linked("n1", [
      preview("https://example.com/old", { fetched_at: daysAgo(RECHECK_DAYS + 1) }),
    ]);
    const recent = linked("n2", [
      preview("https://example.com/new", { fetched_at: daysAgo(RECHECK_DAYS - 1) }),
    ]);
    expect(dueForRecheck([old, recent], now)).toEqual([
      { noteId: "n1", href: "https://example.com/old" },
    ]);
  });

  it("counts from the later of the fetch and the last re-check", () => {
    const checked = linked("n1", [
      preview("https://example.com/a", { fetched_at: daysAgo(200), checked_at: daysAgo(3) }),
    ]);
    expect(dueForRecheck([checked], now)).toEqual([]);
    expect(lastAsked(checked.link_previews[0])).toBe(daysAgo(3));
  });

  it("takes the oldest first and stops at the limit", () => {
    const notes = [40, 90, 50, 70, 45, 60, 80].map((days, i) =>
      linked(`n${i}`, [preview(`https://example.com/${days}`, { fetched_at: daysAgo(days) })]),
    );
    expect(dueForRecheck(notes, now, 3).map((due) => due.href)).toEqual([
      "https://example.com/90",
      "https://example.com/80",
      "https://example.com/70",
    ]);
    expect(dueForRecheck(notes, now)).toHaveLength(RECHECK_AT_ONCE);
  });

  it("skips the trash, an address no longer in the text, and anything never fetched", () => {
    const binned = linked("n1", [preview("https://example.com/binned")], { status: "trashed" });
    const edited = linked("n2", [preview("https://example.com/was")], {
      body: "the link is not in here any more",
    });
    const unasked = linked("n3", [preview("https://example.com/unasked", { fetched_at: null })]);
    expect(dueForRecheck([binned, edited, unasked], now)).toEqual([]);
  });

  it("asks again about a link already marked gone, so a page that comes back is noticed", () => {
    const dead = linked("n1", [
      preview("https://example.com/dead", { gone: true, checked_at: daysAgo(45) }),
    ]);
    expect(dueForRecheck([dead], now)).toEqual([
      { noteId: "n1", href: "https://example.com/dead" },
    ]);
  });
});

describe("goneCount", () => {
  it("counts only the addresses that answered 404 or 410", () => {
    const base = { domain: "d", title: "t", description: null, image: null, fetched_at: null };
    expect(
      goneCount([
        { ...base, href: "a", gone: true },
        { ...base, href: "b" },
        { ...base, href: "c", gone: false },
        { ...base, href: "d", gone: true },
      ]),
    ).toBe(2);
  });
});

describe("hiding a preview", () => {
  const body = "a https://one.com b https://two.com c https://three.com";
  const entry = (href: string, extra: Partial<LinkPreviewData> = {}): LinkPreviewData => ({
    href,
    domain: new URL(href).hostname,
    title: "T",
    description: null,
    image: null,
    fetched_at: "2026-09-01T00:00:00.000Z",
    ...extra,
  });

  it("creates the entry when the link has none, flagged hidden", () => {
    const next = withPreviewsHidden(body, [], ["https://two.com"], true);
    expect(next).toHaveLength(1);
    expect(next?.[0]).toMatchObject({ href: "https://two.com", hidden: true, fetched_at: null });
  });

  it("flags an existing entry without touching its other fields or the others", () => {
    const one = entry("https://one.com", { gone: true, checked_at: "2026-09-02T00:00:00.000Z" });
    const two = entry("https://two.com");
    const next = withPreviewsHidden(body, [one, two], ["https://one.com"], true);
    expect(next).toEqual([{ ...one, hidden: true }, two]);
  });

  it("keeps fields this build has never heard of", () => {
    const odd = { ...entry("https://one.com"), future: 7 } as LinkPreviewData;
    const next = withPreviewsHidden(body, [odd], ["https://one.com"], true);
    expect(next?.[0]).toMatchObject({ future: 7, hidden: true });
  });

  it("ignores an address that is not in the note", () => {
    expect(withPreviewsHidden(body, [], ["https://elsewhere.com"], true)).toBeNull();
  });

  it("showing takes the flag off and drops an entry that only existed to carry it", () => {
    const placeholder = withPreviewsHidden(body, [], ["https://two.com"], true) ?? [];
    const one = entry("https://one.com", { hidden: true });
    const next = withPreviewsHidden(body, [one, ...placeholder], ["https://one.com", "https://two.com"], false);
    expect(next).toHaveLength(1);
    expect(next?.[0]).toMatchObject({ href: "https://one.com", title: "T" });
    expect(next?.[0]).not.toHaveProperty("hidden");
  });

  it("answers null when nothing would change", () => {
    expect(withPreviewsHidden(body, [entry("https://one.com")], ["https://one.com"], false)).toBeNull();
    const hidden = entry("https://one.com", { hidden: true });
    expect(withPreviewsHidden(body, [hidden], ["https://one.com"], true)).toBeNull();
  });

  it("is read back through mergedPreviews, and visiblePreviews drops the hidden", () => {
    const next = withPreviewsHidden(body, [], ["https://two.com"], true);
    const drawn = mergedPreviews(body, next);
    expect(drawn).toHaveLength(3);
    expect(hiddenCount(drawn)).toBe(1);
    expect(visiblePreviews(drawn).map((p) => p.href)).toEqual(["https://one.com", "https://three.com"]);
  });
});
