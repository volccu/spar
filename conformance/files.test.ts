/**
 * Contract: "Files" — where a note's bytes live, who may reach them, and how
 * large one may be.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { BackendError, type Session } from "./driver";
import { useDriver, users, uuid } from "./support";

const driver = useDriver();
let a: Session;
let b: Session;

/** 50 MiB, the limit per file (`MAX_FILE_BYTES` in web/src/lib/files.ts). */
const LIMIT = 50 * 1024 * 1024;

beforeAll(async () => {
  [a, b] = await users(driver, 2);
});

function pathOf(owner: Session): string {
  return `${owner.userId}/${uuid()}/${uuid()}`;
}

function bytes(n: number, fill = 7): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

async function failure(promise: Promise<unknown>): Promise<BackendError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BackendError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the owner's files", () => {
  it("round-trips bytes at <user>/<note>/<attachment>", async () => {
    const path = pathOf(a);
    const sent = new TextEncoder().encode("%PDF-1.4 a small document");
    await a.uploadFile(path, sent, "application/pdf");
    expect(await a.downloadFile(path)).toEqual(sent);
  });

  it("replaces the bytes when the same path is uploaded again, as a retried upload does", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(10, 1), "image/jpeg");
    await a.uploadFile(path, bytes(12, 2), "image/jpeg");
    expect(await a.downloadFile(path)).toEqual(bytes(12, 2));
  });

  it("removes files, after which they cannot be downloaded", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(4), "application/octet-stream");
    await a.removeFiles([path]);
    const error = await failure(a.downloadFile(path));
    expect(["not-found", "failed"]).toContain(error.kind);
    expect(await driver.server.fileExists(path)).toBe(false);
  });

  it("treats removing a path that holds nothing as nothing to do", async () => {
    await a.removeFiles([pathOf(a)]);
  });
});

describe("the size limit", () => {
  it("accepts a file of exactly 50 MiB", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(LIMIT), "application/octet-stream");
    expect(await driver.server.fileExists(path)).toBe(true);
    await a.removeFiles([path]);
  });

  it("refuses a file one byte over 50 MiB, and stores nothing", async () => {
    const path = pathOf(a);
    const error = await failure(a.uploadFile(path, bytes(LIMIT + 1), "application/octet-stream"));
    expect(error.kind).toBe("too-large");
    expect(await driver.server.fileExists(path)).toBe(false);
  });
});

describe("isolation", () => {
  it("refuses an upload under another user's folder", async () => {
    const path = pathOf(a);
    const error = await failure(b.uploadFile(path, bytes(3), "text/plain"));
    expect(["refused", "unauthenticated"]).toContain(error.kind);
    expect(await driver.server.fileExists(path)).toBe(false);
  });

  it("refuses an upload whose first segment is not a user id at all", async () => {
    const error = await failure(b.uploadFile(`shared/${uuid()}/${uuid()}`, bytes(3), "text/plain"));
    expect(["refused", "unauthenticated"]).toContain(error.kind);
  });

  it("never hands another user's bytes out", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(5), "image/png");
    const error = await failure(b.downloadFile(path));
    expect(["not-found", "refused", "failed"]).toContain(error.kind);
  });

  it("does not let another user remove them", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(5), "image/png");
    try {
      await b.removeFiles([path]);
    } catch (error) {
      expect(error).toBeInstanceOf(BackendError);
    }
    expect(await driver.server.fileExists(path)).toBe(true);
    expect(await a.downloadFile(path)).toEqual(bytes(5));
  });

  it("does not let another user overwrite them", async () => {
    const path = pathOf(a);
    await a.uploadFile(path, bytes(5, 1), "image/png");
    await failure(b.uploadFile(path, bytes(5, 9), "image/png"));
    expect(await a.downloadFile(path)).toEqual(bytes(5, 1));
  });
});
