// rateLimit.ts — a small per-user limit on link previews (audit 2026-10-10, SEC-3).
//
// The same token bucket as the self-hosted server's (`server/src/ratelimit.ts`,
// `linkPreviewBurst` 30 and one more every 2 seconds), so a signed-in account
// cannot turn the function into a fetching machine.
//
// **In memory, per isolate, and that is all it is.** Supabase runs a function
// in as many short-lived isolates as it likes and keeps no state between them,
// so this bounds one burst against one warm isolate, not an account's total.
// Doing better needs somewhere shared to count — a table and a migration — and
// for an app with one owner and sign-ups closed that is not worth the trade
// yet; a self-hoster with open sign-ups should know the limit is this soft.
//
// The app treats 429 as "ask again later" (`useLinkUnfurl.ts`, PAGE_STATUSES),
// so a link refused here is retried on a later open, never marked as having
// no picture.

export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly refillMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes a token; returns 0 when granted, else milliseconds until one is free. */
  take(key: string): number {
    const now = this.now();
    // Swept as it goes, so an isolate that lives long does not keep every user
    // it ever saw.
    if (this.buckets.size > 1000) this.sweep();
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    const refilled = Math.min(this.burst, bucket.tokens + (now - bucket.at) / this.refillMs);
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, at: now });
      return 0;
    }
    this.buckets.set(key, { tokens: refilled, at: now });
    return Math.ceil((1 - refilled) * this.refillMs);
  }

  /** Forgets every bucket that has filled back up — it says nothing a new one would not. */
  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.at) / this.refillMs >= this.burst) this.buckets.delete(key);
    }
  }
}

/** What link-preview allows each user: the self-hosted server's own numbers. */
export const PREVIEW_BURST = 30;
export const PREVIEW_REFILL_MS = 2_000;
