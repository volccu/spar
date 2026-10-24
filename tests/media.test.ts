import { describe, expect, it } from "vitest";
import {
  bestRedditStream,
  imgurDirect,
  imgurMedia,
  isFrontPage,
  mediaPlan,
  parseOembed,
  parseRedditEmbed,
  parseRedditFeed,
  parseRedditPost,
  pinterestId,
  pinterestMedia,
  redditFeedMedia,
  redditJsonUrl,
  redditPlaylistUrl,
  redditShareCard,
  screenshotUrl,
  vimeoId,
  vimeoMedia,
  weakPicture,
  youtubeId,
  youtubeMedia,
} from "../supabase/functions/_shared/media";
import { publicUrlShape as parsedPublicUrl } from "../supabase/functions/_shared/netguard";

const u = (s: string) => new URL(s);
const post = (data: Record<string, unknown>) => [{ data: { children: [{ data }] } }, { data: { children: [] } }];

describe("mediaPlan — which sites we can say more about, and how", () => {
  it("knows Reddit posts, YouTube, Vimeo and a single Imgur picture", () => {
    expect(mediaPlan(u("https://www.reddit.com/r/pics/comments/abc123/a_title/"))?.site).toBe("reddit");
    expect(mediaPlan(u("https://youtu.be/dQw4w9WgXcQ"))?.site).toBe("youtube");
    expect(mediaPlan(u("https://vimeo.com/76979871"))?.site).toBe("vimeo");
    expect(mediaPlan(u("https://imgur.com/AbC123x"))?.site).toBe("imgur");
  });

  it("leaves everything else to the generic og:image path — X, Instagram included", () => {
    for (const address of [
      "https://example.com/post",
      "https://x.com/someone/status/1",
      "https://twitter.com/someone/status/1",
      "https://www.instagram.com/p/abc/",
      "https://www.reddit.com/r/pics/",
      "https://www.reddit.com/user/someone",
      "https://www.youtube.com/@channel",
      "https://imgur.com/gallery/abc",
      "https://imgur.com/a/abc",
    ]) {
      expect(mediaPlan(u(address)), address).toBeNull();
    }
  });
});

describe("redditJsonUrl", () => {
  it("asks for the post's own .json on the canonical host, whichever front end the link used", () => {
    for (const host of ["reddit.com", "www.reddit.com", "old.reddit.com", "np.reddit.com", "m.reddit.com"]) {
      expect(redditJsonUrl(u(`https://${host}/r/pics/comments/abc123/slug/?utm=1`))).toBe(
        "https://www.reddit.com/r/pics/comments/abc123/.json?raw_json=1&limit=1&depth=1",
      );
    }
    expect(redditJsonUrl(u("https://www.reddit.com/comments/abc123/slug"))).toBe(
      "https://www.reddit.com/comments/abc123/.json?raw_json=1&limit=1&depth=1",
    );
  });

  it("says nothing for a host that only looks like Reddit", () => {
    expect(redditJsonUrl(u("https://reddit.com.evil.example/r/pics/comments/abc123/x"))).toBeNull();
    expect(redditJsonUrl(u("https://notreddit.com/r/pics/comments/abc123/x"))).toBeNull();
  });
});

