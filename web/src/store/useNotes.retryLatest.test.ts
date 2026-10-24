// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

const failNext = vi.hoisted(() => ({ count: 0 }));

vi.mock("./db", async (importOriginal) => {
  const real = await importOriginal<typeof import("./db")>();
  return {
    ...real,
    putNotes: async (...args: Parameters<typeof real.putNotes>) => {
      if (failNext.count > 0) {
        failNext.count -= 1;
        throw new Error("QuotaExceededError");
      }
      return real.putNotes(...args);
    },
  };
});

import { useNotes } from "./useNotes";
import { allNotes } from "./db";

afterEach(() => {
  cleanup();
  localStorage.clear();
  failNext.count = 0;
});

describe("retry of a failed write vs words typed since", () => {
  it("a retry (timer or button) must not drop the typed words that are waiting for the pause", async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });

    // 1. the first write fails (disk full for a moment): v1 is parked in failedWrites
    failNext.count = 1;
    let id = "";
    act(() => {
      id = hook.result.current.create("first words")!.id;
    });
    await waitFor(() => expect(hook.result.current.storageError).not.toBeNull());

    // 2. the user keeps typing: the new words wait for the 250ms typing pause
    act(() => hook.result.current.editBody(id, "first words, and the rest I kept typing"));

    // 3. the automatic retry (2s timer) / the Retry button fires inside that pause
    await act(async () => {
      await hook.result.current.retryStorage();
    });

    // 4. let the typing pause pass
    await new Promise((r) => setTimeout(r, 700));

    // On screen: the typed words. On the device: must be the same.
    expect(hook.result.current.notes.find((n) => n.id === id)?.body).toBe(
      "first words, and the rest I kept typing",
    );
    const stored = (await allNotes()).find((n) => n.id === id);
    expect(stored?.body).toBe("first words, and the rest I kept typing");
  });
});
