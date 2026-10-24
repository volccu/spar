import { describe, expect, it } from "vitest";
import { boundedQueue } from "./queue";

/** Lets every settled promise's reactions run before looking again. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("boundedQueue", () => {
  it("holds the line at the limit and still finishes everything", async () => {
    const enqueue = boundedQueue(2);
    let started = 0;
    let finished = 0;
    const gates: (() => void)[] = [];
    for (let i = 0; i < 5; i++) {
      enqueue(async () => {
        started += 1;
        await new Promise<void>((open) => gates.push(open));
        finished += 1;
      });
    }

    // Only the first two are on the wire; the other three wait their turn.
    expect(started).toBe(2);

    gates.shift()!();
    await flush();
    // One slot freed is one job started — not the whole backlog at once.
    expect(started).toBe(3);
    expect(finished).toBe(1);

    while (gates.length > 0) {
      gates.shift()!();
      await flush();
    }
    expect(started).toBe(5);
    expect(finished).toBe(5);
  });

  /** A job that throws must hand its slot back, or the queue jams for good. */
  it("frees the slot of a job that throws", async () => {
    const enqueue = boundedQueue(1);
    let ran = false;
    enqueue(async () => {
      throw new Error("upstream said no");
    });
    enqueue(async () => {
      ran = true;
    });

    await flush();

    expect(ran).toBe(true);
  });
});
