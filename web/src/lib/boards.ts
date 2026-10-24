import type { Board, Note, UserBoard } from "../types";
import { boardLook } from "./boardLook";
import { deriveFace, isOnlyLinks } from "./face";
import { cmpIso, cmpStamp, editedAt, sortStamp } from "./versions";
import { TRASH_DAYS } from "./trash";

/**
 * A board is a real folder (SPEC §6, revised). Inbox/All/Todos/Links/Files
 * are automatic — the app noticing something about a note, never the user
 * filing it — and Archive/Trash are the two ends of the shelf. Everything
 * between them is a folder the user made, and a note sits in at most one at a
 * time: moving it out of one is moving it into another, exactly like a file on
 * a desktop. Nothing here is a query over tags anymore; `matchesBoard` for a
 * folder is a straight `note.board_id === board.id`.
 *
 * The shelf is the user's places, then one line, then the app's own boards
 * (Inspiration, a place, and the lenses) — see `buildBoards`. `isBuiltIn` draws
 * the line; `isLens` defines a lens.
 */

/**
 * The landing board, and the one board with an end to it.
 *
 * Everything captured arrives here and **leaves when it is filed**, so the
 * count is a debt that can reach zero. That is the whole difference from All
 * (called Recent when it stood here): All matches every active note, filed or
 * not, which makes it the safety net and makes its count meaningless as a
 * measure of anything — it is all the other boards at once. A large part of the
 * first screen was then spent drawing filed notes dimmed, in order to say "not
 * really this one". The Inbox has no filed notes in it by definition, so
 * nothing on it is ever dimmed (`data-filed` is now All's alone).
 */
export const INBOX_BOARD: Board = { id: "inbox", name: "Inbox", kind: "inbox" };

/**
 * "Bring everything in": the Inbox starts at the beginning of time.
 *
 * One stored value carries both answers to the first-open question (SPEC §6).
 * `null` means it has not been asked yet; a real date means "leave the old ones
 * out"; this means "the whole pile is the Inbox", which is also what the menu's
 * *Bring in the old notes* writes. A second field for "have you answered" would
 * be a second thing to keep in step with the first.
 */
export const INBOX_ALL = new Date(0).toISOString();

/**
 * How big a never-filed pile has to be before the app asks about it.
 *
 * A threshold, not a target. The question exists because an archive that
 * predates the Inbox opens it at 237 on the morning this ships, which is not a
 * landing page, it is a bill. A pile you could clear in one sitting is not a
 * bill and does not deserve a modal on first open — under this many, the whole
 * pile simply *is* the Inbox and nothing is asked.
 */
export const INBOX_ASK_MIN = 20;

/** How many active notes have never been filed anywhere — what the first-open
 *  question is about, and the one number it quotes. A to-do is excluded, because
 *  a to-do's place is the Todos board, not the pile the Inbox is asking about,
 *  and so is a bare link, whose place is the Links board (`linksOnly`) — the
 *  same lines `matchesBoard` draws, so the two can never disagree about what the
 *  pile holds. */
export function neverFiledCount(notes: Note[], folders?: ReadonlySet<string>): number {
  return notes.filter(
    (note) =>
      note.status === "active" &&
      !isFiled(note, folders) &&
      !isTodoNote(note) &&
      !keptOnLinks(note) &&
      !linksOnly(note, folders),
  ).length;
}
/**
 * Every active note, filed or not — the widest lens there is. The one note it
 * leaves out is a bare link nobody has filed or marked, which lives on Links
 * alone (`linksOnly`).
 *
 * It was called **Recent** and the name was the reported fault: "Recent" and
 * "Inbox" both mean *newly arrived*, so two adjacent rows on the shelf made the
 * same promise and only one of them could keep it. "All" collides with nothing
 * and is the only one-word answer to what this board actually holds. Only the
 * name changed — `kind: "recent"` is what `matchesBoard`, the empty-state copy
 * and the card's filed mark are all written against, and renaming it would be a
 * rename across four files for no gain.
 */
const RECENT_BOARD: Board = { id: "recent", name: "All", kind: "recent" };
const TODOS_BOARD: Board = { id: "todos", name: "Todos", kind: "todos" };
const LINKS_BOARD: Board = { id: "links", name: "Links", kind: "links" };
const FILES_BOARD: Board = { id: "files", name: "Files", kind: "files" };
const ARCHIVE_BOARD: Board = { id: "archive", name: "Archive", kind: "archive" };

/** The name the shelf draws for Inspiration, whatever its stored entry is called. */
export const INSPIRATION_NAME = "Inspiration";

/**
 * Stands in a board's `icon` for the one mark that is drawn rather than chosen
 * (`IconInspiration`). It is never stored — no folder has it and `boardLook`
 * would drop it — it exists so the choosers, the Sorter, the capture bar's mark
 * and a card's footer, which all read a board's `icon` through `boardGlyph`,
 * draw Inspiration's own mark with no second code path (`BoardLook.tsx`).
 */
export const INSPIRATION_MARK = "@inspiration";

/** Folder names the one-time adoption takes for Inspiration, compared trimmed and lower-cased. */
export const ADOPTABLE_NAMES: readonly string[] = ["insp", "inspo", "inspiration", "inspirations"];

/** Appended to the end of the shelf, past the lenses, and then pinned outside
 *  the scroller by the strip itself (App.tsx's `.board-trash`) — it is a place,
 *  but it is the one destination that may never scroll out of reach. */
export const TRASH_BOARD: Board = { id: "trash", name: "Trash", kind: "trash" };

/**
 * Whether this board is a **lens** rather than a **place**.
 *
 * A place is somewhere a note *is*, and it is in exactly one of them: the
 * Inbox, a folder, the Archive, the Trash. Moving a note into one moves it out
 * of another. A lens holds nothing of its own — it is the app noticing
 * something about a note (it has an address in it, it carries a file, every
 * line of it is a tick box) or, in All's case, noticing nothing at all. Filing
 * a note never puts it in a lens and never takes it out of one, which is why
 * the counts across the shelf necessarily sum to more than the archive holds
 * and can never be reconciled by arithmetic.
 *
 * Stated once, here, because it is the one definition of *lens*. Which side of
 * the shelf's one hairline a board is drawn on is a different question and is
 * `isBuiltIn`'s: the line used to fall between places and lenses and now falls
 * before the app's own boards, Inspiration (a place) among them.
 */
export function isLens(board: Board): boolean {
  switch (board.kind) {
    case "recent":
    case "todos":
    case "links":
    case "files":
      return true;
    case "inbox":
    case "folder":
    case "inspiration":
    case "archive":
    case "trash":
      return false;
  }
}

/**
 * Whether this board is one of **the app's own** — the group drawn after the
 * shelf's one line: Inspiration, then Todos · Links · Files · All.
 *
 * The line used to mean "lenses", and `isLens` still says exactly that. It now
 * means *the app's own boards*, because Inspiration is a **place** (a note is
 * filed into it and lives there, in exactly one) that stands past the line. So
 * two questions that were one are two: `isLens` — does this hold nothing of its
 * own — and this — which side of the line is it drawn on, and does it stand on
 * the lifted band (`data-lens`). Archive and Trash are the app's own too and
 * deliberately not here: Archive closes the places, Trash is pinned outside.
 */
export function isBuiltIn(board: Board): boolean {
  switch (board.kind) {
    case "inspiration":
    case "recent":
    case "todos":
    case "links":
    case "files":
      return true;
    case "inbox":
    case "folder":
    case "archive":
    case "trash":
      return false;
  }
}

