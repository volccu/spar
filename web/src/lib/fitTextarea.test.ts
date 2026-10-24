// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fitTextarea } from "./fitTextarea";

describe("fitTextarea", () => {
  it("grows the field to its text and leaves every scroller around it where it was", () => {
    const scroller = document.createElement("div");
    const field = document.createElement("textarea");
    scroller.append(field);
    document.body.append(scroller);

    let top = 900;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => top,
      set: (v: number) => {
        top = v;
      },
    });
    // Reading the height is where a browser lays out the collapsed field, and a
    // scroller shorter than its position is clamped right there.
    Object.defineProperty(field, "scrollHeight", {
      configurable: true,
      get: () => {
        top = 40;
        return 640;
      },
    });

    fitTextarea(field);
    expect(field.style.height).toBe("640px");
    expect(top).toBe(900);
    scroller.remove();
  });
});
