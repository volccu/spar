// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { CLOSE_MS, SLIDE_OUT_MS } from "./motion";
import { useModeLayer } from "./useModeLayer";

/**
 * The mode's backup timers. jsdom has no Web Animations, so `animates()` is
 * false and the animated close and fling — the timers with them — are
 * unreachable without a stand-in: the smallest thing that satisfies `animates`
 * and the two members the hook uses, `onfinish` and `cancel`.
 */
type Flight = { onfinish: (() => void) | null; cancel: () => void };
let flights: Flight[] = [];
const proto = HTMLElement.prototype as unknown as { animate?: unknown };
let had: unknown;

beforeEach(() => {
  vi.useFakeTimers();
  flights = [];
  had = proto.animate;
  proto.animate = () => {
    const flight: Flight = { onfinish: null, cancel: vi.fn() };
    flights.push(flight);
    return flight;
  };
});

afterEach(() => {
  cleanup();
  proto.animate = had;
  vi.useRealTimers();
});

/** A mode with one thing in it, a close button, and a card a swipe answers. */
function Mode({ onClose, onSwipe }: { onClose: () => void; onSwipe?: (way: "left" | "right") => void }) {
  const restoreTo = useRef<HTMLButtonElement | null>(null);
  const mode = useModeLayer({ count: 1, origin: null, onClose, restoreTo, onSwipe });
  return (
    <div
      ref={mode.layerRef}
      data-testid="layer"
      tabIndex={-1}
      onTouchStart={mode.onTouchStart}
      onTouchMove={mode.onTouchMove}
      onTouchEnd={mode.onTouchEnd}
    >
      <div ref={mode.faceRef}>the card</div>
      <button type="button" onClick={mode.close}>
        Close
      </button>
    </div>
  );
}

const last = () => flights[flights.length - 1];

describe("closing a mode", () => {
  it("ends by its timer when the animation never finishes, as in a hidden tab", () => {
    const onClose = vi.fn();
    render(<Mode onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CLOSE_MS + 139));
    expect(onClose).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ends when the animation lands, once, and the timer does not end it again", () => {
    const onClose = vi.fn();
    render(<Mode onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    act(() => last().onfinish?.());
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * The close's timer was fired and forgotten. Harmless once the layer had
   * closed (the close was made once either way), but a layer taken away for
   * any other reason mid-close still had its `onClose` go off afterwards,
   * aimed at whatever was up by then. It is called off on both now, as the
   * picture's is.
   */
  it("calls its timer off when the animation lands, and when the mode goes", () => {
    const onClose = vi.fn();
    const first = render(<Mode onClose={onClose} />);
    const waiting = vi.getTimerCount();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(vi.getTimerCount()).toBe(waiting + 1);
    act(() => last().onfinish?.());
    expect(vi.getTimerCount()).toBe(waiting);
    first.unmount();

    onClose.mockClear();
    const second = render(<Mode onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    second.unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("a fling", () => {
  const fling = () => {
    const layer = screen.getByTestId("layer");
    fireEvent.touchStart(layer, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: 100, clientY: 302 }] });
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 100, clientY: 302 }] });
  };

  it("is answered by its timer when the animation never finishes", () => {
    const onSwipe = vi.fn();
    render(<Mode onClose={() => {}} onSwipe={onSwipe} />);
    fling();
    expect(onSwipe).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(SLIDE_OUT_MS + 120));
    expect(onSwipe).toHaveBeenCalledTimes(1);
    expect(onSwipe).toHaveBeenCalledWith("left");
  });

  it("is answered once when it lands, and the timer does not answer it again", () => {
    const onSwipe = vi.fn();
    render(<Mode onClose={() => {}} onSwipe={onSwipe} />);
    fling();
    act(() => last().onfinish?.());
    expect(onSwipe).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(10_000));
    expect(onSwipe).toHaveBeenCalledTimes(1);
  });

  it("is not answered after the mode has gone", () => {
    const onSwipe = vi.fn();
    const { unmount } = render(<Mode onClose={() => {}} onSwipe={onSwipe} />);
    fling();
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(onSwipe).not.toHaveBeenCalled();
  });
});

describe("the tick at the point of no return", () => {
  let buzz: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    buzz = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: buzz, configurable: true });
  });
  afterEach(() => {
    delete (navigator as unknown as { vibrate?: unknown }).vibrate;
  });

  const move = (x: number) =>
    fireEvent.touchMove(screen.getByTestId("layer"), { touches: [{ clientX: x, clientY: 300 }] });

  it("ticks once as the card crosses the line, not again while it stays past, and again on a new crossing", () => {
    render(<Mode onClose={() => {}} onSwipe={() => {}} />);
    fireEvent.touchStart(screen.getByTestId("layer"), { touches: [{ clientX: 500, clientY: 300 }] });
    move(480); // 20px: short of the line (110px here)
    expect(buzz).not.toHaveBeenCalled();
    move(380); // 120px: past it
    expect(buzz).toHaveBeenCalledTimes(1);
    move(350);
    move(300); // still past
    expect(buzz).toHaveBeenCalledTimes(1);
    move(470); // back under the line
    move(380); // and across again
    expect(buzz).toHaveBeenCalledTimes(2);
  });

  it("does not tick for a finger resting on the line", () => {
    render(<Mode onClose={() => {}} onSwipe={() => {}} />);
    fireEvent.touchStart(screen.getByTestId("layer"), { touches: [{ clientX: 500, clientY: 300 }] });
    move(388); // 112px: past
    move(392); // 108px: a tremor, still held
    move(388);
    expect(buzz).toHaveBeenCalledTimes(1);
  });

  it("is silent in a mode that has no swipe to answer", () => {
    render(<Mode onClose={() => {}} />);
    fireEvent.touchStart(screen.getByTestId("layer"), { touches: [{ clientX: 500, clientY: 300 }] });
    move(300);
    expect(buzz).not.toHaveBeenCalled();
  });
});
