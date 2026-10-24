// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canCopyPicture, COPIED_MS, copyPicture, copyText, joinNotes, useCopied, useCopiedWith } from "./clipboard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function giveClipboard(writeText: (t: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

describe("copyText", () => {
  it("writes the text and says so", async () => {
    const writeText = vi.fn(async () => {});
    giveClipboard(writeText);
    expect(await copyText("hei")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hei");
  });

  /**
   * A refused write is the browser's answer, not a fault in the note. The
   * button is told, and shows nothing — it never crashes the open note.
   */
  it("answers false when the write is refused, and never throws", async () => {
    giveClipboard(async () => {
      throw new Error("not focused");
    });
    expect(await copyText("hei")).toBe(false);
  });

  it("answers false where there is no clipboard at all", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    expect(await copyText("hei")).toBe(false);
  });
});

describe("joinNotes", () => {
  /**
   * The notes as they are, one blank line apart — no bullet, no rule, no
   * heading invented for the paste. And an empty body is skipped rather than
   * left as a stray blank paragraph: a picture-only note has nothing to say
   * in text, so it says nothing.
   */
  it("joins bodies with one blank line and skips the wordless", () => {
    expect(joinNotes(["one", "", "  ", "two\nlines", "three"])).toBe(
      "one\n\ntwo\nlines\n\nthree",
    );
  });

  it("is the body itself for a single note", () => {
    expect(joinNotes(["only this"])).toBe("only this");
  });
});

describe("useCopied", () => {
  it("says copied for a moment, then goes back to offering", async () => {
    vi.useFakeTimers();
    giveClipboard(async () => {});
    const { result } = renderHook(() => useCopied());
    expect(result.current[0]).toBe(false);

    await act(async () => {
      await result.current[1]("hei");
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      vi.advanceTimersByTime(COPIED_MS - 1);
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe(false);
  });

  it("stays quiet when the write did not happen", async () => {
    giveClipboard(async () => {
      throw new Error("no");
    });
    const { result } = renderHook(() => useCopied());
    let ok = true;
    await act(async () => {
      ok = await result.current[1]("hei");
    });
    expect(ok).toBe(false);
    expect(result.current[0]).toBe(false);
  });
});

/**
 * A picture goes on the clipboard as a PNG handed over as a promise — which
 * is what lets Safari keep the tap's permission while it is drawn. The viewer
 * used to do this with its own flag and its own timer; it is `useCopiedWith`
 * now, beside the text copy, so the two can never say "Copied" for different
 * lengths.
 */
describe("copyPicture", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "ClipboardItem", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  });

  class FakeItem {
    constructor(public readonly data: Record<string, Promise<Blob>>) {}
  }

  function giveWrite(write: (items: FakeItem[]) => Promise<void>) {
    Object.defineProperty(globalThis, "ClipboardItem", { value: FakeItem, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { write }, configurable: true });
  }

  it("is not offered where the browser cannot hold a picture", async () => {
    expect(canCopyPicture()).toBe(false);
    expect(await copyPicture(Promise.resolve(new Blob(["x"])))).toBe(false);
  });

  it("writes the drawn PNG and says so", async () => {
    const png = new Blob(["x"], { type: "image/png" });
    let got: Blob | null = null;
    giveWrite(async (items) => {
      got = await items[0].data["image/png"];
    });
    expect(canCopyPicture()).toBe(true);
    expect(await copyPicture(Promise.resolve(png))).toBe(true);
    expect(got).toBe(png);
  });

  /** Safari keeps the tap's permission only if the write starts before the
   *  picture is drawn — so `write` must be called with the drawing still a
   *  promise, not after waiting for it. */
  it("starts the write before the picture has finished drawing", async () => {
    let finish: (b: Blob) => void = () => {};
    const drawing = new Promise<Blob | null>((r) => (finish = r));
    let calledWhileDrawing = false;
    let drawn = false;
    void drawing.then(() => (drawn = true));
    giveWrite(async (items) => {
      calledWhileDrawing = !drawn;
      await items[0].data["image/png"];
    });
    const copying = copyPicture(drawing);
    await Promise.resolve();
    expect(calledWhileDrawing).toBe(true);
    finish(new Blob(["x"], { type: "image/png" }));
    expect(await copying).toBe(true);
  });

  it("answers false when nothing could be drawn, and never throws", async () => {
    giveWrite(async (items) => {
      await items[0].data["image/png"];
    });
    expect(await copyPicture(Promise.resolve(null))).toBe(false);
  });

  it("flashes Copied for COPIED_MS through the same hook the text copy uses", async () => {
    vi.useFakeTimers();
    giveWrite(async () => {});
    const { result } = renderHook(() => useCopiedWith(copyPicture));
    await act(async () => {
      expect(await result.current[1](Promise.resolve(new Blob(["x"])))).toBe(true);
    });
    expect(result.current[0]).toBe(true);
    act(() => {
      vi.advanceTimersByTime(COPIED_MS);
    });
    expect(result.current[0]).toBe(false);
  });
});
