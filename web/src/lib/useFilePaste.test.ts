// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFilePaste } from "./useFilePaste";

/**
 * A paste carrying a file is a capture. The hook's whole job is deciding which
 * pastes those are — it knows nothing about notes, exactly as `useFileDrop`
 * knows nothing about them.
 */
function paste(files: File[]): Event {
  // jsdom's ClipboardEvent takes no clipboardData, so it is hung on afterwards.
  // Cancelable, or `preventDefault` would be a no-op and the test would be
  // asserting against a browser that does not exist.
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { files } });
  return e;
}

const shot = () => new File(["x"], "shot.png", { type: "image/png" });

describe("useFilePaste", () => {
  it("takes the files off the clipboard and keeps the browser out of it", () => {
    const took = vi.fn();
    renderHook(() => useFilePaste(took));

    const file = shot();
    const e = paste([file]);
    window.dispatchEvent(e);

    expect(took).toHaveBeenCalledWith([file]);
    expect(e.defaultPrevented).toBe(true);
  });

  /** Pasted text is the browser's own business and must arrive untouched. */
  it("does nothing whatever to a paste carrying no files", () => {
    const took = vi.fn();
    renderHook(() => useFilePaste(took));

    const e = paste([]);
    window.dispatchEvent(e);

    expect(took).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  /**
   * The capture bar and the open note both take their own paste on the way up
   * to here. Without this, a screenshot pasted into an open note would attach
   * to that note *and* land as a second note on the board.
   */
  it("stands aside for anything that already took the paste", () => {
    const took = vi.fn();
    renderHook(() => useFilePaste(took));

    const e = paste([shot()]);
    e.preventDefault();
    window.dispatchEvent(e);

    expect(took).not.toHaveBeenCalled();
  });

  it("stops listening once it is gone", () => {
    const took = vi.fn();
    const { unmount } = renderHook(() => useFilePaste(took));
    unmount();

    window.dispatchEvent(paste([shot()]));
    expect(took).not.toHaveBeenCalled();
  });
});
