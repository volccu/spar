// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { note as base } from "../test/fixtures";
import { readUnsaved, stashUnsaved } from "./unsavedStash";
import { useNotes } from "./useNotes";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the last-resort stash is shared by every tab", () => {
  it("one tab's ordinary successful save does not wipe another tab's stashed failed write", async () => {
    const hook = renderHook(() => useNotes());
    await waitFor(() => expect(hook.result.current.loading).toBe(false), { timeout: 15_000 });

    // Another tab's write failed (disk full) and it parked the note here, as designed.
    stashUnsaved([base({ id: "other-tab-note", body: "typed in tab B, not on disk", updated_at: "2026-10-15T10:00:00.000Z" })]);

    // This tab saves something unrelated, successfully.
    act(() => {
      hook.result.current.create("an ordinary note in tab A");
    });
    await new Promise((r) => setTimeout(r, 300));

    expect(readUnsaved().map((n) => n.id)).toContain("other-tab-note");
  });
});