describe("parseRedditPost", () => {
  it("takes a gallery's first picture, with its size", () => {
    const found = parseRedditPost(
      post({
        title: "Three windows",
        is_gallery: true,
        gallery_data: { items: [{ media_id: "m1" }, { media_id: "m2" }] },
        media_metadata: {
          m1: { e: "Image", s: { u: "https://preview.redd.it/m1.jpg?width=640&amp;s=x", x: 640, y: 960 } },
          m2: { e: "Image", s: { u: "https://preview.redd.it/m2.jpg", x: 1, y: 1 } },
        },
      }),
    );
    expect(found).toMatchObject({ title: "Three windows", media: "image", width: 640, height: 960, video: null });
    expect(found?.images).toEqual(["https://preview.redd.it/m1.jpg?width=640&s=x"]);
  });

  it("takes a post's own picture, preferring the full address to the preview", () => {
    const found = parseRedditPost(
      post({
        title: "A pier",
        post_hint: "image",
        url: "https://i.redd.it/pier.jpg",
        preview: { images: [{ source: { url: "https://preview.redd.it/pier.jpg?auto=webp", width: 4000, height: 3000 } }] },
      }),
    );
    expect(found).toMatchObject({ media: "image", width: 4000, height: 3000 });
    expect(found?.images).toEqual(["https://i.redd.it/pier.jpg", "https://preview.redd.it/pier.jpg?auto=webp"]);
  });

  it("takes a video's poster and plays its stream from v.redd.it", () => {
    const found = parseRedditPost(
      post({
        title: "A kettle",
        is_video: true,
        media: { reddit_video: { fallback_url: "https://v.redd.it/zz9/DASH_720.mp4?source=fallback", width: 720, height: 1280 } },
        preview: { images: [{ source: { url: "https://external-preview.redd.it/zz9.png?format=pjpg", width: 720, height: 1280 } }] },
      }),
    );
    expect(found).toMatchObject({
      media: "video",
      width: 720,
      height: 1280,
      video: { kind: "file", src: "https://v.redd.it/zz9/DASH_720.mp4?source=fallback" },
    });
    expect(found?.images[0]).toBe("https://external-preview.redd.it/zz9.png?format=pjpg");
  });

  it("will not play a video stream that is not on Reddit's own host", () => {
    const found = parseRedditPost(
      post({
        is_video: true,
        media: { reddit_video: { fallback_url: "https://evil.example/x.mp4", width: 1, height: 1 } },
        preview: { images: [{ source: { url: "https://external-preview.redd.it/p.png", width: 10, height: 10 } }] },
      }),
    );
    expect(found?.video).toBeNull();
    expect(found?.media).toBe("image");
  });

  it("takes a link post's preview picture", () => {
    const found = parseRedditPost(
      post({ title: "An article", url: "https://example.com/story", preview: { images: [{ source: { url: "https://external-preview.redd.it/a.jpg", width: 1200, height: 630 } }] } }),
    );
    expect(found).toMatchObject({ media: "image", width: 1200, height: 630 });
  });

  it("says nothing for a text post, a removed post or anything that is not a post", () => {
    expect(parseRedditPost(post({ title: "Just words", selftext: "hello" }))).toBeNull();
    expect(parseRedditPost(post({ title: "[removed]", removed_by_category: "moderator" }))).toBeNull();
    for (const bad of [null, undefined, 7, "text", {}, [], [{}], [{ data: {} }], [{ data: { children: [] } }], [{ data: { children: [{}] } }]]) {
      expect(parseRedditPost(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses a picture address that is not https, or not an address", () => {
    const found = parseRedditPost(
      post({ post_hint: "image", url: "javascript:alert(1)", preview: { images: [{ source: { url: "http://insecure.example/p.jpg", width: 1, height: 1 } }] } }),
    );
    expect(found).toBeNull();
  });

  it("ignores non-numeric and non-positive sizes", () => {
    const found = parseRedditPost(
      post({ post_hint: "image", url: "https://i.redd.it/p.jpg", preview: { images: [{ source: { url: "https://preview.redd.it/p.jpg", width: "wide", height: -3 } }] } }),
    );
    expect(found).toMatchObject({ width: null, height: null });
  });
});

describe("YouTube", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("finds the id in %s", (address, id) => {
    expect(youtubeId(u(address))).toBe(id);
  });

  it("refuses an id that is not eleven id characters, and a look-alike host", () => {
    expect(youtubeId(u("https://www.youtube.com/watch?v=short"))).toBeNull();
    expect(youtubeId(u("https://www.youtube.com/watch?v=dQw4w9WgXcQ%22%3E"))).toBeNull();
    expect(youtubeId(u("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ"))).toBeNull();
    expect(youtubeId(u("https://www.youtube.com/playlist?list=PL123"))).toBeNull();
  });

  it("plans an oEmbed for the title and builds the picture from i.ytimg.com by id, best first", () => {
    const plan = mediaPlan(u("https://youtu.be/dQw4w9WgXcQ"));
    expect(plan).toMatchObject({ site: "youtube", id: "dQw4w9WgXcQ" });
    expect((plan as { oembed: string }).oembed).toBe(
      "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
    );
    const found = youtubeMedia("dQw4w9WgXcQ", "A song");
    expect(found).toMatchObject({ title: "A song", media: "video", video: { kind: "youtube", src: "dQw4w9WgXcQ" } });
    expect(found.images).toEqual([
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    ]);
  });
});

describe("Vimeo", () => {
  it.each([
    ["https://vimeo.com/76979871", "76979871"],
    ["https://www.vimeo.com/76979871?share=copy", "76979871"],
    ["https://player.vimeo.com/video/76979871", "76979871"],
    ["https://vimeo.com/channels/staffpicks/76979871", "76979871"],
  ])("finds the id in %s", (address, id) => {
    expect(vimeoId(u(address))).toBe(id);
  });

  it("refuses a page that is not a video", () => {
    expect(vimeoId(u("https://vimeo.com/watch"))).toBeNull();
    expect(vimeoId(u("https://vimeo.com/someone"))).toBeNull();
  });

  it("reads its public oEmbed for the thumbnail and the size", () => {
    const parsed = parseOembed({ title: "A film", thumbnail_url: "https://i.vimeocdn.com/video/1_640.jpg", thumbnail_width: 640, thumbnail_height: 360 });
    expect(parsed).toEqual({ title: "A film", image: "https://i.vimeocdn.com/video/1_640.jpg", width: 640, height: 360 });
    expect(vimeoMedia("76979871", parsed)).toMatchObject({
      title: "A film",
      media: "video",
      width: 640,
      height: 360,
      video: { kind: "vimeo", src: "76979871" },
      images: ["https://i.vimeocdn.com/video/1_640.jpg"],
    });
  });

  it("has nothing to say without a picture", () => {
    expect(vimeoMedia("76979871", parseOembed({ title: "A film" }))).toBeNull();
    expect(vimeoMedia("76979871", null)).toBeNull();
    expect(parseOembed(null)).toBeNull();
    expect(parseOembed("x")).toBeNull();
  });
});

describe("Imgur", () => {
  it("turns a single-picture page into the direct picture", () => {
    expect(imgurDirect(u("https://imgur.com/AbC123x"))).toBe("https://i.imgur.com/AbC123x.jpg");
    expect(imgurMedia("https://i.imgur.com/AbC123x.jpg")).toMatchObject({ media: "image", video: null, images: ["https://i.imgur.com/AbC123x.jpg"] });
  });

  it("leaves albums, galleries and other hosts to the generic path", () => {
    for (const address of ["https://imgur.com/a/AbC123x", "https://imgur.com/gallery/AbC123x", "https://imgur.com/", "https://imgur.com/t/cats", "https://notimgur.com/AbC123x"]) {
      expect(imgurDirect(u(address)), address).toBeNull();
    }
  });
});

// Every address a site handler derives, or reads out of a site's answer, is then
// fetched by the function through `publicUrl`, whose address rules live in
// `_shared/netguard.ts` so they can be tested from here. These cases pin that a
// handler's own addresses pass those rules and that a hostile one in a site's
// answer would not.
describe("site addresses are still held to the public-address rules", () => {
  it("every address a plan derives is a public https address", () => {
    const derived: string[] = [];
    for (const address of [
      "https://old.reddit.com/r/pics/comments/abc123/slug/",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://imgur.com/AbC123x",
    ]) {
      const plan = mediaPlan(u(address));
      if (plan?.site === "reddit") derived.push(plan.json);
      if (plan?.site === "youtube" || plan?.site === "vimeo") derived.push(plan.oembed);
      if (plan?.site === "imgur") derived.push(plan.image);
    }
    derived.push(...youtubeMedia("dQw4w9WgXcQ", null).images);
    expect(derived).toHaveLength(6);
    for (const address of derived) {
      expect(address.startsWith("https://"), address).toBe(true);
      expect(parsedPublicUrl(address), address).not.toBeNull();
    }
  });

  it("a private, local or non-web address is refused by those rules", () => {
    for (const address of [
      "https://127.0.0.1/p.jpg",
      "https://10.0.0.5/p.jpg",
      "https://192.168.1.1/p.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/p.jpg",
      "https://metadata.google.internal/x",
      "https://user:pass@i.redd.it/p.jpg",
      "https://[::1]/p.jpg",
      "https://2130706433/p.jpg",
      "ftp://i.redd.it/p.jpg",
      "file:///etc/passwd",
    ]) {
      expect(parsedPublicUrl(address), address).toBeNull();
    }
    expect(parsedPublicUrl("https://i.redd.it/p.jpg")).not.toBeNull();
    expect(parsedPublicUrl("http://i.imgur.com/p.jpg")).not.toBeNull();
  });

  it("a private https address in a post can reach the candidate list, and is then refused", () => {
    const found = parseRedditPost(
      post({ post_hint: "image", url: "https://169.254.169.254/x.jpg", preview: { images: [{ source: { url: "https://preview.redd.it/x.jpg", width: 9, height: 9 } }] } }),
    );
    expect(found?.images).toEqual(["https://169.254.169.254/x.jpg", "https://preview.redd.it/x.jpg"]);
    expect(parsedPublicUrl(found!.images[0])).toBeNull();
    expect(parsedPublicUrl(found!.images[1])).not.toBeNull();
  });
});

/** A post's Atom feed as Reddit serves it: the content is HTML escaped into XML. */
const feed = (content: string, thumb: string | null = "https://external-preview.redd.it/abc.png?width=640&amp;crop=smart&amp;s=1") =>
  `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">` +
  `<title>A post : sub</title><entry><author><name>/u/someone</name></author>` +
  `<content type="html">${content}</content><id>t3_abc123</id>` +
  (thumb ? `<media:thumbnail url="${thumb}" />` : "") +
  `<title>Zine/punk collage style for my project&#39;s UI</title></entry>` +
  `<entry><content type="html">&lt;a href=&quot;https://v.redd.it/commentvid&quot;&gt;x&lt;/a&gt;</content><title>a comment</title></entry></feed>`;
const linkTo = (href: string) => `&lt;span&gt;&lt;a href=&quot;${href}&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;`;

describe("Reddit through the post's feed", () => {
  it("plans the feed, the json and the share card from one post address", () => {
    expect(mediaPlan(u("https://old.reddit.com/r/godot/comments/1wqkoq1/zinepunk/?share=1"))).toEqual({
      site: "reddit",
      id: "1wqkoq1",
      embed: "https://embed.reddit.com/r/godot/comments/1wqkoq1/",
      oembed: "https://www.reddit.com/oembed?url=https%3A%2F%2Fwww.reddit.com%2Fr%2Fgodot%2Fcomments%2F1wqkoq1%2F",
      feed: "https://www.reddit.com/r/godot/comments/1wqkoq1/.rss",
      json: "https://www.reddit.com/r/godot/comments/1wqkoq1/.json?raw_json=1&limit=1&depth=1",
    });
  });

  it("reads a video post: its title, poster and v.redd.it id, from the first entry only", () => {
    expect(parseRedditFeed(feed(linkTo("https://v.redd.it/1f099rmcltrh1")))).toEqual({
      title: "Zine/punk collage style for my project's UI",
      poster: "https://external-preview.redd.it/abc.png?width=640&crop=smart&s=1",
      picture: null,
      videoId: "1f099rmcltrh1",
    });
  });

  it("reads a picture post's full picture, with its doubly escaped ampersands undone", () => {
    const post = parseRedditFeed(feed(linkTo("https://i.redd.it/pic.jpg?a=1&amp;amp;b=2")));
    expect(post?.picture).toBe("https://i.redd.it/pic.jpg?a=1&b=2");
    expect(post?.videoId).toBeNull();
  });

  it("is null for anything that is not a feed with an entry", () => {
    expect(parseRedditFeed(null)).toBeNull();
    expect(parseRedditFeed("<html>blocked</html>")).toBeNull();
  });

  it("takes no address that is not https", () => {
    const post = parseRedditFeed(feed(linkTo("http://i.redd.it/pic.jpg"), "javascript:alert(1)"));
    expect(post?.picture).toBeNull();
    expect(post?.poster).toBeNull();
  });

  const mpd = `<MPD><Period><AdaptationSet contentType="video">
    <Representation height="220" id="6" mimeType="video/mp4" width="392"><BaseURL>CMAF_220.mp4</BaseURL></Representation>
    <Representation height="720" id="9" mimeType="video/mp4" width="1280"><BaseURL>CMAF_720.mp4</BaseURL></Representation>
    <Representation height="1080" id="10" mimeType="video/mp4" width="1920"><BaseURL>CMAF_1080.mp4</BaseURL></Representation>
    </AdaptationSet><AdaptationSet contentType="audio">
    <Representation id="a" mimeType="audio/mp4"><BaseURL>CMAF_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;

  it("plays the tallest video stream at or under 720, built on v.redd.it", () => {
    expect(redditPlaylistUrl("1f099rmcltrh1")).toBe("https://v.redd.it/1f099rmcltrh1/DASHPlaylist.mpd");
    expect(bestRedditStream(mpd, "1f099rmcltrh1")).toEqual({
      src: "https://v.redd.it/1f099rmcltrh1/CMAF_720.mp4",
      width: 1280,
      height: 720,
    });
  });

  it("refuses a stream file that is not a plain .mp4 name, and a playlist with none", () => {
    const sneaky = `<Representation height="480" mimeType="video/mp4"><BaseURL>https://evil.example/x.mp4</BaseURL></Representation>`;
    expect(bestRedditStream(sneaky, "1f099rmcltrh1")).toBeNull();
    expect(bestRedditStream("<MPD/>", "1f099rmcltrh1")).toBeNull();
    expect(bestRedditStream(mpd, "../../x")).toBeNull();
  });

  it("makes a playable video of a video post, and a poster of it when no stream came", () => {
    const post = parseRedditFeed(feed(linkTo("https://v.redd.it/1f099rmcltrh1")));
    const stream = bestRedditStream(mpd, "1f099rmcltrh1");
    expect(redditFeedMedia(post, stream)).toMatchObject({
      media: "video",
      images: ["https://external-preview.redd.it/abc.png?width=640&crop=smart&s=1"],
      width: 1280,
      height: 720,
      video: { kind: "file", src: "https://v.redd.it/1f099rmcltrh1/CMAF_720.mp4" },
    });
    expect(redditFeedMedia(post, null)).toMatchObject({ media: "image", video: null });
  });

  it("puts a picture post's full picture before its poster, and is null with no picture at all", () => {
    const post = parseRedditFeed(feed(linkTo("https://i.redd.it/pic.jpg")));
    expect(redditFeedMedia(post, null)?.images).toEqual([
      "https://i.redd.it/pic.jpg",
      "https://external-preview.redd.it/abc.png?width=640&crop=smart&s=1",
    ]);
    expect(redditFeedMedia(parseRedditFeed(feed("just words", null)), null)).toBeNull();
  });

  it("falls back to the card Reddit draws of the post", () => {
    expect(redditShareCard("1wqkoq1").images).toEqual(["https://share.redd.it/preview/post/1wqkoq1"]);
  });
});

