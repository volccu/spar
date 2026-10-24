// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within, configure } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { directWide, fitsBeneath, Sorter, splitPlaces, type Place } from "./Sorter";
import { board as fixtureBoard, note as fixtureNote } from "../test/fixtures";
import { allNotes, setMeta } from "../store/db";
import { INBOX_ALL } from "../lib/boards";
import * as moments from "../lib/mascotMoments";

/*
 * Every find and wait in this file gets ten seconds, and a test forty, because
 * this file was seen failing only inside the whole suite, where the machine is
 * busy and a find that takes 100 ms alone takes seconds. A longer wait costs
 * nothing when the thing arrives, and a failing test still fails — later.
 */
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 40_000 });

/**
 * The Sorter, exercised through the whole app — everything that matters about it
 * is a seam with App: it files through the same `board_id` write the Move panel
 * uses, it is undoable by the same strip, the pile it works through is the
 * Inbox's own order, and the capture bar goes away for the duration and comes
 * back afterwards.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The quarter second held after each answer (QA-02) is read off the clock.
 *  A test that answers twice freezes the date (`unhurried`) and lets the hold
 *  pass by hand (`later`) before each answer after the first. */
function unhurried() {
  vi.useFakeTimers({ toFake: ["Date"] });
}
function later() {
  vi.setSystemTime(Date.now() + 300);
}

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  // Past the first-open question, which these tests are not about — see
  // App.test.tsx, where it is.
  await setMeta("inboxSince", INBOX_ALL);
  // The folders a test made are not the next test's: how many there are
  // decides whether the foot draws them or puts them behind a Move row.
  await setMeta("boards", []);
});

async function boardIsUp() {
  render(<App />);
  await waitFor(
    () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    { timeout: 10_000 },
  );
}

const sorter = () => screen.queryByRole("dialog", { name: "Tidy up Inbox" });
/**
 * The mode's row. It lives **in the menu** since 2026-09-25 — it was a line
 * across the top of the board until the owner asked for it in there — so this
 * opens the menu if it is not already open. Every caller wants the row rather
 * than the panel, and the panel costs nothing to have standing: the board, the
 * cards and the capture bar are all still there behind it.
 */
const entry = () => {
  if (!screen.queryByRole("menu", { name: "Menu" })) {
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  }
  return screen.queryByRole("menuitem", { name: /^tidy up \d+ notes?$/i });
};

// These render at jsdom's default 1024, where the shelf is the tab strip — one
// click to a board, and the "+" tab to make one.
async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

/** Brings the folders up where they are behind a Move row. A shelf that fits
 *  two rows is drawn as buttons already (PL-02), so there is nothing to open. */
function openBoards() {
  const move = within(sorter()!).queryByRole("button", { name: "Move to a board…" });
  if (move) fireEvent.click(move);
}

/** A folder to file into, made the way a person makes one. */
async function makeFolder(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "New board" }));
  const field = screen.getByLabelText("New board name");
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByRole("tab", { name: new RegExp(name, "i") });
  // The new board opens; the tests below tidy the Inbox.
  fireEvent.click(await screen.findByRole("tab", { name: /^inbox/i }));
}

/** The note the Sorter is showing right now. */
const showing = () => document.querySelector(".sorter-text")?.textContent ?? "";

