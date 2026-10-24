/**
 * Live change signals: one Server-Sent Events stream per signed-in session,
 * keyed by user, so a signal can only ever be written to its owner's own
 * streams (docs/sync-contract.md §15, I9). There is no channel another user
 * could join and no broadcast: `publish` takes the owner's id and looks up
 * that owner's streams, and nothing else.
 *
 * A signal is a hint to sync. It carries the changed row so a client can
 * recognise the echo of its own upload (`web/src/store/echo.ts`), but the
 * client never applies it.
 */
import type { ServerResponse } from "node:http";

export type SignalTable = "notes" | "folders" | "prefs";
export type SignalEvent = "INSERT" | "UPDATE" | "DELETE";

export interface Signal {
  table: SignalTable;
  event: SignalEvent;
  /** The row after the change, serialised JSON (INSERT and UPDATE). */
  newJson: string | null;
  /** `{id}` of the row before a DELETE, serialised JSON. */
  oldJson: string | null;
}

interface Stream {
  res: ServerResponse;
  tokenHash: string;
}

/** At most this many open streams per user; the oldest is closed for a new one. */
export const MAX_STREAMS_PER_USER = 20;

export class EventHub {
  private streams = new Map<string, Set<Stream>>();

  add(userId: string, tokenHash: string, res: ServerResponse): () => void {
    let set = this.streams.get(userId);
    if (!set) this.streams.set(userId, (set = new Set()));
    if (set.size >= MAX_STREAMS_PER_USER) {
      const oldest = set.values().next().value as Stream;
      set.delete(oldest);
      oldest.res.end();
    }
    const stream = { res, tokenHash };
    set.add(stream);
    return () => {
      set.delete(stream);
      if (set.size === 0 && this.streams.get(userId) === set) this.streams.delete(userId);
    };
  }

  publish(userId: string, signals: Signal[]): void {
    const set = this.streams.get(userId);
    if (!set || signals.length === 0) return;
    const text = signals
      .map(
        (s) =>
          `event: change\ndata: {"table":${JSON.stringify(s.table)},"event":${JSON.stringify(s.event)},"new":${s.newJson ?? "null"},"old":${s.oldJson ?? "null"}}\n\n`,
      )
      .join("");
    for (const stream of set) stream.res.write(text);
  }

  /** Writes a keep-alive to every stream, closing any whose session has ended. */
  heartbeat(sessionAlive: (tokenHash: string) => boolean): void {
    for (const [userId, set] of this.streams) {
      for (const stream of set) {
        if (!sessionAlive(stream.tokenHash)) {
          set.delete(stream);
          stream.res.end();
        } else {
          stream.res.write(": ping\n\n");
        }
      }
      if (set.size === 0) this.streams.delete(userId);
    }
  }

  /** Ends every stream of a user (account deleted), or of one session. */
  close(userId: string, tokenHash?: string): void {
    const set = this.streams.get(userId);
    if (!set) return;
    for (const stream of set) {
      if (tokenHash && stream.tokenHash !== tokenHash) continue;
      set.delete(stream);
      stream.res.end();
    }
    if (set.size === 0) this.streams.delete(userId);
  }

  closeAll(): void {
    for (const set of this.streams.values()) for (const stream of set) stream.res.end();
    this.streams.clear();
  }

  count(userId: string): number {
    return this.streams.get(userId)?.size ?? 0;
  }
}
