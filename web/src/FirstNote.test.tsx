// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { markSeeded, setMeta } from "./store/db";
import { INBOX_ALL } from "./lib/boards";

/**
 * The one screen nobody who works on this app ever sees: the app with nothing
 * in it.
 *
 * Every other app-level test starts from the seeded archive, which is the
 * right default — it is what the owner's device holds — and it is why this
 * state went wrong quietly. An empty Inbox says "Everything is filed", which
 * is the reward for sorting a pile down to nothing, and it was also the first
 * sentence the app said to somebody who had never written a note: a
 * congratulation for work not done, about notes that do not exist.
 *
 * A file of its own for the reason `FirstOpen.test.tsx` is: it needs a store
 * that stays empty, and a database shared with seventy other tests cannot
 * offer one. `markSeeded` before the first render is what an already-answered
 * new account looks like — nothing to seed, and nothing seeded.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
  await markSeeded();
});

/**
 * The empty state, and never the spinner that precedes it. `.empty` alone
 * matches "Loading" too, which is present for a frame and says nothing — a
 * `waitFor` on that resolves before the board has decided anything, and every
 * assertion below would then be made against the wrong element and pass by
 * examining a spinner.
 */
const empty = () => document.querySelector<HTMLElement>(".empty:not(.empty-loading)");

describe("an app nothing has been written into yet", () => {
  it("does not tell a new user they are finished", async () => {
    render(<App />);
    const state = await waitFor(() => {
      const found = empty();
      expect(found?.textContent).toBeTruthy();
      return found!;
    });
    expect(document.querySelectorAll(".card[data-id]")).toHaveLength(0);
    expect(state.textContent).not.toMatch(/Everything is filed/);
    expect(state.textContent).not.toMatch(/Nothing to tidy/);
  });

  /** Where a first note goes, said once, in the words the empty state already
   *  had — heading, one line under it, and the sleeping mascot above both
   *  (DESIGN §11). It is not a welcome screen and must not grow into one. */
  it("says where a first note lands, and nothing else", async () => {
    render(<App />);
    const state = await waitFor(() => {
      const found = empty();
      expect(found?.textContent).toBeTruthy();
      return found!;
    });
    expect(state.querySelector("strong")?.textContent).toBe("Inbox");
    expect(state.textContent).toMatch(/bar below/);
    expect(state.querySelector("spar-mascot")).toBeTruthy();
    expect(state.textContent).not.toMatch(/[!]/);
  });

  /** And it is gone the moment it stops being true. */
  it("hands the board over to the first note", async () => {
    render(<App />);
    await waitFor(() => expect(empty()).toBeTruthy());
    // The creature is asleep on the board, so the header's is away.
    const header = document.querySelector(".topbar spar-mascot")!;
    await waitFor(() => expect(header.hasAttribute("away")).toBe(true));

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "the first thing I ever wrote here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await screen.findByRole("button", { name: /the first thing I ever wrote here/i });
    expect(empty()).toBeNull();
    // And with the board full it goes home — the same node it always was.
    await waitFor(() => expect(header.hasAttribute("away")).toBe(false));
    expect(document.querySelector(".topbar spar-mascot")).toBe(header);
  });
});
