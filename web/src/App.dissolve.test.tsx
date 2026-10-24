// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor, cleanup, configure } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setMeta, writeCaptureDraft } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/*
 * Every find and wait in this file gets ten seconds, and a test forty, because
 * this file was seen failing only inside the whole suite, where the machine is
 * busy and a find that takes 100 ms alone takes seconds. A longer wait costs
 * nothing when the thing arrives, and a failing test still fails — later.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 40_000 });

/*
 * A file of its own, for one test, and the reason is the store.
 *
 * `App.test.tsx` runs its seventy tests against a single IndexedDB, which is
 * what makes it quick — nobody after the first pays the seed. The price is
 * that anything a test leaves behind is inherited, and this test cannot help
 * leaving a folder behind: a folder is the thing it is about. That folder is
 * enough to break a test eleven hundred lines further down, because the Move
 * chooser once listed only the first six boards and one more board pushed
 * that test's own board off the end of the list (it scrolls now, review
 * UX-A-06, and the file stays separate for the store's sake).
 *
 * Cleaning up after itself was the other option. It was rejected: it would
 * mean this test finishing with a board deletion it does not care about, and
 * a future reader could not tell which half was the point. A separate file
 * gets a fresh database, costs one seed, and cannot reach anybody.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await writeCaptureDraft("");
});

/** The strip is the shelf at jsdom's default 1024 — one click, nothing to open. */
async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

/** One tap and a name, from the "+" tab at the end of the strip. */
async function makeBoard(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  return await screen.findByRole("tab", { name: new RegExp(name, "i") });
}

/** Which board the strip says you are standing on. */
const boardName = () =>
  document.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "";

/**
 * A selection puts nothing on screen but the selection; its verbs are behind
 * the capture bar's burger, which carries the count while anything is picked.
 * Every test below that acts on a selection taps it first.
 */
function openSelection() {
  fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
}

describe("dissolving an idea", () => {
  /**
   * Dissolving an idea has to put its sources back where they were standing
   * when it swallowed them — which for a note that was filed is a folder, not
   * the board the idea itself happened to be on. Nothing about the mechanism
   * moves a source between boards (`board_id` is untouched from merge through
   * to dissolve), but "untouched" is exactly the kind of claim that is true
   * until someone adds a field to one of the three `update` calls in the
   * chain, so it is pinned here rather than reasoned about again.
   *
   * The sources also have to come back *active*. They are archived into the
   * idea, and an idea that dissolved into an archive would be a one-way door
   * wearing an undo button.
   */
  it("dissolves an idea and returns its notes, active, to the folder they came from", async () => {
    render(<App />);
    // The generous wait is for this test run alone, where it pays the seed
    // rather than inheriting it from the test before.
    await waitFor(
      () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
      { timeout: 10_000 },
    );

    const cards = () => Array.from(document.querySelectorAll<HTMLElement>(".card"));

    // A folder of this test's own, so nothing another test filed can be
    // mistaken for a returned source.
    fireEvent.click(await makeBoard("Returned"));
    await waitFor(() => expect(boardName()).toMatch(/Returned/i));

    // Two notes written while standing in it, which is what files them there.
    for (const words of ["a returning note", "another returning note"]) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await screen.findByRole("button", { name: new RegExp(words, "i") });
    }
    await waitFor(() => expect(cards().length).toBe(2));
    const srcIds = cards().map((c) => c.dataset.id!);

    // Merge them. The idea lands unfiled (lib/merge.ts) — so it is not in
    // this folder, and the sources leaving the folder is visible as an empty
    // board rather than inferred.
    fireEvent.contextMenu(cards()[0]);
    await waitFor(() => expect(screen.getByText(/1 selected/)).toBeTruthy());
    fireEvent.click(cards()[1]);
    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeTruthy());
    openSelection();
    fireEvent.click(screen.getByRole("button", { name: /merge 2/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Idea canvas" })).toBeTruthy());

    // Dissolve lives in the canvas's own right-click menu, on the surface
    // rather than on a note. It asks first, and the answer is the dialog's
    // own button, not the row that raised it.
    fireEvent.contextMenu(document.querySelector<HTMLElement>(".canvas-surface")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /dissolve idea/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Dissolve" }));

    // The canvas closes itself, and both notes are standing in the folder
    // again — active, on the board they were filed into, with the idea gone
    // from it.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Idea canvas" })).toBeNull());
    await goToBoard(/Returned/i);
    await waitFor(() => {
      const back = cards().map((c) => c.dataset.id);
      for (const id of srcIds) expect(back).toContain(id);
    });
    expect(cards()).toHaveLength(2);
    expect(screen.getByRole("button", { name: /a returning note/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /another returning note/i })).toBeTruthy();

  });
});
