import { describe, expect, it } from "vitest";
import type { Board, Note, UserBoard } from "../types";
import {
  boardViewKey,
  buildBoards,
  canKeepOnLinks,
  countForBoard,
  createBoard,
  emptyBoardHint,
  waitingElsewhere,
  emptyBoardTitle,
  filePatch,
  folderIds,
  homeBoard,
  isBoardName,
  isFiled,
  isLens,
  canScopeSearch,
  isTodoNote,
  keepsScreenOn,
  keptOnLinks,
  linksOnly,
  linksPatch,
  matchesBoard,
  moveBoard,
  neverFiledCount,
  notesForBoard,
  orderedBoards,
  canMoveBoard,
  foldersOf,
  lensOrderOf,
  orderLenses,
  placeBoard,
  placeInRun,
  reseatShelf,
  shelfRun,
  appSideOrder,
  placedOnShelf,
  shelfOrderOf,
  withBoardHidden,
  withShelfOrder,
  SHELF_ORDER_ID,
  withFolders,
  withLensOrder,
  removeBoard,
  renameBoard,
  setBoardAwake,
  sortForBoard,
  TRASH_BOARD,
  adoptInspiration,
  exportFolders,
  inspirationOf,
  INSPIRATION_MARK,
  INSPIRATION_NAME,
  isBuiltIn,
  isFilable,
  placesOf,
  shouldAdoptInspiration,
} from "./boards";
import { attachment, board, note } from "../test/fixtures";
import { TRASH_DAYS } from "./trash";
import { cmpIso, editedAt } from "./versions";


/** A note written on `born` and last edited on `edited`. */
function written(id: string, born: string, edited = born): Note {
  return note({
    id,
    created_at: born,
    updated_at: edited,
    field_updated_at: { body: edited },
  });
}

const ids = (notes: Note[]) => notes.map((n) => n.id);

