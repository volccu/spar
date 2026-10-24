// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { UserBoard } from "../types";
import { useBoards } from "./useBoards";
import { getMeta } from "./db";

afterEach(cleanup);

/**
 * `removeBoard` is kept by the undo of a move that made its folder and called
 * whenever Ctrl+Z is pressed. It used to filter the list of the render that
 * made it, so a folder made or renamed since was written back to how it had
 * been, and that went up to the other device.
 */
describe("taking a folder away", () => {
  it("works on the list as it is now, not as the render that made the call saw it", async () => {
    const hook = renderHook(() => useBoards());
    await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));

    let recipes!: UserBoard;
    let garden!: UserBoard;
    act(() => {
      recipes = hook.result.current.createBoard("Recipes");
    });
    // What an undo keeps: this render's function, with Recipes the only folder.
    const removeLater = hook.result.current.removeBoard;
    act(() => {
      garden = hook.result.current.createBoard("Garden");
    });
    act(() => hook.result.current.renameBoard(garden.id, "Plants"));

    act(() => removeLater(recipes.id));

    expect(hook.result.current.boards.map((b) => b.name)).toEqual(["Plants"]);
    await waitFor(async () => {
      expect((await getMeta<UserBoard[]>("boards"))?.map((b) => b.name)).toEqual(["Plants"]);
    });
  });

  it("writes nothing for a folder that is not on the list", async () => {
    const hook = renderHook(() => useBoards());
    await waitFor(() => expect(hook.result.current.prefsReady).toBe(true));
    act(() => {
      hook.result.current.createBoard("Plants");
    });
    const at = hook.result.current.boardsAt;
    const version = hook.result.current.boardsVersion;

    act(() => hook.result.current.removeBoard("never-was"));

    expect(hook.result.current.boardsAt).toBe(at);
    expect(hook.result.current.boardsVersion).toBe(version);
    expect(hook.result.current.boards.map((b) => b.name)).toEqual(["Plants"]);
  });
});