describe("the Sorter", () => {
  it("is offered at the top of the Inbox, and says how many are waiting", async () => {
    await boardIsUp();

    const line = entry();
    expect(line).toBeTruthy();
    // The same number the board itself is showing.
    const count = document.querySelectorAll(".card[data-id]").length;
    expect(line!.textContent).toBe(`Tidy up ${count} notes`);

    // And on every other board with notes on it, about that board's own pile.
    // It was the Inbox's line alone until 2026-09-24; tidying a folder you
    // already filed into is the same job said about a different pile, and
    // there was no way to do it without emptying the folder back out first.
    await goToBoard(/^all/i);
    const onAll = entry();
    expect(onAll).toBeTruthy();
    // Its own pile, which on All is every active note — not the Inbox's.
    //
    // **At least the Inbox's, never fewer, and not necessarily more.** This
    // read `toBeGreaterThan` and the deploy hook caught it: All is every
    // active note and the Inbox is the unfiled ones, so the two are *equal*
    // on an archive where nothing has been filed yet — which is exactly what
    // the server's seedless checkout has (29 and 29, where this machine's
    // seeded one had 40 and 98 and the bad assertion passed). Nor may the
    // number be read off the cards: the grid draws a window of them
    // (`useGridFill`), so on a long board the drawn count is not the pile.
    expect(onAll!.textContent).toMatch(/^Tidy up \d+ notes$/);
    const inboxN = Number(line!.textContent!.match(/\d+/)![0]);
    expect(Number(onAll!.textContent!.match(/\d+/)![0])).toBeGreaterThanOrEqual(inboxN);

    // Todos is the exception, and not a missing case: it has a mode of its
    // own, and the row is the same row.
    await goToBoard(/^todos/i);
    expect(entry()).toBeNull();
  });

  it("files a note into a folder, taking it out of the Inbox, and undo puts it back", async () => {
    await boardIsUp();
    await makeFolder("zzzsorterfolder");

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = sorter();
      expect(found).toBeTruthy();
      return found!;
    });

    const first = showing();
    expect(first.length).toBeGreaterThan(0);

    openBoards();
    fireEvent.click(within(panel).getByRole("button", { name: /zzzsorterfolder/i }));

    // Filed, and on to the next one — the pile does not wait to be dismissed.
    await waitFor(() => expect(showing()).not.toBe(first));
    expect(screen.getByText(/moved 1/i)).toBeTruthy();

    // Stop sorting: the note is in the folder and gone from the Inbox.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    // Answers given and cards left: stopping shows the run so far, then Done leaves.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());

    await goToBoard(/zzzsorterfolder/i);
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(1));

    // The ordinary undo strip, one step per note, the same as any other move.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(0));
    await goToBoard(/^inbox/i);
    await waitFor(() => expect(entry()!.textContent).toMatch(/^Tidy up \d+ notes$/));
  });

  it("stopping early shows what the run came to so far", async () => {
    await boardIsUp();
    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(showing()).not.toBe(first));

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    const tally = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".sorter-end-tally");
      expect(found).toBeTruthy();
      return found!;
    });
    expect(within(tally).getByText("Left").nextElementSibling?.textContent).toBe("1");
    expect(within(sorter()!).getByText(/^1 of [0-9]+ done$/)).toBeTruthy();
    // Done leaves.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
  });

  it("keeps without changing the note, and the kept note is still in the pile", async () => {
    await boardIsUp();
    const before = document.querySelectorAll(".card[data-id]").length;

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(showing()).not.toBe(first));

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    // Answers given and cards left: stopping shows the run so far, then Done leaves.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());

    // Nothing moved, nothing was marked: the Inbox is exactly as it was, and
    // there is no kept-forever state for the note to have fallen into. Keep
    // was called Skip until the right-hand swipe started meaning it too — one
    // instruction cannot have two words.
    expect(document.querySelectorAll(".card[data-id]").length).toBe(before);
    expect(entry()!.textContent).toBe(`Tidy up ${before} notes`);
  });

  /**
   * The two-answer swipe, which this file used to assert the absence of.
   *
   * The old rule was "a swipe steps and only steps", and the reason given for
   * it was that *with more than two destinations a swipe cannot say which one
   * it means*. That reason is still right and still binds every folder, the
   * Archive and New board — those are buttons and this test checks that they
   * stay buttons. Keep and bin are two, they are opposite, and the owner asked
   * for them by name (2026-09-24). What was withdrawn is the swipe's old job:
   * stepping back is the Back button in the head now, because a decision you
   * can make by flinging your thumb is one you can make by accident.
   */
  it("keeps on a swipe right and bins on a swipe left, and files on neither", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = sorter();
      expect(found).toBeTruthy();
      return found!;
    });
    const first = showing();

    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(panel, { touches: [{ clientX: from, clientY: 300 }] });
      fireEvent.touchEnd(panel, { changedTouches: [{ clientX: to, clientY: 300 }] });
    };

    // Right: the note is left exactly as it is, and the pile moves on.
    swipe(100, 300);
    await waitFor(() => expect(showing()).not.toBe(first));
    const second = showing();
    expect(screen.queryByText(/deleted 1/i)).toBeNull();
    // Nothing was filed. A swipe may never choose a destination.
    expect(screen.queryByText(/moved 1/i)).toBeNull();

    // Left: the trash, by the ordinary path, with the ordinary offer back.
    swipe(300, 100);
    await waitFor(() => expect(showing()).not.toBe(second));
    expect(screen.getByText(/deleted 1/i)).toBeTruthy();
    expect(screen.queryByText(/moved 1/i)).toBeNull();
  });

  /**
   * Back, which exists because the swipe stopped being the way back. Going
   * back and answering again must not count twice in the summary, which is
   * why what was decided is kept by position in the pile and not as a tally.
   */
  it("goes back to the note behind, and is not offered on the first one", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = sorter();
      expect(found).toBeTruthy();
      return found!;
    });

    const backAt = () =>
      within(sorter()!).getByRole("button", { name: "Back one note" }) as HTMLButtonElement;
    expect(backAt().disabled).toBe(true);

    const first = showing();
    fireEvent.click(within(panel).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(showing()).not.toBe(first));

    expect(backAt().disabled).toBe(false);
    fireEvent.click(backAt());
    await waitFor(() => expect(showing()).toBe(first));
  });

  it("takes the capture bar away while it runs, and gives it back", async () => {
    await boardIsUp();
    expect(screen.getByLabelText("Write a note")).toBeTruthy();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    expect(screen.queryByLabelText("Write a note")).toBeNull();

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    await waitFor(() => expect(sorter()).toBeNull());
    expect(screen.getByLabelText("Write a note")).toBeTruthy();
  });

  it("leaves whatever is left of the pile in the Inbox", async () => {
    await boardIsUp();
    await makeFolder("zzzsorterhalf");
    // The pile is what the menu row says, not what the grid has drawn: going
    // back to the Inbox tab is a new view, and a board of more than a screenful
    // draws the first forty cards and the rest a beat later (`useGridFill`), so
    // a count of cards read now is the window, not the pile.
    const before = Number(entry()!.textContent!.match(/\d+/)![0]);

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    openBoards();
    fireEvent.click(within(sorter()!).getByRole("button", { name: /zzzsorterhalf/i }));
    await waitFor(() => expect(screen.getByText(/moved 1/i)).toBeTruthy());

    // Walking out mid-pile is normal and costs nothing — there is no session to
    // abandon, so Back is all it takes. With an answer given it shows the run
    // so far first, as the ✕ does, and the next Back leaves.
    fireEvent.popState(window);
    await waitFor(() => expect(within(sorter()!).getByText(/^1 of [0-9]+ done$/)).toBeTruthy());
    fireEvent.popState(window);
    await waitFor(() => expect(sorter()).toBeNull());
    await waitFor(() => expect(entry()!.textContent).toBe(`Tidy up ${before - 1} notes`));
  });

  it("makes a folder from inside the mode and files straight into it", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    openBoards();
    fireEvent.click(within(sorter()!).getByRole("button", { name: /new board/i }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: "zzzmadewhilesorting" } });
    fireEvent.keyDown(field, { key: "Enter" });

    // Made, filed into, and on to the next note — one name, one motion.
    await waitFor(() => expect(showing()).not.toBe(first));
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    // Answers given and cards left: stopping shows the run so far, then Done leaves.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());

    await goToBoard(/zzzmadewhilesorting/i);
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]")).toHaveLength(1));
  });

  /**
   * The payoff, and it is deliberately quiet: filing the last note in the pile
   * ends the mode and puts you back on an Inbox that has reached zero. The
   * Inbox's own wording does the celebrating, which is to say it doesn't.
   */
  it("closes at the end of the pile, onto an Inbox at zero", async () => {
    // One note in the pile, arranged the way a real morning arranges it: the
    // old ones were left out, and this is what has been written since.
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    // Not `boardIsUp` — that waits for cards, and the whole point here is an
    // Inbox with none in it.
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(entry()).toBeNull();

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzthelastone" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 1 note"));

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    expect(document.querySelector(".sorter-at")?.textContent).toBe("1 of 1");

    fireEvent.click(within(sorter()!).getByRole("button", { name: /^archive/i }));

    // The mode does not vanish at the end any more: it says what the run came
    // to. Twenty cards in, "the board looks different now" is not an answer.
    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    expect(sorter()).toBeTruthy();
    // Read off the summary itself — the undo mark beside it says "Archived"
    // too, for its first seconds.
    const tally = document.querySelector<HTMLElement>(".sorter-end-tally")!;
    expect(within(tally).getByText("Archived").nextElementSibling?.textContent).toBe("1");

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy();
    expect(entry()).toBeNull();
    // And the bar is back, because there is something to write again.
    expect(screen.getByLabelText("Write a note")).toBeTruthy();
  });

  /**
   * The run's own undo. The eight-second strip is the right offer for one
   * delete and no offer at all for the third of twenty — it has expired long
   * before the reader reaches the end of the pile and finds out what they did.
   */
  it("puts a whole run's deletes back from the summary", async () => {
    unhurried();
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });

    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "zzzrunone" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 1 note"));
    fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: "zzzruntwo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 2 notes"));

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(document.querySelector(".sorter-at")?.textContent).toBe("2 of 2"));
    later();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    const tally = document.querySelector<HTMLElement>(".sorter-end-tally")!;
    expect(within(tally).getByText("Deleted").nextElementSibling?.textContent).toBe("2");

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Put back 2" }));
    // Offered once — there is nothing left to put back.
    await waitFor(() =>
      expect(within(sorter()!).queryByRole("button", { name: /^put back/i })).toBeNull(),
    );
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 2 notes"));
  });

  /**
   * Remind me later is an answer (review 2026-10-04, FX-B-01): the clock in the
   * head offers the open note's four presets, a pick sets the reminder and
   * moves on, the note stays in the Inbox, and the summary counts it.
   */
  it("sets a reminder from the head and moves on, counting it in the summary", async () => {
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });
    for (const [i, words] of ["zzzremindone", "zzzremindtwo"].entries()) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() =>
        expect(entry()?.textContent).toBe(`Tidy up ${i + 1} note${i ? "s" : ""}`),
      );
    }
    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const at = () => document.querySelector(".sorter-at")?.textContent;

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Remind me later" }));
    const menu = screen.getByRole("menu", { name: "Reminder" });
    // The open note's four presets, and nothing else.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(4);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /in 1 hour/i }));

    // On to the next note, the presets shut, and nothing was filed.
    await waitFor(() => expect(at()).toBe("2 of 2"));
    expect(screen.queryByRole("menu", { name: "Reminder" })).toBeNull();

    // Escape shuts the presets first, and only them.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Remind me later" }));
    expect(screen.getByRole("menu", { name: "Reminder" })).toBeTruthy();
    fireEvent.keyDown(sorter()!, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Reminder" })).toBeNull();
    expect(sorter()).toBeTruthy();

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    const line = (word: string) =>
      [...document.querySelectorAll(".sorter-end-line")].find(
        (li) => li.firstElementChild?.textContent === word,
      )?.lastElementChild?.textContent;
    expect(line("Reminded")).toBe("1");
    expect(line("Left")).toBe("1");
    // A line with nothing to report is not drawn at all.
    expect(line("Moved")).toBeUndefined();

    // Nothing left the Inbox.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 2 notes"));
  });

  /**
   * Back is there to change your mind, so the answer you change it to has to
   * be the one that holds. Keep on a note already archived or binned used to
   * write nothing at all: the note stayed in the Archive or the trash, the
   * summary counted it as kept, and a binned one fell out of "Put back", so it
   * stayed in the trash with nothing left that offered it back (review
   * 2026-10-01, UX-03).
   */
  it("puts a note back where it was when Back is followed by Leave", async () => {
    unhurried();
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });

    for (const [i, words] of ["zzzmindone", "zzzmindtwo", "zzzmindthree"].entries()) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() =>
        expect(entry()?.textContent).toBe(`Tidy up ${i + 1} note${i === 0 ? "" : "s"}`),
      );
    }

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const at = () => document.querySelector(".sorter-at")?.textContent;

    // Archive the first, bin the second.
    fireEvent.click(within(sorter()!).getByRole("button", { name: /^archive/i }));
    await waitFor(() => expect(at()).toBe("2 of 3"));
    later();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(at()).toBe("3 of 3"));

    // Back to the binned one: it says what was done to it, and Leave undoes it.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Back one note" }));
    await waitFor(() => expect(at()).toBe("2 of 3"));
    expect(document.querySelector(".sorter-was")?.textContent).toMatch(/deleted/i);
    // Said with the button's own word (review CD-07).
    expect(document.querySelector(".sorter-was")?.textContent).toMatch(/leave puts it back/i);
    // Back again, to the archived one, which says so too.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Back one note" }));
    await waitFor(() => expect(at()).toBe("1 of 3"));
    expect(document.querySelector(".sorter-was")?.textContent).toMatch(/archived/i);

    // Leave both, then leave the third.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(at()).toBe("2 of 3"));
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(at()).toBe("3 of 3"));
    // A note nobody had answered says nothing of the kind.
    expect(document.querySelector(".sorter-was")).toBeNull();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));

    // The summary tells the truth, and has nothing to put back.
    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    const line = (word: string) =>
      [...document.querySelectorAll(".sorter-end-line")].find(
        (li) => li.firstElementChild?.textContent === word,
      )?.lastElementChild?.textContent;
    expect(line("Left")).toBe("3");
    expect(line("Archived")).toBeUndefined();
    expect(line("Deleted")).toBeUndefined();
    expect(within(sorter()!).queryByRole("button", { name: /^put back/i })).toBeNull();

    // And the board agrees: all three are back in the Inbox.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 3 notes"));
  });

  /**
   * The same mind changed the other way round: a binned note sent somewhere
   * else from Back has to leave the trash on the way, or it is filed into a
   * folder and still in the bin — counted as moved, missing from "Put back".
   */
  it("takes a binned note out of the trash when Back files it somewhere else", async () => {
    unhurried();
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });
    await makeFolder("zzzmindfolder");
    await goToBoard(/^inbox/i);

    for (const [i, words] of ["zzzmindbin", "zzzmindstay"].entries()) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() =>
        expect(entry()?.textContent).toBe(`Tidy up ${i + 1} note${i === 0 ? "" : "s"}`),
      );
    }

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const at = () => document.querySelector(".sorter-at")?.textContent;
    const first = showing();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(at()).toBe("2 of 2"));

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Back one note" }));
    await waitFor(() => expect(at()).toBe("1 of 2"));
    expect(document.querySelector(".sorter-was")?.textContent).toMatch(/deleted/i);
    openBoards();
    later();
    fireEvent.click(within(sorter()!).getByRole("button", { name: /zzzmindfolder/i }));
    await waitFor(() => expect(at()).toBe("2 of 2"));
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    expect(within(sorter()!).queryByRole("button", { name: /^put back/i })).toBeNull();

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    await goToBoard(/zzzmindfolder/i);
    expect(await screen.findByRole("button", { name: new RegExp(first) })).toBeTruthy();
  });

  /**
   * Remind is an answer like filing: a binned note brought back by Back and
   * then reminded has to come out of the trash first, or it sits in the bin
   * with a reminder on it, counted "Reminded" (review 2026-10-04, FX-B-01).
   */
  it("takes a binned note out of the trash when Back reminds it instead", async () => {
    unhurried();
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });
    for (const [i, words] of ["zzzremindbin", "zzzremindstay"].entries()) {
      fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: words } });
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() =>
        expect(entry()?.textContent).toBe(`Tidy up ${i + 1} note${i === 0 ? "" : "s"}`),
      );
    }

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const at = () => document.querySelector(".sorter-at")?.textContent;
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(at()).toBe("2 of 2"));

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Back one note" }));
    await waitFor(() => expect(at()).toBe("1 of 2"));
    expect(document.querySelector(".sorter-was")?.textContent).toMatch(/deleted/i);
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Remind me later" }));
    const menu = screen.getByRole("menu", { name: "Reminder" });
    later();
    fireEvent.click(within(menu).getByRole("menuitem", { name: /in 1 hour/i }));
    await waitFor(() => expect(at()).toBe("2 of 2"));
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));

    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    const line = (word: string) =>
      [...document.querySelectorAll(".sorter-end-line")].find(
        (li) => li.firstElementChild?.textContent === word,
      )?.lastElementChild?.textContent;
    expect(line("Reminded")).toBe("1");
    expect(line("Deleted")).toBeUndefined();
    expect(within(sorter()!).queryByRole("button", { name: /^put back/i })).toBeNull();

    // Both are in the Inbox again: the reminded one is out of the trash.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 2 notes"));
  });

  /**
   * Important marks the note and leaves it showing. It is the one control on
   * this screen that does not spend the decision the screen is asking for.
   */
  it("marks a note important without moving the pile on", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    // Whichever way the first note stands, the one control flips it. (It is
    // not always unmarked: the seed's own order is not this test's business.)
    // One name either way; only the pressed state turns (CD-02).
    const flag = () => within(sorter()!).getByRole("button", { name: "Important" });
    const marked = flag().getAttribute("aria-pressed") === "true";
    fireEvent.click(flag());
    await waitFor(() => expect(flag().getAttribute("aria-pressed")).toBe(String(!marked)));
    expect(showing()).toBe(first);
    expect(document.querySelector(".sorter-at")?.textContent).toMatch(/^1 of /);
  });

  /** The to-do mark is Important's twin: it says something about the note and
   *  the card stays where it is. */
  it("marks a note as a to-do without moving the pile on", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    fireEvent.click(within(sorter()!).getByRole("button", { name: "To-do", pressed: false }));
    await waitFor(() =>
      expect(within(sorter()!).getByRole("button", { name: "To-do", pressed: true })).toBeTruthy(),
    );
    expect(showing()).toBe(first);
    expect(document.querySelector(".sorter-at")?.textContent).toMatch(/^1 of /);
  });

  it("archives from the pile, which is undoable like everything else", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    fireEvent.click(within(sorter()!).getByRole("button", { name: /^archive/i }));
    await waitFor(() => expect(showing()).not.toBe(first));
    expect(screen.getByText(/archived 1/i)).toBeTruthy();

    // The undo mark stands in the note's face, never in the head band: it
    // used to float over the band's right end, exactly on the ✕, so leaving
    // the mode quietly undid the last answer (review 2026-10-01, UX-01).
    const undo = screen.getByRole("button", { name: "Undo: Archived 1" });
    expect(undo.closest(".sorter-note")).not.toBeNull();
    expect(undo.closest(".sorter-head")).toBeNull();
  });

  /**
   * The commonest honest answer when clearing an imported pile is "no", and
   * until this row existed the Sorter could not say it: the only ways out were
   * a folder you did not mean, the Archive — which keeps a note whole and
   * searchable, a different sentence entirely — or leaving the mode.
   *
   * It is the trash and not destruction, and there is no confirmation on the
   * way: the trash *is* the confirmation, and a dialog per note would make
   * clearing the pile slower than not using the Sorter at all.
   */
  it("deletes to the trash without asking, and undo puts it back in the pile", async () => {
    // A pile of exactly one, written here so it can be found again by name —
    // the same arrangement the end-of-pile test uses.
    await setMeta("inboxSince", new Date().toISOString());
    render(<App />);
    await waitFor(() => expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy(), {
      timeout: 10_000,
    });

    fireEvent.change(screen.getByLabelText("Write a note"), {
      target: { value: "zzzsorterbin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 1 note"));

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());

    // One tap is the whole gesture. Nothing stands between it and the trash.
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Delete" }));
    // The last of the pile, so the run's summary stands where the note was.
    await waitFor(() => expect(screen.getByText(/ done$/)).toBeTruthy());
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(sorter()).toBeNull());
    expect(screen.getByText(/deleted 1 note/i)).toBeTruthy();

    // Out of the Inbox, whole in the Trash — restorable for TRASH_DAYS like
    // any other delete, never destroyed.
    expect(screen.getByText(/^Nothing to tidy/)).toBeTruthy();
    await goToBoard(/^trash/i);
    expect(await screen.findByRole("button", { name: /zzzsorterbin/i })).toBeTruthy();

    // And the ordinary strip takes it back, a note at a time, as everything
    // else in this mode does.
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
    await goToBoard(/^inbox/i);
    await waitFor(() => expect(entry()?.textContent).toBe("Tidy up 1 note"));
  });

  /**
   * Delete is a destination, so it stands among them — last, after the folders,
   * the Archive and New folder…. Keep is not a destination at all, and nor is
   * Important, so neither is among them: both sit in the head band beside the
   * count, where a thumb aiming at one cannot land on Delete (audit
   * 2026-09-04, F13). Nothing at the foot should be easier to reach than a
   * folder, and the bin least of all.
   */
  it("puts Delete last of the destinations, and Leave in the head", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = sorter();
      expect(found).toBeTruthy();
      return found!;
    });

    const names = Array.from(panel.querySelectorAll(".sorter-dest-name")).map(
      (el) => el.textContent,
    );
    // With no folders yet the foot is Inspiration (the one board that is
    // always there), a new board, Archive, and Delete last. A shelf that fits
    // is drawn as buttons, so there is no Move row; one too big for the foot
    // goes behind it (below, with a shelf of seven).
    expect(names).toEqual(["Inspiration", "New board…", "Archive", "Delete"]);
    expect(names).not.toContain("Leave");
    expect(panel.querySelector(".sorter-head .sorter-skip")?.textContent).toBe("Leave");
    // Important is up there too, for the same reason and one of its own: it
    // is the only control here that leaves the card where it is.
    expect(within(panel).getByRole("button", { name: "Important" })).toBeTruthy();
  });

  /** The board list is a layer inside the mode: Cancel and Escape close it
   *  and leave the note standing, and Escape closes only it. It is what a
   *  shelf too big for the foot falls back to — on jsdom's 768px-tall window
   *  that is past fifteen (`directWide`), so the shelf here has twenty. */
  it("opens the boards on Move and closes them again without acting", () => {
    const { onFile } = renderSorter({ boards: shelf(20) });
    const dialog = sorter()!;

    expect(within(dialog).queryByRole("button", { name: /Folder 3/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to a board…" }));
    expect(within(dialog).getByRole("button", { name: /Folder 3/ })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).queryByRole("button", { name: /Folder 3/ })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move to a board…" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(sorter()).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Folder 3/ })).toBeNull();
    expect(onFile).not.toHaveBeenCalled();
  });

  /**
   * The destinations hold still. They used to be most-recently-used, re-sorted
   * in the same commit that brought up the next note — so filing a folder
   * moved it to the head and shifted every row above it down one, under a
   * finger still on the glass. The second tap of "these two go in the same
   * place" therefore landed on a different folder, and Delete is in that list.
   */
  it("keeps the destinations where they are while the pile moves on", async () => {
    await boardIsUp();
    await makeFolder("zzzsortalpha");
    await makeFolder("zzzsortbeta");

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = sorter();
      expect(found).toBeTruthy();
      return found!;
    });

    const order = () =>
      Array.from(sorter()!.querySelectorAll(".sorter-dest-name")).map((el) => el.textContent);
    const before = order();
    expect(before).toContain("zzzsortalpha");
    expect(before).toContain("zzzsortbeta");
    // Not the first row: under the old ordering this one had furthest to
    // travel, and every row above it moved down by one when it did.
    expect(before.indexOf("zzzsortbeta")).toBeGreaterThan(0);

    const first = showing();
    fireEvent.click(within(panel).getByRole("button", { name: /zzzsortbeta/i }));
    await waitFor(() => expect(showing()).not.toBe(first));

    // The folder just filed into did not walk to the top, and nothing else
    // moved either.
    expect(order()).toEqual(before);
  });

  /**
   * A name is committed by asking for it. It used to commit on blur as well,
   * and blur runs *before* the click that took the focus away — so tapping a
   * folder row with a half-typed name in the field made that folder, filed
   * this note into it and advanced the pile, all before the tap the reader
   * actually made was dispatched.
   */
  it("throws away a half-typed folder name rather than acting on it", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    openBoards();
    fireEvent.click(within(sorter()!).getByRole("button", { name: /new board/i }));
    const field = screen.getByLabelText("New board name");
    fireEvent.change(field, { target: { value: "zzznevermeant" } });
    fireEvent.blur(field);

    // The field is gone and nothing else happened: no folder, no filing, and
    // the same note still standing there waiting to be dealt with.
    await waitFor(() => expect(screen.queryByLabelText("New board name")).toBeNull());
    expect(showing()).toBe(first);
    expect(
      Array.from(sorter()!.querySelectorAll(".sorter-dest-name")).map((el) => el.textContent),
    ).not.toContain("zzznevermeant");

    fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
    await waitFor(() => expect(sorter()).toBeNull());
    expect(screen.queryByRole("tab", { name: /zzznevermeant/i })).toBeNull();
  });

  /**
   * The layer takes the focus when it opens, the way every other layer in the
   * app does.
   *
   * It used to take nothing — and because App puts the board behind it
   * `inert`, the browser then dropped the focus to the body, which is outside
   * this element. The Escape and arrow handlers sit on the layer, so no
   * keystroke ever reached them: Escape did not close the Sorter at all, and
   * the only ways out were the ✕ and Android's own Back.
   */
  it("holds the focus itself, so Escape closes it", async () => {
    await boardIsUp();

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());

    // The layer, not a control in it: nothing here is one stray Enter from
    // filing a note into whichever folder happens to be first.
    expect(document.activeElement).toBe(sorter());

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(sorter()).toBeNull());

    // And the focus goes back to **the burger**, not to the row that opened
    // it. That row is inside the menu and the menu closed on the way in, so
    // it is not in the document to take anything; the burger is the control
    // the reader actually pressed to get here, and it is still there.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Menu" }));
  });

  /**
   * The arrows step the pile, and must step it once. The board's own grid
   * listener used to stay live under this layer — it named three layers of its
   * own and the Sorter was not one of them — so the same keystroke was being
   * read twice by two different screens.
   */
  it("steps the pile on an arrow, and the board behind it does not move", async () => {
    await boardIsUp();

    const standing = document.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const first = showing();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    await waitFor(() => expect(showing()).not.toBe(first));

    // Nothing behind took the key: same board, and the focus never left.
    expect(
      document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,
    ).toBe(standing);
    expect(sorter()!.contains(document.activeElement)).toBe(true);
  });
  /**
   * The mode declares `aria-modal` and the board behind it is `inert` — but
   * the header is not, and the mascot puts `tabindex="0"` on itself, so Tab
   * off the last control used to leave the layer for a creature the reader
   * has been told is not there.
   */
  it("keeps Tab inside itself", async () => {
    await boardIsUp();
    fireEvent.click(entry()!);
    const layer = sorter()!;
    const focusable = [...layer.querySelectorAll<HTMLElement>("button:not(:disabled)")];
    expect(focusable.length).toBeGreaterThan(1);

    focusable[focusable.length - 1].focus();
    fireEvent.keyDown(layer, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);

    fireEvent.keyDown(layer, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusable[focusable.length - 1]);
  });

});

