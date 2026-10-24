// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACK_ANSWER_MS, LAYER_STATE, isLayerEntry, useDismissOnBack } from "./useDismissOnBack";

/**
 * The one rule these hold: **with nothing open, the page stands on the entry
 * under every one of ours**, so the next Back leaves the app in one press
 * (2026-10-12, "it takes two backs to close spår").
 *
 * Each test starts by pushing a marked entry of its own — the board as it was
 * before anything opened — and "settled on the board" means the page is back
 * on exactly that entry. (jsdom keeps the history of the whole file, so a
 * count of `history.length` cannot say this; the marker can.)
 */

let base = 0;
let mark: { base: number };
beforeEach(() => {
  mark = { base: ++base };
  window.history.pushState(mark, "");
});
afterEach(() => {
  // Unmounted, or the last test's listener answers this one's Backs.
  cleanup();
  vi.restoreAllMocks();
});

const onBoard = () => (window.history.state as { base?: number } | null)?.base === mark.base;
const onOurs = () => isLayerEntry(window.history.state);
const popped = () =>
  new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
/** Long enough for jsdom's traversal and a frame after it, several times over. */
const quiet = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 120)));

/** A layer that Back closes, the way App's layers do: by state. */
function useLayer(initial: boolean, inner = false) {
  const [open, setOpen] = useState(initial);
  const [innerOpen, setInnerOpen] = useState(inner);
  const dismissed = useRef({ count: 0 }).current;
  useDismissOnBack(open, () => {
    dismissed.count += 1;
    if (innerOpen) {
      setInnerOpen(false);
      return true;
    }
    setOpen(false);
    return false;
  });
  return { open, setOpen, innerOpen, dismissed };
}

describe("useDismissOnBack", () => {
  it("pushes one entry when a layer opens and takes it back when it closes from inside", async () => {
    const { result } = renderHook(() => useLayer(false));
    expect(onBoard()).toBe(true);
    act(() => result.current.setOpen(true));
    expect(onOurs()).toBe(true);
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  it("closes the layer on Back and leaves the board on its own entry", async () => {
    const { result } = renderHook(() => useLayer(false));
    act(() => result.current.setOpen(true));
    const back = popped();
    act(() => window.history.back());
    await back;
    await waitFor(() => expect(result.current.open).toBe(false));
    await quiet();
    expect(result.current.dismissed.count).toBe(1);
    expect(onBoard()).toBe(true);
  });

  it("puts the same one entry back when Back closed something inside the layer", async () => {
    const { result } = renderHook(() => useLayer(false, true));
    act(() => result.current.setOpen(true));
    const push = vi.spyOn(window.history, "pushState");
    const back = popped();
    act(() => window.history.back());
    await back;
    await quiet();
    expect(result.current.open).toBe(true);
    expect(result.current.innerOpen).toBe(false);
    expect(push).toHaveBeenCalledTimes(1);
    expect(onOurs()).toBe(true);
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  /**
   * The race behind the owner's report: a layer closes from inside (our Back
   * goes out) and another opens before that Back is answered. Pushing at once
   * either had the late Back close the new layer (Chromium) or had the Back
   * dropped and the old entry left under the new one (Firefox).
   */
  it("does not push while its own Back is in flight, and pushes once it lands", async () => {
    const { result } = renderHook(() => useLayer(false));
    act(() => result.current.setOpen(true));
    const push = vi.spyOn(window.history, "pushState");
    const back = popped();
    act(() => result.current.setOpen(false));
    // Before the popstate: the next layer opens.
    act(() => result.current.setOpen(true));
    expect(push).not.toHaveBeenCalled();
    await back;
    await quiet();
    // The late Back was ours, not the user's: the new layer stays open.
    expect(result.current.open).toBe(true);
    expect(result.current.dismissed.count).toBe(0);
    expect(push).toHaveBeenCalledTimes(1);
    expect(onOurs()).toBe(true);
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  it("closing, opening and closing again before any answer still ends on the board", async () => {
    const { result } = renderHook(() => useLayer(false));
    act(() => result.current.setOpen(true));
    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    act(() => result.current.setOpen(false));
    await quiet();
    expect(onBoard()).toBe(true);
    expect(result.current.dismissed.count).toBe(0);
  });

  it("steps off an entry of its own that the page was loaded onto with nothing open", async () => {
    // A reload or a restored session on a layer entry: the layer is gone.
    window.history.pushState(LAYER_STATE, "");
    renderHook(() => useLayer(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  it("adopts an entry of its own it finds under a layer that opens, rather than push a second", async () => {
    window.history.pushState(LAYER_STATE, "");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useLayer(true));
    await quiet();
    expect(push).not.toHaveBeenCalled();
    expect(onOurs()).toBe(true);
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  it("a Back that lands on a left-over entry of ours, with nothing open, steps over it too", async () => {
    // Two entries of ours: one left over (a Back some runtime dropped), and
    // the live one above it.
    window.history.pushState(LAYER_STATE, "");
    window.history.pushState(LAYER_STATE, "");
    const { result } = renderHook(() => useLayer(true));
    await quiet();
    const back = popped();
    act(() => window.history.back());
    await back;
    await waitFor(() => expect(result.current.open).toBe(false));
    await waitFor(() => expect(onBoard()).toBe(true));
    expect(result.current.dismissed.count).toBe(1);
  });

  it("a Forward onto an old entry of ours with nothing open goes straight back", async () => {
    window.history.pushState(LAYER_STATE, "");
    const back = popped();
    window.history.back();
    await back;
    expect(onBoard()).toBe(true);
    const { result } = renderHook(() => useLayer(false));
    await quiet();
    const forward = popped();
    act(() => window.history.forward());
    await forward;
    await waitFor(() => expect(onBoard()).toBe(true));
    expect(result.current.dismissed.count).toBe(0);
  });

  it("stops waiting on a Back of its own that is never answered", async () => {
    const { result } = renderHook(() => useLayer(false));
    act(() => result.current.setOpen(true));
    // The runtime swallows the step: no traversal, no popstate.
    const swallow = vi.spyOn(window.history, "back").mockImplementation(() => {});
    act(() => result.current.setOpen(false));
    act(() => result.current.setOpen(true));
    const push = vi.spyOn(window.history, "pushState");
    expect(push).not.toHaveBeenCalled();
    swallow.mockRestore();
    // Still standing on the entry the swallowed Back never left: adopted
    // once the wait is over, not doubled.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, BACK_ANSWER_MS + 100)));
    expect(push).not.toHaveBeenCalled();
    expect(onOurs()).toBe(true);
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
  });

  it("keeps the entry's state when the address is tidied", async () => {
    const { result } = renderHook(() => useLayer(false));
    act(() => result.current.setOpen(true));
    // What `?note=`, `?shared=1` and `?do=capture` do once read.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    const push = vi.spyOn(window.history, "pushState");
    act(() => result.current.setOpen(false));
    await waitFor(() => expect(onBoard()).toBe(true));
    expect(push).not.toHaveBeenCalled();
  });
});