/** Whether a note is filed into this board by hand — a folder or Inspiration. */
export function isFilable(board: Board): boolean {
  return board.kind === "folder" || board.kind === "inspiration";
}

/**
 * Whether search, opened while standing here, offers to look only here.
 *
 * Search covers every note, and that stays the default wherever it is opened.
 * The offer is made on two boards, and they are the two places a note is only
 * because somebody *put* it there:
 *
 * - **A folder the user made.** "The recipe I filed under Kitchen" is a real
 *   way of remembering a note, and on a short word the folder is the cut
 *   that turns forty results into three.
 * - **The Archive.** Archived notes are searchable but rank at half weight
 *   (SPEC §9), so a person standing in the Archive looking for an old note is
 *   exactly the one whose results come back buried under the live ones. Here
 *   the scope does not only narrow — it undoes the one penalty search applies.
 *
 * - **Links**, the one lens that earns it (review 2026-10-04, FX-A-06).
 *   "That article about X" is remembered as a saved page, and an everywhere
 *   search for X mixes in every note that merely says the word. The lens
 *   already defines its set (`matchesBoard`), so the scope needs nothing else.
 * - **Inspiration**, which is a place like a folder: a note is there because
 *   somebody filed it there (audit 2026-10-10, UX-7).
 *
 * Not the Inbox: it is the pile that empties, every note in it is active and
 * already ranks at full weight, and what is in it is on the screen. Not the
 * other lenses: All is already everything, and Todos and Files are views that
 * search results cut across well enough. Not the Trash: search never reads it.
 */
export function canScopeSearch(board: Board): boolean {
  return (
    board.kind === "folder" ||
    board.kind === "inspiration" ||
    board.kind === "archive" ||
    board.kind === "links"
  );
}

/**
 * The user's own folders, in the order the shelf draws them.
 *
 * Stated once because three things have to agree about it: `buildBoards`, which
 * lays the run out; `moveBoard`, which changes it; and the menu that decides
 * whether a folder has anywhere left to go. Written out three times they would
 * drift the first day a `position` is anything other than its own index — which
 * is a day that has already been possible for as long as the field has existed.
 *
 * The sort is stable, so folders that share a position keep whatever order the
 * list they arrived in had. That is not a guarantee worth relying on and is not
 * relied on: `moveBoard` renumbers the run every time it touches it.
 */
export function orderedBoards(existing: UserBoard[]): UserBoard[] {
  return [...existing].sort((a, b) => a.position - b.position);
}

/**
 * The whole shelf in order: **the user's places, then the app's own boards.**
 *
 *   Inbox · [the user's folders] · Archive ┊ Inspiration · Todos · Links · Files · All
 *
 * The strip used to run the app's own boards and then the user's, with the
 * hairline where the user's began. That division was true and useless: nobody
 * navigating a notes app is asking which of these rows they made. They are
 * asking one of two questions — *where do I put this* and *where do I find
 * that* — and the shelf now answers them in that order. It also puts the boards
 * you actually file into next to the board everything lands on: your first
 * folder used to be the seventh stop on the shelf, six swipes away on a phone,
 * with the four rows you can never file into standing between the Inbox and
 * every destination you own.
 *
 * Inbox stays at index 0 and must: the menu's *Bring in the old notes* row
 * quotes `counts[0]`, and deleting the folder you are standing on lands you on
 * `goToBoard(0)`. Archive closes the places run rather than opening the lenses,
 * because it is the far end of a note's life and not a way of looking at one.
 * All sits last, as the widest lens there is. Trash is appended separately (see
 * `TRASH_BOARD`) and pinned outside the scroller, same as before.
 *
 * The board row marks where the app's own boards begin with the lifted band
 * (App.tsx's `data-lens`, keyed on `isBuiltIn`) — one boundary, moved rather
 * than multiplied, and no rule drawn across it (2026-10-12). Nothing is persisted by board index, so reordering needs no
 * migration.
 *
 * Within each side the order is the user's: folders by their `position`, and
 * Todos, Links and Files by the lens order stored beside them (`lensOrder`,
 * see `SHELF_ORDER_ID`). The five seats named above — Inbox first, Archive
 * closing the places, Inspiration opening the app's own boards, All last,
 * Trash outside — are not.
 */
export function buildBoards(
  userBoards: UserBoard[],
  inboxSince?: string | null,
  foldersKnown = true,
  shelfOrder?: readonly string[] | ShelfOrder | null,
  inspiration: UserBoard | null = null,
): Board[] {
  // An array is the lens order alone, the shape this took before the app's own
  // boards could be carried and hidden (tests and the Keep import still pass it).
  const shelf: ShelfOrder =
    shelfOrder && !Array.isArray(shelfOrder)
      ? (shelfOrder as ShelfOrder)
      : { ...NO_SHELF_ORDER, lenses: (shelfOrder as readonly string[] | null | undefined)?.slice() ?? null };
  // Inspiration is a place a note is filed into, so its id is a known folder
  // for `isFiled`: without it every note filed there would read as unfiled and
  // pour into the Inbox.
  const known = folderIds(inspiration ? [...userBoards, inspiration] : userBoards);
  // The Inbox carries the date it starts at, so `matchesBoard` stays a
  // question about one note and one board rather than needing the answer
  // passed alongside it everywhere — and for the same reason it carries which
  // folders exist, once that is known (see `isFiled`).
  const inbox: ShelfBoard = {
    ...INBOX_BOARD,
    ...(inboxSince ? { since: inboxSince } : {}),
    ...(foldersKnown ? { folders: known } : {}),
  };
  // All is handed the folders for the same reason: a bare link is left off it
  // only while it is in no folder (`linksOnly`), and "no folder" has to mean
  // the same thing on both boards.
  const all: ShelfBoard = {
    ...RECENT_BOARD,
    ...(foldersKnown ? { folders: known } : {}),
  };
  const folders = orderedBoards(userBoards)
      // The look rides along on the board rather than being looked up by id at
      // three separate render sites. `boardLook` drops anything unrecognised on
      // the way through, so a value written by a newer client lands as the
      // default here instead of as a mark that draws nothing.
      .map((b): Board => {
        const look = boardLook(b);
        return {
          id: b.id,
          name: b.name,
          kind: "folder",
          ...(look.icon ? { icon: look.icon } : {}),
          ...(look.color ? { color: look.color } : {}),
          ...(b.awake === true ? { awake: true as const } : {}),
        };
      });
  // Archive closes the places unless it was carried in among the folders: it
  // stands after the folder it was put down behind, first if `null`, and last
  // where that folder is gone or nobody has moved it.
  const places: Board[] = [...folders];
  const after = shelf.archiveAfter;
  const behind = typeof after === "string" ? places.findIndex((b) => b.id === after) + 1 : 0;
  places.splice(after === null ? 0 : behind > 0 ? behind : places.length, 0, ARCHIVE_BOARD);
  // The app's own boards in the order the user carried them into. Inspiration's
  // id is the stored entry's, because that is what `board_id` names; its name
  // is fixed, and it carries no mark or tint of its own — it cannot be dressed.
  const own: Partial<Record<BuiltInKey, Board>> = {
    ...(inspiration ? { inspiration: { id: inspiration.id, name: INSPIRATION_NAME, kind: "inspiration" } as Board } : {}),
    todos: TODOS_BOARD,
    links: LINKS_BOARD,
    files: FILES_BOARD,
    recent: all,
  };
  const appSide = appSideOrder(shelf).flatMap((key) => (own[key] ? [own[key]] : []));
  const hidden = new Set<string>(shelf.hidden);
  return [inbox, ...places, ...appSide].filter((b) => {
    const key = builtInKey(b);
    return key === null || !hidden.has(key);
  });
}

