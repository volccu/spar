// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sparServerBackend } from "./backend/sparServerBackend";
import { REQUEST_MS, deadlineFor, withDeadline } from "./deadline";

/**
 * A request that never answers used to hold the sync loop forever: it runs one
 * turn at a time, so every later turn queued behind it and nothing synced
 * again until a reload. Every request now carries a deadline.
 */
describe("a request with a deadline", () => {
  it("is given up once the deadline passes", async () => {
    const init = withDeadline({}, 20);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(init.signal?.aborted).toBe(true);
  });

  it("gives a large upload longer, so a slow connection can still finish it", () => {
    expect(deadlineFor(undefined)).toBe(REQUEST_MS);
    expect(deadlineFor("x".repeat(4_000_000))).toBe(REQUEST_MS + 500_000);
  });

  it("still stops when the caller's own signal does", () => {
    const own = new AbortController();
    const init = withDeadline({ signal: own.signal }, 60_000);
    own.abort();
    expect(init.signal?.aborted).toBe(true);
  });

  it("is what the spår server backend sends, so a stuck call fails instead of hanging", async () => {
    let seen: AbortSignal | null | undefined;
    const backend = sparServerBackend({ signup: "invite" }, {
      base: "",
      storage: null,
      events: null,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          seen = init?.signal;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    void backend.notesById("id", ["a"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
