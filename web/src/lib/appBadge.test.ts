// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_BADGE_KEY, appBadgeOn, canBadge, installed, setAppBadgeOn, showInboxBadge } from "./appBadge";

/** The Inbox count on the app's icon (review PL-12). */

const nav = navigator as Navigator & { setAppBadge?: unknown; clearAppBadge?: unknown };

function withBadging() {
  const set = vi.fn(async (count?: number) => void count);
  const clear = vi.fn(async () => {});
  nav.setAppBadge = set;
  nav.clearAppBadge = clear;
  return { set, clear };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete nav.setAppBadge;
  delete nav.clearAppBadge;
  vi.unstubAllGlobals();
  showInboxBadge(0);
});

describe("the Inbox count on the app's icon", () => {
  it("shows the count, and clears it at zero rather than drawing a 0", () => {
    const api = withBadging();
    showInboxBadge(12);
    expect(api.set).toHaveBeenLastCalledWith(12);
    showInboxBadge(0);
    expect(api.clear).toHaveBeenCalledTimes(1);
    expect(api.set).toHaveBeenCalledTimes(1);
  });

  it("does nothing, and throws nothing, where the browser cannot badge", () => {
    expect(canBadge()).toBe(false);
    expect(() => showInboxBadge(5)).not.toThrow();
  });

  it("never throws when the browser refuses, whether it rejects or throws outright", async () => {
    nav.setAppBadge = vi.fn(() => Promise.reject(new Error("not installed")));
    expect(() => showInboxBadge(3)).not.toThrow();
    nav.setAppBadge = vi.fn(() => {
      throw new Error("nope");
    });
    expect(() => showInboxBadge(3)).not.toThrow();
    // Let the rejected promise settle: an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 0));
  });

  it("can be switched off, which clears it at once, and back on, which draws it again", () => {
    const api = withBadging();
    showInboxBadge(7);
    setAppBadgeOn(false);
    expect(appBadgeOn()).toBe(false);
    expect(localStorage.getItem(APP_BADGE_KEY)).toBe("off");
    expect(api.clear).toHaveBeenCalledTimes(1);
    showInboxBadge(9);
    expect(api.set).toHaveBeenCalledTimes(1); // still off: only cleared again
    setAppBadgeOn(true);
    expect(api.set).toHaveBeenLastCalledWith(9);
  });

  it("is on by default, and when storage throws", () => {
    expect(appBadgeOn()).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(appBadgeOn()).toBe(true);
    vi.restoreAllMocks();
  });

  it("knows an installed window from a tab", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(display-mode: standalone)" }));
    expect(installed()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(installed()).toBe(false);
  });
});