/**
 * A saved link used to arrive here as a line of raw URL — the least readable
 * thing a note holds, on the screen whose job is recognising a note fast
 * enough to place it. It is named now, the way the Links board names a row.
 */
describe("a link in the Sorter", () => {
  it("is named with its site beside it, and the address is not printed", () => {
    const url = "https://www.example.com/articles/2026/long-path?utm_source=x";
    render(
      <Sorter
        pile={[fixtureNote({ id: "l1", body: `Great read on bread\n${url}` })]}
        where="Inbox"
        boards={[]}
        countFor={() => 0}
        onFile={() => {}}
        onLinks={() => {}}
        onArchive={() => {}}
        onDelete={() => {}}
        onPriority={() => {}}
        onTodo={() => {}}
        onRestore={() => {}}
        onCreateBoard={() => fixtureBoard()}
        onClose={() => {}}
        nameMax={40}
        origin={null}
        restoreTo={{ current: null }}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Tidy up Inbox" });
    const link = dialog.querySelector(".sorter-link");
    expect(link?.querySelector(".sorter-link-name")?.textContent).toBe("Great read on bread");
    expect(link?.querySelector(".sorter-link-site")?.textContent).toBe("example.com");
    expect(dialog.textContent).not.toContain("https://");
  });
});

/**
 * The foot, standalone: the answers a pile makes without the rest of the app,
 * so a test can say how many folders there are and read what was asked of it.
 */
function shelf(n: number) {
  return Array.from({ length: n }, (_, i) =>
    fixtureBoard({ id: `b${i + 1}`, name: `Folder ${i + 1}`, position: i }),
  );
}

function renderSorter(over: Partial<React.ComponentProps<typeof Sorter>> = {}) {
  const handlers = {
    onFile: vi.fn(),
    onLinks: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onUnsort: vi.fn(),
    onPriority: vi.fn(),
    onTodo: vi.fn(),
    onRestore: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <Sorter
      pile={[
        fixtureNote({ id: "p1", body: "first words" }),
        fixtureNote({ id: "p2", body: "second words" }),
      ]}
      where="Inbox"
      boards={[]}
      countFor={() => 0}
      {...handlers}
      onCreateBoard={() => fixtureBoard()}
      nameMax={40}
      origin={null}
      restoreTo={{ current: null }}
      {...over}
    />,
  );
  return handlers;
}

/**
 * One tap to file again (review 2026-10-01, PL-02). The folders are behind a
 * Move row only when there are too many to draw in two rows under the thumb.
 */
describe("the folders in the Sorter's foot", () => {
  it("draws them as buttons, in shelf order, and one tap files", () => {
    const { onFile } = renderSorter({ boards: shelf(3) });
    const dialog = sorter()!;
    expect(within(dialog).queryByRole("button", { name: "Move to a board…" })).toBeNull();
    const names = Array.from(dialog.querySelectorAll(".sorter-dest-name")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["Folder 1", "Folder 2", "Folder 3", "New board…", "Archive", "Delete"]);

    fireEvent.click(within(dialog).getByRole("button", { name: /Folder 2/ }));
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].id).toBe("p1");
    expect(onFile.mock.calls[0][1]).toBe("b2");
  });

  it("dresses a folder's button in its own tint, and leaves the Inbox and untinted ones alone", () => {
    renderSorter({
      boards: [
        fixtureBoard({ id: "b1", name: "Folder 1", position: 0, color: "ochre" }),
        fixtureBoard({ id: "b2", name: "Folder 2", position: 1 }),
      ],
    });
    const dialog = sorter()!;
    const btn = (name: RegExp) => within(dialog).getByRole("button", { name }) as HTMLElement;
    expect(btn(/Folder 1/).style.getPropertyValue("--board-tint")).toBe("var(--board-ochre)");
    expect(btn(/Folder 2/).style.getPropertyValue("--board-tint")).toBe("");
  });

  it("counts two rows on a phone, and on a wide window as many as half its height holds", () => {
    expect(fitsBeneath(0, true)).toBe(true);
    expect(fitsBeneath(4, true)).toBe(true);
    expect(fitsBeneath(5, true)).toBe(false);
    // A phone's bound does not grow with the screen (review 2026-10-04, UX-A-02).
    expect(fitsBeneath(5, true, 900)).toBe(false);
    // Unmeasured, a wide window is two rows of three, as it always was.
    expect(fitsBeneath(6, false)).toBe(true);
    expect(fitsBeneath(7, false)).toBe(false);
    // Measured, the foot may take half the window: 900px tall is ten rows of
    // 45, three of them New board, Archive and Delete, and Links — so seven
    // rows of three folders.
    expect(directWide(900)).toBe(21);
    expect(fitsBeneath(21, false, 900)).toBe(true);
    expect(fitsBeneath(22, false, 900)).toBe(false);
    // Never fewer than the old six, however short the window.
    expect(directWide(400)).toBe(6);
  });

  it("puts the Move row back for a shelf too big, and files through it", () => {
    const { onFile } = renderSorter({ boards: shelf(20) });
    const dialog = sorter()!;
    expect(within(dialog).queryByRole("button", { name: /Folder 1/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to a board…" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Folder 5/ }));
    expect(onFile.mock.calls[0][1]).toBe("b5");
  });

  it("picks a place on a number key, and no number reaches Archive or Delete", () => {
    const { onFile, onArchive, onDelete } = renderSorter({ boards: shelf(3) });
    const dialog = sorter()!;
    fireEvent.keyDown(dialog, { key: "2" });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][1]).toBe("b2");
    // Past the last place a number does nothing — it is not a way to Delete.
    fireEvent.keyDown(dialog, { key: "9" });
    fireEvent.keyDown(dialog, { key: "5", ctrlKey: true });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onArchive).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});

/**
 * The keys a hand on the keyboard answers with (review 2026-10-04, FX-B-05 and
 * UX-B-06): E archives, as on the board, and A still does (audit UX-9); the bin still has no key, and a
 * focused Delete is not one either — the focus goes back to the layer after
 * every answer, so the next Enter lands on nothing.
 */
describe("the Sorter's keys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("archives on A, once per press, and never with a modifier", () => {
    const { onArchive, onDelete } = renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    fireEvent.keyDown(dialog, { key: "a", ctrlKey: true });
    fireEvent.keyDown(dialog, { key: "a", metaKey: true });
    expect(onArchive).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "a" });
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive.mock.calls[0][0].id).toBe("p1");
    // A held key repeats; a repeat answers nothing, here or on a number.
    fireEvent.keyDown(dialog, { key: "a", repeat: true });
    fireEvent.keyDown(dialog, { key: "1", repeat: true });
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  // E archives here as it does on the board (audit 2026-10-10, UX-9); A stays.
  it("archives on E, the board's own archive key, never with a modifier", () => {
    const { onArchive } = renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    fireEvent.keyDown(dialog, { key: "e", ctrlKey: true });
    expect(onArchive).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "e" });
    expect(onArchive).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: "e", repeat: true });
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it("files on a number while the board list is folded away", () => {
    // The list is folded behind Move; 1–9 still pick the places in their order
    // (review 2026-10-04, UX-A-02), with nothing opened first.
    const { onFile } = renderSorter({ boards: shelf(20) });
    const dialog = sorter()!;
    expect(within(dialog).getByRole("button", { name: /^Move to a board/ })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "3" });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][1]).toBe("b3");
  });

  it("draws E on the Archive row where there is a keyboard, and nothing on Delete", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    const row = (name: string) =>
      [...dialog.querySelectorAll(".sorter-dest")].find(
        (el) => el.querySelector(".sorter-dest-name")?.textContent === name,
      )!;
    expect(row("Archive").querySelector(".kbd")?.textContent).toBe("E");
    expect(row("Delete").querySelector(".kbd")).toBeNull();
  });

  it("puts the focus back on the layer after an answer from a focused button", () => {
    unhurried();
    const { onDelete, onArchive } = renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    const del = within(dialog).getByRole("button", { name: "Delete" });
    del.focus();
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialog);
    // Archive the same way.
    const arch = within(dialog).getByRole("button", { name: /^archive/i });
    arch.focus();
    later();
    fireEvent.click(arch);
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(dialog);
  });
});