describe("Pinterest", () => {
  it("knows a pin on any country host, in either address form", () => {
    expect(pinterestId(u("https://fi.pinterest.com/pin/795589090469038858/"))).toBe("795589090469038858");
    expect(pinterestId(u("https://www.pinterest.co.uk/pin/some-title--795589090469038858/"))).toBe("795589090469038858");
    expect(pinterestId(u("https://pinterest.com/pin/795589090469038858"))).toBe("795589090469038858");
    expect(mediaPlan(u("https://fi.pinterest.com/pin/795589090469038858/"))).toEqual({
      site: "pinterest",
      oembed: "https://www.pinterest.com/oembed.json?url=https%3A%2F%2Fwww.pinterest.com%2Fpin%2F795589090469038858%2F",
    });
  });

  it("says nothing for a board, a profile or a look-alike host", () => {
    expect(pinterestId(u("https://www.pinterest.com/someone/boards/"))).toBeNull();
    expect(pinterestId(u("https://pinterest.com.evil.example/pin/795589090469038858/"))).toBeNull();
  });

  it("asks for the 736-pixel picture first and the oEmbed's own thumbnail second", () => {
    const media = pinterestMedia(
      parseOembed({
        title: "velovories",
        thumbnail_url: "https://i.pinimg.com/236x/3c/81/a4/3c81.jpg",
        thumbnail_width: 236,
        thumbnail_height: 354,
      }),
    );
    expect(media).toMatchObject({
      title: "velovories",
      images: ["https://i.pinimg.com/736x/3c/81/a4/3c81.jpg", "https://i.pinimg.com/236x/3c/81/a4/3c81.jpg"],
      media: "image",
      width: 236,
      height: 354,
    });
  });

  it("accepts a thumbnail only from i.pinimg.com", () => {
    expect(pinterestMedia(parseOembed({ thumbnail_url: "https://evil.example/236x/a.jpg" }))).toBeNull();
    expect(pinterestMedia(null)).toBeNull();
  });
});