/**
 * What an empty board is headed with: its own name (review UI-28, 2026-10-01).
 *
 * DESIGN.md §11 — the name of the place in Marcellus, one line of italic under
 * it. The heading was "Nothing here yet" on every board but the Inbox, which
 * named no place and said nothing the line under it did not, so an empty
 * folder read "Nothing here yet / No note filed here yet". What each zero
 * *means* is said by that line now (`emptyBoardHint`), the Inbox's three
 * included.
 */
export function emptyBoardTitle(board: Board, notArrived = false): string {
  return notArrived ? "Your notes have not arrived" : board.name;
}

/**
 * What an empty board says under its own name: what this zero means, then the
 * shortest real step that fills it (quality bar §4 rule 3; review CD-08,
 * 2026-10-05). A folder names the bar first, because a note written while
 * standing in a folder is filed into it; Todos names both of its ways in; the
 * Trash says how long it keeps a note (`TRASH_DAYS`).
 *
 * The Inbox is the one board whose zero means something, and it has four.
 * Driven down to nothing, it is **Nothing to tidy** — or **Inbox is clear**
 * when lists or bare links wait elsewhere (`elsewhere`, below), so the zero does
 * not read as an error: an achievement, not an absence. `fresh` — an archive with no active note in it — is the only zero
 * that is not one, so it says where a first note goes instead, in one
 * sentence (review GD-10). App.tsx works `fresh` out, and only after the
 * server has been heard from (`useServerAnswered`).
 *
 * `heldOutside` is how many never-filed notes the answer to the first-open
 * question is keeping out of the Inbox — see `oldNotesOut` in App.tsx. After
 * *Leave them* an empty Inbox would read as *everything is dealt with*, which is
 * false, so on that one board the hint says so and names the way back.
 *
 * `elsewhere` is how many unfiled notes are waiting on Todos (a list) and on
 * Links (a bare link) instead of here (`waitingElsewhere`). A first list
 * captured on the Inbox goes straight to Todos, and "Everything is filed" under
 * it read as the note being lost (review UX-B-02, 2026-10-05). The routing is
 * unchanged; only these words, and the Go offers EmptyBoard draws under them.
 *
 * `notArrived` is a signed-in device with nothing in its store whose first
 * sync failed or is offline: nobody knows what the archive holds, so no board
 * may say it is empty or tidy (`emptyBoardTitle` says the same).
 */
export function emptyBoardHint(
  board: Board,
  heldOutside = 0,
  fresh = false,
  elsewhere: WaitingElsewhere = NONE_ELSEWHERE,
  notArrived = false,
): string {
  if (notArrived) return "Check the connection. They come down on their own.";
  switch (board.kind) {
    case "inbox":
      // What the app is, for whoever has never seen it (review UX-10).
      if (fresh) return "A notes app where you just write. Type in the bar below, and sort it into boards later.";
      if (heldOutside > 0) {
        return heldOutside === 1
          ? "Nothing to tidy here, but 1 older note is outside the Inbox. Bring it in from the menu."
          : `Nothing to tidy here, but ${heldOutside} older notes are outside the Inbox. Bring them in from the menu.`;
      }
      if (elsewhere.todos > 0 && elsewhere.links > 0) {
        return "Inbox is clear. Lists wait on Todos, bare links on Links.";
      }
      if (elsewhere.todos > 0) return "Inbox is clear. Lists wait on Todos.";
      if (elsewhere.links > 0) return "Inbox is clear. Bare links wait on Links.";
      return "Nothing to tidy. Everything is filed.";
    case "recent":
      return "Every note, filed or not. Bare links stay on Links.";
    case "todos":
      return "Things to do. Mark a note as a to-do, or start a line with [ ].";
    case "links":
      return "Anything with an address lands here.";
    case "files":
      return "Drop one anywhere. Or use + in the bar.";
    case "archive":
      // Names a gesture that exists, shortest first: the button in an open
      // note, then the selection's own. Card swipe was withdrawn.
      return "Put away, not gone. Open a note and press Archive, or hold one to pick several.";
    case "trash":
      return `${TRASH_DAYS} days, then gone.`;
    case "inspiration":
      // Names a way in, as a folder's line does (audit 2026-10-10, UX-7):
      // standing here files a capture here (`isFilable`).
      return "Things worth another look. Paste below, or move a note in.";
    case "folder":
      return "Nothing here yet. Write below, or hold a note and move it in.";
  }
}

/** Unfiled notes the Inbox does not hold because they wait on a lens instead. */
export interface WaitingElsewhere {
  todos: number;
  links: number;
}

const NONE_ELSEWHERE: WaitingElsewhere = { todos: 0, links: 0 };

/**
 * How many notes that would otherwise be in the pile are waiting on Todos (a
 * to-do, `isTodoNote`) and on Links (a bare link, `linksOnly`, or one put there
 * by hand, `keptOnLinks`) — the two arms of `matchesBoard`'s Inbox test that
 * route a note away. Read by the empty Inbox only (review UX-B-02).
 */
export function waitingElsewhere(notes: readonly Note[], inbox: Board): WaitingElsewhere {
  const folders = (inbox as ShelfBoard).folders;
  let todos = 0;
  let links = 0;
  for (const note of notes) {
    if (note.status !== "active" || isFiled(note, folders)) continue;
    if (inbox.since && cmpIso(note.created_at ?? "", inbox.since) < 0) continue;
    if (isTodoNote(note)) todos++;
    else if (keptOnLinks(note) || linksOnly(note, folders)) links++;
  }
  return { todos, links };
}

/**
 * The Inbox and All as `buildBoards` makes them: a board that also knows which
 * folders exist. Kept to this file rather than put on `Board` itself, because
 * nothing but `matchesBoard` ever reads it.
 */
type ShelfBoard = Board & { folders?: ReadonlySet<string> };

/** The ids of the folders on the shelf — what `isFiled` checks a `board_id`
 *  against. */
export function folderIds(userBoards: UserBoard[]): ReadonlySet<string> {
  return new Set(userBoards.map((b) => b.id));
}

/**
 * Whether this note is filed into a folder at all.
 *
 * Deliberately a nullish test rather than `=== null`. `board_id` is *absent*
 * on every note written before the column existed — all 241 imported notes
 * carry no such field, and a note pulled from a server without the column only
 * reads as `null` because `store/sync.ts` coerces it on the way in. Asking
 * `board_id === null` therefore answered "filed" for the entire real archive,
 * which would have opened the Inbox empty on the one morning it matters and
 * drawn every card on All dimmed as though it were filed somewhere.
 *
 * **A `board_id` naming a folder that does not exist is not filed either**,
 * whenever `folders` says which ones do. Deleting a folder clears the field on
 * every note in it, but two things can still write a dead id back: undoing a
 * Move or a Sorter file made before the folder went (the reversal is a fresh
 * write of the old value), and a folder deleted on the other device while this
 * one held an edit. Such a note matched no folder on the shelf and not the
 * Inbox either, so it showed on All and nowhere else, with nothing on screen
 * saying why. Read as unfiled it is back in the pile, which is the truth: it is
 * in no place at all.
 *
 * `folders` is left out until the folder list has actually been read —
 * `useBoards` holds an empty list for a render on every start, and read against
 * that every filed note in the archive would pour into the Inbox for a frame.
 * The one window it cannot close is a sync tick that brings a note filed on the
 * other device a moment before the folder it was filed into; the note stands
 * in the Inbox until the preferences row lands in the same tick.
 *
 * One definition, used by the Inbox, by All's filed mark, and by the Sorter's
 * pile, so those three can never disagree about what unfiled means.
 */
