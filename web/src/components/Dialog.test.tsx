// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Dialog } from "./Dialog";

afterEach(cleanup);

function renderDialog(destructive = false) {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        {open && (
          <Dialog
            title="Confirm"
            message="A decision"
            confirmLabel="Confirm"
            destructive={destructive}
            onConfirm={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        )}
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Open dialog" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("Dialog", () => {
  // bughunt 2026-10-15: a press on the backdrop took the focus to the page,
  // and Escape, heard only inside the question, then did nothing.
  it("keeps the focus in the question when the backdrop is pressed", () => {
    renderDialog();
    const scrim = document.querySelector(".dialog-scrim")!;
    expect(fireEvent.mouseDown(scrim)).toBe(false);
    // A press inside the question is its own business.
    expect(fireEvent.mouseDown(screen.getByRole("dialog"))).toBe(true);
  });

  it("moves focus inside, contains Tab, and restores the trigger", () => {
    const opener = renderDialog();
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close" });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(dialog.isConnected).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  /**
   * Escape is Cancel on a destructive dialog too.
   *
   * This test used to assert the opposite — that the key was swallowed and
   * nothing happened — and that was the bug written down as a rule. A dialog
   * that stops a key has answered it, and "nothing happened" is not an answer
   * anybody can tell apart from a broken keyboard. Walking away from a
   * destructive question destroys nothing, which is exactly what Cancel does,
   * and Cancel is already the button the focus is standing on.
   */
  it("takes Escape as Cancel, destructive or not", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Dialog
        title="Delete"
        message="Cannot undo"
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    // And nothing was destroyed on the way out.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * `onDismiss` is the one dialog whose two buttons are both answers, where
   * walking away has to be able to mean "neither yet". Escape has to reach it
   * on a destructive dialog as well, which is the case the old branch made
   * unreachable.
   */
  it("prefers onDismiss where the dialog has one", () => {
    const onDismiss = vi.fn();
    const onCancel = vi.fn();
    render(
      <Dialog
        title="Old notes"
        message="Bring them in?"
        confirmLabel="Bring them in"
        cancelLabel="Leave them"
        destructive
        onConfirm={() => {}}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
