// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WORKING_DWELL_MS,
  WORKING_ENTER_MS,
  useMascotState,
  useSyncAnnouncement,
} from "./mascotState";
import type { MascotState } from "../components/mascot-element";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fake timers plus the state updates they cause, in one step. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function mount(initial: { busy: boolean; online?: boolean; empty?: boolean }) {
  return renderHook(
    (props: { busy: boolean; online?: boolean; empty?: boolean }) =>
      useMascotState({ busy: props.busy, online: props.online ?? true, empty: props.empty }),
    { initialProps: initial },
  );
}

describe("useMascotState", () => {
  it("rests at idle, and at empty on a board with nothing on it", () => {
    expect(mount({ busy: false }).result.current).toBe("idle");
    expect(mount({ busy: false, empty: true }).result.current).toBe("empty");
  });

  /**
   * Most syncs here finish in a fraction of the threshold. If every one of
   * them set the creature walking, the header would strobe on every keystroke
   * that triggered a push — which reports "something is wrong" far more
   * loudly than it reports "everything is fine".
   */
  it("shows nothing at all for a sync that finishes inside the threshold", () => {
    const { result, rerender } = mount({ busy: true });

    tick(WORKING_ENTER_MS - 50);
    rerender({ busy: false });
    tick(5_000);

    expect(result.current).toBe("idle");
  });

  it("sets off walking once a sync is still running after the threshold", () => {
    const { result } = mount({ busy: true });

    tick(WORKING_ENTER_MS - 1);
    expect(result.current).toBe("idle");

    tick(1);
    expect(result.current).toBe("working");
  });

  /**
   * A state that appears and disappears inside one turn of the walk cycle
   * reads as a glitch, not as an event. So once it is up it stays up, however
   * quickly the sync that started it finished.
   */
  it("keeps walking for the whole dwell, even if the sync has already landed", () => {
    const { result, rerender } = mount({ busy: true });

    tick(WORKING_ENTER_MS);
    expect(result.current).toBe("working");

    // A 300ms sync: 50ms of it visible so far, 750ms of dwell still owed.
    tick(50);
    rerender({ busy: false });

    tick(WORKING_DWELL_MS - 100);
    expect(result.current).toBe("working");

    tick(100);
    expect(result.current).toBe("idle");
  });

  /**
   * Counted, not flagged — which here means the flag it reads is already a
   * count (`useSync` holds it true across a re-run queued mid-flight). Three
   * overlapping saves are one span of walking that ends once, after the last
   * of them, not three starts and stops.
   */
  it("returns to idle once, after the last of several overlapping saves", () => {
    const { result, rerender } = mount({ busy: true });
    tick(WORKING_ENTER_MS);
    expect(result.current).toBe("working");

    // Two more land while the first is still going; the flag never drops.
    tick(200);
    rerender({ busy: true });
    tick(200);
    rerender({ busy: true });
    tick(600);
    expect(result.current).toBe("working");

    rerender({ busy: false });
    tick(WORKING_DWELL_MS);
    expect(result.current).toBe("idle");
  });

  /**
   * A sync cannot be in flight without a connection. If the header shows
   * `working` while the device is disconnected it is lying about the one
   * thing this mark exists to report, so offline wins over everything.
   */
  it("shows offline over working, empty and idle alike", () => {
    const { result, rerender } = mount({ busy: true });
    tick(WORKING_ENTER_MS);
    expect(result.current).toBe("working");

    rerender({ busy: true, online: false });
    expect(result.current).toBe("offline");

    rerender({ busy: false, online: false, empty: true });
    expect(result.current).toBe("offline");

    rerender({ busy: false, online: true, empty: true });
    tick(WORKING_DWELL_MS);
    expect(result.current).toBe("empty");
  });
});

describe("useSyncAnnouncement", () => {
  function say(initial: MascotState) {
    return renderHook(
      (props: { state: MascotState; failed?: boolean }) =>
        useSyncAnnouncement(props.state, props.failed ?? false),
      { initialProps: { state: initial } as { state: MascotState; failed?: boolean } },
    );
  }

  it("says nothing about the state the app opened in", () => {
    expect(say("idle").result.current).toBe("");
    expect(say("offline").result.current).toBe("");
  });

  it("announces each transition once", () => {
    const { result, rerender } = say("idle");

    act(() => rerender({ state: "working" }));
    expect(result.current).toBe("Syncing");

    act(() => rerender({ state: "idle" }));
    expect(result.current).toBe("Synced");

    act(() => rerender({ state: "offline" }));
    expect(result.current).toBe("Offline");
  });

  /** With nothing to sync to, "Synced" promises a server that is not there
   *  (review CD-03): coming back from offline is said as what it is. */
  it("never says Synced with nothing to sync to", () => {
    const { result, rerender } = renderHook(
      (props: { state: MascotState }) => useSyncAnnouncement(props.state, false, false),
      { initialProps: { state: "idle" as MascotState } },
    );
    act(() => rerender({ state: "offline" }));
    expect(result.current).toBe("Offline");
    act(() => rerender({ state: "idle" }));
    expect(result.current).toBe("Online");
  });

  it("keeps a failure in words, over whatever the drawing is doing", () => {
    const { result, rerender } = say("idle");

    act(() => rerender({ state: "idle", failed: true }));
    expect(result.current).toBe("Sync failed");
  });
});