/**
 * Tidying a folder can send a note back (review 2026-10-01, UX-19): the Inbox
 * is a destination there, and the folder being tidied is not.
 */
describe("tidying a folder", () => {
  it("offers the Inbox first and leaves the folder itself out", () => {
    const { onFile } = renderSorter({ boards: shelf(3), hereId: "b2", where: "Folder 2" });
    const dialog = screen.getByRole("dialog", { name: "Tidy up Folder 2" });
    const names = Array.from(dialog.querySelectorAll(".sorter-dest-name")).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(["Inbox", "Folder 1", "Folder 3", "New board…", "Archive", "Delete"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Inbox" }));
    expect(onFile.mock.calls[0][1]).toBeNull();
  });

  it("does not offer the Inbox anywhere that is not a folder", () => {
    renderSorter({ boards: shelf(2) });
    expect(within(sorter()!).queryByRole("button", { name: "Inbox" })).toBeNull();
  });

  it("numbers the Inbox first, so 1 sends the note back", () => {
    const { onFile } = renderSorter({ boards: shelf(3), hereId: "b2", where: "Folder 2" });
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Tidy up Folder 2" }), { key: "1" });
    expect(onFile.mock.calls[0][1]).toBeNull();
  });

  it("leaves a folder out of the list too, when the shelf is too big for the foot", () => {
    renderSorter({ boards: shelf(20), hereId: "b3", where: "Folder 3" });
    const dialog = screen.getByRole("dialog", { name: "Tidy up Folder 3" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to a board…" }));
    expect(within(dialog).getByRole("button", { name: "Inbox" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Folder 3/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /Folder 4/ })).toBeTruthy();
  });
});

/**
 * The card follows the finger (review 2026-10-01, UX-08). jsdom has no Web
 * Animations, which is the reduced-motion path: the card stays put and only the
 * word comes up, and the answer is made on release. What is held here is the
 * word, the line it is whole at, and that a short release answers nothing.
 */
describe("a swipe in the Sorter", () => {
  const card = () => document.querySelector<HTMLElement>(".sorter-card")!;
  const move = (layer: HTMLElement, from: number, to: number) => {
    fireEvent.touchStart(layer, { touches: [{ clientX: from, clientY: 300 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: to, clientY: 302 }] });
  };

  it("shows Leave as the card goes right and Delete as it goes left, growing with the drag", () => {
    renderSorter();
    const layer = sorter()!;
    expect(card().querySelectorAll("[data-cue]")).toHaveLength(2);

    move(layer, 100, 140);
    const partway = Number(card().style.getPropertyValue("--swipe-right"));
    expect(partway).toBeGreaterThan(0);
    expect(partway).toBeLessThan(1);
    expect(card().style.getPropertyValue("--swipe-left")).toBe("0");

    fireEvent.touchMove(layer, { touches: [{ clientX: 300, clientY: 302 }] });
    expect(card().style.getPropertyValue("--swipe-right")).toBe("1");
  });

  it("shows Delete going left", () => {
    renderSorter();
    move(sorter()!, 300, 200);
    expect(Number(card().style.getPropertyValue("--swipe-left"))).toBeGreaterThan(0);
    expect(card().style.getPropertyValue("--swipe-right")).toBe("0");
  });

  it("bins on a left swipe even a moment after another answer", () => {
    unhurried();
    const { onDelete, onArchive } = renderSorter({ boards: shelf(2) });
    const layer = sorter()!;
    fireEvent.click(within(layer).getByRole("button", { name: /^archive/i }));
    expect(onArchive).toHaveBeenCalledTimes(1);
    move(layer, 300, 100);
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 100, clientY: 302 }] });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].id).toBe("p2");
  });

  it("answers nothing, and takes the word down, when let go short of the line", () => {
    const { onDelete, onFile } = renderSorter();
    const layer = sorter()!;
    move(layer, 300, 240);
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 240, clientY: 302 }] });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
    expect(card().style.getPropertyValue("--swipe-left")).toBe("");
    expect(showing()).toBe("first words");
  });

  /**
   * With Web Animations the card follows the finger and is flung off before it
   * is answered; the answer is made once, when the fling lands.
   */
  it("flings the card off past the line and answers when it lands, once", () => {
    const flights: Array<{ onfinish: (() => void) | null; cancel: () => void }> = [];
    const proto = HTMLElement.prototype as unknown as { animate?: unknown };
    const had = proto.animate;
    proto.animate = () => {
      const flight = { onfinish: null as (() => void) | null, cancel: vi.fn() };
      flights.push(flight);
      return flight;
    };
    try {
      const { onDelete } = renderSorter();
      const layer = sorter()!;
      move(layer, 300, 150);
      // The card is in the hand: it has moved with the finger and leans.
      expect(card().style.transform.startsWith("translate3d(-")).toBe(true);
      expect(card().style.transform).toContain("rotate(-");

      fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 150, clientY: 302 }] });
      // Thrown, not yet answered.
      expect(flights.length).toBeGreaterThan(0);
      expect(onDelete).not.toHaveBeenCalled();
      // A finger put down while it is in the air waits.
      fireEvent.touchStart(layer, { touches: [{ clientX: 300, clientY: 300 }] });
      fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 100, clientY: 300 }] });
      expect(onDelete).not.toHaveBeenCalled();

      const flight = flights[flights.length - 1];
      flight.onfinish?.();
      flight.onfinish?.();
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0][0].id).toBe("p1");
    } finally {
      proto.animate = had;
    }
  });

  it("settles back, answering nothing, when the browser takes the touch", () => {
    const { onDelete } = renderSorter();
    const layer = sorter()!;
    move(layer, 300, 200);
    expect(Number(card().style.getPropertyValue("--swipe-left"))).toBeGreaterThan(0);
    fireEvent.touchCancel(layer);
    expect(card().style.getPropertyValue("--swipe-left")).toBe("");
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("does not follow a drag that is mostly down: that is reading the note", () => {
    renderSorter();
    const layer = sorter()!;
    fireEvent.touchStart(layer, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: 120, clientY: 220 }] });
    expect(card().style.getPropertyValue("--swipe-right")).toBe("");
  });

  it("is not a way to answer the last card again once the pile has ended", () => {
    const { onDelete } = renderSorter({ pile: [fixtureNote({ id: "only", body: "alone" })] });
    const layer = sorter()!;
    fireEvent.click(within(layer).getByRole("button", { name: "Leave" }));
    expect(screen.getByText(/ done$/)).toBeTruthy();

    // A left swipe on the summary used to bin the last card a second time.
    fireEvent.touchStart(layer, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 100, clientY: 302 }] });
    fireEvent.keyDown(layer, { key: "ArrowRight" });
    fireEvent.keyDown(layer, { key: "ArrowLeft" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/ done$/)).toBeTruthy();
  });
});

