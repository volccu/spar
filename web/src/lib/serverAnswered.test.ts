// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useServerAnswered } from "./serverAnswered";

const syncing = { heardFromServer: false, deviceOnly: false, syncConfigured: true };

describe("whether this device knows what the archive holds", () => {
  it("knows nothing until a tick has come round clean", () => {
    const { result } = renderHook(() => useServerAnswered(syncing));
    expect(result.current).toBe(false);
  });

  it("knows at once when there is no server to ask", () => {
    expect(
      renderHook(() => useServerAnswered({ ...syncing, deviceOnly: true })).result.current,
    ).toBe(true);
    expect(
      renderHook(() => useServerAnswered({ ...syncing, syncConfigured: false })).result.current,
    ).toBe(true);
  });

  /**
   * The bug this pins. Sync ticks, so `heardFromServer` is false again a moment
   * after it was true — and an account that really is empty would have gone
   * back to "Fetching your notes" on every poll, promising a new user notes
   * they have never had.
   */
  it("does not forget the answer when the next tick starts", () => {
    const { result, rerender } = renderHook((p: Parameters<typeof useServerAnswered>[0]) =>
      useServerAnswered(p),
    { initialProps: syncing });
    expect(result.current).toBe(false);

    rerender({ ...syncing, heardFromServer: true });
    expect(result.current).toBe(true);

    // Working again, offline, failing: none of it unlearns what was heard.
    rerender(syncing);
    expect(result.current).toBe(true);
  });

  /**
   * Signing in from device-only is the one transition that must go *backwards*:
   * the flag that meant "there is nobody to ask" has just stopped being true,
   * and a session that has never synced knows nothing about the server.
   */
  it("goes back to not knowing when a device-only user signs in", () => {
    const { result, rerender } = renderHook((p: Parameters<typeof useServerAnswered>[0]) =>
      useServerAnswered(p),
    { initialProps: { ...syncing, deviceOnly: true } });
    expect(result.current).toBe(true);

    rerender(syncing);
    expect(result.current).toBe(false);
  });
});
