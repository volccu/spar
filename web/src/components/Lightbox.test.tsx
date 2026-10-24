// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Attachment } from "../types";
import { Lightbox } from "./Lightbox";
import { SLIDE_OUT_MS } from "../lib/motion";

const drawPdf = vi.fn();
const fetchFile = vi.fn();
const passingBytes = vi.fn();

// `isPdf` stays real — it is what decides a document is a document, and a
// stubbed one would let this test pass over a viewer that never opened.
vi.mock("../lib/pdf", async (importActual) => {
  const actual = await importActual<typeof import("../lib/pdf")>();
  return { ...actual, drawPdf: (...args: unknown[]) => drawPdf(...args) };
});
vi.mock("../store/attachments", () => ({
  fetchFile: (...args: unknown[]) => fetchFile(...args),
  passingBytes: (...args: unknown[]) => passingBytes(...args),
}));

afterEach(cleanup);

const attachment: Attachment = {
  id: "image-1",
  name: "photo.jpg",
  mime: "image/jpeg",
  size: 1024,
  width: 100,
  height: 100,
  thumb: null,
  path: null,
  added_at: "2026-08-13T10:00:00.000Z",
};

describe("Lightbox", () => {
  it("provides a close control and restores focus to the preview trigger", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            View photo
          </button>
          {open && (
            <Lightbox
              att={attachment}
              src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
              origin={null}
              register={() => {}}
              onClose={() => setOpen(false)}
              downloadUrl={null}
              at={0}
              count={1}
              onStep={() => {}}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "View photo" });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole("button", { name: "Close viewer" })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close viewer" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  /**
   * The fallback that closes a layer whose animation a backgrounded tab never
   * finished used to be fired and forgotten, and an unowned timer holding
   * `onClose` is aimed at whatever layer is up when it goes off: close a
   * picture and open another attachment inside `CLOSE_MS + LATE_CLOSE_MS` and the first
   * viewer's timer shut the second, which reads as a viewer that will not stay
   * open.
   *
   * jsdom has no Web Animations, so `animates()` is false and the whole
   * animated close — the timer included — is unreachable without one. The stub
   * is the smallest thing that satisfies `animates` and the two properties the
   * close actually uses.
   */
  it("takes its backgrounded-tab timer with it when it goes", () => {
    vi.useFakeTimers();
    const running = { onfinish: null as null | (() => void), cancel: () => {} };
    const real = (Element.prototype as { animate?: unknown }).animate;
    (Element.prototype as unknown as { animate: () => unknown }).animate = () => running;

    const onClose = vi.fn();
    const { unmount } = render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={onClose}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    // Nothing yet: the animation is what closes it, and it has not finished.
    expect(onClose).not.toHaveBeenCalled();

    unmount();
    vi.advanceTimersByTime(10_000);
    // The layer is gone and the timer went with it, so the next attachment
    // opened in this window is nobody else's to close.
    expect(onClose).not.toHaveBeenCalled();

    if (real) (Element.prototype as unknown as { animate: unknown }).animate = real;
    else delete (Element.prototype as { animate?: unknown }).animate;
    vi.useRealTimers();
  });
});

describe("getting closer to a picture", () => {
  /** The viewer, mounted, with the picture and the surface that hears fingers.
      Alone in its note unless a walk is asked for — `count` is what says there
      is anything beside it. */
  function open(onClose = () => {}, walk?: { at: number; count: number; onStep: (n: number) => void }) {
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={onClose}
        downloadUrl={null}
        at={walk?.at ?? 0}
        count={walk?.count ?? 1}
        onStep={walk?.onStep ?? (() => {})}
      />,
    );
    const shot = screen.getByAltText("photo.jpg") as HTMLImageElement;
    const frame = shot.parentElement as HTMLElement;
    return { shot, frame };
  }

  /** Two fingers going from `from` apart to `to` apart, around the same spot. */
  function pinchTo(frame: HTMLElement, from: number, to: number) {
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    fireEvent.pointerDown(frame, { pointerId: 2, clientX: from, clientY: 0, pointerType: "touch" });
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: to, clientY: 0, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 2, clientX: to, clientY: 0, pointerType: "touch" });
  }

  it("takes a pinch past the size of the screen", () => {
    // The bug this exists for: a photograph opened on a phone was the size of
    // the screen and no larger, and neither the layer nor the browser had a
    // way in — the note sheet's `touch-action: pan-y` sees to the browser's.
    const { shot, frame } = open();
    expect(shot.style.transform).toContain("scale(1)");

    pinchTo(frame, 100, 200);
    expect(shot.style.transform).toContain("scale(2)");
    expect(frame.getAttribute("data-zoomed")).toBe("true");
  });

  it("never goes below the fit, however far the fingers close", () => {
    const { shot, frame } = open();
    pinchTo(frame, 200, 10);
    expect(shot.style.transform).toContain("scale(1)");
    expect(frame.getAttribute("data-zoomed")).toBe("false");
  });

  it("stops at the point where there is nothing left to see", () => {
    const { shot, frame } = open();
    pinchTo(frame, 10, 4000);
    expect(shot.style.transform).toContain("scale(6)");
  });

  /** A finger down and up on the same spot, and the click the browser sends
      after it — which is the only shape a tap ever really arrives in. */
  function tap(frame: HTMLElement) {
    fireEvent.pointerDown(frame, { pointerId: 9, clientX: 30, clientY: 30, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 9, clientX: 30, clientY: 30, pointerType: "touch" });
    fireEvent.click(frame);
  }

  it("spends the tap on getting back to the fit, and only then on closing", () => {
    // A tap in this layer closes it. Zoomed in that would throw the picture
    // away mid-look, so while there is more picture than screen the tap is
    // respent on the way back out — the mode's own screen, its own budget.
    const onClose = vi.fn();
    const { shot, frame } = open(onClose);

    pinchTo(frame, 100, 300);
    expect(shot.style.transform).toContain("scale(3)");

    tap(frame);
    expect(onClose).not.toHaveBeenCalled();
    expect(shot.style.transform).toContain("scale(1)");

    // At the fit a tap closes — a quarter of a second later, once no second
    // tap has come to make it a double tap.
    vi.useFakeTimers();
    try {
      tap(frame);
      expect(onClose).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes in at the finger on a double tap, and does not close", () => {
    const onClose = vi.fn();
    const { shot, frame } = open(onClose);
    vi.useFakeTimers();
    try {
      tap(frame);
      tap(frame);
      vi.advanceTimersByTime(300);
      expect(onClose).not.toHaveBeenCalled();
      expect(shot.style.transform).toContain("scale(2.5)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not read a drag across the picture as a tap", () => {
    const onClose = vi.fn();
    const { frame } = open(onClose);
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 40, clientY: 40, pointerType: "touch" });
    fireEvent.pointerMove(frame, { pointerId: 1, clientX: 160, clientY: 44, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 160, clientY: 44, pointerType: "touch" });
    fireEvent.click(frame);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps its place when the same picture is handed a new address", () => {
    // The upload finishing writes `path`, and `useFileUrl` answers with a new
    // object URL for the same bytes. That is not a new picture, and it used to
    // snap a pinch back to the fit mid-read.
    const props = {
      origin: null,
      register: () => {},
      onClose: () => {},
      downloadUrl: null,
      at: 0,
      count: 1,
      onStep: () => {},
    };
    const { rerender } = render(<Lightbox {...props} att={attachment} src="blob:first" />);
    const shot = screen.getByAltText("photo.jpg") as HTMLImageElement;
    pinchTo(shot.parentElement as HTMLElement, 100, 250);
    expect(shot.style.transform).toContain("scale(2.5)");

    rerender(<Lightbox {...props} att={{ ...attachment, path: "u/image-1" }} src="blob:second" />);
    expect(shot.style.transform).toContain("scale(2.5)");
  });

  it("zooms on a wheel, so the desktop has the gesture too", () => {
    const { shot, frame } = open();
    fireEvent.wheel(frame, { deltaY: -400, clientX: 0, clientY: 0 });
    const scale = Number(/scale\(([\d.]+)\)/.exec(shot.style.transform)?.[1]);
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThanOrEqual(6);
  });
});