export function isFiled(note: Note, folders?: ReadonlySet<string>): boolean {
  if (note.board_id === null || note.board_id === undefined) return false;
  return folders ? folders.has(note.board_id) : true;
}

/**
 * Whether this note is a to-do. The one definition, and the whole reason
 * `note_type: "note"` exists.
 *
 * A note is a to-do two ways. The user said so — `note_type: "todo"`, the one
 * field a person sets by hand — or every non-blank line of it is a tick box and
 * there are two or more of them, which is `deriveFace`'s checklist face. The
 * second is not the app guessing what a note *means*: it is reading the
 * characters `[ ]` the user typed, exactly as the card face already draws them.
 * Nothing here consults a model, and nothing may (SPEC §8, §12b).
 *
 * That reading is precisely why a third value was needed. **A shopping list, a
 * packing list and a list of album titles are structurally identical, and only
 * one of them is a to-do** — and until `"note"` existed, saying so was not
 * possible at any price. Clearing the type wrote `null`, which for a structural
 * checklist changes nothing at all, so the open note's toggle flipped its own
 * label, wrote a field, and the note stayed exactly where it was. `"note"` means
 * *not a to-do, and do not read the tick boxes as one*; it is what the toggle
 * writes when it is turned off, and `"todo"` is what it writes when it is turned
 * on. Symmetric, so there is no third case to reason about. `null` goes on
 * meaning **the user has never said**, which is what all 241 imported notes
 * carry, so nothing about the existing archive moves.
 *
 * It is only about *membership*. A checklist opted out with `"note"` still draws
 * its tick boxes on its card — the face decides how text is arranged and this
 * decides which board it is on, and the user said "not a to-do", not "stop
 * showing me my own boxes".
 *
 * Stated once, here, because the shelf and the toggle must never be able to
 * disagree about what a to-do is — the drift `isFiled`, `markerOf`, `isLens` and
 * `searchTerms` each exist as a single predicate to prevent. `matchesBoard`'s
 * Todos arm, the open note's Todo-toggle and the selection panel's Todo row all
 * ask this one question. It deliberately stops short of being the whole board
 * test: `matchesBoard` adds the `status === "active"` every arm of it carries,
 * because an archived to-do is still a to-do and the mark on the open note must
 * go on saying so rather than offering to "mark" what is already marked.
 */
export function isTodoNote(note: Note): boolean {
  if (note.note_type === "todo") return true;
  // `"link"` is an answer too: the user put this note on Links, which is not
  // Todos, so a list of `[ ] https://…` lines moved there stops reading as one.
  if (note.note_type === "note" || note.note_type === "link") return false;
  return deriveFace(note).kind === "checklist";
}

/**
 * Whether the user put this note on the Links board by hand.
 *
 * `linksOnly` below keeps a *bare* link out of the Inbox on its own, but a note
 * with one word of the user's beside its address is an ordinary note to it, and
 * so it sat in the pile with nowhere to go: Links is a lens and nothing could be
 * filed into it. This is the way in, and it is `note_type` for the reason the
 * to-do mark is — marking a note as a to-do is already how a note leaves the
 * Inbox for a board that is not a folder, and `"link"` is the same answer said
 * about Links. It is written by the Move chooser's and the Sorter's Links row
 * (`linksPatch`), and any other destination takes it off again (`filePatch`),
 * so a note is still in exactly one place. Marking it as a to-do replaces it,
 * which moves it to Todos. Nothing but the field is read: an address deleted
 * from the note afterwards does not take it off Links, because the user is who
 * put it there.
 */
export function keptOnLinks(note: Note): boolean {
  return note.note_type === "link";
}

/** Whether the Links row is worth offering for this note: it carries an
 *  address and is not on Links by hand already. A note with no address has no
 *  business on a board that means *notes with addresses*. */
export function canKeepOnLinks(note: Note): boolean {
  return !keptOnLinks(note) && deriveFace(note).linkCount > 0;
}

/** What putting a note on Links writes: out of any folder, onto Links. */
export function linksPatch(): Pick<Note, "board_id" | "note_type"> {
  return { board_id: null, note_type: "link" };
}

/** What filing a note into a folder (or the Inbox, `null`) writes. A note the
 *  user had put on Links leaves it on the way — every place is single-home. */
export function filePatch(note: Note, boardId: string | null): Partial<Note> {
  return keptOnLinks(note) ? { board_id: boardId, note_type: null } : { board_id: boardId };
}

/**
 * Whether this note lives on the Links board **alone**.
 *
 * The owner's rule (2026-09-16): a note that is nothing but links
 * (`isOnlyLinks`) shows on Links and on no other board — not the Inbox, not
 * All — *unless the user has said something about it*. Four things count as
 * that. Two are the ways a person puts a note somewhere: filing it into a
 * folder (`isFiled`), or marking it as a to-do (`isTodoNote`, which is also
 * what a list of `[ ] https://…` lines reads as). The other two are the marks
 * that ask for attention: priority, and a reminder. A link flagged or set to
 * ring is one the user wants in front of them, and it was the case the rule
 * got wrong while it knew only the first two — flagging a bare link quietly
 * took it out of the Inbox (review of 2026-09-21, item 32). Once any of the
 * four is true the note is an ordinary note again and every board treats it
 * as one, All included.
 *
 * This deliberately narrows All, which until this rule was "every active note,
 * filed or not". The Links board is the safety net for a bare link instead, and
 * search still finds it — search reads the whole store, not a board. Archive
 * and Trash are untouched: those are where the user *put* the note.
 *
 * It is read by the Inbox and All arms of `matchesBoard` and by
 * `neverFiledCount`, so the pile, the count and the question can never disagree
 * about it. Nothing is written: a link that gains a word, a folder or a to-do
 * mark simply matches differently on the next render.
 */
export function linksOnly(note: Note, folders?: ReadonlySet<string>): boolean {
  return (
    isOnlyLinks(note) &&
    !isFiled(note, folders) &&
    !isTodoNote(note) &&
    !(note.priority > 0) &&
    !note.reminder_at
  );
}

export function matchesBoard(note: Note, board: Board): boolean {
  switch (board.kind) {
    case "inbox":
      return (
        note.status === "active" &&
        !isFiled(note, (board as ShelfBoard).folders) &&
        // A to-do does not wait in the pile — it is already where it belongs,
        // on the Todos board (`isTodoNote`, the one definition the Todos arm
        // and the toggle both ask). The Inbox is for the notes still deciding.
        !isTodoNote(note) &&
        // A bare link does not wait in the pile either: its place is the Links
        // board, until the user files it or marks it (`linksOnly`).
        !linksOnly(note, (board as ShelfBoard).folders) &&
        // Nor does a note the user put on Links by hand (`keptOnLinks`).
        !keptOnLinks(note) &&
        // Only the notes written since the day the pile was drawn a line
        // under, if a line was drawn. Nothing is moved or hidden by this —
        // the rest are still on All and still in search.
        (!board.since || cmpIso(note.created_at ?? "", board.since) >= 0)
      );
    case "recent":
      // Every active note but a bare link nobody has filed (`linksOnly`),
      // which lives on Links alone.
      return note.status === "active" && !linksOnly(note, (board as ShelfBoard).folders);
    case "archive":
      return note.status === "archived";
    case "trash":
      return note.status === "trashed";
    case "links":
      return note.status === "active" && (keptOnLinks(note) || deriveFace(note).linkCount > 0);
    case "files":
      return note.status === "active" && (note.attachments ?? []).length > 0;
    case "todos":
      // Both halves of "is this a to-do" live in `isTodoNote`, so the board and
      // the two controls that govern it cannot say different things about the
      // same note. All this arm adds is the status test every other arm makes.
      return note.status === "active" && isTodoNote(note);
    case "inspiration":
      return note.status === "active" && note.board_id === board.id;
    case "folder":
      return note.status === "active" && note.board_id === board.id;
  }
}

