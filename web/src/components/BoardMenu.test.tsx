// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardMenu } from "./BoardMenu";

afterEach(cleanup);

/**
 * A folder's own menu, on its own.
 *
 * The rows themselves are exercised through the app in `Shelf.test.tsx` — the
 * rename, the reorder pair and what they are called on each shelf. What is
 * here is the half that has nothing to do with App: this panel is a layer, and
 * a layer in this app answers the keyboard and the tap outside it. It did
 * neither. Nothing took the focus when it opened, so Escape had nothing to
 * fire at; the app's own Escape listener cannot see this layer either (it
 * early-returns on `coveredOtherThanSearch`, which `boardMenu` is part of);
 * and there was no dismiss scrim, which every sibling panel renders. A menu
 * opened by an accidental long-press could only be undone by finding Cancel.
 */
function open(props: Partial<Parameters<typeof BoardMenu>[0]> = {}) {
  const onCancel = vi.fn();
  const onRename = vi.fn();
  const onSubmitRename = vi.fn();
  render(
    <BoardMenu
      name="Recipes"
      renaming={false}
      onRename={onRename}
      onLook={vi.fn()}
      onSubmitRename={onSubmitRename}
      onDelete={vi.fn()}
      vertical={false}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { onCancel, onRename, onSubmitRename };
}

describe("a folder's menu", () => {
  it("takes the focus on the row that costs nothing, so Escape has somewhere to fire from", () => {
    const { onCancel } = open();

    // Cancel, and Cancel is first for exactly this reason: nothing on a layer
    // should be one stray Enter from a consequence, and Delete is the row
    // under it.
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on a tap outside it, through the app's one dismiss scrim", () => {
    const { onCancel } = open();

    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  /** The rename field carries its own caret and its own Escape; the panel's
   *  focusing effect stands down while that is what is on screen. */
  it("hands the caret to the rename field instead, and still walks away from it", () => {
    const { onCancel } = open({ renaming: true });

    const field = screen.getByLabelText("Board name");
    expect(document.activeElement).toBe(field);

    // The scrim is drawn here too: a rename you did not mean to start is as
    // much a thing to walk away from as the menu that started it.
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("gives the focus back to whatever had it when it opened", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <BoardMenu
        name="Recipes"
        renaming={false}
        onRename={vi.fn()}
        onLook={vi.fn()}
        onSubmitRename={vi.fn()}
        onDelete={vi.fn()}
        vertical={false}
        onCancel={vi.fn()}
      />,
    );
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  /** Review UI-15: it says which board it is about, and Delete is at the far
   *  end from the hand — past the heavier rule — in both of its shapes. */
  it("names the board on its first line", () => {
    open();
    expect(document.querySelector(".selpanel-head .selpanel-title")?.textContent).toBe("Recipes");
  });

  const labels = () =>
    Array.from(document.querySelectorAll(".selpanel-btn")).map((b) => b.textContent);

  it("hangs under the tab on a desktop, read top-down with Delete last past the rule", () => {
    open({ anchor: { left: 120, top: 84 } });
    const panel = document.querySelector<HTMLElement>(".selpanel")!;
    expect(panel.classList.contains("selpanel-under")).toBe(true);
    expect(panel.classList.contains("selpanel-right")).toBe(false);
    expect(panel.style.left).toBe("120px");
    expect(panel.style.top).toBe("84px");
    expect(labels()).toEqual(["Rename", "Look", "Delete"]);
    const del = screen.getByRole("button", { name: "Delete" });
    expect(del.classList.contains("selpanel-split")).toBe(true);
  });

  it("stands in the corner by the thumb otherwise, with Delete furthest from it", () => {
    open();
    const panel = document.querySelector<HTMLElement>(".selpanel")!;
    expect(panel.classList.contains("selpanel-right")).toBe(true);
    expect(labels()).toEqual(["Delete", "Look", "Rename"]);
    expect(screen.getByRole("button", { name: "Look" }).classList.contains("selpanel-split")).toBe(true);
  });
});

describe("the folder's screen switch", () => {
  it("offers to keep the screen on, and says what a tap will do", () => {
    const onToggleAwake = vi.fn();
    open({ awake: false, onToggleAwake });
    fireEvent.click(screen.getByRole("button", { name: "Keep screen on" }));
    expect(onToggleAwake).toHaveBeenCalledTimes(1);
  });

  it("offers to let it sleep again once it is on", () => {
    open({ awake: true, onToggleAwake: vi.fn() });
    expect(screen.getByRole("button", { name: "Let screen sleep" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep screen on" })).toBeNull();
  });

  it("stands beside Look, in both shapes of the menu", () => {
    const labels = () =>
      [...document.querySelectorAll(".selpanel-label")].map((el) => el.textContent);
    open({ onToggleAwake: vi.fn() });
    expect(labels()).toEqual(["Delete", "Look", "Keep screen on", "Rename"]);
    cleanup();
    open({ onToggleAwake: vi.fn(), anchor: { left: 10, top: 10 } });
    expect(labels()).toEqual(["Rename", "Look", "Keep screen on", "Delete"]);
  });
});