describe("screenshots for the wall", () => {
  it("counts only a site's root as its front page", () => {
    expect(isFrontPage(u("https://saleor.io/"))).toBe(true);
    expect(isFrontPage(u("https://saleor.io/?ref=x"))).toBe(true);
    expect(isFrontPage(u("https://saleor.io/blog/post"))).toBe(false);
  });

  it("knows a logo or an icon by its file name, and leaves a photograph alone", () => {
    expect(weakPicture("http://static1.squarespace.com/static/5438/t/5452/1414712231534/logo.png?format=1500w")).toBe(true);
    expect(weakPicture("https://example.com/favicon-32.png")).toBe(true);
    expect(weakPicture("https://example.com/img/site-icon.png")).toBe(true);
    expect(weakPicture("https://example.com/opengraph-image.png")).toBe(false);
    expect(weakPicture("https://example.com/iconic-bridge.jpg")).toBe(false);
    expect(weakPicture("not an address")).toBe(false);
  });

  it("asks Microlink for the picture itself, at a desktop size", () => {
    const shot = new URL(screenshotUrl(u("https://saleor.io/")));
    expect(shot.origin).toBe("https://api.microlink.io");
    expect(shot.searchParams.get("url")).toBe("https://saleor.io/");
    expect(shot.searchParams.get("embed")).toBe("screenshot.url");
    expect(shot.searchParams.get("viewport.width")).toBe("1280");
  });
});

