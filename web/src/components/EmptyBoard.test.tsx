// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Board } from "../types";
import { EmptyBoard, missedLine } from "./EmptyBoard";

afterEach(cleanup);

const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };
const todos: Board = { id: "todos", name: "Todos", kind: "todos" };

function empty(over: {
  board?: Board;
  waiting?: { todos: number; links: number };
  oldNotesOut?: number;
  searching?: boolean;
  searchQuoted?: boolean;
  searchWords?: number;
  notArrived?: boolean;
  onGoTo?: (kind: "todos" | "links") => void;
}) {
  return render(
    <EmptyBoard
      fetching={false}
      notArrived={over.notArrived}
      searching={over.searching ?? false}
      searchQuoted={over.searchQuoted}
      searchWords={over.searchWords}
      remindersOpen={false}
      headerMood="idle"
      board={over.board ?? inbox}
      freshArchive={false}
      oldNotesOut={over.oldNotesOut ?? 0}
      waiting={over.waiting}
      onGoTo={over.onGoTo ?? (() => {})}
    />,
  );
}

/**
 * A first list captured on the Inbox goes straight to Todos, and a bare link to
 * Links; the Inbox under it used to say "Everything is filed", which read as the
 * note being lost (review UX-B-02). The routing stays; the words say where they
 * went and offer the way there.
 */
describe("an empty Inbox whose notes went to Todos or Links", () => {
  it("names where they wait and offers the way there", () => {
    const onGoTo = vi.fn();
    empty({ waiting: { todos: 1, links: 2 }, onGoTo });
    expect(document.querySelector(".empty")?.textContent).toContain(
      "Inbox is clear. Lists wait on Todos, bare links on Links.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to Todos" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to Links" }));
    expect(onGoTo.mock.calls).toEqual([["todos"], ["links"]]);
  });

  it("offers only the board that holds something", () => {
    empty({ waiting: { todos: 0, links: 1 } });
    expect(screen.queryByRole("button", { name: "Go to Todos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to Links" })).toBeTruthy();
  });

  it("offers nothing when nothing waits, on another board, in a search, or while old notes are held out", () => {
    empty({ waiting: { todos: 0, links: 0 } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelector(".empty")?.textContent).toContain("Everything is filed");
    cleanup();
    empty({ board: todos, waiting: { todos: 2, links: 2 } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    cleanup();
    empty({ searching: true, waiting: { todos: 2, links: 2 } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    cleanup();
    empty({ oldNotesOut: 5, waiting: { todos: 2, links: 2 } });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

/* Audit 2026-10-10, UX-1: a search that found nothing says where the note is
   when search did not look there — the Trash, or outside a narrowed board —
   and offers the way. */
describe("an empty search with matches it did not look at", () => {
  it("words each case", () => {
    expect(missedLine({ inTrash: 1, outside: 0, scope: null })).toBe("1 match is in the Trash.");
    expect(missedLine({ inTrash: 0, outside: 3, scope: "Kitchen" })).toBe(
      "3 matches are outside Kitchen.",
    );
    expect(missedLine({ inTrash: 2, outside: 1, scope: "Kitchen" })).toBe(
      "1 match is outside Kitchen, and 2 matches in the Trash.",
    );
    expect(missedLine({ inTrash: 0, outside: 0, scope: "Kitchen" })).toBeNull();
  });

  it("says it in place of the advice, and offers each way there", () => {
    const onGoToTrash = vi.fn();
    const onSearchEverywhere = vi.fn();
    render(
      <EmptyBoard
        fetching={false}
        searching
        searchWords={1}
        remindersOpen={false}
        headerMood="idle"
        board={inbox}
        freshArchive={false}
        oldNotesOut={0}
        missed={{ inTrash: 1, outside: 2, scope: "Kitchen" }}
        onGoToTrash={onGoToTrash}
        onSearchEverywhere={onSearchEverywhere}
      />,
    );
    expect(screen.getByText(/2 matches are outside Kitchen, and 1 match in the Trash\./)).toBeTruthy();
    expect(screen.queryByText(/Try a shorter form/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go to Trash" }));
    fireEvent.click(screen.getByRole("button", { name: "Search everything" }));
    expect(onGoToTrash).toHaveBeenCalledTimes(1);
    expect(onSearchEverywhere).toHaveBeenCalledTimes(1);
  });

  it("offers the nearest real word, and tapping it searches that word", () => {
    const onSearchWord = vi.fn();
    render(
      <EmptyBoard
        fetching={false}
        searching
        searchWords={1}
        remindersOpen={false}
        headerMood="idle"
        board={inbox}
        freshArchive={false}
        oldNotesOut={0}
        missed={{ inTrash: 0, outside: 0, scope: null, didYouMean: "definately" }}
        onSearchWord={onSearchWord}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Did you mean definately?" }));
    expect(onSearchWord).toHaveBeenCalledWith("definately");
    // The offer is the advice: the generic hint does not stand beside it.
    expect(screen.queryByText(/Try a shorter form/)).toBeNull();
  });

  it("says the true thing about a quoted phrase, not to try fewer words", () => {
    empty({ searching: true, searchQuoted: true, searchWords: 2 });
    expect(screen.getByText(/Words in quotes must stand together/)).toBeTruthy();
    expect(screen.queryByText(/Try fewer words/)).toBeNull();
  });

  it("keeps the advice when there is nowhere else to look", () => {
    empty({ searching: true });
    expect(screen.queryByRole("button", { name: "Go to Trash" })).toBeNull();
    expect(screen.getByText(/Try fewer words/)).toBeTruthy();
  });
});

/**
 * There is only ever one creature, and it cannot speak from the header while
 * it sleeps here: while its bubble stands it goes up to say it, and its place
 * on the board is kept so the words under it do not move (2026-10-16).
 */
describe("an empty board while the creature is speaking", () => {
  it("gives the creature up to the header and keeps its place", () => {
    render(
      <EmptyBoard
        fetching={false}
        searching={false}
        remindersOpen={false}
        headerMood="idle"
        speaking
        board={inbox}
        freshArchive={false}
        oldNotesOut={0}
      />,
    );
    expect(document.querySelector(".empty spar-mascot")).toBeNull();
    expect(document.querySelector(".empty .empty-mascot-gap")).not.toBeNull();
  });
});

/** A signed-in device whose first sync failed knows nothing about the archive. */
describe("an empty store whose first sync has not come through", () => {
  it("says the notes have not arrived, never that everything is filed", () => {
    empty({ notArrived: true });
    const text = document.querySelector(".empty")?.textContent ?? "";
    expect(text).toContain("Your notes have not arrived");
    expect(text).toContain("Check the connection. They come down on their own.");
    expect(text).not.toMatch(/Nothing to tidy|Everything is filed/);
  });

  it("leaves a search's own words alone", () => {
    empty({ notArrived: true, searching: true });
    expect(document.querySelector(".empty")?.textContent).toContain("No matches");
  });
});
