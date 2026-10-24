// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UserBoard } from "../types";
import { useBoards } from "./useBoards";
import { getMeta } from "./db";

afterEach(cleanup);

const SERVER_AT = "2026-10-08T09:00:00.000Z";

describe("adopting Inspiration through the hook", () => {
  it("marks the folder the owner already had, drops it from the folders, and queues the list once", async () => {
    const hook = renderHook(() => useBoards());
    await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));
    act(() => {
      hook.result.current.applyRemoteBoards(
        [
          { id: "k1", name: "Kitchen", position: 0 },
          { id: "x1", name: "Insp", position: 1, color: "teal" },
        ],
        SERVER_AT,
        null,
      );
    });
    expect(hook.result.current.inspiration).toBeNull();
    expect(hook.result.current.boardsDirty).toBe(false);

    act(() => hook.result.current.adoptInspiration());

    expect(hook.result.current.inspiration?.id).toBe("x1");
    expect(hook.result.current.boards.map((b) => b.name)).toEqual(["Kitchen"]);
    expect(hook.result.current.boardsDirty).toBe(true);
    await waitFor(async () => {
      const stored = (await getMeta<UserBoard[]>("boards")) ?? [];
      expect(stored.find((b) => b.id === "x1")?.kind).toBe("inspiration");
      expect(stored.find((b) => b.id === "x1")).not.toHaveProperty("color");
    });

    // The second call writes nothing: the stamp does not move.
    const at = hook.result.current.boardsAt;
    act(() => hook.result.current.adoptInspiration());
    expect(hook.result.current.boardsAt).toBe(at);
  });

  it("keeps Inspiration through a rename of another folder", async () => {
    const hook = renderHook(() => useBoards());
    await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));
    const id = hook.result.current.boards[0].id;
    act(() => hook.result.current.renameBoard(id, "Pantry"));
    expect(hook.result.current.inspiration?.id).toBe("x1");
    expect(hook.result.current.boards[0].name).toBe("Pantry");
  });
});
