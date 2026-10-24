/**
 * Files (docs/sync-contract.md §12): a note's bytes, on disk under the data
 * folder at `files/<user id>/<note id>/<attachment id>`, with one row each in
 * the `files` table (size and type, for the per-user cap and for serving).
 *
 * A path is only ever built from three segments that have each been checked
 * against a strict pattern — the first must be the caller's own id — so no
 * spelling of `..`, a slash, a backslash or a NUL can reach the disk. A path
 * belonging to someone else answers exactly as a missing one does.
 *
 * Unlike the Supabase backend (deviation D7), a note's files go when the note
 * is permanently deleted.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Db } from "./db";
import { HttpError } from "./http";
import type { Micros } from "./time";

/** 50 MiB — `MAX_FILE_BYTES` in web/src/lib/files.ts, and the bucket's limit (migration 0027). */
export const MAX_FILE_BYTES = 52_428_800;

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const USER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface FilePath {
  owner: string;
  note: string;
  name: string;
  /** `<owner>/<note>/<name>`, the path the client writes into the note. */
  path: string;
}

/**
 * A storage path, or null when it is not three safe segments. Takes the path
 * as it appears in a URL (percent-decoded here) or in a JSON body.
 */
export function parseFilePath(raw: string, encoded: boolean): FilePath | null {
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const decoded: string[] = [];
  for (const part of parts) {
    let value = part;
    if (encoded) {
      try {
        value = decodeURIComponent(part);
      } catch {
        return null;
      }
    }
    decoded.push(value);
  }
  const [owner, note, name] = decoded;
  if (!USER.test(owner.toLowerCase()) || !SEGMENT.test(note) || !SEGMENT.test(name)) return null;
  const lower = owner.toLowerCase();
  return { owner: lower, note, name, path: `${lower}/${note}/${name}` };
}

interface FileRow {
  path: string;
  owner_id: string;
  note_id: string;
  size: number;
  content_type: string;
}

function cleanType(value: string | undefined): string {
  const type = (value ?? "").split(";")[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) && type.length <= 127 ? type : "application/octet-stream";
}

export class FileStore {
  private readonly root: string;

  constructor(
    dataDir: string,
    private readonly db: Db,
    private readonly now: () => Micros,
    private readonly capBytes: number,
  ) {
    this.root = join(dataDir, "files");
  }

  private diskPath(file: FilePath): string {
    return join(this.root, file.owner, file.note, file.name);
  }

  /** The owner's bytes in store (for the cap and the account page). */
  used(owner: string): number {
    return (this.db.prepare("select coalesce(sum(size), 0) as n from files where owner_id = ?").get(owner) as { n: number }).n;
  }

  /** Streams a request body to `file`, replacing what is there. */
  async write(file: FilePath, req: IncomingMessage): Promise<void> {
    const declared = Number(req.headers["content-length"]);
    const tooLarge = () => new HttpError(413, "too_large", `A file may be at most ${MAX_FILE_BYTES} bytes`);
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      req.resume();
      throw tooLarge();
    }
    const existing = this.db.prepare("select size from files where path = ?").get(file.path) as { size: number } | undefined;
    const overCap = (size: number) =>
      this.capBytes > 0 && this.used(file.owner) - (existing?.size ?? 0) + size > this.capBytes;
    if (Number.isFinite(declared) && overCap(declared)) {
      req.resume();
      throw new HttpError(507, "storage_full", "This account has used all the file storage it is allowed");
    }

    const dir = join(this.root, file.owner, file.note);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `.upload-${randomUUID()}`);
    let size = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(temp, { mode: 0o600 });
        let failed = false;
        const fail = (error: Error) => {
          if (failed) return;
          failed = true;
          req.unpipe(out);
          req.resume();
          out.destroy();
          reject(error);
        };
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_FILE_BYTES) fail(tooLarge());
        });
        req.on("error", fail);
        req.on("aborted", () => fail(new HttpError(400, "aborted", "The upload was cut short")));
        out.on("error", fail);
        out.on("finish", () => (failed ? undefined : resolve()));
        req.pipe(out);
      });
      if (overCap(size)) throw new HttpError(507, "storage_full", "This account has used all the file storage it is allowed");
      await rename(temp, this.diskPath(file));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
    this.db
      .prepare(
        `insert into files (path, owner_id, note_id, size, content_type, created_at) values (?, ?, ?, ?, ?, ?)
         on conflict (path) do update set size = excluded.size, content_type = excluded.content_type, created_at = excluded.created_at`,
      )
      .run(file.path, file.owner, file.note, size, cleanType(req.headers["content-type"]), this.now());
  }

  /** The stored file for a download, or null when there is none at that path. */
  async open(file: FilePath): Promise<{ size: number; type: string; stream: () => NodeJS.ReadableStream } | null> {
    const row = this.db.prepare("select * from files where path = ? and owner_id = ?").get(file.path, file.owner) as
      | FileRow
      | undefined;
    if (!row) return null;
    const disk = this.diskPath(file);
    try {
      const info = await stat(disk);
      return { size: info.size, type: row.content_type, stream: () => createReadStream(disk) };
    } catch {
      return null;
    }
  }

  async exists(file: FilePath): Promise<boolean> {
    return (await this.open(file)) !== null;
  }

  /** Reads a whole file of `owner`'s by the path a note carries, or null. */
  async readBytes(owner: string, path: string): Promise<Uint8Array | null> {
    const file = parseFilePath(path, false);
    if (!file || file.owner !== owner) return null;
    const found = await this.open(file);
    if (!found) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of found.stream() as AsyncIterable<Buffer>) chunks.push(chunk);
    return new Uint8Array(Buffer.concat(chunks));
  }

  async remove(files: FilePath[]): Promise<void> {
    for (const file of files) {
      this.db.prepare("delete from files where path = ? and owner_id = ?").run(file.path, file.owner);
      await rm(this.diskPath(file), { force: true });
    }
  }

  /** Everything filed under one note of the owner's (a permanent delete). */
  async removeNote(owner: string, noteId: string): Promise<void> {
    if (!USER.test(owner)) return;
    this.db.prepare("delete from files where owner_id = ? and note_id = ?").run(owner, noteId);
    if (SEGMENT.test(noteId)) await rm(join(this.root, owner, noteId), { recursive: true, force: true });
  }

  /** Everything of one owner's (the account deleted). */
  async removeOwner(owner: string): Promise<void> {
    if (!USER.test(owner)) return;
    this.db.prepare("delete from files where owner_id = ?").run(owner);
    await rm(join(this.root, owner), { recursive: true, force: true });
  }
}
