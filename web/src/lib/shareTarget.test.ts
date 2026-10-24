import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_INBOX, UNREADABLE, composeShared, takeShared } from "./shareTarget";

/**
 * The half of the share target that can be tested.
 *
 * `public/share-sw.js` is a plain file with no build step and no imports, so
 * it holds nothing but "read the form, park it, redirect" — every decision it
 * would otherwise have made lives here, and this is where those decisions are
 * checked. The cache below is the contract between the two files: the worker
 * writes exactly these keys and headers, and `takeShared` reads them.
 */

/** A stand-in for one browser's Cache Storage, enough for what is used here. */
class FakeCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === "string" ? request : request.url, response);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async match(request: Request | string) {
    return this.entries.get(typeof request === "string" ? request : request.url);
  }
}

let caches_: Map<string, FakeCache>;

function installCaches() {
  caches_ = new Map();
  vi.stubGlobal("caches", {
    has: async (name: string) => caches_.has(name),
    open: async (name: string) => {
      if (!caches_.has(name)) caches_.set(name, new FakeCache());
      return caches_.get(name)!;
    },
    delete: async (name: string) => caches_.delete(name),
  });
}

/** What the worker writes, said once so the tests can't drift from it. */
async function park(
  words: Record<string, string>,
  files: { name: string; type: string; body: string }[] = [],
) {
  const cache = new FakeCache();
  caches_.set(SHARE_INBOX, cache);
  await cache.put(
    new Request("https://spar.test/__share/text"),
    new Response(JSON.stringify(words), { headers: { "content-type": "application/json" } }),
  );
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    await cache.put(
      new Request(`https://spar.test/__share/f/${String(i).padStart(4, "0")}`),
      new Response(f.body, {
        headers: {
          "content-type": f.type || "application/octet-stream",
          "x-share-name": encodeURIComponent(f.name),
          "x-share-type": encodeURIComponent(f.type),
        },
      }),
    );
  }
}

beforeEach(() => {
  installCaches();
});

describe("composeShared", () => {
  it("has nothing to say about a photograph", () => {
    // The overwhelmingly common case: the gallery sends files and no words at
    // all, and the note is then the picture, exactly as a dropped file is.
    expect(composeShared({})).toBe("");
    expect(composeShared(null)).toBe("");
  });

  it("writes a shared page as its name and then its address", () => {
    expect(
      composeShared({ title: "Best cinnamon buns", url: "https://example.com/buns" }),
    ).toBe("Best cinnamon buns\nhttps://example.com/buns");
  });

  it("does not print the address twice when an app puts it in the text", () => {
    // Extremely common: the sheet fills `text` with the URL and sends `url` as
    // well. Kept naively that is the same line twice in the note.
    expect(
      composeShared({ text: "https://example.com/buns", url: "https://example.com/buns" }),
    ).toBe("https://example.com/buns");
  });

  it("keeps the longer of two parts that say the same thing", () => {
    expect(composeShared({ title: "Buns", text: "Buns, the good ones" })).toBe(
      "Buns, the good ones",
    );
  });

  it("keeps a title that merely happens to appear inside the address", () => {
    // "news" is inside "news.ycombinator.com", and it is also the name of the
    // thing. Thrown away, the note is a bare URL and the words are gone.
    expect(
      composeShared({
        title: "news",
        url: "https://news.ycombinator.com/item?id=42",
      }),
    ).toBe("news\nhttps://news.ycombinator.com/item?id=42");
  });

  it("still drops an address a sentence already ends with", () => {
    expect(
      composeShared({
        text: "Worth reading https://example.com/buns",
        url: "https://example.com/buns",
      }),
    ).toBe("Worth reading https://example.com/buns");
  });

  it("ignores fields that are only whitespace or not strings", () => {
    expect(composeShared({ title: "   ", text: 42, url: "https://a.test" })).toBe(
      "https://a.test",
    );
  });

  /**
   * The one door into the app that has no textarea behind it. A textarea
   * normalises its own value, so nothing typed can carry a carriage return —
   * but a page shared from a Windows browser or a mail client routinely does,
   * and every line pattern in `blocks.ts` reads a line up to its newline. A
   * shared checklist whose lines ended "\r" drew with no tick boxes at all:
   * the marks were still in the text, and none of them were on the screen.
   */
  it("normalises the line endings a sending app hands over", () => {
    expect(composeShared({ text: "[ ] milk\r\n[ ] bread" })).toBe("[ ] milk\n[ ] bread");
    // A lone carriage return is one break, not none and not two.
    expect(composeShared({ text: "one\rtwo" })).toBe("one\ntwo");
    expect(composeShared({ text: "a\r\n\r\nb" })).toBe("a\n\nb");
  });

  it("still catches a repeat once the endings have been normalised", () => {
    // The clash check compares whole strings, so a "\r" on one side and not
    // the other would have let the same line through twice.
    expect(
      composeShared({ text: "Buns\r\nhttps://a.test", url: "https://a.test" }),
    ).toBe("Buns\nhttps://a.test");
  });
});

