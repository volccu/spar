/**
 * In-memory rate limits. One process serves one instance, so a map is the
 * whole story; a restart forgets every count, which errs toward letting a
 * person back in.
 */

/** Counts events per key inside a sliding window. */
export class WindowCounter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private recent(key: string): number[] {
    const since = this.now() - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Whether `key` is already at its limit. */
  blocked(key: string): boolean {
    return this.recent(key).length >= this.limit;
  }

  /** Milliseconds until `key` may try again (0 when it may now). */
  retryAfterMs(key: string): number {
    const list = this.recent(key);
    if (list.length < this.limit) return 0;
    return Math.max(0, list[list.length - this.limit] + this.windowMs - this.now());
  }

  hit(key: string): void {
    const list = this.recent(key);
    list.push(this.now());
    this.hits.set(key, list);
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  sweep(): void {
    for (const key of [...this.hits.keys()]) this.recent(key);
  }
}

/**
 * A token bucket per key: `burst` at once, then one per `refillMs`.
 *
 * The link-preview function holds a twin (`supabase/functions/_shared/rateLimit.ts`)
 * that is not imported here on purpose: it sweeps from inside `take` once it
 * holds a thousand keys, reading the clock a second time, so a bucket a
 * millisecond short of full could be forgotten and come back full. This server
 * sweeps on its own timer instead (`app.ts`), and its answers stay exactly
 * these.
 */
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
    const bucket = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    const refilled = Math.min(this.burst, bucket.tokens + (now - bucket.at) / this.refillMs);
    if (refilled >= 1) {
      this.buckets.set(key, { tokens: refilled - 1, at: now });
      return 0;
    }
    this.buckets.set(key, { tokens: refilled, at: now });
    return Math.ceil((1 - refilled) * this.refillMs);
  }

  sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.at) / this.refillMs >= this.burst) this.buckets.delete(key);
    }
  }
}
