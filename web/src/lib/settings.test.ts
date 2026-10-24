// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSettingsChange, readSetting, SETTINGS, useSetting, writeSetting } from "./settings";
import { applyTheme, resolvedTheme } from "./theme";

/** This device's settings (2026-10-11, owner approved: every one stays on the device). */

function prefersLight(light: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-color-scheme: light)" ? light : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.motion;
});

describe("a device setting", () => {
  it("reads its default when nothing is stored, and stores nothing for the default", () => {
    expect(readSetting("boardRow")).toBe("top");
    writeSetting("boardRow", "bottom");
    expect(localStorage.getItem(SETTINGS.boardRow.key)).toBe("bottom");
    writeSetting("boardRow", "top");
    expect(localStorage.getItem(SETTINGS.boardRow.key)).toBeNull();
  });

  it("reads a value this build does not know as the default", () => {
    localStorage.setItem(SETTINGS.theme.key, "sepia");
    expect(readSetting("theme")).toBe("dark");
  });

  it("reads the default, and writes without throwing, when storage refuses", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSetting("previews")).toBe("fetch");
    expect(() => writeSetting("previews", "off")).not.toThrow();
    vi.restoreAllMocks();
  });

  it("tells its listeners about every write, and stops when asked", () => {
    const heard = vi.fn();
    const stop = onSettingsChange(heard);
    writeSetting("motion", "reduced");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    writeSetting("motion", "system");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("hears another tab's write through the storage event", () => {
    const heard = vi.fn();
    const stop = onSettingsChange(heard);
    window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS.theme.key }));
    window.dispatchEvent(new StorageEvent("storage", { key: "someone.else" }));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it("re-renders a component the moment the switch is pressed", () => {
    const { result } = renderHook(() => useSetting("boardRow"));
    expect(result.current).toBe("top");
    act(() => writeSetting("boardRow", "bottom"));
    expect(result.current).toBe("bottom");
  });
});

describe("the theme on the document", () => {
  it("starts dark on a new device, even one set to light", () => {
    prefersLight(true);
    expect(readSetting("theme")).toBe("dark");
    expect(resolvedTheme()).toBe("dark");
    writeSetting("theme", "light");
    writeSetting("theme", "dark");
    expect(localStorage.getItem(SETTINGS.theme.key)).toBeNull();
  });

  it("resolves System against the device, and a device with no light preference is dark", () => {
    writeSetting("theme", "system");
    prefersLight(true);
    expect(resolvedTheme()).toBe("light");
    prefersLight(false);
    expect(resolvedTheme()).toBe("dark");
  });

  it("lets an explicit choice win over the device", () => {
    prefersLight(true);
    writeSetting("theme", "dark");
    expect(resolvedTheme()).toBe("dark");
    prefersLight(false);
    writeSetting("theme", "light");
    expect(resolvedTheme()).toBe("light");
  });

  it("writes only light or dark, never system, and marks reduced motion only when asked", () => {
    prefersLight(false);
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.motion).toBeUndefined();
    writeSetting("theme", "light");
    writeSetting("motion", "reduced");
    applyTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