describe("what floats to the top of a board", () => {
  it("puts the freshest edit first, not the newest capture", () => {
    // The whole point: an old note you worked on this morning is the note you
    // are working on, and it used to sit wherever March had left it.
    const old = written("old", "2026-03-01T00:00:00.000Z", "2026-08-14T00:00:00.000Z");
    const recent = written("recent", "2026-08-01T00:00:00.000Z");
    expect(ids(sortForBoard([recent, old]))).toEqual(["old", "recent"]);
  });

  it("still puts priority above everything", () => {
    const marked = note({
      id: "marked",
      priority: 1,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      field_updated_at: { body: "2026-01-01T00:00:00.000Z" },
    });
    const fresh = written("fresh", "2026-08-14T00:00:00.000Z");
    expect(ids(sortForBoard([fresh, marked]))).toEqual(["marked", "fresh"]);
  });

  it("leaves an untouched archive in the order it was captured", () => {
    // 237 of the 241 real notes have never been edited, so for almost the whole
    // archive this has to be exactly the order it always was.
    const a = written("a", "2026-05-01T00:00:00.000Z");
    const b = written("b", "2026-06-01T00:00:00.000Z");
    const c = written("c", "2026-04-01T00:00:00.000Z");
    expect(ids(sortForBoard([a, b, c]))).toEqual(["b", "a", "c"]);
  });

  it("does not reorder the board when a note is merely filed", () => {
    // Filing writes the row (board_id, or archiving). If that counted, moving
    // a note into a folder would shuffle the board around the note that just
    // left it.
    const filed = note({
      id: "filed",
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-08-14T00:00:00.000Z",
      field_updated_at: {
        body: "2026-02-01T00:00:00.000Z",
        board_id: "2026-08-14T00:00:00.000Z",
      },
    });
    const other = written("other", "2026-07-01T00:00:00.000Z");
    expect(ids(sortForBoard([filed, other]))).toEqual(["other", "filed"]);
  });

  it("breaks a tie on the capture date, so the order is total", () => {
    const a = note({ id: "a", created_at: "2026-05-01T00:00:00.000Z", updated_at: "2026-05-01T00:00:00.000Z" });
    const b = note({ id: "b", created_at: "2026-05-01T00:00:00.000Z", updated_at: "2026-05-01T00:00:00.000Z" });
    expect(sortForBoard([a, b])).toHaveLength(2);
  });

  it("orders exactly as comparing the stamps one pair at a time did", () => {
    // The stamps are parsed once up front now (audit PERF-5). Mixed with ones
    // `Date.parse` cannot read — an empty string, a server's six-digit
    // fraction, rubbish — the order must be the one `cmpIso` gave.
    const stamps = [
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T00:00:00.000123+00:00",
      "2025-12-31T23:59:59.999Z",
      "",
      "not a date",
      "2026-09-01T10:00:00.000Z",
    ];
    const pile: Note[] = [];
    let n = 0;
    for (const born of stamps) {
      for (const edited of stamps) {
        pile.push(
          note({
            id: `n${n}`,
            priority: n % 7 === 0 ? 1 : 0,
            created_at: born,
            updated_at: edited,
            field_updated_at: edited ? { body: edited } : undefined,
          }),
        );
        n += 1;
      }
    }
    const reference = [...pile].sort(
      (a, b) =>
        b.priority - a.priority ||
        cmpIso(editedAt(b), editedAt(a)) ||
        cmpIso(b.created_at ?? "", a.created_at ?? ""),
    );
    expect(ids(sortForBoard(pile))).toEqual(ids(reference));
  });

  it("does not sort the array it was given", () => {
    const a = written("a", "2026-01-01T00:00:00.000Z");
    const b = written("b", "2026-09-01T00:00:00.000Z");
    const input = [a, b];
    sortForBoard(input);
    expect(ids(input)).toEqual(["a", "b"]);
  });

  it("reads each note's edit stamp once and still orders by it", () => {
    // The stamps are read into a side table before the comparator runs, so
    // this is the guard that the table is keyed on the right thing: three
    // notes sharing an id would collapse onto one entry, and the order would
    // silently fall back to the capture date.
    const a = written("a", "2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
    const b = written("b", "2026-01-01T00:00:00.000Z", "2026-08-01T00:00:00.000Z");
    const c = written("c", "2026-01-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    expect(ids(sortForBoard([a, b, c]))).toEqual(["b", "c", "a"]);
  });
});

/**
 * The shelf's counts take a shortcut — `countForBoard` filters and never sorts,
 * because ordering is not part of "how many". This is what holds the shortcut
 * to the long way round: the day `notesForBoard` grows a rule of its own beyond
 * the filter, the two answers part and the shelf starts lying.
 */
describe("counting a board", () => {
  const boards: Board[] = [
    { id: "inbox", name: "Inbox", kind: "inbox" },
    { id: "recent", name: "All", kind: "recent" },
    { id: "todos", name: "Todos", kind: "todos" },
    { id: "links", name: "Links", kind: "links" },
    { id: "files", name: "Files", kind: "files" },
    { id: "archive", name: "Archive", kind: "archive" },
    { id: "f1", name: "Work", kind: "folder" },
    TRASH_BOARD,
  ];
  const notes = [
    note({ id: "plain" }),
    note({ id: "filed", board_id: "f1" }),
    note({ id: "todo", note_type: "todo" }),
    note({ id: "link", body: "see https://example.com/x" }),
    note({ id: "gone", status: "archived" }),
    note({ id: "binned", status: "trashed" }),
  ];

  it("answers exactly what the board itself holds, on every board", () => {
    for (const board of boards) {
      expect(countForBoard(notes, board)).toBe(notesForBoard(notes, board).length);
    }
  });

  it("counts nothing as nothing", () => {
    expect(countForBoard([], boards[0])).toBe(0);
  });

  // The Inbox `buildBoards` makes knows which folders exist, and a note filed
  // into one that is gone is back in the pile. That is a second rule on the
  // Inbox arm, which is exactly where the shortcut could part from the filter.
  it("still agrees once the Inbox knows which folders exist", () => {
    const shelf = [...buildBoards([{ id: "f1", name: "Work", position: 0 }]), TRASH_BOARD];
    const withStranded = [...notes, note({ id: "stranded", board_id: "deleted-folder" })];
    for (const board of shelf) {
      expect(countForBoard(withStranded, board)).toBe(notesForBoard(withStranded, board).length);
    }
    // plain, link and the stranded one — the stranded one is what changed.
    expect(countForBoard(withStranded, shelf[0])).toBe(3);
  });
});

/**
 * The Inbox is the landing board, and the one board with an end to it: a note
 * arrives here by being captured and *leaves* by being filed. That is the whole
 * difference from All, which is every active note at once and can therefore
 * never reach zero.
 */
describe("the Inbox board", () => {
  const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };

  it("matches an active note in no folder, and only that", () => {
    expect(matchesBoard(note({ board_id: null }), inbox)).toBe(true);
    expect(matchesBoard(note({ board_id: "work" }), inbox)).toBe(false);
  });

  it("never matches an archived or trashed note, filed or not", () => {
    expect(matchesBoard(note({ status: "archived" }), inbox)).toBe(false);
    expect(matchesBoard(note({ status: "trashed" }), inbox)).toBe(false);
    expect(matchesBoard(note({ board_id: "work", status: "archived" }), inbox)).toBe(false);
  });

  /**
   * The condition every note in the real archive is actually in: `board_id` is
   * not null, it is *absent* — the column did not exist when they were
   * imported. Asked as `board_id === null`, the Inbox opened empty on all 241
   * of them.
   */
  it("counts a note with no board_id field at all as unfiled", () => {
    const imported = note();
    delete (imported as { board_id?: string | null }).board_id;
    expect(isFiled(imported)).toBe(false);
    expect(matchesBoard(imported, inbox)).toBe(true);
  });

  /**
   * Undoing a Move made before its folder was deleted writes the dead id back,
   * and so can a folder deleted on the other device. Read as filed, that note
   * matched no folder and not the Inbox, and showed on All and nowhere else.
   */
  it("takes back a note filed into a folder that no longer exists", () => {
    const shelf = [{ id: "work", name: "Work", position: 0 }];
    const [fromShelf] = buildBoards(shelf);
    expect(matchesBoard(note({ board_id: "work" }), fromShelf)).toBe(false);
    expect(matchesBoard(note({ board_id: "gone" }), fromShelf)).toBe(true);
    expect(isFiled(note({ board_id: "gone" }), folderIds(shelf))).toBe(false);
    expect(isFiled(note({ board_id: "work" }), folderIds(shelf))).toBe(true);
    // The first-open question counts the same pile the Inbox holds.
    expect(neverFiledCount([note({ board_id: "gone" }), note({ board_id: "work" })], folderIds(shelf))).toBe(1);
  });

  /**
   * The folder list arrives from IndexedDB a render after the notes do. Read
   * against the empty list it starts as, every filed note would pour into the
   * Inbox for a frame — so until it has been read, every id counts as a folder.
   */
  it("reads every board_id as filed while the folder list is still unknown", () => {
    const [unknown] = buildBoards([], null, false);
    expect(matchesBoard(note({ board_id: "work" }), unknown)).toBe(false);
    expect(isFiled(note({ board_id: "work" }))).toBe(true);
  });

  it("loses a note to filing, and All keeps it", () => {
    const all: Board = { id: "recent", name: "All", kind: "recent" };
    const captured = note({ board_id: null });
    expect(matchesBoard(captured, inbox)).toBe(true);
    const filed = { ...captured, board_id: "work" };
    expect(matchesBoard(filed, inbox)).toBe(false);
    expect(matchesBoard(filed, all)).toBe(true);
  });

  it("does not hold a to-do — its place is the Todos board, not the pile", () => {
    expect(matchesBoard(note({ note_type: "todo", body: "call the bank" }), inbox)).toBe(false);
    expect(matchesBoard(note({ body: "[ ] milk\n[ ] eggs" }), inbox)).toBe(false);
    // An opted-out checklist is not a to-do, so it waits in the Inbox like
    // any other unfiled note.
    expect(matchesBoard(note({ note_type: "note", body: "[ ] milk\n[ ] eggs" }), inbox)).toBe(
      true,
    );
  });

  it("is sorted like every other board — priority, then the freshest edit", () => {
    // The Inbox is not special here: a pile you are working through is still
    // ordered the way every board in the app is ordered.
    const old = written("old", "2026-03-01T00:00:00.000Z", "2026-08-14T00:00:00.000Z");
    const recent = written("recent", "2026-08-01T00:00:00.000Z");
    expect(ids(notesForBoard([recent, old], inbox))).toEqual(["old", "recent"]);
  });
});

describe("the All board", () => {
  const all: Board = { id: "recent", name: "All", kind: "recent" };

  it("matches every active note, filed or not", () => {
    expect(matchesBoard(note({ board_id: null }), all)).toBe(true);
    expect(matchesBoard(note({ board_id: "work" }), all)).toBe(true);
  });

  it("never matches archived or trashed notes", () => {
    expect(matchesBoard(note({ status: "archived" }), all)).toBe(false);
    expect(matchesBoard(note({ status: "trashed" }), all)).toBe(false);
  });
});

describe("the Todos board", () => {
  const todos: Board = { id: "todos", name: "Todos", kind: "todos" };

  it("matches a note hand-marked as a todo", () => {
    expect(matchesBoard(note({ note_type: "todo", body: "call the bank" }), todos)).toBe(true);
  });

  it("matches a note that is structurally a checklist, with no hand-marking", () => {
    const checklist = note({ body: "[ ] milk\n[ ] eggs" });
    expect(matchesBoard(checklist, todos)).toBe(true);
  });

  it("does not match an ordinary note", () => {
    expect(matchesBoard(note({ body: "just some words" }), todos)).toBe(false);
  });

  /**
   * What the selection panel's Todo row does in both directions, seen from the
   * board's side: setting the type is what puts a note here, and clearing it is
   * what takes it away — unless the note's own text is a checklist, in which
   * case it was never here on the strength of the type in the first place.
   */
  it("follows the hand-set type in both directions", () => {
    const plain = note({ body: "call the bank" });
    expect(matchesBoard(plain, todos)).toBe(false);
    expect(matchesBoard({ ...plain, note_type: "todo" }, todos)).toBe(true);
    expect(matchesBoard({ ...plain, note_type: null }, todos)).toBe(false);
  });

  it("keeps a checklist on the board after its hand-set type is cleared", () => {
    // `null` is "the user has never said", which is what every imported note
    // carries — so it leaves the note's own text to answer, and the text says
    // checklist. Saying *no* is a different value; see the next three tests.
    const checklist = note({ note_type: "todo", body: "[ ] milk\n[ ] eggs" });
    expect(matchesBoard({ ...checklist, note_type: null }, todos)).toBe(true);
  });

  /**
   * The whole point of `"note"`: a shopping list, a packing list and a list of
   * album titles are structurally identical and only one of them is a to-do.
   * Before this value existed, saying so was impossible at any price — the
   * toggle wrote `null`, which for a checklist changes nothing, so it flipped
   * its own label and the note never moved.
   */
  it("takes a checklist off the board when the user says it is not a todo", () => {
    const checklist = note({ body: "[ ] Kind of Blue\n[ ] Blue Train" });
    expect(matchesBoard(checklist, todos)).toBe(true);
    expect(matchesBoard({ ...checklist, note_type: "note" }, todos)).toBe(false);
  });

  it("puts it back when the user says it is one after all", () => {
    const opted = note({ note_type: "note", body: "[ ] milk\n[ ] eggs" });
    expect(matchesBoard({ ...opted, note_type: "todo" }, todos)).toBe(true);
  });

  it("never matches an archived or trashed todo", () => {
    const gone = note({ note_type: "todo", status: "archived" });
    expect(matchesBoard(gone, todos)).toBe(false);
  });
});

/**
 * One definition, asked by the board, by the open note's Todo-toggle and by the
 * selection panel's Todo row. Written twice they drift, and then a selection
 * reports the opposite of what the note reports about itself — which is exactly
 * the fault this predicate was extracted to end.
 */
describe("what counts as a todo", () => {
  const todos: Board = { id: "todos", name: "Todos", kind: "todos" };

  it("says yes to a hand-marked note that is not a checklist at all", () => {
    expect(isTodoNote(note({ note_type: "todo", body: "call the bank" }))).toBe(true);
  });

  it("says yes to a checklist nobody has typed", () => {
    expect(isTodoNote(note({ body: "[ ] milk\n[ ] eggs" }))).toBe(true);
    // Naming a list is not saying it is no longer a to-do.
    expect(isTodoNote(note({ body: "# Shop\n\n[ ] milk\n[ ] eggs" }))).toBe(true);
  });

  it("says no to ordinary prose, and to a checklist opted out", () => {
    expect(isTodoNote(note({ body: "just some words" }))).toBe(false);
    expect(isTodoNote(note({ note_type: "note", body: "[ ] milk\n[ ] eggs" }))).toBe(false);
  });

  /**
   * The predicate answers "is this a to-do", never "is this on the board" —
   * `matchesBoard` adds the status test every one of its arms carries. An
   * archived to-do is still a to-do, so the open note's mark goes on saying so
   * rather than offering to mark what is already marked.
   */
  it("still says yes for an archived todo, which the board does not", () => {
    const gone = note({ note_type: "todo", status: "archived" });
    expect(isTodoNote(gone)).toBe(true);
    expect(matchesBoard(gone, todos)).toBe(false);
  });

  it("is what the board is written against", () => {
    const cases = [
      note({ body: "[ ] milk\n[ ] eggs" }),
      note({ note_type: "note", body: "[ ] milk\n[ ] eggs" }),
      note({ note_type: "todo", body: "call the bank" }),
      note({ body: "just some words" }),
    ];
    for (const n of cases) expect(matchesBoard(n, todos)).toBe(isTodoNote(n));
  });
});

describe("a note that is nothing but a link", () => {
  const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };
  const all: Board = { id: "recent", name: "All", kind: "recent" };
  const links: Board = { id: "links", name: "Links", kind: "links" };
  const bare = () => note({ body: "https://example.com/a\nhttps://example.com/b" });

  it("lives on Links alone — not the Inbox, not All", () => {
    expect(linksOnly(bare())).toBe(true);
    expect(matchesBoard(bare(), links)).toBe(true);
    expect(matchesBoard(bare(), inbox)).toBe(false);
    expect(matchesBoard(bare(), all)).toBe(false);
  });

  it("is not counted in the pile the first-open question is about", () => {
    expect(neverFiledCount([bare(), note({ body: "a thought" })])).toBe(1);
  });

  it("ignores Keep's Saved link: prefix and the dashes between addresses", () => {
    expect(linksOnly(note({ body: "Saved link: https://example.com" }))).toBe(true);
    expect(linksOnly(note({ body: "- https://a.example\n- https://b.example" }))).toBe(true);
  });

  it("is an ordinary note once one word stands beside the address", () => {
    const worded = note({ body: "recipe https://example.com" });
    expect(linksOnly(worded)).toBe(false);
    expect(matchesBoard(worded, inbox)).toBe(true);
    expect(matchesBoard(worded, all)).toBe(true);
  });

  it("is an ordinary note once it carries a file", () => {
    const withFile = note({ body: "https://example.com", attachments: [attachment()] });
    expect(linksOnly(withFile)).toBe(false);
  });

  it("is an ordinary note once it is filed, and then All holds it too", () => {
    const shelf = [{ id: "work", name: "Work", position: 0 }];
    const boards = buildBoards(shelf);
    const allFromShelf = boards.find((b) => b.kind === "recent")!;
    const filed = { ...bare(), board_id: "work" };
    expect(linksOnly(filed, folderIds(shelf))).toBe(false);
    expect(matchesBoard(filed, allFromShelf)).toBe(true);
    // Filed into a folder that no longer exists is not filed at all.
    expect(matchesBoard({ ...bare(), board_id: "gone" }, allFromShelf)).toBe(false);
  });

  /**
   * The case the rule first got wrong (review of 2026-09-21, item 32): a flag
   * or a reminder is the user asking to see the note, so a bare link marked
   * either way must not quietly leave the Inbox the moment it is marked.
   */
  it("stays in the Inbox and on All once it is flagged or given a reminder", () => {
    const flagged = { ...bare(), priority: 1 };
    const ringing = { ...bare(), reminder_at: "2026-10-01T09:00:00.000Z" };
    for (const marked of [flagged, ringing]) {
      expect(linksOnly(marked)).toBe(false);
      expect(matchesBoard(marked, inbox)).toBe(true);
      expect(matchesBoard(marked, all)).toBe(true);
    }
  });

  it("leaves the Inbox for Todos when it is marked as a to-do", () => {
    const todo = { ...bare(), note_type: "todo" as const };
    expect(linksOnly(todo)).toBe(false);
    expect(matchesBoard(todo, inbox)).toBe(false);
    expect(matchesBoard(todo, all)).toBe(true);
  });

  it("is untouched in Archive and Trash, where the user put it", () => {
    const archive: Board = { id: "archive", name: "Archive", kind: "archive" };
    expect(matchesBoard({ ...bare(), status: "archived" }, archive)).toBe(true);
  });
});

