// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comesLate, printFrames, usePrint, PRINT_QUICK_MS } from "./usePrint";
import { ENTER, EXIT, PRINT_MS } from "./motion";

/**
 * The print: a picture that arrives late comes up out of the dark, and a
 * picture that was already here — decoded when first drawn, the device's own
 * bytes, a cache's quick answer — appears at once with no effect at all.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-motion");
});

describe("printFrames", () => {
  it("starts from nothing, hangs back as a ghost, and ends exactly where the stylesheet leaves it", () => {
    const frames = printFrames(0.68);
    expect(frames[0]).toMatchObject({ opacity: 0, easing: EXIT });
    expect(frames[1]?.opacity as number).toBeGreaterThan(0);
    expect(frames[1]?.opacity as number).toBeLessThan(0.68 / 2);
    expect(frames[1]).toMatchObject({ easing: ENTER });
    expect(frames[2]).toEqual({ opacity: 0.68 });
  });

  it("stays well under a second", () => {
    expect(PRINT_MS).toBeLessThan(1000);
  });
});

describe("comesLate", () => {
  const remote = { src: "https://example.test/a.jpg" };

  it("is yes for a remote picture that took longer than a cache's answer", () => {
    expect(comesLate(remote, false, PRINT_QUICK_MS + 1)).toBe(true);
  });
  it("is no for one already decoded when it was first drawn", () => {
    expect(comesLate(remote, true, 900)).toBe(false);
  });
  it("is no for this device's own bytes, however long they took", () => {
    expect(comesLate({ src: "blob:http://x/1" }, false, 900)).toBe(false);
    expect(comesLate({ src: "data:image/jpeg;base64,AAAA" }, false, 900)).toBe(false);
  });
  it("is no for a browser cache's quick answer", () => {
    expect(comesLate(remote, false, PRINT_QUICK_MS - 1)).toBe(false);
  });
});

describe("usePrint on an element", () => {
  let now = 0;
  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  function Pic({ src, k }: { src: string; k?: string }) {
    const print = usePrint(k);
    return <img alt="" src={src} ref={print.ref} onLoad={print.onLoad} />;
  }

  function stage(src: string, complete = false) {
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => complete });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => (complete ? 10 : 0) });
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    const view = render(<Pic src={src} />);
    return { animate, img: view.container.querySelector("img")!, view };
  }

  it("runs once when a remote picture lands late, over PRINT_MS", () => {
    const { animate, img } = stage("https://example.test/a.jpg");
    now += 400;
    fireEvent.load(img);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0][1]).toEqual({ duration: PRINT_MS });
    // The sharper copy of the same picture, arriving after, does not blink.
    now += 400;
    fireEvent.load(img);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a picture already decoded at first draw", () => {
    const { animate, img } = stage("https://example.test/a.jpg", true);
    now += 400;
    fireEvent.load(img);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does nothing for the device's own bytes", () => {
    const { animate, img } = stage("blob:http://localhost/xyz");
    now += 400;
    fireEvent.load(img);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does nothing under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    const { animate, img } = stage("https://example.test/a.jpg");
    now += 400;
    fireEvent.load(img);
    expect(animate).not.toHaveBeenCalled();
  });

  describe("a lazy picture (the wall's)", () => {
    let seen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    beforeEach(() => {
      seen = null;
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
            seen = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    function lazy() {
      Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => false });
      Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 0 });
      const animate = vi.fn();
      HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
      function Lazy() {
        const print = usePrint();
        return <img alt="" loading="lazy" src="https://example.test/w.jpg" ref={print.ref} onLoad={print.onLoad} />;
      }
      const view = render(<Lazy />);
      return { animate, img: view.container.querySelector("img")! };
    }

    it("does not count the time before it came into view: a cached one appears at once", () => {
      const { animate, img } = lazy();
      now += 5000; // scrolled to much later; the cache answers on the way in
      fireEvent.load(img);
      expect(animate).not.toHaveBeenCalled();
    });

    it("still comes up when it lands late after coming into view", () => {
      const { animate, img } = lazy();
      now += 5000;
      act(() => seen?.([{ isIntersecting: true }]));
      now += 400;
      fireEvent.load(img);
      expect(animate).toHaveBeenCalledTimes(1);
    });
  });

  it("counts a new key as a new arrival", () => {
    const { animate, img, view } = stage("https://example.test/a.jpg");
    now += 400;
    fireEvent.load(img);
    act(() => {
      view.rerender(<Pic src="https://example.test/b.jpg" k="b" />);
    });
    now += 400;
    fireEvent.load(view.container.querySelector("img")!);
    expect(animate).toHaveBeenCalledTimes(2);
  });
});