/**
 * Priority first, then freshest. One tap to priority is the whole point.
 *
 * "Freshest" is when the note was last *edited*, not when it was written. The
 * board used to be a record of the order things arrived in, which is only the
 * same thing as usefulness on the day you write them: a note opened, added to
 * and worked on this morning sat exactly where it had sat since March, under
 * whatever had been captured since. Sorting by the edit brings anything you
 * are actually working on back to the top and lets everything you have stopped
 * touching sink, which is the whole of the organising this app asks for.
 *
 * Filing a note is deliberately not an edit — see `editedAt`. Archiving twelve
 * notes, or moving a note into a folder, must not reorder the board around it.
 *
 * The creation date is the tiebreak, so two notes never captured since keep the
 * order they were captured in, and the sort is total rather than arbitrary.
 */
export function sortForBoard(notes: Note[]): Note[] {
  // Each note's `editedAt` is read once, up front, rather than from inside the
  // comparator. It is not a field: it walks the per-field clocks and parses
  // two timestamps per field, and a comparison sort asks its comparator for a
  // note O(log n) times — so on the real archive the same walk was being made
  // some nine times per note, per sort, per render. Reading it into a side
  // table first is the ordinary Schwartzian trade, and on 401 notes it is a
  // measured 3.7ms down to 1.1ms. The stamps are parsed into that table too
  // (audit PERF-5): `cmpStamp` decides exactly as `cmpIso` did, so a stamp
  // `Date.parse` cannot read still falls back to the string compare, but the
  // parse happens once per note rather than twice per comparison.
  const keyed = notes.map((note) => ({
    note,
    edited: sortStamp(editedAt(note)),
    born: sortStamp(note.created_at ?? ""),
  }));
  keyed.sort(
    (a, b) =>
      b.note.priority - a.note.priority ||
      cmpStamp(b.edited, a.edited) ||
      cmpStamp(b.born, a.born),
  );
  return keyed.map((k) => k.note);
}

/**
 * Where a note is to be found: the first board along the shelf that holds it.
 *
 * The shelf runs places first and All last (`buildBoards`), so this reads as
 * the sentence a person would say. A filed note is in its folder; an unfiled
 * one is in the Inbox; one the Inbox does not keep — a to-do, a bare link, a
 * note put on Links by hand — is on the board that does (Todos, Links); and
 * All is the answer only when nothing narrower is. It is what the capture
 * bar's receipt names when a note lands off the screen (web/CLAUDE.md,
 * "Gestures, and what the app says back"), and the board its tap goes to, so
 * the words and the destination cannot disagree. `null` for a note on none of
 * them, which the Trash is outside of.
 */
export function homeBoard(note: Note, boards: readonly Board[]): Board | null {
  // All is the answer only when nothing narrower is, wherever it was carried
  // to on the shelf (2026-10-23: the app's own boards can be reordered).
  return (
    boards.find((board) => board.kind !== "recent" && matchesBoard(note, board)) ??
    boards.find((board) => board.kind === "recent" && matchesBoard(note, board)) ??
    null
  );
}

export function notesForBoard(notes: Note[], board: Board): Note[] {
  return sortForBoard(notes.filter((n) => matchesBoard(n, board)));
}

/**
 * How many notes a board holds.
 *
 * The count is the filter's length and nothing else — **never**
 * `notesForBoard(...).length`, which is what the shelf did for as long as it
 * has had counts. Ordering is not part of the question, and answering it
 * anyway meant re-sorting the archive once per board, on every note change —
 * every keystroke in an open note included. Measured on 401 notes across eight
 * boards: **6.8ms of the main thread to read eight numbers off arrays nobody
 * looks at the order of, against 0.32ms for the filter alone**, out of a 50ms
 * budget for the whole write path (SPEC §2.6).
 */
export function countForBoard(notes: Note[], board: Board): number {
  let held = 0;
  for (const note of notes) if (matchesBoard(note, board)) held += 1;
  return held;
}

/**
 * What makes this board a different *view* — its name plus the filter it is
 * currently applying.
 *
 * The grid animates a card leaving and draws a mark for where it went, and it
 * decides something left by measuring the cards before and after. That is only
 * a fair question while the board still means the same thing. The Inbox does
 * not: `since` arrives from an IndexedDB read a beat after first paint (see
 * `useBoards`, where `inboxSince` is `null` for a render on every single
 * start), and until it lands the Inbox matches *every* unfiled note rather
 * than the ones written since the line was drawn.
 *
 * Keyed on the id alone, that arrival looked exactly like the entire pile being
 * removed from the board in one frame, and the grid announced it the only way
 * it knows how — a vanishing card and a mark each, for two hundred notes, on
 * open. Keyed on the filter too, the board is simply a different view and the
 * grid resets instead, which is what it already does for paging and for search.
 *
 * A board with no filter of its own is just its id, so nothing else changes.
 */
export function boardViewKey(board: Board): string {
  return board.since ? `${board.id}:${board.since}` : board.id;
}

/**
 * The name rules for a folder, stated once. Blank names are refused by the
 * caller (there is nothing to show on a tab), and the length ceiling keeps a
 * long name from taking over the tab strip — `web/CLAUDE.md`'s "six sizes and
 * no seventh" spirit applied to a board name rather than a type size.
 */
export const BOARD_NAME_MAX = 40;

export function isBoardName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= BOARD_NAME_MAX;
}

/** A fresh folder, appended to the end of the user's own shelf order. */
export function createBoard(name: string, existing: UserBoard[]): UserBoard {
  const position = existing.reduce((max, b) => Math.max(max, b.position), -1) + 1;
  return { id: crypto.randomUUID(), name: name.trim(), position };
}

export function renameBoard(existing: UserBoard[], id: string, name: string): UserBoard[] {
  const trimmed = name.trim();
  return existing.map((b) => (b.id === id ? { ...b, name: trimmed } : b));
}

export function removeBoard(existing: UserBoard[], id: string): UserBoard[] {
  return existing.filter((b) => b.id !== id);
}

/**
 * One folder, one step along the shelf: `-1` towards the Inbox, `+1` away from
 * it.
 *
 * `position` has existed since folders did, syncs with them, and is what
 * `orderedBoards` sorts on — and until this function nothing anywhere could
 * change it. `createBoard` appended, and that was the order forever, so the
 * folder you file into every day sat wherever it happened to be created. That
 * mattered less when your folders were the far end of the strip; it matters
 * now that they sit one step from the Inbox.
 *
 * **The run is renumbered, never swapped.** Swapping two `position` values is
 * only a move while those two values differ, and nothing has ever validated
 * this field: a list written by an older client, or merged from the other
 * device, may hold duplicates, gaps or negatives. On two folders that both sit
 * at `0` a swap is a no-op, and the row would have appeared to do nothing at
 * all — the worst failure a control can have, because there is nothing to see
 * and nothing to report. Reassigning the whole run to its own indices is right
 * whatever it held on the way in, costs one pass over a handful of folders, and
 * quietly repairs a list that had already drifted.
 *
 * A step off either end returns the list it was given, unchanged and by
 * identity — the caller reads that as "nothing happened" and does not stamp the
 * preferences row dirty for it. `BoardMenu` does not draw a row with nowhere to
 * go, so this guard should never fire; it is stated anyway, because "the first
 * folder cannot move earlier" is a fact about the list rather than about the
 * panel that happens to be drawing it.
 */
