// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNoteDrop } from "./useNoteDrop";

const drag = (over: Partial<DragEvent> & { files?: File[] } = {}) =>
  ({
    dataTransfer: { types: ["Files"], files: over.files ?? [], dropEffect: "none" },
    currentTarget: document.createElement("div"),
    relatedTarget: null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...over,
  }) as never;

describe("a file dragged over the open note", () => {
  it("shows the cue while it is over, and not for a drag that holds no files", () => {
    const { result } = renderHook(() => useNoteDrop(() => {}));
    act(() => result.current.handlers.onDragOver({ ...drag(), dataTransfer: { types: ["text/plain"] } } as never));
    expect(result.current.over).toBe(false);
    act(() => result.current.handlers.onDragOver(drag()));
    expect(result.current.over).toBe(true);
  });

  it("drops the cue when the pointer leaves the sheet, not when it moves between its parts", () => {
    const { result } = renderHook(() => useNoteDrop(() => {}));
    act(() => result.current.handlers.onDragOver(drag()));
    const sheet = document.createElement("div");
    const child = document.createElement("span");
    sheet.append(child);
    act(() => result.current.handlers.onDragLeave(drag({ currentTarget: sheet, relatedTarget: child } as never)));
    expect(result.current.over).toBe(true);
    act(() => result.current.handlers.onDragLeave(drag({ currentTarget: sheet, relatedTarget: null } as never)));
    expect(result.current.over).toBe(false);
  });

  it("attaches the dropped files, ends the cue and keeps the drop from the window", () => {
    const onFiles = vi.fn();
    const { result } = renderHook(() => useNoteDrop(onFiles));
    act(() => result.current.handlers.onDragOver(drag()));
    const file = new File(["x"], "a.png", { type: "image/png" });
    const e = drag({ files: [file] });
    act(() => result.current.handlers.onDrop(e));
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(result.current.over).toBe(false);
    expect((e as unknown as { stopPropagation: () => void }).stopPropagation).toHaveBeenCalled();
  });
});
