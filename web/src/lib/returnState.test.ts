// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leaveForLink,
  provideReturnSpot,
  RETURN_MAX_MS,
  stashReturn,
  takeReturn,
} from "./returnState";

afterEach(() => {
  provideReturnSpot(null);
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const SPOT = { openId: "n1", boardId: "inbox", scrollTop: 120 };

describe("stashReturn / takeReturn", () => {
  it("is a no-op without a provider", () => {
    stashReturn();
    expect(takeReturn()).toBeNull();
  });

  it("round-trips the spot the provider hands over", () => {
    provideReturnSpot(() => SPOT);
    stashReturn();
    const spot = takeReturn();
    expect(spot).toMatchObject(SPOT);
    expect(typeof spot?.when).toBe("number");
  });

  it("is consumed by one read — offered once, never to a later open", () => {
    provideReturnSpot(() => SPOT);
    stashReturn();
    expect(takeReturn()).not.toBeNull();
    expect(takeReturn()).toBeNull();
  });

  it("refuses a stale spot, and still consumes it", () => {
    provideReturnSpot(() => SPOT);
    stashReturn();
    expect(takeReturn(Date.now() + RETURN_MAX_MS + 1)).toBeNull();
    expect(takeReturn()).toBeNull();
  });

  it("keeps a spot that is old but inside the window", () => {
    provideReturnSpot(() => SPOT);
    stashReturn();
    expect(takeReturn(Date.now() + RETURN_MAX_MS - 1000)).not.toBeNull();
  });

  it("survives garbage in the slot", () => {
    sessionStorage.setItem("spar-return", "{not json");
    expect(takeReturn()).toBeNull();
  });
});

/**
 * A `window.open` that obeys the one rule every real browser obeys and the
 * old mock did not: a features string carrying `noopener` (or `noreferrer`,
 * which implies it) makes the call return `null` **even though the window
 * opened**, because there is no opener link left to hand a handle back over.
 *
 * The previous mock returned a truthy stand-in whatever it was passed, so it
 * agreed that the anchor stood down while the shipped code was being told
 * `null` on every single click and standing the anchor down never — two tabs
 * per link, and a green test. Measured in Chromium 152: `window.open(url,
 * "_blank")` returns a WindowProxy, `window.open(url, "_blank",
 * "noopener,noreferrer")` returns null and opens the window regardless.
 */
function browserlikeOpen() {
  const asked: (string | undefined)[] = [];
  const handle = { opener: {} } as unknown as Window;
  const spy = vi
    .spyOn(window, "open")
    .mockImplementation((_url?: unknown, _target?: string, features?: string) => {
      asked.push(features);
      if (features && /noopener|noreferrer/.test(features)) return null;
      return handle;
    });
  return { spy, asked, handle };
}

describe("leaveForLink", () => {
  const event = () => ({
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  });

  it("stands the anchor down against a browser-accurate window.open", () => {
    const { spy, handle } = browserlikeOpen();
    const e = event();
    leaveForLink(e, "https://example.com/a");
    expect(spy).toHaveBeenCalledTimes(1);
    // The one assertion that catches the two-tabs bug: asked in a way that can
    // answer, so the anchor's own navigation is called off and one tab opens.
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(handle.opener).toBeNull();
  });

  it("never severs the opener in the features string, where it costs the answer", () => {
    const { asked } = browserlikeOpen();
    leaveForLink(event(), "https://example.com/a");
    for (const features of asked) {
      expect(features ?? "").not.toMatch(/noopener|noreferrer/);
    }
  });

  it("asks window.open inside the gesture", () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as WindowProxy);
    leaveForLink(event(), "https://example.com/a");
    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank");
  });

  it("lets the anchor's own target carry the link when the runtime refuses", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const e = event();
    leaveForLink(e, "https://example.com/a");
    expect(e.preventDefault).not.toHaveBeenCalled();
    // The tap must still not fall through into the reader's edit-on-touch.
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it("opens the link even when the handle refuses to be severed", () => {
    const e = event();
    vi.spyOn(window, "open").mockReturnValue({
      set opener(_v: unknown) {
        throw new Error("cross-origin");
      },
    } as unknown as WindowProxy);
    expect(() => leaveForLink(e, "https://example.com/a")).not.toThrow();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it("writes the spot down before leaving", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    provideReturnSpot(() => SPOT);
    leaveForLink(event(), "https://example.com/a");
    expect(takeReturn()).toMatchObject(SPOT);
  });
});