export function moveBoard(existing: UserBoard[], id: string, step: -1 | 1): UserBoard[] {
  const at = orderedBoards(existing).findIndex((b) => b.id === id);
  if (at < 0) return existing;
  return placeBoard(existing, id, at + step);
}

/**
 * One folder, put down at `to` in the folder run — what a drag on the shelf
 * ends with, where `moveBoard` is the menu's one step. Same renumbering, for
 * the reason given there, and the same identity answer for a drop that
 * changes nothing (back where it started, off either end, an id that is not a
 * folder), so the caller stamps nothing dirty for it.
 */
export function placeBoard(existing: UserBoard[], id: string, to: number): UserBoard[] {
  const order = orderedBoards(existing);
  const ids = order.map((b) => b.id);
  const next = placeInRun(ids, id, to);
  if (next === ids) return existing;
  const byId = new Map(order.map((b) => [b.id, b]));
  return next.map((key, i) => ({ ...byId.get(key)!, position: i }));
}

/**
 * `id` taken out of `run` and put back at `to`. The same array, by identity,
 * when that changes nothing — the one test every caller needs before it
 * writes anything.
 */
export function placeInRun<T extends string>(run: readonly T[], id: string, to: number): T[] {
  const from = run.indexOf(id as T);
  if (from < 0 || to < 0 || to >= run.length || to === from) return run as T[];
  const next = [...run];
  next.splice(from, 1);
  next.splice(to, 0, id as T);
  return next;
}

/* --- the shelf's own order ----------------------------------------------------
   A board on the shelf is moved by holding its tab (or its drawer row) and
   carrying it — the owner's ask of 2026-09-29, widened on 2026-10-23 to the
   app's own boards (web/CLAUDE.md has the whole of it). Two runs move:

     Inbox · [folders and Archive] ┊ [Inspiration · Todos · Links · Files · All]

   **A board moves only within its own side of the hairline.** The line means
   *the app's own boards begin here*, so a folder carried among them, or one of
   them set down among the user's places, would make the one line on the shelf
   say something false (owner's pick, 2026-10-23). The run is the fence:
   `shelfRun` is all a drag is ever handed, so there is no position it can
   reach that crosses it.

   **Two boards hold their seats.** The Inbox stays at index 0 because two
   things mean board 0 when they say it (`buildBoards`), and Trash is not in
   the strip at all. Archive is a place, so it moves among the folders. All may
   stand anywhere on its side: `homeBoard` asks it last whatever its seat, so a
   to-do the capture bar reports still "landed on Todos", never on All.
   -------------------------------------------------------------------------- */

/** The three lenses an older device could put in order, in the default one. */
const MOVABLE_LENSES: readonly Board[] = [TODOS_BOARD, LINKS_BOARD, FILES_BOARD];

/** The name a built-in board goes by in the shelf order and the hidden list. */
export type BuiltInKey = "archive" | "inspiration" | "todos" | "links" | "files" | "recent" | "trash";

/** The app's own boards past the line, in the default order. */
const APP_SIDE: readonly BuiltInKey[] = ["inspiration", "todos", "links", "files", "recent"];

/** Every board that can be hidden, in the order Settings lists them. The Inbox
 *  cannot be: the app opens on it. */
export const HIDABLE: readonly { key: BuiltInKey; name: string }[] = [
  { key: "archive", name: "Archive" },
  { key: "inspiration", name: INSPIRATION_NAME },
  { key: "todos", name: "Todos" },
  { key: "links", name: "Links" },
  { key: "files", name: "Files" },
  { key: "recent", name: "All" },
  { key: "trash", name: "Trash" },
];

/** A built-in board's key, or null for the Inbox and a folder. */
export function builtInKey(board: Board): BuiltInKey | null {
  switch (board.kind) {
    case "archive":
    case "inspiration":
    case "todos":
    case "links":
    case "files":
    case "recent":
    case "trash":
      return board.kind;
    case "inbox":
    case "folder":
      return null;
  }
}

/** Whether this board can be carried along its run: anything but the Inbox and Trash. */
export function canMoveBoard(board: Board): boolean {
  return board.kind === "folder" || board.kind === "archive" || isBuiltIn(board);
}

/** Which side of the line a movable board is carried along. */
function sideOf(board: Board): "places" | "app" {
  return isBuiltIn(board) ? "app" : "places";
}

/**
 * The ids a board may be carried among, in shelf order — its own run, itself
 * included — or null for a board that holds its seat. Read off the shelf as it
 * is drawn (a hidden board is not on it), so the run a drag measures and the
 * run it writes are one list.
 */
export function shelfRun(boards: readonly Board[], id: string): string[] | null {
  const held = boards.find((b) => b.id === id);
  if (!held || !canMoveBoard(held)) return null;
  const side = sideOf(held);
  return boards.filter((b) => canMoveBoard(b) && sideOf(b) === side).map((b) => b.id);
}

/**
 * The whole shelf's ids after `id` is put down at `to` in its run — what the
 * app needs to keep the seat on the board you are standing on through a move
 * (see `useFollowSeat`), worked out before the list changes rather than a frame
 * after it. The run's members only ever trade places among themselves, so every
 * seat outside it stays where it was.
 */
export function reseatShelf(ids: readonly string[], run: readonly string[], id: string, to: number): string[] {
  const moved = placeInRun(run, id, to);
  if (moved === run) return [...ids];
  const seats = ids.map((key, i) => (run.includes(key) ? i : -1)).filter((i) => i >= 0);
  const next = [...ids];
  seats.forEach((seat, i) => {
    next[seat] = moved[i];
  });
  return next;
}

/**
 * The lens order rides in the folder list, as one entry of its own.
 *
 * It has to be synced — a shelf in one order on the phone and another on the
 * desktop is two shelves — and the preferences row has exactly one place a
 * list like it can go without a migration: `boards`, which both backends store
 * as opaque JSON (`docs/sync-contract.md` §8). It is one entry rather than
 * one per lens so that a client from before this, which reads every entry as a
 * folder, shows one stray tab rather than three that share the real lenses'
 * names; and it is written only once somebody actually moves a lens, so a
 * shelf nobody has rearranged carries nothing new at all. `position` is far
 * past any folder's, so that stray tab stands at the end of the folders.
 *
 * **Everything that reads the list as folders reads it through `foldersOf`.**
 * `useBoards` splits it on the way in and puts it back together on the way
 * out, so the rest of the app never sees the entry; `planArchive` filters it
 * for the server's export, which reads the stored row directly.
 */
export const SHELF_ORDER_ID = "shelf-order";
const SHELF_ORDER_POSITION = 1_000_000;

interface ShelfOrderEntry extends UserBoard {
  lenses: string[];
  /** The app's own boards in the user's order, by `BuiltInKey` (2026-10-23). */
  builtIns?: string[];
  /** The folder Archive was put down behind: `null` first, absent last. */
  archiveAfter?: string | null;
  /** Built-in boards taken off the shelf in Settings, by `BuiltInKey`. */
  hidden?: string[];
}

function isShelfOrder(entry: UserBoard): entry is ShelfOrderEntry {
  return entry.id === SHELF_ORDER_ID;
}

export function isInspirationEntry(entry: UserBoard): boolean {
  return entry.kind === "inspiration" && !isShelfOrder(entry);
}

/**
 * The entry that is Inspiration: the **lowest id** among the marked ones.
 *
 * Two devices that both adopt before they have synced each make one. The
 * merge (`lib/boardsMerge.ts`) keeps the one already on the server as the wall
 * and turns the newcomer into a plain folder, keeping its id, so a note filed
 * into it is never stranded (audit DATA-3, 2026-10-10 — it used to be
 * dropped). Should a list still hold two, lowest id is a rule neither side
 * needs to ask about, so they converge on the same board; the rest are drawn
 * as ordinary folders (`foldersOf`).
 */