/** The note is set in the open note's centred column (review 2026-10-01, UI-14). */
describe("an offer made before Tidy up", () => {
  it("is not shown beside the note, and the run's own offer is", async () => {
    await boardIsUp();
    // Something that offers an undo, just before Tidy up opens.
    fireEvent.contextMenu(document.querySelector(".card[data-id]")!);
    await waitFor(() => screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^archive/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Undo: / })).toBeTruthy());

    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    // That offer is on Ctrl+Z, never beside a note it has nothing to do with.
    expect(within(sorter()!).queryByRole("button", { name: /^Undo: / })).toBeNull();

    fireEvent.click(within(sorter()!).getByRole("button", { name: /^archive/i }));
    await waitFor(() =>
      expect(within(sorter()!).getByRole("button", { name: "Undo: Archived 1" })).toBeTruthy(),
    );
  });
});

describe("the Sorter's run", () => {
  it("hands back the notes it left, and not the ones it never reached", () => {
    const onLeft = vi.fn();
    renderSorter({ onLeft, boards: shelf(2) });
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));
    cleanup();
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onLeft.mock.calls[0][0]).toEqual(["p1"]);
  });

  it("does not show a note trashed out from under the pile, but keeps its own deletes", () => {
    renderSorter({
      pile: [
        fixtureNote({ id: "p1", body: "gone elsewhere", status: "trashed" }),
        fixtureNote({ id: "p2", body: "still here" }),
      ],
    });
    expect(showing()).toBe("still here");
  });
});

