// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * A file of its own for the reason `App.dissolve.test.tsx` gives: the test is
 * about a folder, a folder is left behind, and `App.test.tsx` shares one store
 * across seventy tests whose Move chooser counts the folders it can list.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

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

describe("un-merging an idea", () => {
  /**
   * SPEC §7 always said un-merge was "trivially possible"; this is it being
   * offered. The sources come back active, into the folder they were filed in
   * when they were merged — merge never touches `board_id` — and the idea goes
   * to the **archive**, not the trash: it may hold words written after the
   * merge. One undo puts the whole merge back.
   */
  it("puts the notes back where they were, archives the idea, and undoes whole", async () => {
    render(<App />);
    await waitFor(() => expect(cards().length).toBeGreaterThan(0), { timeout: 10_000 });

    fireEvent.click(await makeBoard("Unmerged"));
    await waitFor(() => expect(boardName()).toMatch(/Unmerged/i));

    for (const words of ["first unmerge note", "second unmerge note"]) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await screen.findByRole("button", { name: new RegExp(words, "i") });
    }
    await waitFor(() => expect(cards().length).toBe(2));
    const srcIds = cards().map((c) => c.dataset.id!);

    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(cards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
    // The canvas is a lazy chunk, and under a whole-suite run its first load
    // outlasts waitFor's one-second default — so this waits the way App.test does.
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy(), {
      timeout: 10_000,
    });

    // The canvas's own menu, beside Dissolve. It asks nothing: nothing is
    // thrown away, and the undo is right there.
    fireEvent.contextMenu(document.querySelector<HTMLElement>(".canvas-surface")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^un-merge$/i }));
    expect(screen.queryByRole("button", { name: "Dissolve" })).toBeNull();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
    await goToBoard(/Unmerged/i);
    await waitFor(() => {
      const back = cards().map((c) => c.dataset.id);
      for (const id of srcIds) expect(back).toContain(id);
    });
    expect(cards()).toHaveLength(2);

    // The idea is in the archive, as the plain note its composed text is —
    // no longer a canvas, so it draws its words rather than a picture of
    // notes that are now back on the board.
    await goToBoard(/Archive/i);
    await waitFor(() =>
      expect(
        cards().some(
          (c) =>
            /first unmerge note/i.test(c.textContent ?? "") &&
            /second unmerge note/i.test(c.textContent ?? ""),
        ),
      ).toBe(true),
    );

    // One undo, and the merge stands again: the sources leave the folder for
    // the idea they were in, which was filed there with them.
    fireEvent.click(screen.getByRole("button", { name: /^Undo: Un-merged into 2/ }));
    await goToBoard(/Unmerged/i);
    await waitFor(() => expect(cards()).toHaveLength(1));
    for (const id of srcIds) expect(cards()[0].dataset.id).not.toBe(id);
  });
});