describe("takeShared", () => {
  it("says nothing is waiting, without creating a cache", async () => {
    expect(await takeShared()).toBeNull();
    expect(caches_.has(SHARE_INBOX)).toBe(false);
  });

  it("brings back every shared photograph, in the order they were picked", async () => {
    // Ten, because nine is where a naive sort puts 10 between 1 and 2 — the
    // whole reason the worker zero-pads its keys.
    const files = Array.from({ length: 10 }, (_, i) => ({
      name: `photo-${i}.jpg`,
      type: "image/jpeg",
      body: `bytes ${i}`,
    }));
    await park({}, files);

    const shared = await takeShared();
    expect(shared?.files.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(shared?.text).toBe("");
    expect(await shared!.files[3].text()).toBe("bytes 3");
    expect(shared!.files[0].type).toBe("image/jpeg");
  });

  it("gives a file back its real name, accents and all", async () => {
    // A header value has to be ASCII, so the worker percent-encodes the name.
    // Undecoded, every Swedish filename on this phone comes back mangled.
    await park({}, [{ name: "Räkna om.jpg", type: "image/jpeg", body: "x" }]);
    expect((await takeShared())?.files[0].name).toBe("Räkna om.jpg");
  });

  it("keeps an empty type empty rather than inventing one", async () => {
    // Android hands over a blank type often enough to matter, and `fileKind`
    // reads the extension first anyway. The `application/octet-stream` the
    // worker had to write to make a legal header must not leak through.
    await park({}, [{ name: "note.txt", type: "", body: "x" }]);
    expect((await takeShared())?.files[0].type).toBe("");
  });

  it("carries the words alongside the files", async () => {
    await park({ text: "for Saturday" }, [
      { name: "a.jpg", type: "image/jpeg", body: "x" },
    ]);
    const shared = await takeShared();
    expect(shared?.text).toBe("for Saturday");
    expect(shared?.files).toHaveLength(1);
  });

  it("empties the inbox, so the same share is never collected twice", async () => {
    await park({ text: "once" });
    expect((await takeShared())?.text).toBe("once");
    expect(await takeShared()).toBeNull();
  });

  it("is null, not a throw, when the browser has no cache storage", async () => {
    vi.stubGlobal("caches", undefined);
    await expect(takeShared()).resolves.toBeNull();
  });

  it("is null, not a throw, when the cache itself refuses", async () => {
    vi.stubGlobal("caches", {
      has: async () => true,
      open: async () => {
        throw new Error("no room");
      },
      delete: async () => true,
    });
    await expect(takeShared()).resolves.toBe(UNREADABLE);
  });

  it("is null when the existence check itself fails: nothing is known to be waiting", async () => {
    vi.stubGlobal("caches", {
      has: async () => {
        throw new Error("no storage");
      },
    });
    await expect(takeShared()).resolves.toBeNull();
  });
  /**
   * The bytes stay put until there is a note to point at.
   *
   * The inbox used to be emptied inside `takeShared`, *before* the note was
   * written — and writing one for eight photographs means eight decodes,
   * eight thumbnails and eight IndexedDB writes on a phone that has just
   * cold-started to answer a share. Android reclaiming the tab anywhere in
   * there left no note and an empty inbox, with nothing to say a share had
   * ever arrived.
   */
  it("leaves the share where it is until the caller commits", async () => {
    await park({ title: "a page" }, [{ name: "shot.jpg", type: "image/jpeg", body: "bytes" }]);

    const shared = await takeShared();
    expect(shared?.files).toHaveLength(1);
    // Still there: nothing has been made of it yet.
    expect(caches_.has(SHARE_INBOX)).toBe(true);

    await shared!.commit();
    expect(caches_.has(SHARE_INBOX)).toBe(false);
  });

  it("drops a share it cannot read at all, rather than re-failing on it forever", async () => {
    await park({ title: "a page" }, []);
    // A cache that answers a key with nothing readable: the read throws, and
    // an entry that failed once will fail identically on every open.
    caches_.get(SHARE_INBOX)!.match = () => Promise.reject(new Error("unreadable"));

    // Dropped, and said so: the marker is what lets the app tell the reader.
    expect(await takeShared()).toBe(UNREADABLE);
    expect(caches_.has(SHARE_INBOX)).toBe(false);
  });
});
