import type { Attachment } from "../types";
import { getBackend } from "./backend";
import { fetchFile } from "./attachments";
import { getFile } from "./db";

/** How long a streaming address stays good: a long film, paused and resumed. */
const STREAM_SECONDS = 6 * 60 * 60;

/**
 * A film or a sound, ready to play: this device's own bytes when it has them,
 * otherwise an address the player streams from the server — starting in a
 * moment, seeking as it goes, and never written into this device's store
 * (a 25 MB film fetched whole used to stand between the tap and the first
 * frame, and then sat in the cache budget). Where the backend cannot give such
 * an address, the file is fetched whole, as before. Null when it is nowhere.
 */
export async function streamFile(att: Attachment): Promise<Blob | string | null> {
  const local = await getFile(att.id);
  if (local) return local;
  if (!att.path) return null;
  const backend = await getBackend();
  if (backend?.fileLink) {
    const { data, error } = await backend.fileLink(att.path, STREAM_SECONDS);
    if (!error && data) return data;
  }
  return fetchFile(att);
}
