// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFileDrop } from "./useFileDrop";

/**
 * jsdom has no DragEvent, so a plain cancelable Event carries a stand-in
 * dataTransfer. Only what the hook reads is on it.
 */
function drag(type: string, files: File[] = []): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } });
  return e;
}

const shot = () => new File(["x"], "shot.png", { type: "image/png" });

describe("useFileDrop", () => {
  it("lights the invitation while a file is over the window, and takes the drop", () => {
    const took = vi.fn();
    const { result } = renderHook(() => useFileDrop(took));
    act(() => void window.dispatchEvent(drag("dragover")));
    expect(result.current).toBe(true);

    const file = shot();
    act(() => void window.dispatchEvent(drag("drop", [file])));
    expect(result.current).toBe(false);
    expect(took).toHaveBeenCalledWith([file]);
  });

  it("puts the invitation out when something on the way up took the drop itself", () => {
    // An open note's drop, and a picture dropped on an idea's canvas, call
    // preventDefault before the window hears it. The file is theirs, but the
    // board's "Drop to keep" was lit by the dragover and has to go out.
    const took = vi.fn();
    const { result } = renderHook(() => useFileDrop(took));
    act(() => void window.dispatchEvent(drag("dragover")));
    expect(result.current).toBe(true);

    const e = drag("drop", [shot()]);
    e.preventDefault();
    act(() => void window.dispatchEvent(e));
    expect(result.current).toBe(false);
    expect(took).not.toHaveBeenCalled();
  });
});
