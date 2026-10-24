// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { setMeta } from "../store/db";
import { INBOX_ALL } from "../lib/boards";

/*
 * Finds and waits here get the suite's ten seconds (`src/test/asyncWaits.ts`),
 * and a test forty: this file was seen failing only inside the whole suite,
 * where the machine is busy and a screen that draws in 100 ms alone takes
 * seconds. A longer wait costs nothing when the thing arrives.
 */
vi.setConfig({ testTimeout: 40_000 });

/**
 * The Ticker, exercised through the whole app — like the Sorter, everything
 * that matters about it is a seam with App: a tick is the same `body` write the
 * open note makes, the pile is the Todos board's own order, the capture bar
 * goes away for the duration, and the mode is offered only where there is
 * something to do.
 */

afterEach(cleanup);

beforeEach(async () => {
  localStorage.setItem("spar.deviceOnly", "1");
  await setMeta("inboxSince", INBOX_ALL);
});

async function boardIsUp() {
  render(<App />);
  await waitFor(
    () => expect(document.querySelectorAll(".card").length).toBeGreaterThan(0),
    { timeout: 10_000 },
  );
}

const ticker = () => screen.queryByRole("dialog", { name: "Tick off the lists" });
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
  return screen.queryByRole("menuitem", { name: /^tick off \d+ lists?$/i });
};