describe("the undo corner of the Sorter's note", () => {
  it("keeps its box when the mark goes, until the note changes", () => {
    const props = {
      pile: [fixtureNote({ id: "p1", body: "first" }), fixtureNote({ id: "p2", body: "second" })],
      where: "Inbox",
      boards: [],
      countFor: () => 0,
      onFile: vi.fn(),
      onLinks: vi.fn(),
      onArchive: vi.fn(),
      onDelete: vi.fn(),
      onUnsort: vi.fn(),
      onPriority: vi.fn(),
      onTodo: vi.fn(),
      onRestore: vi.fn(),
      onClose: vi.fn(),
      onCreateBoard: () => fixtureBoard(),
      nameMax: 40,
      origin: null,
      restoreTo: { current: null },
    };
    const mark = <span className="undo-slot undo-slot-face">mark</span>;
    const { rerender } = render(<Sorter {...props} />);
    // No mark has stood here: nothing is held, and the text has its full line.
    expect(document.querySelector(".sorter-read .undo-slot-face")).toBeNull();
    rerender(<Sorter {...props} undo={mark} />);
    expect(document.querySelector(".sorter-read .undo-slot-face")).toBeTruthy();
    // The offer expires: the corner stays the same size.
    rerender(<Sorter {...props} />);
    expect(document.querySelector(".sorter-read .undo-slot-face")).toBeTruthy();
    // The note changes: the box is released.
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(document.querySelector(".sorter-read .undo-slot-face")).toBeNull();
  });
});

