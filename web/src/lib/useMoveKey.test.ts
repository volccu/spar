// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useMoveKey } from "./useMoveKey";

function rig(selected: string[]) {
  const o = {
    setSelected: vi.fn(),
    setMoving: vi.fn(),
    setMoveError: vi.fn(),
    setMenuOpen: vi.fn(),
  };
  const view = renderHook((props: { selected: string[] }) => useMoveKey({ ...o, selected: props.selected }), {
    initialProps: { selected },
  });
  return { ...view, ...o };
}

describe("Escape on a chooser opened by M", () => {
  it("drops the one card M picked, and the panel with it", () => {
    const { result, rerender, setSelected, setMoving, setMenuOpen } = rig([]);
    act(() => result.current.open("a"));
    expect(setSelected).toHaveBeenCalledWith(["a"]);
    rerender({ selected: ["a"] });
    let up = true;
    act(() => {
      up = result.current.cancel();
    });
    expect(up).toBe(false);
    expect(setSelected).toHaveBeenLastCalledWith([]);
    expect(setMoving).toHaveBeenLastCalledWith(false);
    expect(setMenuOpen).toHaveBeenLastCalledWith(false);
  });

  it("only closes the chooser when the selection was the user's own", () => {
    const { result, setSelected, setMoving } = rig(["a", "b"]);
    act(() => result.current.open(null));
    let up = false;
    act(() => {
      up = result.current.cancel();
    });
    expect(up).toBe(true);
    expect(setSelected).not.toHaveBeenCalled();
    expect(setMoving).toHaveBeenLastCalledWith(false);
  });
});