describe("Reddit through the post's embed page", () => {
  const poster =
    "https://external-preview.redd.it/zine-v0-cGQ5.png?width=640&amp;crop=smart&amp;format=pjpg&amp;s=bd49";
  const videoPage =
    `<html><head><title>Reddit - The heart of the internet</title></head><body>` +
    `<shreddit-player src="https://v.redd.it/1f099rmcltrh1/HLSPlaylist.m3u8?f=hd&amp;v=1" poster="${poster}" autoplay></shreddit-player>` +
    `<a href="https://v.redd.it/1f099rmcltrh1">x</a></body></html>`;

  it("reads a video post's poster and stream id, and takes the title it is given", () => {
    expect(parseRedditEmbed(videoPage, "Zine/punk collage style")).toEqual({
      title: "Zine/punk collage style",
      poster: "https://external-preview.redd.it/zine-v0-cGQ5.png?width=640&crop=smart&format=pjpg&s=bd49",
      picture: null,
      videoId: "1f099rmcltrh1",
    });
  });

  it("reads a picture post's full picture, and a gallery's first preview", () => {
    const picturePage = `<img src="https://preview.redd.it/abc.jpg?width=640&amp;s=1"><a href="https://i.redd.it/k3x9a.jpeg">x</a>`;
    expect(parseRedditEmbed(picturePage, null)).toMatchObject({
      picture: "https://i.redd.it/k3x9a.jpeg",
      poster: "https://preview.redd.it/abc.jpg?width=640&s=1",
      videoId: null,
    });
  });

  it("is null for a page with no media at all — a text post, a refusal", () => {
    expect(parseRedditEmbed("<html><p>words</p></html>", "A title")).toBeNull();
    expect(parseRedditEmbed(null, null)).toBeNull();
  });

  it("feeds the same media maker as the feed does", () => {
    expect(redditFeedMedia(parseRedditEmbed(videoPage, "T"), null)).toMatchObject({
      title: "T",
      images: ["https://external-preview.redd.it/zine-v0-cGQ5.png?width=640&crop=smart&format=pjpg&s=bd49"],
      media: "image",
    });
  });
});