export function inspirationOf(stored: readonly UserBoard[]): UserBoard | null {
  let winner: UserBoard | null = null;
  for (const entry of stored) {
    if (isInspirationEntry(entry) && (winner === null || entry.id < winner.id)) winner = entry;
  }
  return winner;
}

/**
 * The user's folders, without the shelf's own order entry **and without
 * Inspiration** — everything that reads the stored list "as folders" (the
 * folder menu, rename, delete, the Look sheet, the reorder rows, the Keep
 * import) goes through here, so none of it can touch the built-in board.
 * A duplicate Inspiration entry (see `inspirationOf`) comes back as the plain
 * folder it will be drawn as: `Inspiration 2`, `Inspiration 3`, in id order.
 */
export function foldersOf(stored: UserBoard[]): UserBoard[] {
  const marked = stored.filter(isInspirationEntry);
  if (marked.length === 0) {
    return stored.some(isShelfOrder) ? stored.filter((entry) => !isShelfOrder(entry)) : stored;
  }
  const winner = inspirationOf(stored);
  const losers = marked
    .filter((entry) => entry !== winner)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return stored
    .filter((entry) => !isShelfOrder(entry) && entry !== winner)
    .map((entry) => {
      const at = losers.indexOf(entry);
      if (at < 0) return entry;
      const { kind: _kind, ...plain } = entry;
      return { ...plain, name: `${INSPIRATION_NAME} ${at + 2}` };
    });
}

/** The lens order as stored, or null where nobody has moved a lens. */
export function lensOrderOf(stored: readonly UserBoard[]): string[] | null {
  const entry = stored.find(isShelfOrder);
  return entry && Array.isArray(entry.lenses) ? entry.lenses.filter((id) => typeof id === "string") : null;
}

/** The stored list with the lens order written into it, replacing any before. */
export function withLensOrder(stored: UserBoard[], lenses: readonly string[]): UserBoard[] {
  return withShelfOrder(stored, { lenses: [...lenses] });
}

/**
 * The shelf's own shape as stored: what an older device wrote (`lenses`) and
 * what this one adds — the app side's whole order, where Archive stands among
 * the folders, and which built-in boards are hidden (2026-10-23). Each is its
 * own field of the one entry, so the merge (`lib/boardsMerge.ts`) takes each
 * from whichever device changed it.
 */
export interface ShelfOrder {
  lenses: string[] | null;
  builtIns: string[] | null;
  /** The folder Archive follows; `null` first among the places, undefined last. */
  archiveAfter: string | null | undefined;
  hidden: string[];
}

const NO_SHELF_ORDER: ShelfOrder = { lenses: null, builtIns: null, archiveAfter: undefined, hidden: [] };

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;

/** The shelf's shape as stored, read defensively, or the default shape. */
export function shelfOrderOf(stored: readonly UserBoard[]): ShelfOrder {
  const entry = stored.find(isShelfOrder);
  if (!entry) return NO_SHELF_ORDER;
  const after = entry.archiveAfter;
  return {
    lenses: strings(entry.lenses),
    builtIns: strings(entry.builtIns),
    archiveAfter: typeof after === "string" || after === null ? after : undefined,
    hidden: (strings(entry.hidden) ?? []).filter((key) => HIDABLE.some((h) => h.key === key)),
  };
}

/**
 * `known` in the order `stored` names them: an unknown id dropped, a repeat
 * counted once, and one `stored` does not mention put back beside the one it
 * follows by default (first if none of those is placed) — so a board added
 * after the order was written lands next to the neighbour it was designed to
 * sit by, rather than at one end.
 */
function orderKeys<T extends string>(stored: readonly string[] | null | undefined, known: readonly T[]): T[] {
  if (!stored) return [...known];
  const placed: T[] = [];
  for (const id of stored) {
    if ((known as readonly string[]).includes(id) && !placed.includes(id as T)) placed.push(id as T);
  }
  known.forEach((key, i) => {
    if (placed.includes(key)) return;
    const before = known.slice(0, i).reverse().find((prior) => placed.includes(prior));
    placed.splice(before ? placed.indexOf(before) + 1 : 0, 0, key);
  });
  return placed;
}

/**
 * The app side's order: the stored whole order, with Todos, Links and Files in
 * the seats it gives them, in the order `lenses` gives them. Both are written
 * together, so they agree — unless an older device, which writes only
 * `lenses`, moved a lens since; then its move is kept.
 */
export function appSideOrder(shelf: ShelfOrder): BuiltInKey[] {
  const order = orderKeys(shelf.builtIns, APP_SIDE);
  const lenses = orderLenses(shelf.lenses).map((lens) => lens.id as BuiltInKey);
  let next = 0;
  return order.map((key) => (lenses.includes(key) ? lenses[next++] : key));
}

/** The stored list with the shelf entry patched, made if there is none yet. */
export function withShelfOrder(
  stored: UserBoard[],
  patch: { lenses?: string[]; builtIns?: string[]; archiveAfter?: string | null; hidden?: string[] },
): UserBoard[] {
  const before = stored.find(isShelfOrder);
  const entry: ShelfOrderEntry = before
    ? { ...before }
    : {
        id: SHELF_ORDER_ID,
        name: "Shelf order",
        position: SHELF_ORDER_POSITION,
        lenses: MOVABLE_LENSES.map((lens) => lens.id),
      };
  if (patch.lenses) entry.lenses = [...patch.lenses];
  if (patch.builtIns) entry.builtIns = [...patch.builtIns];
  // Archive put back at the end of the places is written as no seat at all, so
  // a folder made later still lands before it.
  if ("archiveAfter" in patch) {
    if (patch.archiveAfter === undefined) delete entry.archiveAfter;
    else entry.archiveAfter = patch.archiveAfter;
  }
  if (patch.hidden) {
    if (patch.hidden.length === 0) delete entry.hidden;
    else entry.hidden = [...patch.hidden];
  }
  return [...stored.filter((b) => !isShelfOrder(b)), entry];
}

/** The stored list with one built-in board shown or hidden; the same list when nothing changes. */
export function withBoardHidden(stored: UserBoard[], key: BuiltInKey, hide: boolean): UserBoard[] {
  const hidden = shelfOrderOf(stored).hidden;
  if (hidden.includes(key) === hide) return stored;
  return withShelfOrder(stored, { hidden: hide ? [...hidden, key] : hidden.filter((k) => k !== key) });
}

/**
 * The stored list after board `id` is put down at `to` in `run`, the shelf's
 * run as drawn (`shelfRun`). The same list, by identity, when nothing changes.
 * On the places side the folders are renumbered in their new order and
 * Archive's seat is written as the folder it now follows; on the app side the
 * whole order is written, a hidden board keeping its seat, with the lens order
 * an older device reads beside it.
 */