describe("the Links board", () => {
  const links: Board = { id: "links", name: "Links", kind: "links" };

  it("matches any note that contains a URL anywhere in its text", () => {
    const buried = note({ body: "Notes from the call.\n\nSee https://example.com/doc for the recording." });
    expect(matchesBoard(buried, links)).toBe(true);
  });

  it("matches a note that is entirely a saved link, same as before", () => {
    expect(matchesBoard(note({ body: "https://example.com" }), links)).toBe(true);
  });

  it("does not match a note with no address in it", () => {
    expect(matchesBoard(note({ body: "just some words" }), links)).toBe(false);
  });
});

/**
 * A note with words beside its address is an ordinary note to `linksOnly`, so
 * it sat in the Inbox with nowhere to go — Links is a lens, and nothing could
 * be filed into it. The Move chooser's Links row puts it there by hand.
 */
describe("a note put on Links by hand", () => {
  const inbox: Board = { id: "inbox", name: "Inbox", kind: "inbox" };
  const all: Board = { id: "recent", name: "All", kind: "recent" };
  const links: Board = { id: "links", name: "Links", kind: "links" };
  const todos: Board = { id: "todos", name: "Todos", kind: "todos" };
  const worded = () => note({ body: "bread recipe to try https://example.com/bread" });
  const moved = (n: Note) => ({ ...n, ...linksPatch() });

  it("leaves the Inbox for Links, and All still holds it", () => {
    expect(matchesBoard(worded(), inbox)).toBe(true);
    const there = moved(worded());
    expect(keptOnLinks(there)).toBe(true);
    expect(matchesBoard(there, inbox)).toBe(false);
    expect(matchesBoard(there, links)).toBe(true);
    expect(matchesBoard(there, all)).toBe(true);
  });

  it("leaves its folder on the way — a note is in one place", () => {
    const filed = { ...worded(), board_id: "work" };
    const there = moved(filed);
    expect(there.board_id).toBeNull();
    expect(matchesBoard(there, { id: "work", name: "Work", kind: "folder" })).toBe(false);
  });

  it("stays on Links though its address is deleted, because the user put it there", () => {
    expect(matchesBoard({ ...moved(worded()), body: "bread recipe to try" }, links)).toBe(true);
  });

  it("is not counted in the pile the first-open question is about", () => {
    expect(neverFiledCount([moved(worded()), worded()])).toBe(1);
  });

  it("stops reading as a to-do, though every line of it is a tick box", () => {
    const list = note({ body: "[ ] https://a.example\n[ ] https://b.example" });
    expect(isTodoNote(list)).toBe(true);
    expect(isTodoNote(moved(list))).toBe(false);
    expect(matchesBoard(moved(list), todos)).toBe(false);
  });

  it("comes off Links when it is filed into a folder or back into the Inbox", () => {
    const there = moved(worded());
    expect(filePatch(there, "work")).toEqual({ board_id: "work", note_type: null });
    const back = { ...there, ...filePatch(there, null) };
    expect(matchesBoard(back, inbox)).toBe(true);
    // A note never put there keeps its type when it is filed.
    expect(filePatch({ ...worded(), note_type: "todo" }, "work")).toEqual({ board_id: "work" });
  });

  it("is offered only to a note with an address that is not there already", () => {
    expect(canKeepOnLinks(worded())).toBe(true);
    expect(canKeepOnLinks(moved(worded()))).toBe(false);
    expect(canKeepOnLinks(note({ body: "just some words" }))).toBe(false);
  });
});

describe("the Files board", () => {
  const files: Board = { id: "files", name: "Files", kind: "files" };
  const attachment = {
    id: "a1",
    name: "photo.jpg",
    mime: "image/jpeg",
    size: 1000,
    width: 100,
    height: 100,
    thumb: null,
    path: null,
    added_at: "2026-01-01T00:00:00.000Z",
  };

  it("matches any note carrying an attachment", () => {
    expect(matchesBoard(note({ attachments: [attachment] }), files)).toBe(true);
  });

  it("does not match a note with no attachment", () => {
    expect(matchesBoard(note(), files)).toBe(false);
  });
});

describe("a folder board", () => {
  const work: Board = { id: "board-1", name: "Work", kind: "folder" };

  it("matches a note filed into it, and only that one", () => {
    expect(matchesBoard(note({ board_id: "board-1" }), work)).toBe(true);
    expect(matchesBoard(note({ board_id: "board-2" }), work)).toBe(false);
    expect(matchesBoard(note({ board_id: null }), work)).toBe(false);
  });

  it("never matches an archived or trashed note, filed or not", () => {
    expect(matchesBoard(note({ board_id: "board-1", status: "archived" }), work)).toBe(false);
    expect(matchesBoard(note({ board_id: "board-1", status: "trashed" }), work)).toBe(false);
  });
});

/**
 * The shelf divides on what a board *does*, not on who made it.
 *
 * Places — Inbox, the user's folders, Archive, Trash — are somewhere a note is,
 * and it is in exactly one of them. Lenses — Todos, Links, Files, All — hold
 * nothing of their own and overlap freely, which is why the counts along the
 * strip necessarily sum to more than the archive holds. The old order ran the
 * app's own boards and then the user's, which put the four rows you can never
 * file into between the Inbox and every destination you own.
 */
