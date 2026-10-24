// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Taking one note back out of an idea, on the app's side. `CanvasSheet.test.tsx`
 * shows the menu row calls `onRelease`; this pins what the app then does: the
 * note is active on its board again and the other one stays in the idea.
 * A file of its own for the reason `App.dissolve.test.tsx` gives — it leaves a
 * folder behind.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") });
}

const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

describe("taking a note out of an idea", () => {
  it("puts it back on its board, and the other note stays in the idea", async () => {
    render(<App />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });

    fireEvent.click(await makeBoard("Released"));
    await waitFor(() => expect(boardName()).toMatch(/Released/i));

    for (const words of ["first release note", "second release note"]) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await screen.findByRole("button", { name: new RegExp(words, "i") });
    }
    await waitFor(() => expect(cards().length).toBe(2));
    const secondId = cards().find((c) => /second release note/i.test(c.textContent ?? ""))!.dataset.id;

    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(cards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
    const canvas = await screen.findByRole("dialog", { name: "Idea canvas" }, { timeout: 10_000 });

    const first = within(canvas).getByRole("button", { name: /open note: first release note/i });
    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });
    const menu = within(document.querySelector<HTMLElement>(".ctx-menu")!);
    fireEvent.click(menu.getByRole("menuitem", { name: /take out of idea/i }));

    // The undo strip names what happened, and the note is no longer on the
    // canvas.
    expect(await screen.findByRole("button", { name: /^Undo: Took 1 out/ })).toBeTruthy();
    await waitFor(() =>
      expect(within(canvas).queryByRole("button", { name: /open note: first release note/i })).toBeNull(),
    );

    fireEvent.click(within(canvas).getByRole("button", { name: /^(back|close)/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
    // Back on its board, active; the other one is still inside the idea, which
    // is filed on the same board (both its notes were) and has no card of its own.
    await waitFor(() =>
      expect(cards().some((c) => /first release note/i.test(c.textContent ?? ""))).toBe(true),
    );
    expect(cards().some((c) => c.dataset.id === secondId)).toBe(false);
  });
});
