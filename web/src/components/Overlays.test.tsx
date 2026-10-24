// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Overlays } from "./Overlays";

afterEach(cleanup);

/**
 * The wiring, pinned.
 *
 * These four dialogs came out of `App.tsx` as a pure extraction, and the whole
 * suite passing said nothing about whether they came out correctly: not one of
 * them had end-to-end coverage, so every handler could have been transposed and
 * 632 tests would still have gone green. Three of the four are the confirmation
 * in front of an irreversible or wide-reaching action — permanent deletion,
 * dissolving an idea, deleting a folder — which makes "no test noticed" the
 * wrong place to leave it.
 *
 * So what is checked here is not that a dialog appears. It is that each button
 * reaches its own handler *and no other*, which is the failure a transposition
 * actually produces: Delete deleting the wrong thing, quietly, once.
 */
describe("Overlays", () => {
  /** Every handler, so any accidental crossing shows up as a stray call. */
  function handlers() {
    return {
      onCloseFileNotice: vi.fn(),
      onConfirmDissolve: vi.fn(),
      onCancelDissolve: vi.fn(),
      onConfirmDeleteBoard: vi.fn(),
      onCancelDeleteBoard: vi.fn(),
      onConfirmDestroy: vi.fn(),
      onCancelDestroy: vi.fn(),
      onSortBacklog: vi.fn(),
      onLeaveBacklog: vi.fn(),
      onDismissBacklog: vi.fn(),
    };
  }

  const nothingAsked = {
    fileNotice: null,
    dissolveRequest: null,
    deleteBoardRequest: null,
    destroyRequest: null,
    synced: true,
    backlogRequest: null,
  };

  /** Asserts exactly one handler fired, and says which one if not. */
  function onlyCalled(all: ReturnType<typeof handlers>, name: keyof ReturnType<typeof handlers>) {
    for (const [key, fn] of Object.entries(all)) {
      expect(fn, `${key} should ${key === name ? "" : "not "}have fired`).toHaveBeenCalledTimes(
        key === name ? 1 : 0,
      );
    }
  }

  it("asks nothing when nothing is being asked", () => {
    const { container } = render(<Overlays {...nothingAsked} {...handlers()} />);
    expect(container.querySelectorAll(".dialog")).toHaveLength(0);
  });

  it("closes the file notice from either exit, and touches nothing else", () => {
    // The notice is the one dialog with no second choice — it is telling you
    // something, not asking. So it carries no cancel button, and both the
    // confirm and the header ✕ have to land on the same handler; a transposed
    // ✕ would leave a modal with no way out.
    const confirm = handlers();
    const { container } = render(
      <Overlays
        {...nothingAsked}
        fileNotice={{ title: "Too big", message: "That file is over the limit." }}
        {...confirm}
      />,
    );
    expect(screen.getByRole("heading", { name: "Too big" })).toBeTruthy();
    expect(container.querySelector(".dialog-actions .btn:not(.dialog-confirm)")).toBeNull();
    fireEvent.click(container.querySelector<HTMLButtonElement>(".dialog-confirm")!);
    onlyCalled(confirm, "onCloseFileNotice");

    cleanup();
    const dismiss = handlers();
    const second = render(
      <Overlays
        {...nothingAsked}
        fileNotice={{ title: "Too big", message: "That file is over the limit." }}
        {...dismiss}
      />,
    );
    fireEvent.click(second.container.querySelector<HTMLButtonElement>(".dialog-close")!);
    onlyCalled(dismiss, "onCloseFileNotice");
  });

  it("dissolves only on Dissolve, and cancels only on Cancel", () => {
    const confirm = handlers();
    render(<Overlays {...nothingAsked} dissolveRequest="idea-1" {...confirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Dissolve" }));
    onlyCalled(confirm, "onConfirmDissolve");

    cleanup();
    const cancel = handlers();
    render(<Overlays {...nothingAsked} dissolveRequest="idea-1" {...cancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    onlyCalled(cancel, "onCancelDissolve");
  });

  it("names the board it is asking about, and deletes only on Delete", () => {
    const confirm = handlers();
    render(
      <Overlays {...nothingAsked} deleteBoardRequest={{ id: "b1", name: "Recipes" }} {...confirm} />,
    );
    // The name is the whole reason this dialog is not generic — deleting the
    // wrong folder archives every note in it.
    expect(screen.getByRole("heading", { name: /Recipes/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    onlyCalled(confirm, "onConfirmDeleteBoard");

    cleanup();
    const cancel = handlers();
    render(
      <Overlays {...nothingAsked} deleteBoardRequest={{ id: "b1", name: "Recipes" }} {...cancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    onlyCalled(cancel, "onCancelDeleteBoard");
  });

  it("destroys only on the destructive confirm, and says what it is destroying", () => {
    const fns = handlers();
    render(
      <Overlays {...nothingAsked} destroyRequest={{ ids: ["a", "b"], what: "2 notes" }} {...fns} />,
    );
    // alertdialog rather than dialog, and the count in the sentence: both are
    // the difference between this and an ordinary confirmation.
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/deletes 2 notes for good/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    onlyCalled(fns, "onConfirmDestroy");
  });

  /** Only a device that syncs has a server to delete from (review CD-03). */
  it("mentions the server only when there is one", () => {
    const what = { ids: ["a", "b"], what: "both notes in the trash" };
    render(<Overlays {...nothingAsked} destroyRequest={what} {...handlers()} />);
    expect(screen.getByText(/here and on the server/)).toBeTruthy();
    cleanup();
    render(<Overlays {...nothingAsked} synced={false} destroyRequest={what} {...handlers()} />);
    expect(screen.getByText("This deletes both notes in the trash for good. It cannot be undone.")).toBeTruthy();
    expect(screen.queryByText(/server/)).toBeNull();
  });

  it("keeps two open questions on separate handlers", () => {
    // dismissTopDialog answers destructive-first, so both can be on screen at
    // once. Answering the one on top must not also answer the one beneath.
    const fns = handlers();
    render(
      <Overlays
        {...nothingAsked}
        fileNotice={{ title: "Too big", message: "over the limit" }}
        destroyRequest={{ ids: ["a"], what: "1 note" }}
        {...fns}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    onlyCalled(fns, "onConfirmDestroy");
  });
});
