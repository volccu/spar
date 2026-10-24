/**
 * an abandoned download leaks a file descriptor.
 *
 * GET /api/files/* does `createReadStream(path).pipe(res)` (app.ts). When the
 * client hangs up mid-download, `pipe` merely unpipes: the read stream is left
 * paused with its descriptor open (Node docs: "one important caveat is that if
 * the Readable stream emits an error ... the Writable destination is not
 * closed automatically" and the converse - the source is never destroyed when
 * the destination closes). Each dropped download of a file bigger than one
 * 64 KiB chunk leaks one descriptor until the process hits EMFILE; on Windows
 * the file also stays locked.
 */
import { createReadStream as realCreateReadStream, type ReadStream } from "node:fs";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client, startServer, type Running } from "./helpers";

const opened: ReadStream[] = [];
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: ((...args: Parameters<typeof actual.createReadStream>) => {
      const stream = actual.createReadStream(...args);
      opened.push(stream);
      return stream;
    }) as typeof actual.createReadStream,
  };
});

describe("a download the client abandons", () => {
  let s: Running;
  afterEach(async () => s?.close());

  it("closes the file it was reading", async () => {
    void realCreateReadStream;
    s = await startServer();
    const a = new Client(s.url);
    await a.signUp();
    const path = `${a.userId}/${crypto.randomUUID()}/att1`;
    const put = await a.request("PUT", `/api/files/${path}`, new Uint8Array(8 * 1024 * 1024), { "content-type": "application/octet-stream" });
    expect(put.status).toBe(204);
    opened.length = 0;

    // Start the download, take the headers and a first chunk, then hang up.
    await new Promise<void>((resolve, reject) => {
      const req = request(`${s.url}/api/files/${path}`, { headers: { cookie: a.cookie ?? "" } }, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.on("error", () => undefined);
      req.on("error", reject);
      req.end();
    });
    await new Promise((r) => setTimeout(r, 500));

    const mine = opened.filter((x) => String(x.path).includes("att1"));
    expect(mine).toHaveLength(1);
    expect(mine[0].destroyed).toBe(true);
  });
});
