import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canPreview,
  fileIconKey,
  fileKind,
  fileSize,
  isAudio,
  isImage,
  isVideo,
  mimeFor,
  PREVIEW_THUMB_PX,
  WALL_THUMB_PX,
} from "./files";
import { describe as describeFile, describeAll, measure } from "./describeFile";
import { DREW_BLANK, shrunkFromDataUrl, thumbFromDataUrl } from "./shrink";
import type { Attachment } from "../types";

function att(over: Partial<Attachment>): Attachment {
  return {
    id: "a1",
    name: "file",
    mime: "",
    size: 0,
    width: null,
    height: null,
    thumb: null,
    path: null,
    added_at: "2026-08-10T00:00:00.000Z",
    ...over,
  };
}

describe("fileSize", () => {
  it("stays short enough for the row it sits in", () => {
    expect(fileSize(400)).toBe("400 B");
    expect(fileSize(2048)).toBe("2 KB");
    expect(fileSize(900 * 1024)).toBe("900 KB");
    expect(fileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
    // Past ten, the tenth of a megabyte is noise.
    expect(fileSize(42 * 1024 * 1024)).toBe("42 MB");
  });
});

describe("fileKind", () => {
  it("takes the extension when there is one", () => {
    expect(fileKind("report.pdf", "application/pdf")).toBe("PDF");
    expect(fileKind("shot.PNG", "image/png")).toBe("PNG");
  });

  it("falls back to the type when the name has nothing to say", () => {
    expect(fileKind("noextension", "application/pdf")).toBe("PDF");
    expect(fileKind("", "")).toBe("FILE");
  });

  /**
   * A name is not a type. "backup.2026.01.31.tar" has a real extension at the
   * end; "notes.this.is.not.an.extension" does not, and a twelve-character box
   * would wreck the card it sits on.
   */
  it("refuses a tail too long to be an extension", () => {
    expect(fileKind("notes.description", "text/plain")).toBe("TEXT");
    expect(fileKind("backup.tar", "")).toBe("TAR");
  });

  /**
   * A MIME subtype is machine language. The common ones get the word a person
   * would use — "text/plain" was showing as PLAI — and only a type nobody
   * mapped still takes the subtype's first four letters.
   */
  it("speaks the common MIME types rather than truncating them", () => {
    expect(fileKind("noext", "text/plain")).toBe("TEXT");
    expect(
      fileKind(
        "noext",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("DOCX");
    expect(fileKind("noext", "audio/mpeg")).toBe("MP3");
    expect(fileKind("noext", "application/x-bizarre")).toBe("X-BI");
  });
});

describe("fileIconKey", () => {
  it("names the family from the extension first", () => {
    expect(fileIconKey("shot.png", "")).toBe("image");
    expect(fileIconKey("report.pdf", "")).toBe("document");
    expect(fileIconKey("notes.txt", "")).toBe("document");
    expect(fileIconKey("song.mp3", "")).toBe("audio");
    expect(fileIconKey("clip.mp4", "")).toBe("video");
    expect(fileIconKey("budget.xlsx", "")).toBe("sheet");
    expect(fileIconKey("deck.pptx", "")).toBe("slides");
    expect(fileIconKey("config.json", "")).toBe("code");
    expect(fileIconKey("backup.zip", "")).toBe("archive");
    expect(fileIconKey("invite.ics", "")).toBe("calendar");
    expect(fileIconKey("mum.vcf", "")).toBe("contact");
  });

  // The last dot decides, which is all "tar.gz" needs: gz is an archive.
  it("reads a compound extension off its last dot", () => {
    expect(fileIconKey("backup.tar.gz", "")).toBe("archive");
  });

  it("falls back to the MIME type for a dotless name", () => {
    expect(fileIconKey("photo", "image/heic")).toBe("image");
    expect(fileIconKey("voice note", "audio/ogg")).toBe("audio");
    expect(fileIconKey("export", "text/csv")).toBe("sheet");
    expect(fileIconKey("letter", "application/msword")).toBe("document");
    expect(fileIconKey("anything", "text/plain")).toBe("document");
  });

  // Android share and some drag sources hand over an empty MIME string, and a
  // name is allowed to be all name. The answer is a plain page, never a throw.
  it("answers file for the unknown and the empty", () => {
    expect(fileIconKey("", "")).toBe("file");
    expect(fileIconKey("mystery.blob", "")).toBe("file");
    expect(fileIconKey("thing", "application/octet-stream")).toBe("file");
  });
});

describe("isImage", () => {
  it("goes by the type, not by the name", () => {
    expect(isImage(att({ mime: "image/png", name: "x.txt" }))).toBe(true);
    expect(isImage(att({ mime: "application/pdf", name: "x.png" }))).toBe(false);
    expect(isImage(att({ mime: "" }))).toBe(false);
  });
});

describe("media types", () => {
  it("recognises audio and video from their MIME types", () => {
    expect(isAudio(att({ mime: "audio/mpeg", name: "x.bin" }))).toBe(true);
    expect(isVideo(att({ mime: "video/mp4", name: "x.bin" }))).toBe(true);
    expect(isAudio(att({ mime: "video/mp4" }))).toBe(false);
    expect(isVideo(att({ mime: "audio/mpeg" }))).toBe(false);
  });
});

describe("thumbFromDataUrl", () => {
  it("never throws on input it cannot even fetch as a URL", async () => {
    await expect(thumbFromDataUrl("not a data url", 200, 0.6)).resolves.toBeNull();
  });

  it("returns null for a data URL that is not a picture", async () => {
    const notAnImage = "data:text/plain;base64,aGVsbG8=";
    expect(await thumbFromDataUrl(notAnImage, 200, 0.6)).toBeNull();
  });

  // jsdom has no real canvas or createImageBitmap, so the actual shrink can't
  // run here — this only proves the happy path is reachable and, wherever
  // Node/jsdom does not implement createImageBitmap, that the function still
  // resolves to null rather than throwing.
  it("resolves rather than throwing for a real (tiny) image, wherever createImageBitmap exists", async () => {
    // 1x1 red GIF.
    const tinyGif =
      "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAUwAOw==";
    const result = await thumbFromDataUrl(tinyGif, 200, 0.6);
    if (typeof createImageBitmap !== "function") {
      expect(result).toBeNull();
    } else {
      expect(result === null || result.startsWith("data:image/jpeg")).toBe(true);
    }
  });

  /**
   * The production Content-Security-Policy allows connections to the app
   * itself and Supabase only, and `fetch` of a `data:` URL is a connection.
   * The one deploy that decoded through `fetch` threw away every picture the
   * server had already delivered — on production only, invisibly in dev — and
   * then stamped each preview "asked, no picture" so it was never asked
   * again. The decode must stay pure string work.
   */
  it("never reaches for fetch, which the deployed CSP would refuse", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new TypeError("Failed to fetch");
    });
    try {
      const tinyGif =
        "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAUwAOw==";
      await thumbFromDataUrl(tinyGif, 200, 0.6);
      await thumbFromDataUrl("data:text/plain;base64,aGVsbG8=", 200, 0.6);
      await thumbFromDataUrl("not a data url", 200, 0.6);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});


describe("shrunkFromDataUrl", () => {
  // jsdom has no canvas, and this suite has no document at all: a stand-in
  // canvas that remembers the size it was given, and a decoder that says the
  // picture is 800x400. What is asserted is the size reported back, which must
  // be the one the canvas was set to.
  const DATA_URL = "data:image/gif;base64,R0lGODlhAQABAIAAAP8AAP///ywAAAAAAQABAAACAUwAOw==";
  const canvases: { width: number; height: number }[] = [];
  const contextOptions: unknown[] = [];
  /** What was done to the canvas, in order — the paint, the reads, the encode. */
  const ops: string[] = [];

  /** `alpha` and `rgb` are what every pixel reads back as. */
  function stubDecoding(alpha = 255, rgb = 0) {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 800, height: 400, close() {} }));
    vi.stubGlobal("document", {
      createElement: () => {
        const ctx = {
          globalCompositeOperation: "source-over",
          fillStyle: "#000000",
          drawImage() {
            ops.push("draw");
          },
          fillRect() {
            ops.push(`fill ${ctx.fillStyle} ${ctx.globalCompositeOperation}`);
          },
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            ops.push("read");
            const data = new Uint8ClampedArray(w * h * 4).fill(rgb);
            for (let i = 3; i < data.length; i += 4) data[i] = alpha;
            return { data };
          },
        };
        const canvas = {
          width: 0,
          height: 0,
          getContext: (_kind: string, options?: unknown) => {
            contextOptions.push(options);
            return ctx;
          },
          toDataURL: () => {
            ops.push(`encode ${ctx.globalCompositeOperation}`);
            return "data:image/jpeg;base64,AA";
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    canvases.length = 0;
    contextOptions.length = 0;
    ops.length = 0;
  });

  /**
   * Audit BUG-1 (2026-10-10): a JPEG has no transparency, so a see-through PNG
   * or WebP — a logo, a sticker — was stored with a black background. White
   * goes in behind the picture, after the blank check has read the real alpha
   * and before the encode, and the canvas is back to ordinary drawing after.
   */
  it("lays white behind a see-through picture before it is made a JPEG", async () => {
    stubDecoding(128, 0);
    await shrunkFromDataUrl(DATA_URL, 480, 0.7);
    expect(ops).toEqual(["draw", "read", "fill white destination-over", "encode source-over"]);
  });

  it("says the size of what it stored, not of what it was given", async () => {
    stubDecoding();
    const out = await shrunkFromDataUrl(DATA_URL, 480, 0.7);
    expect(out).toMatchObject({ width: 480, height: 240 });
    expect(out?.thumb.startsWith("data:image")).toBe(true);
    expect(canvases[0]).toMatchObject({ width: 480, height: 240 });
  });

  it("is null for something that is not a picture", async () => {
    stubDecoding();
    expect(await shrunkFromDataUrl("not a data url", 480, 0.7)).toBeNull();
    expect(await shrunkFromDataUrl("data:text/plain;base64,aGVsbG8=", 480, 0.7)).toBeNull();
  });

  it("never enlarges", async () => {
    stubDecoding();
    const out = await shrunkFromDataUrl(DATA_URL, 4000, 0.7);
    expect(out).toMatchObject({ width: 800, height: 400 });
  });

  /**
   * 2026-10-09: one browser's canvas drew nothing for a burst of link pictures,
   * and an empty canvas encodes as a solid black JPEG — which was stored and
   * synced as each link's picture, and the Inspiration wall drew black boxes.
   */
  it("refuses to encode a canvas the draw never reached, which would be a black picture", async () => {
    stubDecoding(0);
    expect(await shrunkFromDataUrl(DATA_URL, 480, 0.7)).toBe(DREW_BLANK);
    expect(await thumbFromDataUrl(DATA_URL, 200, 0.6)).toBeNull();
  });

  it("keeps a picture that really is black, which is opaque", async () => {
    stubDecoding(255, 0);
    expect(await shrunkFromDataUrl(DATA_URL, 480, 0.7)).toMatchObject({ width: 480, height: 240 });
  });

  it("asks for a canvas kept in ordinary memory, where a hidden tab cannot lose the drawing", async () => {
    stubDecoding(255);
    await shrunkFromDataUrl(DATA_URL, 480, 0.7);
    expect(contextOptions[0]).toMatchObject({ willReadFrequently: true });
  });

  it("leaves thumbFromDataUrl answering with the same picture, minus the size", async () => {
    stubDecoding();
    expect(await thumbFromDataUrl(DATA_URL, 200, 0.6)).toBe("data:image/jpeg;base64,AA");
    expect(canvases[0]).toMatchObject({ width: 200, height: 100 });
  });
});

it("keeps the wall's picture at 1080 and everyone else's at 200", () => {
  expect(WALL_THUMB_PX).toBe(1080);
  expect(PREVIEW_THUMB_PX).toBe(200);
});

/**
 * An empty `file.type` is ordinary — Android's share sheet sends one often
 * enough that `shareTarget.test.ts` pins it, and some drag sources do the
 * same. `fileKind` and `fileIconKey` have always read the extension first for
 * that reason; the fields the app reads as *behaviour* did not, so a shared
 * screenshot was stored with no type, drew a grey box instead of itself, and
 * could not be opened in the viewer at all.
 */
describe("a file whose own type says nothing", () => {
  it("believes the browser wherever it spoke", () => {
    expect(mimeFor("x.png", "application/pdf")).toBe("application/pdf");
    expect(mimeFor("noextension", "image/png")).toBe("image/png");
  });

  it("reads the name when the browser said nothing", () => {
    expect(mimeFor("shot.png", "")).toBe("image/png");
    expect(mimeFor("PHOTO.JPG", "")).toBe("image/jpeg");
    expect(mimeFor("voice.m4a", "")).toBe("audio/mp4");
    expect(mimeFor("clip.mov", "")).toBe("video/quicktime");
    expect(mimeFor("lease.pdf", "")).toBe("application/pdf");
  });

  // Honest about not knowing: a name that says nothing leaves the type the
  // empty string it arrived as, rather than an invented octet-stream.
  it("invents nothing for a name that says nothing either", () => {
    expect(mimeFor("mystery.blob", "")).toBe("");
    expect(mimeFor("noextension", "")).toBe("");
    expect(mimeFor("", "")).toBe("");
  });

  /**
   * Read through `mimeFor` rather than off the stored string, so every picture
   * already saved with an empty type — on this device and on the other one —
   * starts drawing itself again without a migration touching a row.
   */
  it("draws and opens a picture the type never named", () => {
    const shared = att({ name: "IMG_20260904.jpg", mime: "" });
    expect(isImage(shared)).toBe(true);
    expect(canPreview(shared)).toBe(true);
    expect(isAudio(att({ name: "note.m4a", mime: "" }))).toBe(true);
    expect(isVideo(att({ name: "clip.mp4", mime: "" }))).toBe(true);
  });

  it("still lets a real type overrule the name it was given", () => {
    expect(isImage(att({ name: "x.png", mime: "application/pdf" }))).toBe(false);
    expect(canPreview(att({ name: "x.png", mime: "application/pdf", thumb: null }))).toBe(false);
  });
});

/**
 * The half of the same bug that reached the *other* device: `measure` returned
 * before `createImageBitmap` was ever asked, so the note synced with no
 * thumbnail in it and the phone had nothing to draw.
 */
describe("measure", () => {
  async function withBitmap(file: File) {
    const bitmap = { width: 800, height: 600, close: vi.fn() };
    const decode = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", decode);
    try {
      return { out: await measure(file), decode };
    } finally {
      vi.unstubAllGlobals();
    }
  }

  /**
   * What is pinned is the *gate*, not the drawing: this suite runs with no
   * `document`, so the canvas half cannot run here at any rate. Reaching
   * `createImageBitmap` at all is the whole of the regression — the old line
   * refused the file before this point and returned a note with no thumbnail
   * to sync.
   */
  it("hands a picture with no type to the decoder instead of refusing it", async () => {
    const file = new File(["x"], "shot.png");
    const { decode } = await withBitmap(file);
    expect(decode).toHaveBeenCalledWith(file);
  });

  it("does not reach for a decoder when neither source says picture", async () => {
    const { out, decode } = await withBitmap(new File(["x"], "notes.txt"));
    expect(decode).not.toHaveBeenCalled();
    expect(out).toEqual({ thumb: null, width: null, height: null });
  });
});

/** `describe()` stores what `mimeFor` worked out, which is what the upload's
 *  own `contentType` is read off as well (`store/attachments.ts`). */
describe("describe", () => {
  it("records the type the name implies for a file that arrived without one", async () => {
    const att_ = await describeFile(new File(["x"], "shot.png"));
    expect(att_.mime).toBe("image/png");
    expect(isImage(att_)).toBe(true);
  });

  it("leaves the type empty when nothing knows it", async () => {
    const att_ = await describeFile(new File(["x"], "mystery.blob"));
    expect(att_.mime).toBe("");
  });
});

describe("describeAll", () => {
  /**
   * Several files are read a few at a time rather than strictly one after
   * another; what comes back must still be in the order they were given, or a
   * shared set of photographs would land shuffled in the note.
   */
  it("answers in the order given, one attachment per file", async () => {
    const files = ["a.txt", "b.pdf.txt", "c.txt", "d.txt", "e.txt"].map(
      (name) => new File([name], name, { type: "text/plain" }),
    );
    const atts = await describeAll(files);
    expect(atts.map((a) => a.name)).toEqual(files.map((f) => f.name));
    expect(new Set(atts.map((a) => a.id)).size).toBe(files.length);
  });

  it("answers nothing for nothing", async () => {
    expect(await describeAll([])).toEqual([]);
  });
});