describe("walking between the files a note carries", () => {
  /** The viewer standing at `at` of three, and the surface that hears fingers. */
  function openAt(at: number) {
    const onStep = vi.fn();
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={at}
        count={3}
        onStep={onStep}
      />,
    );
    const shot = screen.getByAltText("photo.jpg") as HTMLImageElement;
    return { onStep, shot, frame: shot.parentElement as HTMLElement };
  }

  /** One finger down, across and up — the shape a swipe arrives in. */
  function swipe(frame: HTMLElement, dx: number) {
    fireEvent.pointerDown(frame, { pointerId: 5, clientX: 200, clientY: 80, pointerType: "touch" });
    fireEvent.pointerMove(frame, {
      pointerId: 5,
      clientX: 200 + dx,
      clientY: 80,
      pointerType: "touch",
    });
    fireEvent.pointerUp(frame, {
      pointerId: 5,
      clientX: 200 + dx,
      clientY: 80,
      pointerType: "touch",
    });
  }

  it("says where you are, and only when there is anywhere to be", () => {
    const { unmount } = render(
      <Lightbox
        att={attachment}
        src="x"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    expect(screen.queryByText("1 / 1")).toBeNull();
    unmount();

    openAt(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("moves with the arrow keys, which is the desktop half of the swipe", () => {
    const { onStep } = openAt(1);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onStep).toHaveBeenCalledWith(2);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onStep).toHaveBeenLastCalledWith(0);
  });

  it("has nothing past the ends, from a key or from a finger", () => {
    const last = openAt(2);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    swipe(last.frame, -160);
    expect(last.onStep).not.toHaveBeenCalled();
    cleanup();

    const first = openAt(0);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    swipe(first.frame, 160);
    expect(first.onStep).not.toHaveBeenCalled();
  });

  it("walks on a swipe across the picture", () => {
    const { onStep, frame } = openAt(0);
    swipe(frame, -160);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  /**
   * With Web Animations the picture is thrown off before the walk is made, and
   * a tab put in the background never finishes the throw: a timer makes the
   * walk instead. Either way it is made once. jsdom has no `animate`, so a
   * stand-in plays the throw.
   */
  it("walks once the throw lands, or on its timer when it never does", () => {
    vi.useFakeTimers();
    const throws: { onfinish: null | (() => void); cancel: () => void }[] = [];
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const had = proto.animate;
    proto.animate = () => {
      const t = { onfinish: null as null | (() => void), cancel: () => {} };
      throws.push(t);
      return t;
    };
    try {
      const landed = openAt(0);
      swipe(landed.frame, -160);
      expect(landed.onStep).not.toHaveBeenCalled();
      act(() => throws[throws.length - 1].onfinish?.());
      expect(landed.onStep).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(10_000));
      expect(landed.onStep).toHaveBeenCalledTimes(1);
      cleanup();

      const hidden = openAt(0);
      swipe(hidden.frame, -160);
      const thrown = throws[throws.length - 1];
      act(() => vi.advanceTimersByTime(SLIDE_OUT_MS + 119));
      expect(hidden.onStep).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(hidden.onStep).toHaveBeenCalledTimes(1);
      act(() => thrown.onfinish?.());
      expect(hidden.onStep).toHaveBeenCalledTimes(1);
    } finally {
      proto.animate = had;
      vi.useRealTimers();
    }
  });

  it("does not read a nudge as a swipe", () => {
    const { onStep, frame } = openAt(0);
    swipe(frame, -30);
    expect(onStep).not.toHaveBeenCalled();
  });

  it("leaves the finger to panning once there is more picture than frame", () => {
    // The one that matters: zoomed in, a sideways drag is how you look at the
    // right-hand side of a receipt. Spending it on the next file instead would
    // take the picture away mid-look — the same fault the tap was respent for.
    const { onStep, shot, frame } = openAt(0);
    fireEvent.pointerDown(frame, { pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    fireEvent.pointerDown(frame, { pointerId: 2, clientX: 100, clientY: 0, pointerType: "touch" });
    fireEvent.pointerMove(frame, { pointerId: 2, clientX: 400, clientY: 0, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 1, clientX: 0, clientY: 0, pointerType: "touch" });
    fireEvent.pointerUp(frame, { pointerId: 2, clientX: 400, clientY: 0, pointerType: "touch" });
    expect(shot.style.transform).toContain("scale(4)");

    swipe(frame, -160);
    expect(onStep).not.toHaveBeenCalled();
  });
});

describe("a document in the viewer", () => {
  const doc: Attachment = {
    id: "doc-1",
    name: "placeholder.pdf",
    mime: "application/pdf",
    size: 2048,
    width: 612,
    height: 792,
    thumb: null,
    path: null,
    added_at: "2026-08-13T10:00:00.000Z",
  };

  beforeEach(() => {
    drawPdf.mockReset();
    fetchFile.mockReset();
    drawPdf.mockResolvedValue({ drawn: 1, total: 1 });
  });

  it("draws from the stored bytes, not from the object URL it is shown with", async () => {
    // The regression. The viewer used to hand pdf.js the `blob:` URL in `src`,
    // and pdf.js fetches a URL — which the deployed CSP refuses for `blob:`,
    // so on the real site every document said "cannot draw this document".
    // The bytes are in this device's own store by the time the viewer opens;
    // asking for them costs nothing and no header can refuse it.
    const bytes = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
      type: "application/pdf",
    });
    fetchFile.mockResolvedValue(bytes);

    render(
      <Lightbox
        att={doc}
        src="blob:http://localhost/6f1c-not-to-be-fetched"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );

    await waitFor(() => expect(drawPdf).toHaveBeenCalled());
    expect(fetchFile).toHaveBeenCalledWith(doc);
    expect(drawPdf.mock.calls[0][0]).toBe(bytes);
    expect(drawPdf.mock.calls[0][0]).not.toBe("blob:http://localhost/6f1c-not-to-be-fetched");
  });

  it("says so plainly when the bytes are nowhere to be had", async () => {
    fetchFile.mockResolvedValue(null);

    render(
      <Lightbox
        att={doc}
        src="blob:http://localhost/6f1c-not-to-be-fetched"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );

    const said = await screen.findByText("Can't show this here. Save it to open it elsewhere.");
    // Marked as a failure, not left looking like the page count the same line
    // carries the rest of the time — an error takes full ink and a 3px rule.
    expect(said.getAttribute("data-failed")).toBe("true");
    expect(drawPdf).not.toHaveBeenCalled();
  });
});

describe("Lightbox — a link item", () => {
  const link = {
    noteId: "n1",
    title: "A page",
    href: "https://example.com/p",
    site: "example.com",
    poster: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP",
    video: null,
  };

  it("draws the link's picture, names it, and offers Open site and Open note — no Save, no file size", () => {
    const onOpenNote = vi.fn();
    render(
      <Lightbox link={link} src={link.poster} origin={null} register={() => {}} onClose={() => {}} at={0} count={1} onStep={() => {}} onOpenNote={onOpenNote} />,
    );
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("A page");
    expect(screen.getByRole("img", { name: "A page" }).getAttribute("src")).toBe(link.poster);
    expect(screen.getByRole("link", { name: /Open site/i }).getAttribute("href")).toBe("https://example.com/p");
    expect(screen.queryByRole("button", { name: /^Save/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open note" }));
    expect(onOpenNote).toHaveBeenCalled();
  });

  it("plays a video in place and does not autoplay under reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
    try {
      const { container } = render(
        <Lightbox
          link={{ ...link, video: { kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" } }}
          src={link.poster}
          origin={null}
          register={() => {}}
          onClose={() => {}}
          at={0}
          count={1}
          onStep={() => {}}
        />,
      );
      expect(container.querySelector("video")?.autoplay).toBe(false);
      expect(screen.getByRole("link", { name: /Open site/i })).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });

  it("autoplays a video when motion is not reduced, and a hostile source stays a picture with Open site", () => {
    const { container, rerender } = render(
      <Lightbox
        link={{ ...link, video: { kind: "file", src: "https://v.redd.it/x/DASH_720.mp4" } }}
        src={link.poster}
        origin={null}
        register={() => {}}
        onClose={() => {}}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    expect(container.querySelector("video")?.autoplay).toBe(true);
    rerender(
      <Lightbox
        link={{ ...link, video: { kind: "youtube", src: "bad id" } }}
        src={link.poster}
        origin={null}
        register={() => {}}
        onClose={() => {}}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    expect(container.querySelector("video, iframe")).toBeNull();
    expect(container.querySelector("img.viewer-poster")?.getAttribute("src")).toBe(link.poster);
    expect(screen.getByRole("link", { name: /Open site/i }).getAttribute("href")).toBe("https://example.com/p");
  });

  it("draws no Open note when it is not handed a way to open one (the note's own viewer)", () => {
    render(
      <Lightbox att={attachment} src="x" origin={null} register={() => {}} onClose={() => {}} downloadUrl={null} at={0} count={1} onStep={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Open note" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open site/i })).toBeNull();
  });
});

/**
 * A picture opens at the size of the screen, not at its own pixels: a wall
 * picture is stored 480px wide, and `max-width` alone only ever shrinks, so it
 * opened as a postage stamp in the middle of a desktop screen (2026-10-09).
 */
describe("a picture fills the screen", () => {
  function sized(el: HTMLElement, props: Record<string, number>) {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(el, key, { configurable: true, value });
    }
  }

  it("draws a small picture as large as the frame allows, its shape kept", () => {
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    const img = document.querySelector<HTMLImageElement>(".lightbox-shot")!;
    const frame = document.querySelector<HTMLElement>(".lightbox-frame")!;
    sized(frame, { clientWidth: 1200, clientHeight: 900 });
    sized(img, { naturalWidth: 480, naturalHeight: 320 });
    fireEvent.load(img);
    // 1200 / 480 = 2.5 and 900 / 320 = 2.81: the width is what stops it.
    expect(img.style.width).toBe("1200px");
    expect(img.style.height).toBe("800px");
  });

  it("leaves a picture it cannot measure to the stylesheet", () => {
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    const img = document.querySelector<HTMLImageElement>(".lightbox-shot")!;
    fireEvent.load(img);
    expect(img.style.width).toBe("");
    expect(img.style.height).toBe("");
  });
});

describe("making a picture the card's", () => {
  it("offers Use as cover on a picture that is not first, and asks the note to move it", () => {
    const onCover = vi.fn();
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={1}
        count={2}
        onStep={() => {}}
        onCover={onCover}
        isCover={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Use as the card's picture" }));
    expect(onCover).toHaveBeenCalledTimes(1);
  });

  it("does not offer it on the picture already first", () => {
    render(
      <Lightbox
        att={attachment}
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={2}
        onStep={() => {}}
        onCover={() => {}}
        isCover
      />,
    );
    expect(screen.queryByRole("button", { name: "Use as the card's picture" })).toBeNull();
  });
});

/**
 * Audit BUG-6 (2026-10-10): on the Inspiration wall's viewer a film plays from
 * a stream address, which cannot be saved from, so Save did nothing. It now
 * fetches the bytes for the save — without keeping them on the device.
 */
describe("Save on a streamed film", () => {
  it("fetches the film for the save and hands it to the browser", async () => {
    passingBytes.mockResolvedValue(new Blob(["film"], { type: "video/mp4" }));
    Object.assign(URL, { createObjectURL: () => "blob:film", revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const film: Attachment = { ...attachment, id: "film-1", name: "holiday.mp4", mime: "video/mp4", path: "u/n/film-1" };
    render(
      <Lightbox
        att={film}
        src="https://example.supabase.co/storage/v1/object/sign/film"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
    const save = screen.getByRole("button", { name: "Save holiday.mp4" });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(passingBytes).toHaveBeenCalledWith(film);
    expect(fetchFile).not.toHaveBeenCalledWith(film);
    click.mockRestore();
  });
});

/**
 * The bar's Copy, Share and Save go through the app's one copy of each
 * (`lib/clipboard.ts`, `lib/share.ts`, `lib/saveFile.ts`). These hold what the
 * viewer did before it gave up its own: the words, what is handed where, and —
 * the one thing that changed — how long a fetched file's address lives.
 */
describe("the viewer's copy, share and save", () => {
  function open(att: Attachment, downloadUrl: string | null = null) {
    return render(
      <Lightbox
        att={att}
        src="blob:photo"
        origin={null}
        register={() => {}}
        onClose={() => {}}
        downloadUrl={downloadUrl}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    for (const key of ["clipboard", "share", "canShare"] as const) {
      Object.defineProperty(navigator, key, { value: undefined, configurable: true });
    }
    Object.defineProperty(globalThis, "ClipboardItem", { value: undefined, configurable: true });
  });

  it("offers neither Copy nor Share where the browser has neither", () => {
    open(attachment);
    expect(screen.queryByRole("button", { name: "Copy picture" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share photo.jpg" })).toBeNull();
  });

  it("copies the picture and says Copied, then offers again", async () => {
    const items: { data: Record<string, Promise<Blob>> }[] = [];
    Object.defineProperty(globalThis, "ClipboardItem", {
      value: class {
        constructor(public readonly data: Record<string, Promise<Blob>>) {}
      },
      configurable: true,
    });
    const write = vi.fn(async (handed: { data: Record<string, Promise<Blob>> }[]) => {
      items.push(...handed);
      // jsdom draws nothing, so the picture's promise refuses; the browser
      // would have read it, and the test reads it so nothing is left hanging.
      void handed[0].data["image/png"].catch(() => {});
    });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
    open(attachment);
    fireEvent.click(screen.getByRole("button", { name: "Copy picture" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(write).toHaveBeenCalledTimes(1);
    expect(Object.keys(items[0].data)).toEqual(["image/png"]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy picture" })).toBeTruthy(), {
      timeout: 3000,
    });
  });

  it("shares the note's own bytes under the file's name", async () => {
    fetchFile.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    open(attachment);
    fireEvent.click(screen.getByRole("button", { name: "Share photo.jpg" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const data = share.mock.calls[0][0];
    expect(data.title).toBe("photo.jpg");
    expect(data.files).toHaveLength(1);
    expect(data.files![0].name).toBe("photo.jpg");
    expect(data.files![0].type).toBe("image/jpeg");
  });

  it("saves from the address it was handed, fetching nothing", () => {
    const seen: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      seen.push({ href: this.href, download: this.download });
    });
    open(attachment, "blob:photo-bytes");
    fireEvent.click(screen.getByRole("button", { name: "Save photo.jpg" }));
    expect(seen).toEqual([{ href: "blob:photo-bytes", download: "photo.jpg" }]);
    expect(passingBytes).not.toHaveBeenCalled();
  });

  /**
   * The viewer gave a fetched file's address back after 8 s, where Settings
   * and the sign-in screen allow a minute — and a save on a slow phone can
   * still be reading it at 8 s. One length now, `OBJECT_URL_TTL_MS`.
   */
  it("keeps a fetched file's address for a minute, not eight seconds", async () => {
    passingBytes.mockResolvedValue(new Blob(["film"], { type: "video/mp4" }));
    Object.assign(URL, { createObjectURL: () => "blob:fetched", revokeObjectURL: () => {} });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const timers = vi.spyOn(window, "setTimeout");
    const film: Attachment = { ...attachment, id: "film-2", name: "trip.mp4", mime: "video/mp4", path: "u/n/film-2" };
    open(film);
    fireEvent.click(screen.getByRole("button", { name: "Save trip.mp4" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const delays = timers.mock.calls.map((call) => call[1]);
    expect(delays).toContain(60_000);
    expect(delays).not.toContain(8000);
  });
});

/**
 * A film the note carries plays in the same box a link's video does
 * (`ViewerFilm` in ViewerVideo.tsx, shared since 2026-10-13). What it says
 * and draws is its own: no Open site to point to, so its words say save it.
 */
describe("a film the note carries", () => {
  const thumb = "data:image/jpeg;base64,AAAA";
  const film: Attachment = { ...attachment, id: "film-3", name: "trip.mp4", mime: "video/mp4", thumb, path: "u/n/film-3" };

  function open(src: string, onClose = () => {}) {
    return render(
      <Lightbox
        att={film}
        src={src}
        origin={null}
        register={() => {}}
        onClose={onClose}
        downloadUrl={null}
        at={0}
        count={1}
        onStep={() => {}}
      />,
    );
  }

  afterEach(() => {
    delete document.documentElement.dataset.motion;
  });

  it("plays from its address with its frame standing, and a click on it does not close the layer", () => {
    const onClose = vi.fn();
    const { container } = open("blob:trip", onClose);
    const box = container.querySelector(".viewer-video")!;
    expect(box.hasAttribute("data-fallback")).toBe(false);
    expect(box.hasAttribute("data-muted")).toBe(false);
    const el = box.querySelector("video")!;
    expect(el.className).toBe("viewer-player");
    expect(el.getAttribute("src")).toBe("blob:trip");
    expect(el.getAttribute("poster")).toBe(thumb);
    expect(el.hasAttribute("controls")).toBe(true);
    expect(el.hasAttribute("playsinline")).toBe(true);
    expect(el.getAttribute("preload")).toBe("metadata");
    expect(el.getAttribute("aria-label")).toBe("trip.mp4");
    expect(el.autoplay).toBe(true);
    // Its own Save is the bar's; the element's menu is left as the browser draws it.
    expect(el.hasAttribute("controlslist")).toBe(false);
    expect(box.querySelector(".viewer-video-note")).toBeNull();
    fireEvent.click(el);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not start by itself under reduced motion", () => {
    document.documentElement.dataset.motion = "reduced";
    const { container } = open("blob:trip");
    expect(container.querySelector("video")!.autoplay).toBe(false);
  });

  it("says save it to watch where this browser will not play it", () => {
    const { container } = open("blob:trip");
    fireEvent.error(container.querySelector("video")!);
    const box = container.querySelector(".viewer-video")!;
    expect(box.hasAttribute("data-fallback")).toBe(true);
    expect(box.querySelector("video")).toBeNull();
    expect(box.querySelector("img.viewer-poster")?.getAttribute("src")).toBe(thumb);
    expect(box.querySelector("img.viewer-poster")?.getAttribute("alt")).toBe("trip.mp4");
    expect(box.querySelector(".viewer-video-note")?.textContent).toBe("Won't play here. Save it to watch.");
  });

  it("stands its frame, and says nothing, while there is no address to play yet", () => {
    for (const src of ["", thumb]) {
      const { container, unmount } = open(src);
      const box = container.querySelector(".viewer-video")!;
      expect(box.querySelector("video"), src).toBeNull();
      expect(box.hasAttribute("data-fallback"), src).toBe(false);
      expect(box.querySelector("img.viewer-poster")?.getAttribute("src"), src).toBe(thumb);
      expect(box.querySelector(".viewer-video-note"), src).toBeNull();
      unmount();
    }
  });
});
