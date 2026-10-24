// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  class UnsentWork extends Error {
    constructor(readonly count: number) {
      super("unsent");
    }
  }
  return {
    purge: vi.fn(async () => {}),
    claim: vi.fn<(opts?: { evenIfUnsent?: boolean }) => Promise<boolean>>(async () => false),
    UnsentWork,
  };
});

vi.mock("./db", () => ({
  claimForOwner: (...args: [string, { evenIfUnsent?: boolean }?]) => db.claim(args[1]),
  purgeEverything: () => db.purge(),
  UnsentWork: db.UnsentWork,
}));

import { useAccount } from "./useAccount";

const realLocation = window.location;
const reload = vi.fn();

beforeEach(() => {
  localStorage.clear();
  reload.mockReset();
  db.purge.mockReset().mockResolvedValue(undefined);
  db.claim.mockReset().mockResolvedValue(false);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

/**
 * "Use on this device only" after signing out is the browser changing hands.
 *
 * The purge empties IndexedDB and leaves everything read out of it in memory —
 * the notes, the previous owner's folders, the recent searches — so flipping to
 * device-only in place drew the old owner's shelf over an empty store, or sat
 * on Loading. Only a reload is sure of all of it.
 */
describe("handing the device over", () => {
  it("reloads once the purge has finished, with the skip already written", async () => {
    let finish: () => void = () => {};
    db.purge.mockImplementation(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const { result } = renderHook(() => useAccount(null));

    act(() => result.current.beginHandoff());
    act(() => result.current.stayOnThisDevice());
    // Not before the notes are gone.
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      finish();
    });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("spar.deviceOnly")).toBe("1");
  });

  it("stays on the handoff screen, skip unset, when the purge fails", async () => {
    db.purge.mockRejectedValue(new Error("blocked"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useAccount(null));

    act(() => result.current.beginHandoff());
    await act(async () => {
      result.current.stayOnThisDevice();
    });

    expect(reload).not.toHaveBeenCalled();
    expect(result.current.handoffRequired).toBe(true);
    expect(localStorage.getItem("spar.deviceOnly")).toBeNull();
    quiet.mockRestore();
  });

  it("does not reload for an ordinary skip, which keeps everything", () => {
    const { result } = renderHook(() => useAccount(null));
    act(() => result.current.stayOnThisDevice());
    expect(db.purge).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(result.current.deviceOnly).toBe(true);
  });
});

/**
 * A different account over the previous one's unsent work: the claim refuses,
 * and the hook holds — sync off, nothing reloaded, the count handed to the
 * screen that asks. Clearing anyway is a second, explicit claim.
 */
describe("a switch over unsent work", () => {
  it("holds with the count instead of reloading, and keeps sync off", async () => {
    db.claim.mockRejectedValueOnce(new db.UnsentWork(3));
    const { result } = renderHook(() => useAccount("bob"));
    await waitFor(() => expect(result.current.held).toBe(3));
    expect(result.current.ownerReady).toBe(false);
    expect(result.current.ownerError).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("clears only when asked, with the explicit flag, then reloads", async () => {
    db.claim.mockRejectedValueOnce(new db.UnsentWork(1));
    const { result } = renderHook(() => useAccount("bob"));
    await waitFor(() => expect(result.current.held).toBe(1));
    db.claim.mockResolvedValueOnce(true);
    act(() => result.current.clearAnyway());
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(db.claim).toHaveBeenLastCalledWith({ evenIfUnsent: true });
  });
});
