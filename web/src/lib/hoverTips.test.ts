// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { SHOW_WAIT_MS, startHoverTips, WARM_MS } from "./hoverTips";

const tip = () => document.querySelector<HTMLElement>(".hover-tip");
const over = (el: Element, from: Element | null = null, pointerType = "mouse") =>
  fireEvent.pointerOver(el, { pointerType, relatedTarget: from });
const out = (el: Element, to: Element | null = null) =>
  fireEvent.pointerOut(el, { pointerType: "mouse", relatedTarget: to });

describe("the app's own hover hint", () => {
  let stop: () => void;
  let a: HTMLButtonElement;
  let b: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<button id="a" title="Inspiration"><svg></svg></button><button id="b" title="Todos">Todos</button>';
    a = document.querySelector("#a")!;
    b = document.querySelector("#b")!;
    stop = startHoverTips();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("waits, then shows the title in its own box, with the browser's kept off", () => {
    over(a);
    expect(a.hasAttribute("title")).toBe(false);
    expect(tip()?.hidden ?? true).toBe(true);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    expect(tip()?.hidden).toBe(false);
    expect(tip()?.textContent).toBe("Inspiration");
    expect(tip()?.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the title back when the pointer leaves", () => {
    over(a);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    out(a);
    expect(a.getAttribute("title")).toBe("Inspiration");
    expect(tip()?.hidden).toBe(true);
  });

  it("keeps an icon button named while its title is off", () => {
    over(a);
    expect(a.getAttribute("aria-label")).toBe("Inspiration");
    out(a);
    expect(a.hasAttribute("aria-label")).toBe(false);
    over(b);
    expect(b.hasAttribute("aria-label")).toBe(false);
  });

  it("shows the next one at once while warm", () => {
    over(a);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    out(a, b);
    over(b, a);
    vi.advanceTimersByTime(0);
    expect(tip()?.textContent).toBe("Todos");
    expect(tip()?.hidden).toBe(false);
  });

  it("waits again once it has gone cold", () => {
    over(a);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    const now = performance.now();
    const clock = vi.spyOn(performance, "now");
    clock.mockReturnValue(now);
    out(a);
    clock.mockReturnValue(now + WARM_MS + 1);
    over(b);
    vi.advanceTimersByTime(0);
    expect(tip()?.hidden).toBe(true);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    expect(tip()?.textContent).toBe("Todos");
    clock.mockRestore();
  });

  it("is put away by a press and stays away until the pointer leaves", () => {
    over(a);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    fireEvent.pointerDown(a, { pointerType: "mouse" });
    expect(tip()?.hidden).toBe(true);
    expect(a.hasAttribute("title")).toBe(false);
    vi.advanceTimersByTime(SHOW_WAIT_MS * 2);
    expect(tip()?.hidden).toBe(true);
    out(a);
    expect(a.getAttribute("title")).toBe("Inspiration");
  });

  it("takes new words set while it is up", async () => {
    over(a);
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    a.setAttribute("title", "Unpin");
    await vi.waitFor(() => expect(tip()?.textContent).toBe("Unpin"));
    expect(a.hasAttribute("title")).toBe(false);
    out(a);
    expect(a.getAttribute("title")).toBe("Unpin");
  });

  it("leaves a finger alone", () => {
    over(a, null, "touch");
    vi.advanceTimersByTime(SHOW_WAIT_MS);
    expect(a.getAttribute("title")).toBe("Inspiration");
    expect(tip()).toBeNull();
  });
});
