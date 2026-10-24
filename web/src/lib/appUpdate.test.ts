import { describe, expect, it, vi } from "vitest";
import { scheduleUpdateChecks, UPDATE_CHECK_MS, watchForUpdate, type Clocks } from "./appUpdate";

/**
 * A page that stands in for the browser: whether it is hidden, who is
 * listening for that to change, and what timers are running.
 */
function fakeClocks(hidden = false) {
  const listeners = new Set<() => void>();
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const clocks: Clocks = {
    addVisibilityListener: (l) => listeners.add(l),
    removeVisibilityListener: (l) => listeners.delete(l),
    isHidden: () => hidden,
    setInterval: (fn, ms) => {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => {
      timers.delete(id);
    },
  };
  return {
    clocks,
    timers,
    listeners,
    setHidden(value: boolean) {
      hidden = value;
      for (const l of listeners) l();
    },
    tick() {
      for (const { fn } of timers.values()) fn();
    },
  };
}

describe("scheduleUpdateChecks", () => {
  it("looks for a new build every hour while the app is in front", () => {
    const page = fakeClocks();
    const check = vi.fn();
    scheduleUpdateChecks(check, page.clocks);

    expect(check).not.toHaveBeenCalled();
    expect([...page.timers.values()].map((t) => t.ms)).toEqual([UPDATE_CHECK_MS]);
    page.tick();
    expect(check).toHaveBeenCalledTimes(1);
  });

  /**
   * The case the whole module exists for: an installed app brought back from
   * the background. The browser does not look on its own here, so this is
   * where a stale build would otherwise live on for a week.
   */
  it("looks the moment the app comes to the front, and stops while it is hidden", () => {
    const page = fakeClocks();
    const check = vi.fn();
    scheduleUpdateChecks(check, page.clocks);

    page.setHidden(true);
    expect(page.timers.size, "no timer runs behind a locked screen").toBe(0);
    page.tick();
    expect(check).not.toHaveBeenCalled();

    page.setHidden(false);
    expect(check, "coming back is a check in itself").toHaveBeenCalledTimes(1);
    expect(page.timers.size, "and the hourly look resumes").toBe(1);
  });

  it("does not start a timer for a page that opens hidden", () => {
    const page = fakeClocks(true);
    scheduleUpdateChecks(vi.fn(), page.clocks);
    expect(page.timers.size).toBe(0);
  });

  it("stops cleanly", () => {
    const page = fakeClocks();
    const check = vi.fn();
    const stop = scheduleUpdateChecks(check, page.clocks);
    stop();
    expect(page.timers.size).toBe(0);
    expect(page.listeners.size).toBe(0);
    page.setHidden(false);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("watchForUpdate", () => {
  /** jsdom has no service workers, so this is the browser-without-them case. */
  it("offers nothing where there are no service workers", async () => {
    expect("serviceWorker" in navigator).toBe(false);
    await expect(watchForUpdate({ onReady: vi.fn() })).resolves.toBeNull();
  });
});
