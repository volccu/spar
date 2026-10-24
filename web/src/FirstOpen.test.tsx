// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { setMeta } from "./store/db";

/**
 * The first-open question, in its own file for one plain reason: every other
 * app-level test starts *past* it (they store the answer in `beforeEach`), and
 * these are the only ones that must start before it. A file of its own also
 * means a fake IndexedDB of its own, so "the Inbox reaches zero" is a real
 * assertion here rather than one that depends on whichever notes an earlier
 * test in the same file happened to capture a moment ago.
 */

afterEach(cleanup);

beforeEach(() => localStorage.setItem("spar.deviceOnly", "1"));

/** At jsdom's default width the shelf is the tab strip, so a board is one
 *  click away with nothing to open first. */
async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

/**
 * The one question this change has to ask.
 *
 * 237 of the 241 imported notes have never been filed, so the Inbox opens at
 * 237 on the morning this ships — a bill, not a landing page. Neither answer
 * moves, archives or deletes a note: both decide only what the Inbox shows,
 * and either can be changed afterwards from the menu.
 */
describe("the first-open question", () => {
  beforeEach(async () => {
    // Unanswered, which is the state a device is in the first time it opens
    // after the Inbox arrives.
    await setMeta("inboxSince", null);
  });

  const question = () => screen.queryByRole("dialog", { name: /never been filed/i });

  /**
   * How many notes are archived and how many are in the trash, read off the
   * strip's own tabs. The header used to state the archive's size ("M kept")
   * and this test read it there; the header now says only the board's count,
   * so the promise is checked at the two places a moved note would land.
   */
  const put = () => {
    const n = (sel: string) =>
      Number(document.querySelector(sel)?.textContent?.match(/(\d+)/)?.[1] ?? NaN);
    return { archived: n("#board-tab-archive .tab-n"), trashed: n("#board-tab-trash .tab-n") };
  };

  it("asks once, quoting the number, and leaves every note where it is", async () => {
    render(<App />);
    const asked = await waitFor(() => {
      const found = question();
      expect(found).toBeTruthy();
      return found!;
    });
    const before = document.querySelectorAll(".card[data-id]").length;
    expect(asked.textContent).toMatch(new RegExp(`${before} notes have never been filed`));
    // Where a note would go if the answer moved one: the archive and the
    // trash. This is what "neither answer moves a note" actually means.
    const before2 = put();
    // Read, not merely matched: `toBe` compares NaN to NaN as equal, so a
    // tab that stopped carrying a count would make the assertion below pass
    // by saying nothing at all.
    expect(Number.isNaN(before2.archived)).toBe(false);
    expect(Number.isNaN(before2.trashed)).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "Leave them" }, { timeout: 5000 }));
    await waitFor(() => expect(question()).toBeNull());

    // The Inbox starts empty — and the notes are untouched: All still has
    // every one of them, which is the promise the question makes, and the
    // dialog names that board by its own name.
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(0));
    expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy();
    await goToBoard(/^all/i);
    // At least the Inbox's own pile, and possibly more. This used to assert
    // the two were *equal*, which held only while "active and never filed"
    // and "active" described the same notes — and stopped holding the day a
    // to-do left the Inbox for the Todos board (`isTodoNote`, lib/boards.ts):
    // All still holds those, correctly, so the equality broke while nothing
    // was actually wrong. All is the widest lens there is; it can never hold
    // fewer than a board inside it.
    await waitFor(() =>
      expect(document.querySelectorAll(".card[data-id]").length).toBeGreaterThanOrEqual(before),
    );
    // And the real promise: nothing was archived, trashed or otherwise moved
    // by answering. The two tabs count exactly what they counted before the
    // question was answered.
    expect(put()).toEqual(before2);
  });

  /**
   * An empty Inbox is an achievement — but not while a couple of hundred notes
   * are sitting outside it because of the answer just given. Nothing else on
   * screen mentions them again except a menu row there is no reason to open, so
   * an unqualified "Nothing to tidy" would be the app saying everything is
   * dealt with when it is not. The number is the same one the menu row quotes.
   */
  it("says how many are being held outside the empty Inbox", async () => {
    render(<App />);
    await waitFor(() => expect(question()).toBeTruthy());
    const before = document.querySelectorAll(".card[data-id]").length;

    fireEvent.click(await screen.findByRole("button", { name: "Leave them" }, { timeout: 5000 }));
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(0));

    // Still finished as a pile...
    expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy();
    // ...and honest about what is not in the pile.
    const held = await screen.findByText(
      new RegExp(`${before} older notes are outside the Inbox`),
    );
    expect(held.textContent).toMatch(/menu/i);

    // The same number, said in the one other place it is said.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const row = await screen.findByRole("menuitem", { name: /bring in the old notes/i });
    expect(row.textContent).toMatch(new RegExp(`${before}`));
  });

  /* The other half — an empty Inbox with nothing held outside it keeping the
     words it has always had — is `boards.test.ts`'s, where it costs one call
     rather than emptying 237 notes off a board a keystroke at a time. */

  it("brings the old ones back in from the menu, so the answer is never permanent", async () => {
    render(<App />);
    await waitFor(() => expect(question()).toBeTruthy());
    const before = document.querySelectorAll(".card[data-id]").length;
    fireEvent.click(await screen.findByRole("button", { name: "Leave them" }, { timeout: 5000 }));
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(0));

    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /bring in the old notes/i }));

    await waitFor(() =>
      expect(document.querySelectorAll(".card[data-id]").length).toBe(before),
    );
  });

  it("puts the whole pile in the Inbox when that is the answer", async () => {
    render(<App />);
    await waitFor(() => expect(question()).toBeTruthy());
    const before = document.querySelectorAll(".card[data-id]").length;

    fireEvent.click(await screen.findByRole("button", { name: "Tidy up" }, { timeout: 5000 }));
    await waitFor(() => expect(question()).toBeNull());

    // Nothing moved here either — every one of them was already unfiled,
    // which is exactly what the Inbox holds.
    expect(document.querySelectorAll(".card[data-id]").length).toBe(before);
    // "Tidy up one at a time" is what the question promised, so the answer
    // opens the Sorter on the pile rather than leaving you to find it.
    // Generous waits: the Sorter grows out of a row and shrinks back into
    // it, and under the whole suite's load one second was not always enough.
    expect(
      await screen.findByRole("dialog", { name: "Tidy up Inbox" }, { timeout: 5000 }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop tidying up" }));
    await waitFor(
      () => expect(screen.queryByRole("dialog", { name: "Tidy up Inbox" })).toBeNull(),
      { timeout: 5000 },
    );
    // And with the answer in, the menu has nothing to offer to bring in.
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.queryByRole("menuitem", { name: /bring in the old notes/i })).toBeNull();
  });

  /**
   * Walking away is not an answer. The question is about a couple of hundred
   * notes; the app would rather ask again next time than decide for you.
   */
  it("stays unanswered when it is dismissed rather than answered", async () => {
    render(<App />);
    await waitFor(() => expect(question()).toBeTruthy());
    const before = document.querySelectorAll(".card[data-id]").length;

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(question()).toBeNull());
    // Nothing was decided, so the Inbox is still the whole pile.
    expect(document.querySelectorAll(".card[data-id]").length).toBe(before);

    cleanup();
    render(<App />);
    await waitFor(() => expect(question()).toBeTruthy());
  });
});
