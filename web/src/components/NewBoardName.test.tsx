// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewBoardName } from "./NewBoardName";

afterEach(cleanup);

function field(props: Partial<Parameters<typeof NewBoardName>[0]> = {}) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  render(
    <NewBoardName value="" max={40} onChange={vi.fn()} onCreate={onCreate} onCancel={onCancel} {...props} />,
  );
  return { input: screen.getByLabelText("New board name"), onCreate, onCancel };
}

describe("the new-board name field", () => {
  it("creates on Enter, cancels on Escape and on blur, and never creates on blur", () => {
    const { input, onCreate, onCancel } = field({ value: "Kitchen" });
    fireEvent.blur(input);
    expect(onCreate).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledWith("Kitchen");
  });

  it("does not create on the Enter that picks a word in an input method", () => {
    const { input, onCreate } = field({ value: "東京" });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("does nothing on Enter with no name, or closes when asked to", () => {
    const kept = field({ value: "  " });
    fireEvent.keyDown(kept.input, { key: "Enter" });
    expect(kept.onCreate).not.toHaveBeenCalled();
    expect(kept.onCancel).not.toHaveBeenCalled();
    cleanup();
    const closed = field({ value: "", cancelIfEmpty: true });
    fireEvent.keyDown(closed.input, { key: "Enter" });
    expect(closed.onCreate).not.toHaveBeenCalled();
    expect(closed.onCancel).toHaveBeenCalledTimes(1);
  });

  // The strip's field had no such guard until it shared this one: a create
  // that moves the focus blurs the field while the Enter is still running,
  // and that blur must not cancel the name just taken.
  it("ignores the blur a create causes while it is still running", () => {
    const onCancel = vi.fn();
    const onCreate = vi.fn(() => (document.activeElement as HTMLElement | null)?.blur());
    render(
      <NewBoardName value="Kitchen" max={40} onChange={vi.fn()} onCreate={onCreate} onCancel={onCancel} />,
    );
    const input = screen.getByLabelText("New board name");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
