/**
 * How long a request to the server may take before it is given up.
 *
 * A fetch has no deadline of its own. On a phone whose signal drops in a tunnel
 * and comes back, a request can be left neither answered nor failed, for good —
 * and the sync loop runs one turn at a time, so every later turn waited behind
 * it and nothing synced again until a reload. A request given up is an ordinary
 * failure, and the next turn tries again.
 *
 * Files get far longer than the rest: a film going up on a slow connection is
 * slow, not stuck.
 */
export const REQUEST_MS = 2 * 60_000;
export const FILE_REQUEST_MS = 15 * 60_000;

/**
 * The deadline for a request carrying `body`: a batch of notes with their
 * thumbnails can be megabytes, and on a poor connection a fixed two minutes
 * would give it up on every turn, for good. Each kilobyte adds an eighth of a
 * second, a floor of 8 KB/s.
 */
export function deadlineFor(body: BodyInit | null | undefined, base = REQUEST_MS): number {
  return typeof body === "string" ? base + Math.ceil(body.length / 8) : base;
}

/** `init` with a signal that aborts after `ms`, as well as whenever its own does. */
export function withDeadline(init: RequestInit | undefined, ms: number): RequestInit {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return init ?? {};
  const deadline = AbortSignal.timeout(ms);
  const own = init?.signal;
  if (!own) return { ...init, signal: deadline };
  // A caller's own signal is kept: without `AbortSignal.any` (older browsers)
  // the request keeps it alone, as it always had.
  if (typeof AbortSignal.any !== "function") return init;
  return { ...init, signal: AbortSignal.any([own, deadline]) };
}
