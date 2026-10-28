import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { SHARE_INBOX, takeShared } from "./shareTarget";
import { MAX_FILE_BYTES } from "./files";

/**
 * `public/share-sw.js` itself, run against a stand-in for the worker's globals.
 *
 * The worker decides nothing about what a share becomes, but since audit SEC-1
 * (2026-10-10) it does bound what one share may park — any website can post a
 * form to `/share`, so the door takes no more than a share sheet plausibly
 * sends. These are the bounds, and the round trip into `takeShared`.
 */

const ORIGIN = "https://spar.test";
const source = readFileSync(fileURLToPath(new URL("../../public/share-sw.js", import.meta.url)), "utf8");

class FakeCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    // Read now, as the real cache stores a body rather than a stream.
    const body = await response.arrayBuffer();
    this.entries.set(typeof request === "string" ? request : request.url, new Response(body, response));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async match(request: Request | string) {
    return this.entries.get(typeof request === "string" ? request : request.url)?.clone();
  }
}

let stores: Map<string, FakeCache>;
const fakeCaches = {
  has: async (name: string) => stores.has(name),
  open: async (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  },
  delete: async (name: string) => stores.delete(name),
};

type FetchEvent = { request: Request; respondWith: (r: Promise<Response>) => void };
let listener: (event: FetchEvent) => void;

beforeEach(() => {
  stores = new Map();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: FetchEvent) => void) => {
      if (type === "fetch") listener = fn;
    },
  };
  // The worker's two globals, handed in by name; `Response` and `URL` are the
  // platform's own.
  new Function("self", "caches", source)(self, fakeCaches);
  (globalThis as { caches?: unknown }).caches = fakeCaches;
});

/** A file that claims a size without holding it, so a bound can be crossed cheaply. */
function sized(name: string, size: number): File {
  const file = new File(["x"], name, { type: "image/jpeg" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** Posts a form at the worker and waits for its answer. */
async function post(form: FormData, headers: Record<string, string> = {}): Promise<Response> {
  // The worker reads the form through `request.formData()`; a stand-in
  // request hands it this one, so the sizes claimed above survive.
  const request = new Request(`${ORIGIN}/share`, { method: "POST", headers });
  Object.defineProperty(request, "formData", { value: async () => form });
  let answer: Promise<Response> | null = null;
  listener({ request, respondWith: (r) => (answer = r) });
  expect(answer).not.toBeNull();
  return await answer!;
}

describe("the share worker's bounds (audit SEC-1)", () => {
  it("parks an ordinary share whole, and redirects into the app", async () => {
    const form = new FormData();
    form.append("files", new File(["a"], "one.jpg", { type: "image/jpeg" }));
    form.append("files", new File(["b"], "two.jpg", { type: "image/jpeg" }));
    form.append("text", "words");
    const answer = await post(form);
    expect(answer.status).toBe(303);
    const shared = await takeShared();
    expect(shared?.files.map((f) => f.name)).toEqual(["one.jpg", "two.jpg"]);
    expect(shared?.text).toBe("words");
    expect(shared?.left).toBeUndefined();
  });

  it("leaves out a file over the size limit, and names it", async () => {
    const form = new FormData();
    form.append("files", sized("small.jpg", 1000));
    form.append("files", sized("huge.mov", MAX_FILE_BYTES + 1));
    await post(form);
    const shared = await takeShared();
    expect(shared?.files.map((f) => f.name)).toEqual(["small.jpg"]);
    expect(shared?.left).toEqual({ names: [{ name: "huge.mov", size: MAX_FILE_BYTES + 1 }], count: 1 });
  });

  it("names the files it ran out of room for, rather than landing short without a word", async () => {
    const real = FakeCache.prototype.put;
    let puts = 0;
    FakeCache.prototype.put = async function (request, response) {
      const url = typeof request === "string" ? request : request.url;
      if (url.includes("/__share/f/") && ++puts > 1) throw new DOMException("full", "QuotaExceededError");
      return real.call(this, request, response);
    };
    try {
      const form = new FormData();
      for (const name of ["one.jpg", "two.jpg", "three.jpg"]) form.append("files", sized(name, 1000));
      await post(form);
    } finally {
      FakeCache.prototype.put = real;
    }
    const shared = await takeShared();
    expect(shared?.files.map((f) => f.name)).toEqual(["one.jpg"]);
    expect(shared?.left).toEqual({
      names: [{ name: "two.jpg", size: 1000 }, { name: "three.jpg", size: 1000 }],
      count: 2,
      full: true,
    });
  });

  it("keeps no more than thirty files", async () => {
    const form = new FormData();
    for (let i = 0; i < 35; i++) form.append("files", sized(`p${i}.jpg`, 10));
    await post(form);
    const shared = await takeShared();
    expect(shared?.files).toHaveLength(30);
    expect(shared?.left?.count).toBe(5);
  });

  it("stops at two hundred megabytes in all", async () => {
    const form = new FormData();
    for (let i = 0; i < 6; i++) form.append("files", sized(`v${i}.mp4`, 40 * 1024 * 1024));
    await post(form);
    const shared = await takeShared();
    // Five 40 MB files are exactly the bound; the sixth is past it.
    expect(shared?.files).toHaveLength(5);
    expect(shared?.left?.names.map((f) => f.name)).toEqual(["v5.mp4"]);
  });

  it("does not read a body far past the bound at all, and still opens the app", async () => {
    const form = new FormData();
    form.append("files", sized("small.jpg", 10));
    const answer = await post(form, { "content-length": String(400 * 1024 * 1024) });
    expect(answer.status).toBe(303);
    expect(stores.has(SHARE_INBOX)).toBe(false);
  });
});
