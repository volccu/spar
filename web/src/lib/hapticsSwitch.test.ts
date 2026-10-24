// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { canVibrate } from "./hapticsSwitch";

/** Settings' Vibrate switch is drawn only where there is a motor (audit 2026-10-24, UX-009). */
describe("canVibrate", () => {
  const vibrate = Object.getOwnPropertyDescriptor(navigator, "vibrate");

  const media = Object.getOwnPropertyDescriptor(window, "matchMedia");

  afterEach(() => {
    if (vibrate) Object.defineProperty(navigator, "vibrate", vibrate);
    else delete (navigator as { vibrate?: unknown }).vibrate;
    if (media) Object.defineProperty(window, "matchMedia", media);
    else delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function device(pointer: "fine" | "coarse") {
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: pointer === "fine" && query.includes("pointer: fine"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  }

  it("is true on a phone that has the function", () => {
    device("coarse");
    expect(canVibrate()).toBe(true);
  });

  it("is false on a desktop browser that has the function and no motor", () => {
    device("fine");
    expect(canVibrate()).toBe(false);
  });
});
