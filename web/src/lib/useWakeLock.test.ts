// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWakeLock } from "./useWakeLock";

/**
 * jsdom has no `navigator.wakeLock`, which is itself the first case: the hook
 * must do nothing at all there. The rest hang a fake one on the navigator —
 * a sentinel that records its release, and a browser that drops it when the
 * page is hidden, which is the behaviour the re-acquire exists for.
 */

interface FakeSentinel {
  released: boolean;
  release: () => Promise<void>;
}

function fakeLock(refuse = false) {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    if (refuse) throw new Error("NotAllowedError");
    const s: FakeSentinel = {
      released: false,
      release: vi.fn(async () => {
        s.released = true;
      }),
    };
    sentinels.push(s);
    return s;
  });
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
  return { request, sentinels };
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  // `delete` on the configurable own property puts jsdom's navigator back.
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

/** Lets the fake request's promise settle. */
const settle = () => act(async () => {});

describe("useWakeLock", () => {
  it("does nothing where the browser has no wake lock", () => {
    expect("wakeLock" in navigator).toBe(false);
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();
  });

  it("asks for the screen while active and lets go when the mode closes", async () => {
    const { request, sentinels } = fakeLock();
    const { unmount } = renderHook(() => useWakeLock(true));
    await settle();
    expect(request).toHaveBeenCalledWith("screen");
    expect(sentinels).toHaveLength(1);
    unmount();
    expect(sentinels[0].released).toBe(true);
  });

  it("asks for nothing while inactive", async () => {
    const { request } = fakeLock();
    renderHook(() => useWakeLock(false));
    await settle();
    expect(request).not.toHaveBeenCalled();
  });

  it("asks again when the page comes back, because the browser dropped it", async () => {
    const { request, sentinels } = fakeLock();
    renderHook(() => useWakeLock(true));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    // The browser releases the lock itself when the page is hidden.
    sentinels[0].released = true;
    setVisibility("hidden");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels[1].released).toBe(false);
  });

  it("does not ask twice while it still holds the lock", async () => {
    const { request } = fakeLock();
    renderHook(() => useWakeLock(true));
    await settle();
    setVisibility("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after the mode has already closed", async () => {
    const { sentinels } = fakeLock();
    const { unmount } = renderHook(() => useWakeLock(true));
    // Closed before the browser answered.
    unmount();
    await settle();
    expect(sentinels).toHaveLength(1);
    expect(sentinels[0].released).toBe(true);
  });

  it("says nothing when the browser refuses", async () => {
    const { request } = fakeLock(true);
    const { unmount } = renderHook(() => useWakeLock(true));
    await settle();
    expect(request).toHaveBeenCalledTimes(1);
    unmount();
  });
});
