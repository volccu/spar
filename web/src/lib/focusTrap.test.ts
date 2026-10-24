// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cycleTab } from "./focusTrap";

function layer(buttons: number): { el: HTMLElement; items: HTMLButtonElement[] } {
  const el = document.createElement("div");
  el.tabIndex = -1;
  const items = Array.from({ length: buttons }, () => {
    const b = document.createElement("button");
    el.appendChild(b);
    return b;
  });
  document.body.appendChild(el);
  return { el, items };
}

function tab(shift = false) {
  let prevented = false;
  return {
    shiftKey: shift,
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

describe("cycleTab", () => {
  it("wraps from the last element to the first, and back with Shift", () => {
    const { el, items } = layer(3);
    items[2].focus();
    const forward = tab();
    cycleTab(forward, el);
    expect(document.activeElement).toBe(items[0]);
    expect(forward.prevented).toBe(true);

    const back = tab(true);
    cycleTab(back, el);
    expect(document.activeElement).toBe(items[2]);
    expect(back.prevented).toBe(true);
    el.remove();
  });

  it("lets Tab through in the middle of the layer", () => {
    const { el, items } = layer(3);
    items[1].focus();
    const key = tab();
    cycleTab(key, el);
    expect(key.prevented).toBe(false);
    expect(document.activeElement).toBe(items[1]);
    el.remove();
  });

  it("takes focus itself when the layer holds nothing focusable", () => {
    const { el } = layer(0);
    const key = tab();
    cycleTab(key, el);
    expect(key.prevented).toBe(true);
    expect(document.activeElement).toBe(el);
    el.remove();
  });
});