describe("the Sorter's note", () => {
  it("sits in a reading column of its own, inside the scrolling note", () => {
    renderSorter();
    const column = document.querySelector(".sorter-note > .sorter-read");
    expect(column?.querySelector(".sorter-text")?.textContent).toBe("first words");
  });

  // "Set exactly as it is read anywhere else" (DESIGN.md §8): a note's `# `
  // name line is the open note's heading here too — its hashes a muted mark,
  // its words the heading — and not the raw characters printed as prose. The
  // text itself is untouched: every character is still drawn.
  it("draws a heading the way the open note does, not as raw hashes", () => {
    const body = "# Start here\nThe words under it.\n## A part\nmore";
    renderSorter({ pile: [fixtureNote({ id: "h1", body })] });
    const text = document.querySelector(".sorter-text")!;
    expect(text.textContent).toBe(body);
    const headings = text.querySelectorAll(".sorter-heading");
    expect(headings).toHaveLength(2);
    expect(headings[0].querySelector(".note-mark")?.textContent).toBe("# ");
    expect(headings[0].textContent?.trim()).toBe("# Start here");
    expect(headings[1].querySelector(".note-mark")?.textContent).toBe("## ");
    // The sentence under the name is prose, not part of the heading.
    expect(headings[0].textContent).not.toContain("The words under it");
  });
});

/**
 * A tap on the note's words opens them for typing, in place (review 2026-10-04,
 * FX-B-03): the open note's own field, so nothing here is a second editor.
 * While it is open every other key and swipe belongs to it.
 */