describe("buildBoards", () => {
  it("runs places first — Inbox, the folders, Archive — then the lenses", () => {
    const boards = buildBoards([
      { id: "b2", name: "Recipes", position: 1 },
      { id: "b1", name: "Work", position: 0 },
    ]);
    expect(boards.map((b) => b.kind)).toEqual([
      "inbox",
      "folder",
      "folder",
      "archive",
      "todos",
      "links",
      "files",
      "recent",
    ]);
  });

  /** Several things read `counts[0]` and `goToBoard(0)` and mean the Inbox by
   *  it — the menu's *Bring in the old notes* row, and where you land after
   *  deleting the folder you were standing on. */
  it("keeps the Inbox at index 0, folders or no folders", () => {
    expect(buildBoards([])[0].kind).toBe("inbox");
    expect(buildBoards([{ id: "b1", name: "Work", position: 0 }])[0].kind).toBe("inbox");
  });

  it("puts the user's own folders in shelf order, one step from the Inbox", () => {
    const userBoards: UserBoard[] = [
      { id: "b2", name: "Recipes", position: 1 },
      { id: "b1", name: "Work", position: 0 },
    ];
    const boards = buildBoards(userBoards);
    const folderNames = boards.filter((b) => b.kind === "folder").map((b) => b.name);
    expect(folderNames).toEqual(["Work", "Recipes"]);
    expect(boards[1].name).toBe("Work");
  });

  it("closes the places with Archive rather than opening the lenses with it", () => {
    const boards = buildBoards([{ id: "b1", name: "Work", position: 0 }]);
    const archive = boards.findIndex((b) => b.kind === "archive");
    expect(boards[archive - 1].kind).toBe("folder");
    expect(isLens(boards[archive])).toBe(false);
    expect(isLens(boards[archive + 1])).toBe(true);
  });

  /**
   * The strip has one boundary between places and lenses, drawn as the lifted
   * band (`data-lens` in App.tsx), and where it falls is decided by the first
   * `isLens` on the shelf. Two runs, one
   * boundary: if this ever finds a second crossing, the strip has grown a
   * second rule and the divider has stopped meaning what it says.
   */
  it("crosses from places to lenses exactly once, and never back", () => {
    const boards = buildBoards([
      { id: "b1", name: "Work", position: 0 },
      { id: "b2", name: "Recipes", position: 1 },
    ]);
    const crossings = boards.filter((b, i) => i > 0 && isLens(b) && !isLens(boards[i - 1]));
    expect(crossings).toHaveLength(1);
    expect(crossings[0].kind).toBe("todos");
    // Nothing crosses back: once you are past the line, every row is a lens.
    const first = boards.findIndex(isLens);
    expect(boards.slice(first).every(isLens)).toBe(true);
  });

  /** The widest lens there is, so it sits at the far end of them. */
  it("ends on All", () => {
    const boards = buildBoards([]);
    expect(boards[boards.length - 1].kind).toBe("recent");
    expect(boards[boards.length - 1].name).toBe("All");
  });
});

/**
 * "Recent" and "Inbox" both meant *newly arrived*, which is the confusion that
 * started the whole reordering: two adjacent rows making the same promise, one
 * of which could never keep it. Only the display name changed — `kind` is what
 * every rule in this file is written against.
 */
describe("the board named All", () => {
  it("is called All and is still `kind: recent`", () => {
    const all = buildBoards([]).find((b) => b.kind === "recent")!;
    expect(all.name).toBe("All");
    expect(all.id).toBe("recent");
  });

  it("leaves no board on the shelf called Recent", () => {
    const names = [...buildBoards([]), TRASH_BOARD].map((b) => b.name);
    expect(names).not.toContain("Recent");
  });
});

describe("isLens", () => {
  it("calls the derived views lenses and everywhere a note can be put a place", () => {
    const shelf = [...buildBoards([{ id: "b1", name: "Work", position: 0 }]), TRASH_BOARD];
    const lenses = shelf.filter(isLens).map((b) => b.kind);
    const places = shelf.filter((b) => !isLens(b)).map((b) => b.kind);
    expect(lenses).toEqual(["todos", "links", "files", "recent"]);
    expect(places).toEqual(["inbox", "folder", "archive", "trash"]);
  });
});

describe("canScopeSearch", () => {
  it("offers to search only here on a folder, Inspiration, the Archive and Links, and nowhere else", () => {
    const shelf = [
      ...buildBoards([{ id: "b1", name: "Work", position: 0 }], null, true, null, {
        id: "i1",
        name: "Inspiration",
        position: 1,
        kind: "inspiration",
      }),
      TRASH_BOARD,
    ];
    // The places a note is only because somebody put it there — a folder,
    // Inspiration (audit UX-7), the Archive — and Links, where "only the saved
    // pages" is the search (review FX-A-06). Not the Inbox (it empties, and is
    // on screen), not another lens, not the bin.
    expect(shelf.filter(canScopeSearch).map((b) => b.kind).sort()).toEqual([
      "archive",
      "folder",
      "inspiration",
      "links",
    ]);
  });
});

describe("board name and folder-list surgery", () => {
  it("accepts a name between 1 and 40 characters, trimmed", () => {
    expect(isBoardName("Work")).toBe(true);
    expect(isBoardName("  Work  ")).toBe(true);
    expect(isBoardName("")).toBe(false);
    expect(isBoardName("   ")).toBe(false);
    expect(isBoardName("x".repeat(41))).toBe(false);
  });

  it("createBoard appends at the next position", () => {
    const existing: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];
    const created = createBoard("Recipes", existing);
    expect(created.name).toBe("Recipes");
    expect(created.position).toBe(1);
  });

  it("renameBoard changes only the named board", () => {
    const existing: UserBoard[] = [
      { id: "b1", name: "Work", position: 0 },
      { id: "b2", name: "Recipes", position: 1 },
    ];
    const renamed = renameBoard(existing, "b1", "Projects");
    expect(renamed.find((b) => b.id === "b1")?.name).toBe("Projects");
    expect(renamed.find((b) => b.id === "b2")?.name).toBe("Recipes");
  });

  it("removeBoard drops only the named board", () => {
    const existing: UserBoard[] = [
      { id: "b1", name: "Work", position: 0 },
      { id: "b2", name: "Recipes", position: 1 },
    ];
    expect(removeBoard(existing, "b1").map((b) => b.id)).toEqual(["b2"]);
  });
});

/**
 * `position` existed, synced and sorted the shelf from the day folders did, and
 * for all of that time nothing anywhere could change it: `createBoard` appended
 * and that was the order forever. Nothing validated it either, so the list this
 * is handed is not guaranteed to be `0..n-1` — which is the whole reason the run
 * is renumbered rather than having two values swapped in it.
 */