async function goToBoard(name: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

/** A checklist, written the way a person writes one. Two tick-box lines make a
 *  note a checklist by its own text, which is what puts it on Todos.
 *
 * Note that the store is shared across the tests in this file (one
 * `fake-indexeddb` per module), so every assertion below is written against a
 * delta or a pattern rather than against a fixed count — a test that only
 * passes when it runs first is a test that will be deleted by whoever adds the
 * one before it. */
async function writeList(text: string) {
  fireEvent.change(screen.getByLabelText("Write a note"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
}

const items = () => screen.queryAllByRole("checkbox");

describe("the Ticker", () => {
  it("is offered on Todos when a list has something left, and nowhere else", async () => {
    await boardIsUp();
    await writeList("[ ] milk\n[ ] bread");

    // Not on the Inbox: a to-do does not wait in the pile, it is already where
    // it belongs, and the line there is about filing.
    expect(entry()).toBeNull();

    await goToBoard(/^todos/i);
    await waitFor(() => expect(entry()).toBeTruthy());
    expect(entry()!.textContent).toMatch(/^Tick off \d+ lists?$/);
  });

  it("ticks a box without opening the note, and the note keeps it", async () => {
    await boardIsUp();
    await writeList("[ ] milk\n[ ] bread");
    await goToBoard(/^todos/i);

    fireEvent.click(entry()!);
    const panel = await waitFor(() => {
      const found = ticker();
      expect(found).toBeTruthy();
      return found!;
    });
    expect(within(panel).getByText("2 left")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("checkbox", { name: /milk/i }));

    // The count is the receipt, and the mode does not move on: a list is
    // several decisions and you are here for all of them.
    await waitFor(() => expect(within(ticker()!).getByText("1 left")).toBeTruthy());
    expect(ticker()).toBeTruthy();

    // A tick is a write. The box the note carries is ticked, which is what the
    // open note would show — the settle has sunk it below what is left.
    await waitFor(() =>
      expect(items().map((el) => el.getAttribute("aria-checked"))).toEqual(["false", "true"]),
    );
  });

  it("says so when the list is finished, and archiving takes it off the board", async () => {
    await boardIsUp();
    await writeList("[ ] pack the tent\n[ ] find the map");
    await goToBoard(/^todos/i);
    const before = document.querySelectorAll(".card[data-id]").length;

    fireEvent.click(entry()!);
    await waitFor(() => expect(ticker()).toBeTruthy());

    fireEvent.click(within(ticker()!).getByRole("checkbox", { name: /pack the tent/i }));
    await waitFor(() => expect(within(ticker()!).getByText("1 left")).toBeTruthy());
    fireEvent.click(within(ticker()!).getByRole("checkbox", { name: /find the map/i }));
    await waitFor(() => expect(within(ticker()!).getByText("all done")).toBeTruthy());

    // The one way a finished list leaves from in here — and it moves the pile
    // on, which is why the way out is pressed rather than assumed.
    fireEvent.click(within(ticker()!).getByRole("button", { name: /archive/i }));
    const open = ticker();
    if (open) fireEvent.click(within(open).getByRole("button", { name: "Stop ticking" }));
    await waitFor(() => expect(ticker()).toBeNull());
    await waitFor(() =>
      expect(document.querySelectorAll(".card[data-id]").length).toBe(before - 1),
    );
  });

  /* The list used again every week: one press unticks the lot, and the
     ordinary undo puts the ticks back — the mode stays up for both. */
  it("unticks the whole list at once, and the undo offer puts it back", async () => {
    await boardIsUp();
    await writeList("[ ] oats\n[ ] honey\n[ ] salt");
    await goToBoard(/^todos/i);

    fireEvent.click(entry()!);
    await waitFor(() => expect(ticker()).toBeTruthy());
    const panel = () => within(ticker()!);
    // Nothing ticked, nothing to untick: neither mark is drawn.
    expect(panel().queryByRole("button", { name: "Untick all" })).toBeNull();

    fireEvent.click(panel().getByRole("checkbox", { name: /oats/i }));
    fireEvent.click(await panel().findByRole("checkbox", { name: /honey/i }));
    await waitFor(() => expect(panel().getByText("1 left")).toBeTruthy());

    // Named in words on the screen, not only to a reader.
    expect(panel().getByRole("button", { name: "Untick all" }).textContent).toBe("Untick all");
    expect(panel().getByRole("button", { name: "Clear done" }).textContent).toBe("Clear done");

    fireEvent.click(panel().getByRole("button", { name: "Untick all" }));
    await waitFor(() => expect(panel().getByText("3 left")).toBeTruthy());
    expect(ticker()).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Undo: Unticked 2" }));
    await waitFor(() => expect(panel().getByText("1 left")).toBeTruthy());
    // Reversed in place: the mode is still up.
    expect(ticker()).toBeTruthy();
  });

  /* The running list: the ticked items leave the text, and come back. */
  it("clears what is done out of the list, and the undo offer brings it back", async () => {
    await boardIsUp();
    await writeList("[ ] nails\n[ ] glue\n[ ] tape");
    await goToBoard(/^todos/i);

    fireEvent.click(entry()!);
    await waitFor(() => expect(ticker()).toBeTruthy());
    const panel = () => within(ticker()!);

    fireEvent.click(panel().getByRole("checkbox", { name: /glue/i }));
    await waitFor(() => expect(panel().getByText("2 left")).toBeTruthy());

    fireEvent.click(panel().getByRole("button", { name: "Clear done" }));
    await waitFor(() => expect(panel().queryByRole("checkbox", { name: /glue/i })).toBeNull());
    expect(panel().getAllByRole("checkbox")).toHaveLength(2);

    fireEvent.click(await screen.findByRole("button", { name: "Undo: Cleared 1 done" }));
    await waitFor(() => expect(panel().getByRole("checkbox", { name: /glue/i })).toBeTruthy());
    expect(panel().getAllByRole("checkbox")).toHaveLength(3);
  });

  it("takes the capture bar away while it runs, and gives it back", async () => {
    await boardIsUp();
    await writeList("[ ] milk\n[ ] bread");
    await goToBoard(/^todos/i);

    expect(screen.queryByLabelText("Write a note")).toBeTruthy();
    fireEvent.click(entry()!);
    await waitFor(() => expect(ticker()).toBeTruthy());
    expect(screen.queryByLabelText("Write a note")).toBeNull();

    fireEvent.click(within(ticker()!).getByRole("button", { name: "Stop ticking" }));
    await waitFor(() => expect(ticker()).toBeNull());
    expect(screen.queryByLabelText("Write a note")).toBeTruthy();
  });

  /* A note marked as a to-do with no boxes in it has nothing for this mode to
     do, and a screen of nothing to tick is a screen that should not have been
     offered. */
  it("counts only the lists with something still open in them", async () => {
    await boardIsUp();
    const count = () => Number(/\d+/.exec(entry()?.textContent ?? "0")![0]);

    await goToBoard(/^todos/i);
    const before = entry() ? count() : 0;

    // A list with every box already ticked is on Todos and is not in the pile:
    // there is nothing here for this mode to do with it.
    await goToBoard(/^inbox/i);
    await writeList("[x] done already\n[x] also done");
    await goToBoard(/^todos/i);
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]").length).toBeGreaterThan(0));
    expect(entry() ? count() : 0).toBe(before);

    await goToBoard(/^inbox/i);
    await writeList("[ ] still open\n[ ] and this");
    await goToBoard(/^todos/i);
    await waitFor(() => expect(count()).toBe(before + 1));
  });

  /* Search opens in the board row so that nothing else on screen moves. The
     entry line keeps its box and loses only what is in it — the rule the Inbox
     learned, applied here because the row is the same row. */
  it("is not offered while a search is running", async () => {
    await boardIsUp();
    await writeList("[ ] milk\n[ ] bread");
    await goToBoard(/^todos/i);
    await waitFor(() => expect(entry()).toBeTruthy());

    fireEvent.click(screen.getByRole("menuitem", { name: /search/i }));
    fireEvent.change(await screen.findByLabelText("Search notes"), {
      target: { value: "milk" },
    });

    // Search borrows the grid, so the board behind it is not what is under
    // the reader's hands and its pile is not what the menu should offer to
    // work through. The row is simply not drawn.
    //
    // **This test used to be "keeps its box while a search is running"**, and
    // it asserted `data-hidden` on a 40px line at the top of the board: a row
    // that left the flow pulled the whole grid up by 40px, so it had to stay
    // and merely empty itself. The row is in the menu now and that whole
    // problem is gone with it — nothing on the board moves either way.
    expect(entry()).toBeNull();
  });
});

/**
 * The list as drawn (review 2026-10-04, UI-A-05): a `# ` name is set as the
 * open note's heading, and the box prints the characters the note holds.
 */
describe("the Ticker's list", () => {
  it("sets a name line as a heading and prints a ticked box as the note wrote it", async () => {
    const { Ticker } = await import("./Ticker");
    const { note } = await import("../test/fixtures");
    render(
      <Ticker
        pile={[note({ id: "t1", body: "# Shopping\n[x] milk\n[ ] eggs" })]}
        onTick={() => {}}
        onArchive={() => {}}
        onClose={() => {}}
        origin={null}
        restoreTo={{ current: null }}
      />,
    );
    const heading = document.querySelector(".ticker-heading .sorter-heading")!;
    expect(heading.textContent).toBe("# Shopping");
    expect(heading.querySelector(".note-mark")?.textContent).toBe("# ");
    const boxes = [...document.querySelectorAll(".ticker-box")].map((b) => b.textContent);
    expect(boxes).toEqual(["[x]", "[ ]"]);
  });
});

/**
 * The pen's last stroke (2026-10-14): Archive stands at --muted while a box is
 * still open, and steps up to --ink when the last one is ticked.
 */
describe("the Ticker's Archive mark", () => {
  async function drawn(body: string) {
    const { Ticker } = await import("./Ticker");
    const { note } = await import("../test/fixtures");
    render(
      <Ticker
        pile={[note({ id: "t1", body })]}
        onTick={() => {}}
        onArchive={() => {}}
        onClose={() => {}}
        origin={null}
        restoreTo={{ current: null }}
      />,
    );
    return document.querySelector(".ticker-archive")!;
  }

  it("is quiet while anything is left to tick", async () => {
    const archive = await drawn(["[x] milk", "[ ] eggs"].join("\n"));
    expect(archive.hasAttribute("data-ready")).toBe(false);
  });

  it("steps up once every box is ticked, and takes its time from motion.ts", async () => {
    const { STRIKE_MS } = await import("../lib/motion");
    const archive = (await drawn(["[x] milk", "[x] eggs"].join("\n"))) as HTMLElement;
    expect(archive.hasAttribute("data-ready")).toBe(true);
    expect(archive.style.getPropertyValue("--strike-ms")).toBe(`${STRIKE_MS}ms`);
  });
});

/* An offer made before Tick off opened is not the Ticker's to show (audit
   2026-10-10, UX-6 — the same rule UX-B-01 gave Tidy up). It stays on the
   stack for Ctrl+Z; the run's own offers still show in the head band. */
describe("an offer made before Tick off", () => {
  it("is not shown in the Ticker, and the run's own offer is", async () => {
    await boardIsUp();
    await writeList("[ ] rope\n[ ] pegs");
    await writeList("[ ] stove\n[ ] fuel");
    await goToBoard(/^todos/i);
    await waitFor(() => expect(document.querySelectorAll(".card[data-id]").length).toBeGreaterThan(1));

    // Something that offers an undo, just before the mode opens.
    fireEvent.contextMenu(document.querySelector(".card[data-id]")!);
    await waitFor(() => screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Menu, \d+ selected$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^archive/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Undo: / })).toBeTruthy());

    fireEvent.click(entry()!);
    await waitFor(() => expect(ticker()).toBeTruthy());
    expect(within(ticker()!).queryByRole("button", { name: /^Undo: / })).toBeNull();

    const panel = () => within(ticker()!);
    fireEvent.click(panel().getAllByRole("checkbox")[0]);
    fireEvent.click(await panel().findByRole("button", { name: "Untick all" }));
    expect(await panel().findByRole("button", { name: /^Undo: Unticked 1$/ })).toBeTruthy();
  });
});