describe("editing the note's words in the Sorter", () => {
  const field = () => screen.queryByRole("textbox", { name: "Note text" }) as HTMLTextAreaElement | null;
  const tap = () => fireEvent.click(document.querySelector(".sorter-text")!);

  it("a tap on the words opens a field holding the note, with the focus in it", () => {
    renderSorter({ onEditBody: vi.fn() });
    expect(field()).toBeNull();
    tap();
    expect(field()).toBeTruthy();
    expect(field()!.value).toBe("first words");
    expect(document.activeElement).toBe(field());
    // The same classes lay it out as the paragraph it replaces.
    expect(field()!.classList.contains("sorter-text")).toBe(true);
  });

  it("is not offered when nothing can take the words", () => {
    renderSorter();
    tap();
    expect(field()).toBeNull();
  });

  it("Enter on the layer opens the same field, the caret at the end", () => {
    renderSorter({ onEditBody: vi.fn() });
    fireEvent.keyDown(sorter()!, { key: "Enter" });
    expect(field()).toBeTruthy();
    expect(field()!.value).toBe("first words");
    expect(document.activeElement).toBe(field());
    expect(field()!.selectionStart).toBe("first words".length);
  });

  it("Enter does nothing where nothing can take the words, or on a button's own press", () => {
    renderSorter();
    fireEvent.keyDown(sorter()!, { key: "Enter" });
    expect(field()).toBeNull();
    cleanup();
    renderSorter({ onEditBody: vi.fn() });
    fireEvent.keyDown(screen.getByRole("button", { name: "Important" }), { key: "Enter" });
    expect(field()).toBeNull();
  });

  it("typing does not answer the note: no Archive, no number, no arrow, no Leave", () => {
    const h = renderSorter({ boards: shelf(2), onEditBody: vi.fn() });
    tap();
    const f = field()!;
    for (const key of ["a", "A", "1", "2", "ArrowRight", "ArrowLeft", "Delete", "Backspace"]) {
      fireEvent.keyDown(f, { key });
    }
    expect(h.onArchive).not.toHaveBeenCalled();
    expect(h.onFile).not.toHaveBeenCalled();
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(within(sorter()!).getByText("1 of 2")).toBeTruthy();
  });

  it("a swipe over the note does not answer it while the field is open", () => {
    const h = renderSorter({ onEditBody: vi.fn() });
    tap();
    const layer = sorter()!;
    fireEvent.touchStart(layer, { touches: [{ clientX: 300, clientY: 300 }] });
    fireEvent.touchMove(layer, { touches: [{ clientX: 60, clientY: 302 }] });
    fireEvent.touchEnd(layer, { changedTouches: [{ clientX: 60, clientY: 302 }] });
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(within(layer).getByText("1 of 2")).toBeTruthy();
  });

  it("writes the body as it is typed, and leaving the field puts the paragraph back", () => {
    const onEditBody = vi.fn();
    renderSorter({ onEditBody });
    tap();
    fireEvent.change(field()!, { target: { value: "first words, changed" } });
    expect(onEditBody).toHaveBeenCalledTimes(1);
    expect(onEditBody.mock.calls[0][0].id).toBe("p1");
    expect(onEditBody.mock.calls[0][1]).toBe("first words, changed");
    fireEvent.blur(field()!);
    expect(field()).toBeNull();
    expect(document.querySelector(".sorter-text")).toBeTruthy();
  });

  it("counts a numbered list straight once, on leaving — never on a keystroke", () => {
    const onEditBody = vi.fn();
    renderSorter({
      pile: [fixtureNote({ id: "p1", body: "1. a\n2. b" })],
      onEditBody,
    });
    tap();
    fireEvent.change(field()!, { target: { value: "1. a\n3. b" } });
    expect(onEditBody).toHaveBeenLastCalledWith(expect.anything(), "1. a\n3. b");
    fireEvent.blur(field()!);
    expect(onEditBody).toHaveBeenLastCalledWith(expect.anything(), "1. a\n2. b");
  });

  it("Escape ends the edit and not the mode; the next Escape leaves the mode", () => {
    const onEditBody = vi.fn();
    const h = renderSorter({ onEditBody });
    tap();
    fireEvent.change(field()!, { target: { value: "kept" } });
    fireEvent.keyDown(field()!, { key: "Escape" });
    expect(field()).toBeNull();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(onEditBody).toHaveBeenCalledWith(expect.anything(), "kept");
    // Keys answer the note again.
    fireEvent.keyDown(sorter()!, { key: "ArrowRight" });
    expect(within(sorter()!).getByText("2 of 2")).toBeTruthy();
    // An answer given and a card left: Escape shows the run so far, as the ✕
    // does, and the one after it leaves the mode.
    fireEvent.keyDown(sorter()!, { key: "Escape" });
    expect(within(sorter()!).getByText("1 of 2 done")).toBeTruthy();
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(sorter()!, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("a note with a link edits its whole body, address and all", () => {
    const onEditBody = vi.fn();
    renderSorter({
      pile: [fixtureNote({ id: "p1", body: "Read this https://example.com/a-page later" })],
      onEditBody,
    });
    tap();
    expect(field()!.value).toBe("Read this https://example.com/a-page later");
    fireEvent.change(field()!, { target: { value: "Read this https://example.com/a-page now" } });
    fireEvent.blur(field()!);
    expect(onEditBody).toHaveBeenCalledWith(expect.anything(), "Read this https://example.com/a-page now");
    expect(document.querySelector(".sorter-text")).toBeTruthy();
  });

  it("in the whole app, the body changes and raw_content never does", async () => {
    await boardIsUp();
    fireEvent.click(entry()!);
    await waitFor(() => expect(sorter()).toBeTruthy());
    const was = showing();
    fireEvent.click(document.querySelector(".sorter-text")!);
    const input = field()!;
    expect(input.value).toBe(was);
    fireEvent.change(input, { target: { value: "typed in the sorter" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(sorter()).toBeTruthy();
    expect(showing()).toBe("typed in the sorter");
    await waitFor(async () => {
      const row = (await allNotes()).find((n) => n.body === "typed in the sorter");
      expect(row).toBeTruthy();
      expect(row!.raw_content).not.toBe("typed in the sorter");
    });
  });
});

/**
 * Review 2026-10-13, QA-02: a quick double tap on an answer used to answer the
 * next note too, which nobody had read. For a quarter second after an answer
 * the next one is ignored. Only the clock is faked, so React still runs.
 */
describe("a quick second tap", () => {
  it("does not answer the note behind the one just answered", () => {
    unhurried();
    const { onDelete, onArchive } = renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    const del = within(dialog).getByRole("button", { name: "Delete" });
    fireEvent.click(del);
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: /^archive/i }));
    expect(onArchive).not.toHaveBeenCalled();

    // Once the note has been looked at, the next tap is an answer again.
    later();
    fireEvent.click(del);
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(onDelete.mock.calls[1][0].id).toBe("p2");
  });

  it("holds for a folder too, and for the number keys", () => {
    unhurried();
    const { onFile } = renderSorter({ boards: shelf(2) });
    const dialog = sorter()!;
    const folder = within(dialog).getByRole("button", { name: /Folder 1/ });
    fireEvent.click(folder);
    fireEvent.click(folder);
    fireEvent.keyDown(dialog, { key: "2" });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].id).toBe("p1");
  });
});

/**
 * Review 2026-10-13, UX-02: past four folders a phone used to put every one of
 * them behind the Move row. The ones that hold most notes are buttons now, in
 * shelf order, Inspiration is drawn besides and never counted, and the rest
 * wait behind the row.
 */
describe("the places a phone draws as buttons", () => {
  const folder = (id: string): Place => ({ kind: "folder", board: fixtureBoard({ id, name: id }) });
  const insp: Place = {
    kind: "folder",
    board: fixtureBoard({ id: "insp", name: "Inspiration", kind: "inspiration" }),
  };
  const ids = (places: Place[]) =>
    places.map((p) => (p.kind === "inbox" ? "inbox" : p.board.id));

  it("draws everything when four folders and Inspiration are all there is", () => {
    const run = [folder("a"), folder("b"), folder("c"), folder("d"), insp];
    const { drawn, rest } = splitPlaces(run, new Map(), 4);
    expect(ids(drawn)).toEqual(["a", "b", "c", "d", "insp"]);
    expect(rest).toEqual([]);
  });

  it("keeps the busiest folders, in shelf order, and Inspiration besides", () => {
    const run = [folder("a"), folder("b"), folder("c"), folder("d"), folder("e"), folder("f"), insp];
    const counts = new Map([["a", 1], ["b", 9], ["c", 2], ["d", 7], ["e", 7], ["f", 5]]);
    const { drawn, rest } = splitPlaces(run, counts, 4);
    // d beats e on the tie by standing earlier on the shelf.
    expect(ids(drawn)).toEqual(["b", "d", "e", "f", "insp"]);
    expect(ids(rest)).toEqual(["a", "c"]);
  });

  it("holds the Inbox's seat first when the pile is a folder's", () => {
    const run: Place[] = [{ kind: "inbox" }, folder("a"), folder("b"), folder("c"), folder("d"), folder("e")];
    const counts = new Map([["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5]]);
    const { drawn } = splitPlaces(run, counts, 4);
    expect(ids(drawn)).toEqual(["inbox", "c", "d", "e"]);
  });

  it("on a phone files straight into a busy folder, and the rest are one row away", () => {
    vi.stubGlobal("innerWidth", 390);
    try {
      const boards = [
        ...shelf(7),
        fixtureBoard({ id: "insp", name: "Inspiration", position: 99, kind: "inspiration" }),
      ];
      const busy: Record<string, number> = { b2: 30, b4: 20, b5: 10, b7: 5 };
      const { onFile } = renderSorter({ boards, countFor: (id) => busy[id] ?? 0 });
      const dialog = sorter()!;
      const names = Array.from(dialog.querySelectorAll(".sorter-dest-name")).map(
        (el) => el.textContent,
      );
      expect(names).toEqual([
        "Folder 2",
        "Folder 4",
        "Folder 5",
        "Folder 7",
        "Inspiration",
        "Move to a board…",
        "Archive",
        "Delete",
      ]);
      fireEvent.click(within(dialog).getByRole("button", { name: /Folder 4/ }));
      expect(onFile.mock.calls[0][1]).toBe("b4");

      // The others are behind the row, with Cancel and a new board.
      fireEvent.click(within(dialog).getByRole("button", { name: "Move to a board…" }));
      const rest = Array.from(dialog.querySelectorAll(".sorter-dest-name")).map(
        (el) => el.textContent,
      );
      expect(rest).toEqual(["Cancel", "Folder 1", "Folder 3", "Folder 6", "New board…"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Review 2026-10-13, UI-04: a place's row said a count and a key, two small
 * grey digits side by side. The count is gone, and the key stands before the
 * mark, on a machine with a keyboard only.
 */
describe("a place's row", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has no count, and the key stands before the mark", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(hover: hover) and (pointer: fine)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderSorter({ boards: shelf(2), countFor: () => 7 });
    const dialog = sorter()!;
    expect(dialog.querySelector(".sorter-dest-n")).toBeNull();
    const row = within(dialog).getByRole("button", { name: /Folder 1/ });
    expect(row.textContent).not.toMatch(/7/);
    expect(row.firstElementChild?.classList.contains("kbd")).toBe(true);
    expect(row.querySelector(".kbd")?.textContent).toBe("1");
  });

  it("draws no key without a keyboard", () => {
    renderSorter({ boards: shelf(2) });
    expect(sorter()!.querySelector(".kbd")).toBeNull();
  });
});

/** Review 2026-10-13, UI-03: the four marks in the head are one set. */
describe("the head's marks", () => {
  it("are all drawn at the one in-row size", () => {
    renderSorter();
    for (const name of ["Back one note", "Important", "To-do", "Remind me later", "Stop tidying up"]) {
      const svg = within(sorter()!).getByRole("button", { name }).querySelector("svg");
      expect(svg?.getAttribute("class"), name).toContain("icon-inline");
    }
  });
});

/**
 * The ✕, Escape and the phone's Back are one way out (review 2026-10-19). With
 * an answer given and a card left, the first press shows the run so far and
 * the next leaves; with nothing answered each leaves at once. The creature's
 * hop is for a pile seen through to its last card, never for one stopped early.
 */
describe("the ways out of the Sorter", () => {
  type Way = "the ✕" | "Escape" | "Back";
  const ways: Way[] = ["the ✕", "Escape", "Back"];
  const leave = () => fireEvent.click(within(sorter()!).getByRole("button", { name: "Leave" }));

  /** What a press does. Back is answered in the app by the Sorter first and,
   *  when it does not stay up, by the app closing it: the same two steps here. */
  function setUp() {
    const back = { current: null as (() => boolean) | null };
    const h = renderSorter({ backRef: back });
    const press = (way: Way) => {
      if (way === "the ✕") {
        fireEvent.click(within(sorter()!).getByRole("button", { name: "Stop tidying up" }));
      } else if (way === "Escape") {
        fireEvent.keyDown(sorter()!, { key: "Escape" });
      } else {
        act(() => {
          if (!back.current?.()) h.onClose();
        });
      }
    };
    return { h, press };
  }

  it.each(ways)("%s shows the run so far first, then a press on it leaves", (way) => {
    const { h, press } = setUp();
    leave();
    press(way);
    expect(within(sorter()!).getByText("1 of 2 done")).toBeTruthy();
    expect(h.onClose).not.toHaveBeenCalled();
    press(way);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it.each(ways)("%s leaves at once when nothing was answered", (way) => {
    const { h, press } = setUp();
    press(way);
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/ done$/)).toBeNull();
  });

  it("Back puts the reminder presets away before it shows the run so far", () => {
    const { h, press } = setUp();
    leave();
    fireEvent.click(within(sorter()!).getByRole("button", { name: "Remind me later" }));
    expect(screen.getByRole("menu", { name: "Reminder" })).toBeTruthy();
    press("Back");
    expect(screen.queryByRole("menu", { name: "Reminder" })).toBeNull();
    expect(screen.queryByText(/ done$/)).toBeNull();
    press("Back");
    expect(within(sorter()!).getByText("1 of 2 done")).toBeTruthy();
    expect(h.onClose).not.toHaveBeenCalled();
  });

  describe("the creature's hop", () => {
    afterEach(() => vi.restoreAllMocks());

    it.each(ways)("does not follow a run stopped early by %s", (way) => {
      const hop = vi.spyOn(moments, "tidiedUp").mockImplementation(() => {});
      const { press } = setUp();
      leave();
      press(way);
      press(way);
      cleanup();
      expect(hop).not.toHaveBeenCalled();
    });

    it("follows a run seen through to its last card", () => {
      const hop = vi.spyOn(moments, "tidiedUp").mockImplementation(() => {});
      renderSorter();
      leave();
      leave();
      expect(within(sorter()!).getByText("All 2 done")).toBeTruthy();
      cleanup();
      expect(hop).toHaveBeenCalledTimes(1);
      expect(hop).toHaveBeenCalledWith(expect.objectContaining({ left: 2 }));
    });
  });
});