describe("moveBoard", () => {
  const three: UserBoard[] = [
    { id: "b1", name: "Work", position: 0 },
    { id: "b2", name: "Recipes", position: 1 },
    { id: "b3", name: "Garden", position: 2 },
  ];

  it("moves a folder one step towards the Inbox, and renumbers the run", () => {
    const moved = moveBoard(three, "b3", -1);
    expect(moved.map((b) => b.name)).toEqual(["Work", "Garden", "Recipes"]);
    expect(moved.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  it("moves one step away from it too", () => {
    const moved = moveBoard(three, "b1", 1);
    expect(moved.map((b) => b.name)).toEqual(["Recipes", "Work", "Garden"]);
    expect(moved.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  it("is what the shelf then draws", () => {
    const shelf = buildBoards(moveBoard(three, "b3", -1));
    expect(shelf.filter((b) => b.kind === "folder").map((b) => b.name)).toEqual([
      "Work",
      "Garden",
      "Recipes",
    ]);
  });

  /**
   * The failure a swap would have had, and the reason there is no swap here.
   * Two folders both sitting at 0 is a perfectly reachable state — nothing has
   * ever written this field, let alone checked it — and exchanging two equal
   * numbers is a control that does nothing while looking like it worked.
   */
  it("moves a folder whose position is a duplicate of its neighbour's", () => {
    const duplicated: UserBoard[] = [
      { id: "b1", name: "Work", position: 0 },
      { id: "b2", name: "Recipes", position: 0 },
      { id: "b3", name: "Garden", position: 0 },
    ];
    const moved = moveBoard(duplicated, "b3", -1);
    expect(moved.map((b) => b.name)).toEqual(["Work", "Garden", "Recipes"]);
    expect(moved.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  it("moves a folder out of a sparse run, and closes the gaps on the way", () => {
    const sparse: UserBoard[] = [
      { id: "b1", name: "Work", position: -4 },
      { id: "b2", name: "Recipes", position: 7 },
      { id: "b3", name: "Garden", position: 900 },
    ];
    const moved = moveBoard(sparse, "b1", 1);
    expect(moved.map((b) => b.name)).toEqual(["Recipes", "Work", "Garden"]);
    expect(moved.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  /**
   * Returned by identity, which is what tells `useBoards` that nothing happened
   * — committing a list nobody changed would stamp the synced preferences row
   * dirty and offer this device's folders up against the other device's.
   */
  it("hands back the same list for a step off either end", () => {
    expect(moveBoard(three, "b1", -1)).toBe(three);
    expect(moveBoard(three, "b3", 1)).toBe(three);
    expect(moveBoard(three, "nope", -1)).toBe(three);
    expect(moveBoard([], "b1", 1)).toEqual([]);
  });

  it("gives a lone folder nowhere to go in either direction", () => {
    const one: UserBoard[] = [{ id: "b1", name: "Work", position: 0 }];
    expect(moveBoard(one, "b1", -1)).toBe(one);
    expect(moveBoard(one, "b1", 1)).toBe(one);
  });

  it("orders folders the way the shelf draws them, without touching the caller's array", () => {
    const unsorted: UserBoard[] = [
      { id: "b2", name: "Recipes", position: 1 },
      { id: "b1", name: "Work", position: 0 },
    ];
    expect(orderedBoards(unsorted).map((b) => b.name)).toEqual(["Work", "Recipes"]);
    expect(unsorted.map((b) => b.name)).toEqual(["Recipes", "Work"]);
  });
});

/**
 * An empty board says what its zero means and the shortest real step that
 * fills it (review CD-08). The bar is that step on the Inbox, and on a folder,
 * where a note written while standing in it is filed there — and on no lens,
 * Archive or Trash, where the bar would land the note somewhere else.
 */
describe("an empty board names the thing that fills it", () => {
  const everyBoard = [...buildBoards([{ id: "b1", name: "Work", position: 0 }]), TRASH_BOARD];

  it("offers the bar on a folder, and nowhere else", () => {
    const mentionsTheBar = everyBoard.filter((board) => /(bar )?below/.test(emptyBoardHint(board)));
    // The Inbox no longer says it: the write box names where a capture lands
    // (`writeHint`), and the words here stay short (joy review 2026-10-14, #8).
    expect(mentionsTheBar.map((b) => b.kind).sort()).toEqual(["folder"]);
  });

  it("heads every empty board with its name, and calls an empty Inbox finished", () => {
    for (const board of everyBoard) expect(emptyBoardTitle(board)).toBe(board.name);
    expect(emptyBoardHint(buildBoards([])[0])).toMatch(/^Nothing to tidy./);
    for (const board of everyBoard.slice(1)) {
      expect(emptyBoardHint(board)).not.toMatch(/Nothing to tidy/);
    }
  });

  it("never tells the user to write into the trash, and says how long it keeps a note", () => {
    expect(emptyBoardHint(TRASH_BOARD)).not.toMatch(/write/i);
    expect(emptyBoardHint(TRASH_BOARD)).toContain(`${TRASH_DAYS} days`);
  });

  it("leads each board with its shortest real step, in the app's own words", () => {
    const hint = (kind: string) => emptyBoardHint(everyBoard.find((b) => b.kind === kind)!);
    expect(hint("folder")).toBe(
      "Nothing here yet. Write below, or hold a note and move it in.",
    );
    expect(hint("todos")).toBe("Things to do. Mark a note as a to-do, or start a line with [ ].");
    expect(hint("archive")).toMatch(/^Put away, not gone\. Open a note and press Archive/);
    // The glossary: To-do in prose, never "todo"; no capitalised verb mid-sentence;
    // no "mark" for a button.
    for (const board of everyBoard) {
      const words = emptyBoardHint(board);
      expect(words).not.toMatch(/\btodo\b/);
      expect(words).not.toMatch(/ Move /);
      expect(words).not.toMatch(/archive mark/);
    }
  });

  it("says something, and something different, for every board there is", () => {
    // Called one argument at a time on purpose: `map(emptyBoardHint)` would
    // hand the index in as `heldOutside` and quietly test a different sentence.
    const hints = everyBoard.map((board) => emptyBoardHint(board));
    expect(hints.every((hint) => hint.trim().length > 0)).toBe(true);
    expect(new Set(hints).size).toBe(hints.length);
  });
});

/**
 * The Inbox's third zero: an archive with no active note in it.
 *
 * The other zeros are achievements — a pile sorted down to nothing, and the
 * same with notes parked outside it. This one is a user who has just arrived,
 * and "Everything is filed" is the app's first sentence to them. One sentence
 * of where a note goes, nothing else (review GD-10): the tick-box tip is gone
 * now the To-do mark makes lists.
 */
describe("an Inbox in an archive nothing has ever been written into", () => {
  const shelf = [...buildBoards([{ id: "b1", name: "Work", position: 0 }]), TRASH_BOARD];
  const inbox = shelf[0];

  it("does not call an untouched archive finished", () => {
    expect(emptyBoardHint(inbox, 0, true)).not.toMatch(/Nothing to tidy/);
    expect(emptyBoardHint(inbox, 0, true)).not.toMatch(/filed/i);
  });

  it("says what the app is, where a first note goes, and still offers the bar (review UX-10)", () => {
    expect(emptyBoardHint(inbox, 0, true)).toBe(
      "A notes app where you just write. Type in the bar below, and sort it into boards later.",
    );
  });

  it("drops the tick-box tip from every Inbox", () => {
    expect(emptyBoardHint(inbox, 0, true)).not.toMatch(/\[\]/);
    expect(emptyBoardHint(inbox)).not.toMatch(/\[\]/);
  });

  /** Voice, §11: an invitation, not a mood. No exclamation, no welcome, no
   *  praise for arriving. */
  it("keeps the voice it has everywhere else", () => {
    const words = `${emptyBoardTitle(inbox)} ${emptyBoardHint(inbox, 0, true)}`;
    expect(words).not.toMatch(/[!]/);
    expect(words).not.toMatch(/welcome|get started|let's|congrat/i);
  });

  /** The achievement wording is untouched — this is a third case, not a
   *  replacement for the two that were already right. */
  it("leaves both of the other zeros alone", () => {
    expect(emptyBoardHint(inbox)).toMatch(/Nothing to tidy/);
    expect(emptyBoardHint(inbox)).toMatch(/Everything is filed/);
    expect(emptyBoardHint(inbox, 180)).toMatch(/180 older notes/);
  });

  /** Only the Inbox lies at zero: every other board names the action that
   *  fills it, which is as true of an empty archive as of a full one. */
  it("is ignored by every other board", () => {
    for (const board of shelf.slice(1)) {
      expect(emptyBoardHint(board, 0, true)).toBe(emptyBoardHint(board));
    }
  });
});

/**
 * The Inbox's fourth zero: empty because what was written went to Todos or
 * Links on its own (review UX-B-02). "Everything is filed" over a list that
 * was never filed read as the note being lost.
 */
describe("an empty Inbox whose notes wait on Todos or Links", () => {
  const shelf = buildBoards([{ id: "b1", name: "Work", position: 0 }]);
  const inbox = shelf[0];

  it("names the board each one waits on, and never calls them filed", () => {
    expect(emptyBoardHint(inbox, 0, false, { todos: 1, links: 0 })).toBe(
      "Inbox is clear. Lists wait on Todos.",
    );
    expect(emptyBoardHint(inbox, 0, false, { todos: 0, links: 2 })).toBe(
      "Inbox is clear. Bare links wait on Links.",
    );
    expect(emptyBoardHint(inbox, 0, false, { todos: 1, links: 1 })).toBe(
      "Inbox is clear. Lists wait on Todos, bare links on Links.",
    );
    expect(emptyBoardHint(inbox, 0, false, { todos: 1, links: 1 })).not.toMatch(/filed/);
  });

  it("is ignored by every other board", () => {
    for (const board of shelf.slice(1)) {
      expect(emptyBoardHint(board, 0, false, { todos: 3, links: 3 })).toBe(emptyBoardHint(board));
    }
  });

  it("counts unfiled to-dos and bare links, and nothing filed or put away", () => {
    const list = note({ id: "l", body: "[ ] eggs\n[ ] bread" });
    const marked = note({ id: "m", body: "call Jon", note_type: "todo" });
    const bare = note({ id: "u", body: "https://example.com" });
    const kept = note({ id: "k", body: "read this https://example.com", note_type: "link" });
    const filedList = note({ id: "f", body: "[ ] a\n[ ] b", board_id: "b1" });
    const archived = note({ id: "a", body: "[ ] a\n[ ] b", status: "archived" });
    const plain = note({ id: "p", body: "just words" });
    expect(waitingElsewhere([list, marked, bare, kept, filedList, archived, plain], inbox)).toEqual({
      todos: 2,
      links: 2,
    });
  });
});

/**
 * An empty Inbox is an achievement — unless it is empty because a couple of
 * hundred never-filed notes are being held outside it by the answer to the
 * first-open question. Nothing else on screen mentions them again, so the one
 * board that is lying about them is the one that has to say so.
 */
describe("an empty Inbox with notes held outside it", () => {
  const shelf = [...buildBoards([{ id: "b1", name: "Work", position: 0 }]), TRASH_BOARD];
  const inbox = shelf[0];

  it("names how many are out there, and the way back", () => {
    const hint = emptyBoardHint(inbox, 180);
    expect(hint).toMatch(/180 older notes/);
    expect(hint).toMatch(/outside the Inbox/);
    expect(hint).toMatch(/menu/);
  });

  it("counts one note as one note", () => {
    expect(emptyBoardHint(inbox, 1)).toMatch(/1 older note is/);
  });

  it("keeps the ordinary words when nothing is being held", () => {
    expect(emptyBoardHint(inbox, 0)).toBe(emptyBoardHint(inbox));
    expect(emptyBoardHint(inbox)).toMatch(/^Nothing to tidy\. Everything is filed\.$/);
  });

  /** The Inbox is still finished as a pile, and what the line adds is that
   *  the pile was not all of it. */
  it("still calls the empty Inbox finished", () => {
    expect(emptyBoardHint(inbox, 180)).toMatch(/^Nothing to tidy here/);
  });

  /** Only the Inbox holds anything outside itself; the count is meaningless on
   *  every other board and must change nothing there. */
  it("is ignored by every other board", () => {
    for (const board of shelf.slice(1)) {
      expect(emptyBoardHint(board, 180)).toBe(emptyBoardHint(board));
    }
  });
});

/**
 * The bug this pins: on a phone, opening the app played the vanish animation —
 * a shrinking card and a *delete* mark — over every note on the board at once.
 *
 * `inboxSince` is read from IndexedDB and is `null` for a render on every
 * start, so the Inbox first matches every unfiled note and then, a beat later,
 * only the ones written since the line was drawn. The grid measures cards
 * before and after to work out what left; keyed on the board's id alone, that
 * settling was indistinguishable from the entire pile being taken off the
 * board in one frame.
 */
describe("a board's view key", () => {
  it("changes when the Inbox learns where it starts", () => {
    const before = buildBoards([], null)[0];
    const after = buildBoards([], "2026-08-01T00:00:00.000Z")[0];

    expect(before.kind).toBe("inbox");
    expect(after.kind).toBe("inbox");
    expect(before.id).toBe(after.id);
    // The id alone cannot tell these apart, which is exactly what went wrong.
    expect(boardViewKey(before)).not.toBe(boardViewKey(after));
  });

  it("changes again when the answer changes", () => {
    const leaveThemOut = buildBoards([], "2026-08-01T00:00:00.000Z")[0];
    const bringThemIn = buildBoards([], new Date(0).toISOString())[0];
    expect(boardViewKey(leaveThemOut)).not.toBe(boardViewKey(bringThemIn));
  });

  it("is just the id for every board that filters on nothing", () => {
    for (const board of [...buildBoards([]).slice(1), TRASH_BOARD]) {
      expect(boardViewKey(board)).toBe(board.id);
    }
  });

  it("keeps two different folders apart", () => {
    const [kitchen, garden] = buildBoards([
      { id: "b1", name: "Kitchen", position: 0 },
      { id: "b2", name: "Garden", position: 1 },
    ]).filter((b) => b.kind === "folder");
    expect(boardViewKey(kitchen)).not.toBe(boardViewKey(garden));
  });
});

describe("where a note is to be found", () => {
  const folders: UserBoard[] = [{ id: "f1", name: "Recipes", position: 0 }];
  const shelf = buildBoards(folders, null);
  const home = (over: Partial<Note>) => homeBoard(note({ body: "soup", raw_content: "soup", ...over }), shelf)?.name;

  it("names the folder a filed note is in", () => {
    expect(home({ board_id: "f1" })).toBe("Recipes");
  });

  it("names the Inbox for an unfiled note", () => {
    expect(home({})).toBe("Inbox");
  });

  it("names the board that keeps what the Inbox does not", () => {
    // A to-do's place is Todos, and a bare address's is Links — the first
    // board along the shelf that holds each, never All.
    expect(home({ note_type: "todo" })).toBe("Todos");
    expect(home({ body: "https://example.com/a", raw_content: "https://example.com/a" })).toBe("Links");
    expect(home({ note_type: "link", body: "a page https://example.com/a" })).toBe("Links");
  });

  it("names the Archive for an archived note, and nothing for a trashed one", () => {
    expect(home({ status: "archived" })).toBe("Archive");
    expect(home({ status: "trashed" })).toBeUndefined();
  });
});

/**
 * Holding a board on the shelf and carrying it reorders it (the owner's ask of
 * 2026-09-29). Two runs move — the folders, and Todos · Links · Files — and a
 * board moves only inside its own, so the hairline between places and lenses
 * says what it has always said. The Inbox, Archive, All and Trash keep their
 * seats; `lib/boards.ts` has the reason for each.
 */
describe("the shelf's own order", () => {
  const folders: UserBoard[] = [
    { id: "b1", name: "Work", position: 0 },
    { id: "b2", name: "Recipes", position: 1 },
    { id: "b3", name: "Garden", position: 2 },
  ];

  it("moves everything but the Inbox and the Trash (2026-10-23)", () => {
    const shelf = [...buildBoards(folders), TRASH_BOARD];
    expect(shelf.filter(canMoveBoard).map((b) => b.id)).toEqual([
      "b1",
      "b2",
      "b3",
      "archive",
      "todos",
      "links",
      "files",
      "recent",
    ]);
  });

  it("hands a board only its own run, so no carry can cross the hairline", () => {
    const shelf = buildBoards(folders);
    expect(shelfRun(shelf, "b2")).toEqual(["b1", "b2", "b3", "archive"]);
    expect(shelfRun(shelf, "archive")).toEqual(["b1", "b2", "b3", "archive"]);
    expect(shelfRun(shelf, "links")).toEqual(["todos", "links", "files", "recent"]);
    for (const fixed of ["inbox", "trash", "nope"]) {
      expect(shelfRun(shelf, fixed)).toBeNull();
    }
  });

  it("seats Archive among the folders, and back at the end when its folder is gone", () => {
    const ids = (list: UserBoard[]) => buildBoards(foldersOf(list), null, true, shelfOrderOf(list)).map((b) => b.id);
    const stored = withShelfOrder(folders, { archiveAfter: "b1" });
    expect(ids(stored)).toEqual(["inbox", "b1", "archive", "b2", "b3", "todos", "links", "files", "recent"]);
    expect(ids(withShelfOrder(folders, { archiveAfter: null })).slice(0, 3)).toEqual(["inbox", "archive", "b1"]);
    expect(ids(withShelfOrder(folders, { archiveAfter: "gone" })).slice(3, 5)).toEqual(["b3", "archive"]);
  });

  it("carries Archive and a folder in one run, writing Archive's seat as the folder it follows", () => {
    const shelf = buildBoards(folders);
    const run = shelfRun(shelf, "archive")!;
    const first = placedOnShelf(folders, shelf, run, "archive", 1);
    expect(shelfOrderOf(first).archiveAfter).toBe("b1");
    // Back at the end is no seat at all, so a folder made later still lands before it.
    const back = placedOnShelf(first, buildBoards(foldersOf(first), null, true, shelfOrderOf(first)), shelfRun(buildBoards(foldersOf(first), null, true, shelfOrderOf(first)), "archive")!, "archive", 3);
    expect(shelfOrderOf(back).archiveAfter).toBeUndefined();
    // A folder carried past an Archive that stays at the end makes no shelf entry.
    const folderOnly = placedOnShelf(folders, shelf, run, "b3", 0);
    expect(folderOnly.some((b) => b.id === SHELF_ORDER_ID)).toBe(false);
    expect(orderedBoards(foldersOf(folderOnly)).map((b) => b.id)).toEqual(["b3", "b1", "b2"]);
    expect(placedOnShelf(folders, shelf, run, "b1", 0)).toBe(folders);
  });

  it("moves Archive alone without renumbering the folders, so it claims no folder order", () => {
    const gappy: UserBoard[] = [
      { id: "b1", name: "Work", position: 0 },
      { id: "b3", name: "Garden", position: 5 },
    ];
    const shelf = buildBoards(gappy);
    const next = placedOnShelf(gappy, shelf, shelfRun(shelf, "archive")!, "archive", 0);
    expect(foldersOf(next).map((b) => b.position)).toEqual([0, 5]);
    expect(shelfOrderOf(next).archiveAfter).toBeNull();
  });

  it("carries All and the lenses in one run, and writes the lens order an older device reads", () => {
    const shelf = buildBoards(folders);
    const run = shelfRun(shelf, "recent")!;
    const next = placedOnShelf(folders, shelf, run, "recent", 0);
    const order = shelfOrderOf(next);
    expect(order.builtIns).toEqual(["inspiration", "recent", "todos", "links", "files"]);
    expect(order.lenses).toEqual(["todos", "links", "files"]);
    expect(buildBoards(folders, null, true, order).slice(-4).map((b) => b.id)).toEqual(["recent", "todos", "links", "files"]);
  });

  it("keeps an older device's lens move inside the whole order", () => {
    const order = { ...shelfOrderOf(withShelfOrder(folders, { builtIns: ["recent", "todos", "links", "files"] })), lenses: ["files", "todos", "links"] };
    expect(appSideOrder(order)).toEqual(["inspiration", "recent", "files", "todos", "links"]);
    // An entry with only the lens order, as an older device wrote it, reads as it always did.
    expect(buildBoards(folders, null, true, ["links", "todos", "files"]).slice(-4).map((b) => b.id)).toEqual(["links", "todos", "files", "recent"]);
  });

  it("hides a built-in board from the shelf, never the Inbox, and moves no note", () => {
    const stored = withBoardHidden(withBoardHidden(folders, "links", true), "archive", true);
    const shelf = buildBoards(folders, null, true, shelfOrderOf(stored));
    expect(shelf.map((b) => b.id)).toEqual(["inbox", "b1", "b2", "b3", "todos", "files", "recent"]);
    expect(withBoardHidden(stored, "links", true)).toBe(stored);
    const shown = withBoardHidden(stored, "links", false);
    expect(shelfOrderOf(shown).hidden).toEqual(["archive"]);
    // A hidden board's run skips it, and carrying writes the hidden one's seat back untouched.
    const run = shelfRun(shelf, "todos")!;
    expect(run).toEqual(["todos", "files", "recent"]);
    expect(shelfOrderOf(placedOnShelf(stored, shelf, run, "recent", 0)).builtIns).toEqual(["inspiration", "recent", "links", "todos", "files"]);
    // An unknown key in the stored list is ignored.
    expect(shelfOrderOf(withShelfOrder(folders, { hidden: ["inbox", "todos"] })).hidden).toEqual(["todos"]);
  });

  it("names All only when nothing narrower holds the note, wherever All stands", () => {
    const allFirst = buildBoards([], null, true, { lenses: null, builtIns: ["recent", "todos"], archiveAfter: undefined, hidden: [] });
    const todo = note({ id: "t", body: "[ ] a\n[ ] b", raw_content: "[ ] a\n[ ] b" });
    expect(homeBoard(todo, allFirst)?.id).toBe("todos");
  });

  it("puts a folder down anywhere in its run, renumbered, and gives back the same list for a non-move", () => {
    const moved = placeBoard(folders, "b3", 0);
    expect(orderedBoards(moved).map((b) => b.name)).toEqual(["Garden", "Work", "Recipes"]);
    expect(moved.map((b) => b.position)).toEqual([0, 1, 2]);
    expect(placeBoard(folders, "b3", 2)).toBe(folders);
    expect(placeBoard(folders, "b3", 3)).toBe(folders);
    expect(placeBoard(folders, "b3", -1)).toBe(folders);
    expect(placeBoard(folders, "todos", 0)).toBe(folders);
  });

  it("moves an id within a run by taking it out and putting it back", () => {
    const run = ["a", "b", "c", "d"];
    expect(placeInRun(run, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(placeInRun(run, "d", 1)).toEqual(["a", "d", "b", "c"]);
    expect(placeInRun(run, "b", 1)).toBe(run);
  });

  it("draws the lenses in the stored order, with All still last and the Inbox still first", () => {
    const shelf = buildBoards(folders, null, true, ["files", "links", "todos"]);
    expect(shelf.map((b) => b.id)).toEqual([
      "inbox",
      "b1",
      "b2",
      "b3",
      "archive",
      "files",
      "links",
      "todos",
      "recent",
    ]);
    const crossings = shelf.filter((b, i) => i > 0 && isLens(b) && !isLens(shelf[i - 1]));
    expect(crossings.map((b) => b.id)).toEqual(["files"]);
  });

  /**
   * A stored order is only ever what some device wrote. An older device's may
   * name fewer lenses than this build has, a newer one's may name a lens this
   * build has never heard of, and a merge may repeat one. None of it may cost
   * a lens its place on the shelf or put one there twice.
   */
  it("falls back to the default order for anything the stored order does not say", () => {
    const ids = (order: string[] | null) => orderLenses(order).map((b) => b.id);
    expect(ids(null)).toEqual(["todos", "links", "files"]);
    expect(ids([])).toEqual(["todos", "links", "files"]);
    // Links is missing: it goes back beside Todos, the lens it follows by default.
    expect(ids(["files", "todos"])).toEqual(["files", "todos", "links"]);
    // Nothing it follows is present: it goes first.
    expect(ids(["files", "links"])).toEqual(["todos", "files", "links"]);
    // Unknown ids are dropped, repeats count once, and a fixed board is not a lens.
    expect(ids(["images", "links", "links", "recent", "inbox"])).toEqual(["todos", "links", "files"]);
  });

  it("keeps the seat on the board you are standing on through a move", () => {
    const ids = buildBoards(folders).map((b) => b.id);
    const run = ["b1", "b2", "b3"];
    const next = reseatShelf(ids, run, "b3", 0);
    expect(next).toEqual(["inbox", "b3", "b1", "b2", "archive", "todos", "links", "files", "recent"]);
    // Every seat outside the run is where it was.
    expect(next.indexOf("archive")).toBe(ids.indexOf("archive"));
    expect(reseatShelf(ids, run, "b3", 2)).toEqual(ids);
  });

  /**
   * The order entry rides in the stored folder list (no migration, no new
   * table), so every reader of that list as folders must be unable to see it.
   */
  it("carries the lens order beside the folders without ever being one", () => {
    const stored = withLensOrder(folders, ["links", "todos", "files"]);
    expect(stored.map((b) => b.id)).toContain(SHELF_ORDER_ID);
    expect(foldersOf(stored)).toEqual(folders);
    expect(foldersOf(folders)).toBe(folders);
    expect(lensOrderOf(stored)).toEqual(["links", "todos", "files"]);
    expect(lensOrderOf(folders)).toBeNull();
    // Rewritten, not added to.
    const again = withLensOrder(stored, ["files", "todos", "links"]);
    expect(again.filter((b) => b.id === SHELF_ORDER_ID)).toHaveLength(1);
    // A change to the folders keeps it.
    const renamed = withFolders(again, renameBoard(foldersOf(again), "b1", "Office"));
    expect(lensOrderOf(renamed)).toEqual(["files", "todos", "links"]);
    expect(foldersOf(renamed).map((b) => b.name)).toEqual(["Office", "Recipes", "Garden"]);
  });
});

describe("a board that keeps the screen on", () => {
  const recipes: UserBoard = { id: "b1", name: "Recipes", position: 0 };
  const garden: UserBoard = { id: "b2", name: "Garden", position: 1 };

  it("is switched on and off on the one folder, and off leaves no trace", () => {
    const on = setBoardAwake([recipes, garden], "b1", true);
    expect(on[0]).toEqual({ ...recipes, awake: true });
    expect(on[1]).toBe(garden);
    expect(setBoardAwake(on, "b1", false)[0]).toEqual(recipes);
  });

  it("rides along on the shelf's board, and only where it is on", () => {
    const shelf = buildBoards([{ ...recipes, awake: true }, garden]);
    expect(shelf.find((b) => b.id === "b1")?.awake).toBe(true);
    expect(shelf.find((b) => b.id === "b2")).not.toHaveProperty("awake");
  });

  it("keeps the screen on for a note filed in such a folder, and no other", () => {
    const shelf = buildBoards([{ ...recipes, awake: true }, garden]);
    expect(keepsScreenOn(note({ board_id: "b1" }), shelf)).toBe(true);
    expect(keepsScreenOn(note({ board_id: "b2" }), shelf)).toBe(false);
    expect(keepsScreenOn(note({ board_id: null }), shelf)).toBe(false);
    expect(keepsScreenOn(note({ board_id: "gone" }), shelf)).toBe(false);
    expect(keepsScreenOn(null, shelf)).toBe(false);
  });

  it("lets the screen sleep for a note in the trash, wherever it was filed", () => {
    const shelf = buildBoards([{ ...recipes, awake: true }]);
    expect(keepsScreenOn(note({ board_id: "b1", status: "trashed" }), shelf)).toBe(false);
  });
});

describe("Inspiration — the marked entry", () => {
  const entry = (over: Partial<UserBoard> = {}): UserBoard => ({
    id: "i1",
    name: "Inspiration",
    position: 3,
    kind: "inspiration",
    ...over,
  });
  const shelfOrder = (): UserBoard =>
    ({ id: SHELF_ORDER_ID, name: "Shelf order", position: 1_000_000, lenses: ["links"] }) as UserBoard;

  it("finds nothing in a list of plain folders", () => {
    expect(inspirationOf([board({ id: "f1" })])).toBeNull();
  });

  it("is the lowest id when two devices each made one", () => {
    const stored = [entry({ id: "b" }), board({ id: "f1" }), entry({ id: "a" })];
    expect(inspirationOf(stored)?.id).toBe("a");
  });

  it("is stripped from the folders, and a duplicate is drawn as an ordinary folder so no note is stranded", () => {
    const stored = [board({ id: "f1" }), entry({ id: "b" }), entry({ id: "a" }), shelfOrder()];
    const folders = foldersOf(stored);
    expect(folders.map((f) => [f.id, f.name])).toEqual([
      ["f1", "Recipes"],
      ["b", "Inspiration 2"],
    ]);
    expect(folders.some((f) => "kind" in f)).toBe(false);
  });

  it("numbers several duplicates in id order", () => {
    const folders = foldersOf([entry({ id: "c" }), entry({ id: "a" }), entry({ id: "b" })]);
    expect(folders.map((f) => [f.id, f.name])).toEqual([
      ["c", "Inspiration 3"],
      ["b", "Inspiration 2"],
    ]);
  });

  it("returns the very same array when there is nothing to strip", () => {
    const stored = [board({ id: "f1" })];
    expect(foldersOf(stored)).toBe(stored);
  });

  it("is kept when the folder list is written back, and the duplicate becomes the plain folder it was drawn as", () => {
    const stored = [board({ id: "f1" }), entry({ id: "a" }), entry({ id: "b" })];
    const next = withFolders(stored, foldersOf(stored).map((f) => (f.id === "f1" ? { ...f, name: "Kitchen" } : f)));
    expect(next.map((b) => [b.id, b.name, b.kind ?? null])).toEqual([
      ["f1", "Kitchen", null],
      ["b", "Inspiration 2", null],
      ["a", "Inspiration", "inspiration"],
    ]);
  });

  it("is drawn on the shelf's dressed place list last, with the reserved mark and its fixed name", () => {
    const places = placesOf([board({ id: "f1" })], entry({ name: "insp", icon: "BookOpenIcon" }));
    expect(places.map((p) => p.id)).toEqual(["f1", "i1"]);
    expect(places[1]).toMatchObject({ name: INSPIRATION_NAME, icon: INSPIRATION_MARK, kind: "inspiration" });
    const folders = [board({ id: "f1" })];
    expect(placesOf(folders, null)).toBe(folders);
  });

  it("is exported as an ordinary folder, so its notes are not written into the Inbox", () => {
    const out = exportFolders([board({ id: "f1" }), entry(), shelfOrder()]);
    expect(out.map((f) => f.id)).toEqual(["f1", "i1"]);
    expect(out.some((f) => "kind" in f)).toBe(false);
  });
});

describe("Inspiration — adoption", () => {
  const ids = (list: UserBoard[]) => list.map((b) => b.id);

  it.each(["insp", "Inspo", " INSPIRATION ", "inspirations"])("adopts a folder named %j", (name) => {
    const stored = [board({ id: "f1" }), board({ id: "x", name, position: 1, color: "teal", icon: "BookOpenIcon" })];
    const next = adoptInspiration(stored);
    const adopted = next.find((b) => b.id === "x")!;
    expect(adopted.kind).toBe("inspiration");
    // The tint and the mark are dropped; the name and place are the user's still.
    expect(adopted).not.toHaveProperty("color");
    expect(adopted).not.toHaveProperty("icon");
    expect(adopted.name).toBe(name);
    expect(next[0]).toBe(stored[0]);
    expect(ids(next)).toEqual(["f1", "x"]);
  });

  it("does not adopt a folder that merely contains the word", () => {
    const next = adoptInspiration([board({ id: "f1", name: "Inspiration board" })], () => "fresh");
    expect(ids(next)).toEqual(["f1", "fresh"]);
    expect(next[1]).toMatchObject({ name: "Inspiration", kind: "inspiration" });
  });

  it("makes a new entry after the last folder, ignoring the shelf-order entry's far position", () => {
    const stored = [board({ id: "f1", position: 4 }), { id: SHELF_ORDER_ID, name: "Shelf order", position: 1_000_000, lenses: [] } as UserBoard];
    const next = adoptInspiration(stored, () => "fresh");
    expect(next.at(-1)).toMatchObject({ id: "fresh", position: 5, kind: "inspiration" });
    expect(next).toContain(stored[1]);
  });

  it("changes nothing the second time, by identity", () => {
    const once = adoptInspiration([board({ id: "f1" })], () => "fresh");
    expect(adoptInspiration(once)).toBe(once);
  });

  it("prefers the first adoptable folder in shelf order", () => {
    const stored = [board({ id: "late", name: "insp", position: 5 }), board({ id: "early", name: "inspo", position: 1 })];
    expect(adoptInspiration(stored).find((b) => b.kind)?.id).toBe("early");
  });

  it("waits for the preferences, the notes and the first clean sync — and stops once it exists", () => {
    const ready = { prefsReady: true, loading: false, firstSyncDone: true, stored: [] as UserBoard[] };
    expect(shouldAdoptInspiration(ready)).toBe(true);
    expect(shouldAdoptInspiration({ ...ready, prefsReady: false })).toBe(false);
    expect(shouldAdoptInspiration({ ...ready, loading: true })).toBe(false);
    // The failure class this guards: a device that has not heard from the server
    // pushing a list of its own over the real one.
    expect(shouldAdoptInspiration({ ...ready, firstSyncDone: false })).toBe(false);
    expect(shouldAdoptInspiration({ ...ready, stored: [{ id: "i", name: "x", position: 0, kind: "inspiration" }] })).toBe(false);
  });
});

describe("Inspiration — on the shelf and as a board", () => {
  const entry: UserBoard = { id: "i1", name: "whatever", position: 9, kind: "inspiration" };
  const shelf = () => buildBoards([board({ id: "f1" })], null, true, null, entry);

  it("stands first after the line: Inbox, folders, Archive, Inspiration, then the lenses", () => {
    expect(shelf().map((b) => b.name)).toEqual([
      "Inbox", "Recipes", "Archive", "Inspiration", "Todos", "Links", "Files", "All",
    ]);
    expect(shelf()[3]).toMatchObject({ id: "i1", kind: "inspiration" });
  });

  it("is absent until the entry exists", () => {
    expect(buildBoards([board({ id: "f1" })]).some((b) => b.kind === "inspiration")).toBe(false);
  });

  it("is not a lens, is built in, is filable and is not colourable", () => {
    const inspo = shelf()[3];
    expect(isLens(inspo)).toBe(false);
    expect(isBuiltIn(inspo)).toBe(true);
    expect(isFilable(inspo)).toBe(true);
    expect(isFilable(shelf()[1])).toBe(true);
    expect(isFilable(shelf()[4])).toBe(false);
    expect(inspo).not.toHaveProperty("color");
    expect(inspo).not.toHaveProperty("icon");
  });

  it("keeps exactly one line across the shelf, now where the built-in group begins", () => {
    const boards = shelf();
    const crossings = boards.filter((b, i) => i > 0 && isBuiltIn(b) !== isBuiltIn(boards[i - 1]));
    expect(crossings).toHaveLength(1);
    expect(crossings[0].name).toBe("Inspiration");
  });

  it("is carried among the app's own boards, never into the places", () => {
    const boards = shelf();
    expect(canMoveBoard(boards[3])).toBe(true);
    expect(shelfRun(boards, "i1")).toEqual(["i1", "todos", "links", "files", "recent"]);
    // the places' run is untouched by it
    expect(shelfRun(boards, "f1")).toEqual(["f1", "archive"]);
  });

  it("holds a note filed into it, and the Inbox does not", () => {
    const boards = shelf();
    const filed = note({ id: "n", board_id: "i1" });
    expect(matchesBoard(filed, boards[3])).toBe(true);
    expect(matchesBoard(filed, boards[0])).toBe(false); // the Inbox knows the id is a place
    expect(matchesBoard(filed, boards.at(-1)!)).toBe(true); // and All still holds every active note
    expect(matchesBoard(note({ id: "m", board_id: "i1", status: "archived" }), boards[3])).toBe(false);
    expect(matchesBoard(note({ id: "o", board_id: "other" }), boards[3])).toBe(false);
  });

  it("counts like any board", () => {
    const boards = shelf();
    const notes = [note({ id: "a", board_id: "i1" }), note({ id: "b", board_id: "i1" }), note({ id: "c" })];
    expect(countForBoard(notes, boards[3])).toBe(2);
    expect(notesForBoard(notes, boards[3])).toHaveLength(2);
  });

  it("says what the empty board is for, and names a way in (audit UX-7)", () => {
    expect(emptyBoardHint(shelf()[3])).toBe(
      "Things worth another look. Paste below, or move a note in.",
    );
    expect(emptyBoardTitle(shelf()[3])).toBe("Inspiration");
  });

  it("takes a note off Links when it is filed into it, like any place", () => {
    const onLinks = note({ id: "l", note_type: "link" });
    expect(filePatch(onLinks, "i1")).toEqual({ board_id: "i1", note_type: null });
  });
});