export function placedOnShelf(
  stored: UserBoard[],
  boards: readonly Board[],
  run: readonly string[],
  id: string,
  to: number,
): UserBoard[] {
  const moved = placeInRun(run, id, to);
  const held = boards.find((b) => b.id === id);
  if (moved === run || !held) return stored;
  if (sideOf(held) === "places") {
    const order = moved.filter((key) => key !== ARCHIVE_BOARD.id);
    const before = run.filter((key) => key !== ARCHIVE_BOARD.id);
    // Only Archive moved: the folders keep their numbers, so this device does
    // not claim the folder order and overrule a reorder made on another one.
    const foldersMoved = order.some((key, i) => key !== before[i]);
    const at = new Map(order.map((key, i) => [key, i]));
    const folders = foldersOf(stored).map((b) => (at.has(b.id) ? { ...b, position: at.get(b.id)! } : b));
    const archive = moved.indexOf(ARCHIVE_BOARD.id);
    const next = foldersMoved ? withFolders(stored, folders) : stored;
    if (archive < 0) return next;
    const archiveAfter = archive === moved.length - 1 ? undefined : archive === 0 ? null : moved[archive - 1];
    // A folder carried past an Archive that stays where it was writes no seat.
    return archiveAfter === shelfOrderOf(stored).archiveAfter ? next : withShelfOrder(next, { archiveAfter });
  }
  const keyOf = new Map(boards.map((b) => [b.id, builtInKey(b)]));
  const keys = moved.map((key) => keyOf.get(key)).filter((key): key is BuiltInKey => Boolean(key));
  const whole = appSideOrder(shelfOrderOf(stored));
  let n = 0;
  const builtIns = whole.map((key) => (keys.includes(key) ? keys[n++] : key));
  return withShelfOrder(stored, {
    builtIns,
    lenses: builtIns.filter((key) => MOVABLE_LENSES.some((lens) => lens.id === key)),
  });
}

/** The stored list with its folders replaced and its order and Inspiration entries kept. */
export function withFolders(stored: UserBoard[], folders: UserBoard[]): UserBoard[] {
  const winner = inspirationOf(stored);
  const kept = stored.filter((entry) => isShelfOrder(entry) || entry === winner);
  return kept.length > 0 ? [...folders, ...kept] : folders;
}

/**
 * One time per account: the folder the user already calls their inspiration
 * becomes Inspiration (its notes keep their `board_id`; **no note is written**),
 * or a new entry is made. The marker is the whole change — a folder that was
 * tinted or given a mark loses both, because the app's own boards cannot be
 * dressed (DESIGN.md §2b). Returns the list it was given when there is already
 * one, so the caller stamps nothing dirty for it.
 */
export function adoptInspiration(
  stored: UserBoard[],
  makeId: () => string = () => crypto.randomUUID(),
): UserBoard[] {
  if (inspirationOf(stored)) return stored;
  const folders = foldersOf(stored);
  const named = orderedBoards(folders).find((b) =>
    ADOPTABLE_NAMES.includes(b.name.trim().toLowerCase()),
  );
  if (named) {
    return stored.map((entry) => {
      if (entry.id !== named.id) return entry;
      const { icon: _icon, color: _color, ...rest } = entry;
      return { ...rest, kind: "inspiration" as const };
    });
  }
  const position = folders.reduce((max, b) => Math.max(max, b.position), -1) + 1;
  return [...stored, { id: makeId(), name: INSPIRATION_NAME, position, kind: "inspiration" as const }];
}

/**
 * Whether it is time to adopt. All four, and the last is the one that matters:
 * the first-open question once answered itself on a device that had not yet
 * heard from the server and pushed an empty list over four real folders. Adopt
 * only after a whole tick has come round clean (`firstSyncDone`), so what is
 * adopted from is the account's own list, or a device that has no server.
 */
export function shouldAdoptInspiration(state: {
  prefsReady: boolean;
  loading: boolean;
  firstSyncDone: boolean;
  stored: readonly UserBoard[];
}): boolean {
  return state.prefsReady && !state.loading && state.firstSyncDone && inspirationOf(state.stored) === null;
}

/**
 * The places a note is filed into by hand, in the order the choosers list them:
 * the user's folders, then Inspiration (dressed with its reserved mark and fixed
 * name). The Move chooser, the Sorter, the capture bar's board mark and a card's
 * filed mark all read this one list, so Inspiration needs no second path.
 */
export function placesOf(folders: UserBoard[], inspiration: UserBoard | null): UserBoard[] {
  if (!inspiration) return folders;
  return [...folders, { ...inspiration, name: INSPIRATION_NAME, icon: INSPIRATION_MARK }];
}

/**
 * The folders the export writes: the user's, and Inspiration as one of them. A
 * note filed there is in a place, and the export writes places — left out, its
 * notes would have been written into the Inbox folder (`isFiled` against a list
 * that did not name it).
 */
export function exportFolders(stored: UserBoard[]): UserBoard[] {
  const winner = inspirationOf(stored);
  if (!winner) return foldersOf(stored);
  const { kind: _kind, ...plain } = winner;
  return [...foldersOf(stored), plain];
}

/**
 * The three movable lenses in the order the user put them in.
 *
 * Nothing that could be in the stored list is trusted to be whole. An id this
 * build does not know is dropped; a repeat counts once; and a lens the stored
 * order does not mention — one added after it was written, or a list cut short
 * by an older device — goes back in beside the lens it follows by default, or
 * first if none of those is present. So a shelf with no stored order at all is
 * exactly the default, and a new lens arriving in a shelf the user arranged
 * lands where it would have been, next to the neighbour it was designed to sit
 * by, rather than being pushed to one end.
 */
export function orderLenses(stored: readonly string[] | null | undefined): Board[] {
  if (!stored) return [...MOVABLE_LENSES];
  const known = new Map(MOVABLE_LENSES.map((lens) => [lens.id, lens]));
  const placed: Board[] = [];
  for (const id of stored) {
    const lens = known.get(id);
    if (lens && !placed.includes(lens)) placed.push(lens);
  }
  MOVABLE_LENSES.forEach((lens, i) => {
    if (placed.includes(lens)) return;
    const before = MOVABLE_LENSES.slice(0, i).reverse().find((prior) => placed.includes(prior));
    placed.splice(before ? placed.indexOf(before) + 1 : 0, 0, lens);
  });
  return placed;
}

/**
 * How one board wants to be drawn — its mark, its hue, or both.
 *
 * A patch rather than two setters, because the picker asks both questions on
 * one panel and a board that changed only its colour must not have its mark
 * rewritten to `undefined` on the way through. `null` is the way to say "back
 * to the default": the field is *deleted* rather than stored as null, so a
 * board with no mark of its own is byte-identical to every board written
 * before this existed, and the synced JSON does not grow a column of nulls.
 */
export function setBoardLook(
  existing: UserBoard[],
  id: string,
  look: { icon?: string | null; color?: string | null },
): UserBoard[] {
  return existing.map((b) => {
    if (b.id !== id) return b;
    const next: UserBoard = { ...b };
    if (look.icon !== undefined) {
      if (look.icon === null) delete next.icon;
      else next.icon = look.icon;
    }
    if (look.color !== undefined) {
      if (look.color === null) delete next.color;
      else next.color = look.color;
    }
    return next;
  });
}

/**
 * Whether a folder's notes keep the screen on while open. Off deletes the
 * field rather than storing `false`, for the reason `setBoardLook` deletes a
 * mark: a folder that was switched back is the folder it was before.
 */
export function setBoardAwake(existing: UserBoard[], id: string, on: boolean): UserBoard[] {
  return existing.map((b) => {
    if (b.id !== id) return b;
    const next: UserBoard = { ...b };
    if (on) next.awake = true;
    else delete next.awake;
    return next;
  });
}

/**
 * Whether the open note should hold the screen on: it is filed in a folder
 * that asked for that (`UserBoard.awake`), and it is not in the trash. Asked
 * of the shelf's own boards, so a note naming a deleted folder asks nothing.
 */
export function keepsScreenOn(note: Note | null, boards: readonly Board[]): boolean {
  if (!note || note.status === "trashed" || !note.board_id) return false;
  return boards.some((b) => b.kind === "folder" && b.id === note.board_id && b.awake === true);
}
