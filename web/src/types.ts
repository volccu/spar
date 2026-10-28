export type NoteType =
  | "note"
  | "todo"
  /** Put on the Links board by hand (`keptOnLinks` in `lib/boards.ts`). */
  | "link"
  | "recipe"
  | "delve"
  | "reference"
  | "journal";

/**
 * `trashed` is a holding pen, not a deletion: the note stays whole and
 * restorable until it ages out (SPEC §2.4). Nothing needs a `trashed_at`
 * column — a note enters the trash by being updated, so `updated_at` already
 * says when, and restoring it resets the clock by definition.
 */
export type NoteStatus = "active" | "archived" | "trashed";

/**
 * How often a reminder comes round again.
 *
 * Three periods, matching the picker's three presets, and null for the
 * reminder that rings once — which is every reminder the app could set until
 * this existed. The rule is a fact about the *series*; the instant it is
 * measured from is still `reminder_at`, untouched and never advanced by
 * anything (`lib/reminders.ts`, migration 0020).
 */
export type ReminderRepeat = "daily" | "weekly" | "monthly";

/**
 * A file carried by a note.
 *
 * An attachment is never stored in the note's text. `raw_content` is the
 * immutable original capture and `body` is prose the user edits; a file is
 * neither, so it rides alongside them and the two invariants stay intact. A
 * file added while there are words leaves a marker in the text, `[image 2]`,
 * which is ordinary characters pointing at `ref` (`lib/attachRefs.ts`).
 *
 * `thumb` is the reason this works as a way to move a file between two
 * machines. It is a deliberately tiny JPEG carried *in the note row itself*,
 * so the moment the note syncs the other device can already draw the picture —
 * before it has downloaded a single byte of the file. Finding what you just
 * sent stops being a task: it is the newest card, and it looks like the thing.
 */
export interface Attachment {
  id: string;
  name: string;
  /** As the browser reported it. Empty when it wouldn't say. */
  mime: string;
  size: number;
  /** Pixels, images only — lets a preview reserve the right shape. */
  width: number | null;
  height: number | null;
  /** A ~200px JPEG data URL, or null for anything that is not an image. */
  thumb: string | null;
  /** Where the bytes live on the server. Null until the upload lands. */
  path: string | null;
  added_at: string;
  /**
   * Its number among the note's files of its kind, for a `[image 2]` marker
   * (`lib/attachRefs.ts`). Given when the file is added and never changed;
   * absent on files added before markers existed.
   */
  ref?: number;
}

export interface LinkPreview {
  href: string;
  domain: string;
  title: string;
  description: string | null;
  image: string | null;
  fetched_at: string | null;
  /**
   * The page answered **404 or 410** the last time it was asked — and only
   * those two; a bot wall, a 5xx or a timeout never sets it (`linkStatus.ts`
   * beside the function). Absent means nothing says the page is gone, which
   * is every preview written before this existed. A later answer from the
   * page clears it. Carried inside the `link_previews` jsonb like every other
   * field here, so it cost no migration, and a client that has never heard
   * of it keeps it: every writer spreads the entries it does not touch.
   */
  gone?: boolean;
  /**
   * When the app last asked again whether the page is still there — the
   * re-check that runs on open (`dueForRecheck` in `lib/links.ts`). Absent
   * until the first re-check; `fetched_at` stands in for it until then.
   */
  checked_at?: string | null;
  /**
   * The owner hid this preview from the open note and from the card
   * (`withPreviewsHidden` in `lib/links.ts`). The address stays in the text,
   * live, exactly as written: only the box is put away. Absent means shown,
   * which is every preview written before this existed; showing again
   * removes the key rather than writing `false`. Carried inside the
   * `link_previews` jsonb like every other field here — no migration — and
   * **every writer must keep it**: an unfurl rebuilds an entry from the local
   * unfurl and has to copy this across by hand (`ask` in
   * `store/useLinkUnfurl.ts`), and a merge carries the hidden entries of its
   * sources (`buildMerge`).
   */
  hidden?: boolean;
  /**
   * What the page's picture is — written by the function's site-aware
   * extraction (`supabase/functions/_shared/media.ts`) and read by the
   * Inspiration wall. `undefined` means this entry was fetched before the
   * function could say (the wall asks once more); `null` means it asked and
   * there is nothing to say. Carried in the `link_previews` jsonb like every
   * field here, so no migration, and every writer spreads what it does not touch.
   */
  media?: "image" | "video" | null;
  /** Pixels of the **stored** `image`, so a tile reserves its shape before the picture loads. */
  width?: number;
  height?: number;
  /** A video the viewer may play in place — streamed from the source, never saved. */
  video?: { kind: "file" | "youtube" | "vimeo"; src: string };
  /** The long edge, in pixels, the stored `image` was shrunk to (200 elsewhere, 480 on the wall). */
  thumb_px?: number;
  /**
   * When the function was asked once more because the note is on the
   * Inspiration wall (`needsUnfurl`). Written by that ask whatever came back,
   * so an older function, or a page with no bigger picture, ends it for good
   * rather than being fetched again on every open. Absent means never asked.
   */
  wall_asked_at?: string;
}

/** Mirrors SPEC §4. `raw_content` is the immutable original; `body` is what the UI edits. */
export interface Note {
  id: string;
  raw_content: string;
  body: string;
  source: string;
  created_at: string;
  updated_at: string;

  /**
   * Hand-set only, never guessed. Two of the six are reachable, and they are
   * the two ends of one switch: the Todo-toggle in the open note (SPEC §6)
   * writes `todo` when it is turned on and **`note`** when it is turned off.
   * `note` is not a category, it is an opt-out — *this list is not a to-do
   * list* — and it exists because a note can also be on the Todos board by its
   * own tick boxes, which `null` is powerless to contradict. `null` therefore
   * keeps meaning "the user has never said", which is what every imported note
   * carries. See `isTodoNote` in `lib/boards.ts`, the one place both halves are
   * stated. The other four are inert until something in the UI sets them.
   */
  note_type: NoteType | null;

  // organizing
  /** The one board this note is filed in, or null — unfiled, still visible
   *  on All. A note lives in at most one board at a time (SPEC §6). */
  board_id: string | null;
  status: NoteStatus;
  priority: number;
  reminder_at: string | null;
  /**
   * The repeat rule, or null for a reminder that rings once. Read together
   * with `reminder_at`, never alone: a rule with no anchor is not a reminder,
   * which is why clearing the reminder clears this in the same write.
   */
  reminder_repeat: ReminderRepeat | null;
  done: boolean | null;

  merged_from: string[] | null;
  /** Archived source notes point at the idea that replaced them. */
  merged_into?: string | null;
  keep_id: string | null;

  /** Files carried by this note. Empty for all 241 imported notes. */
  attachments: Attachment[];
  /** Optional online metadata; absent until a background fetch succeeds. */
  link_previews?: LinkPreview[];
  /** Per-field sync clocks; absent on notes created before conflict protection. */
  field_updated_at?: Record<string, string>;
}

/**
 * One pencil stroke on the infinite canvas. Coordinates are in world space
 * (relative to the world origin at 50 000), the same system the notes use.
 */
export interface DrawingStroke {
  id: string;
  points: [number, number][];
  color: string;
  width: number;
  /**
   * Set on a shape (`lib/shapes.ts`): `points` is then its outline, drawn straight rather
   * than smoothed. Absent on a hand-drawn line. An older device draws the same points as a
   * line, which is why the outline, not the shape's two corners, is what is stored.
   */
  shape?: ShapeKind;
  /** A closed shape filled with its own pen colour (DESIGN.md §2b). */
  fill?: true;
  /** Drawn with the highlighter: the pen's colour, see-through, under the other strokes. */
  highlight?: true;
}

export type ShapeKind = "rect" | "ellipse" | "line" | "arrow";

export type CanvasTool = "move" | "select" | "draw" | "highlight" | "shape" | "erase" | "text";

/**
 * A free-standing text label on the canvas. Coordinates are in world space,
 * like everything else. Width is absent on labels made before the Text tool.
 */
export interface CanvasText {
  id: string;
  x: number;
  y: number;
  text: string;
  width?: number;
}

/** A merged idea can be opened as a spatial folder without changing the note model. */
export interface CanvasItem {
  note_id: string;
  x: number;
  y: number;
  /** Pixel width of the note card on the canvas. Absent means the default. */
  width?: number;
}

/**
 * A picture placed straight onto a canvas. The bytes are an ordinary
 * attachment on the idea note itself (a file is a note); this is only where it
 * stands. Its width is `image_widths[attachment_id]`, as a note's picture's is.
 * On the server it travels inside the `items` column (`canvasSync.ts`), so it
 * needed no migration.
 */
export interface CanvasImage {
  attachment_id: string;
  x: number;
  y: number;
}

/**
 * Folder state is local-first and deliberately separate from Note. The idea
 * note remains the provenance record; this stores only the spatial arrangement,
 * any freehand strokes drawn on the canvas, per-image display widths, and
 * free-standing text labels.
 */
export interface Canvas {
  id: string;
  idea_id: string;
  items: CanvasItem[];
  strokes: DrawingStroke[];
  /** Attachment id -> display width in pixels, for resized images on the canvas. */
  image_widths: Record<string, number>;
  text_elements: CanvasText[];
  /** Pictures placed on the canvas itself. Absent on canvases made before them. */
  images?: CanvasImage[];
  created_at: string;
  updated_at: string;
}

/**
 * A board is a real folder, not a saved filter — a note is `matchesBoard`'s
 * business, not a query. Five kinds are automatic (Inbox/All/Todos/Links/
 * Files), two are the ends of the shelf (Archive/Trash), and `folder` is the
 * user's own: something they made from the Shelf and file notes into by hand.
 *
 * `recent` is the kind behind the board now **named All** — the name changed,
 * the kind did not, because `matchesBoard`, the empty-state copy and the card's
 * filed mark are all written against it (`lib/boards.ts`).
 *
 * `inbox` is the landing board: active notes that are in no folder. It is the
 * one board whose count is a debt and can reach zero — which is exactly what
 * All's count, being every active note at once, can never do.
 *
 * `inspiration` is the one built-in board a note is filed into (a place, not a lens) — see `lib/boards.ts`.
 */
export type BoardKind =
  | "inbox"
  | "recent"
  | "todos"
  | "links"
  | "files"
  | "folder"
  | "inspiration"
  | "archive"
  | "trash";

export interface Board {
  id: string;
  name: string;
  kind: BoardKind;
  /**
   * A folder's own mark and hue, carried through from the `UserBoard` it was
   * built from (`buildBoards`) so the strip, the drawer and the phone's header
   * row all read one object. Never set on the eight automatic boards: those
   * have marks of their own that say what they *are*, and a colour on Inbox or
   * Trash would be the app dressing itself rather than the user naming a place.
   */
  icon?: string;
  color?: string;
  /** A folder whose notes keep the screen on while open — see `UserBoard`. */
  awake?: true;
  /**
   * Inbox only: the date the Inbox starts at, as answered once on first open —
   * see `INBOX_ALL` and `buildBoards` in `lib/boards.ts`. Unfiled notes written
   * before it are left out of the pile while staying exactly as findable as they
   * ever were, on All and in search. Absent means the question has not been
   * answered yet, and everything unfiled is in.
   */
  since?: string | null;
}

/** A user-made folder board, as stored in prefs — see `store/useBoards.ts`. */
export interface UserBoard {
  id: string;
  name: string;
  /** Shelf order among the user's own folders, stable across a rename. */
  position: number;
  /**
   * The mark this board wears, as a Heroicons outline export name
   * (`"BookOpenIcon"`). Absent means the folder mark every board started with.
   * Validated on the way in by `isBoardIcon` — an unknown name draws the
   * folder, never nothing, so a board synced from a newer client is still a
   * board here.
   */
  icon?: string;
  /**
   * The hue this board is recognised by, as a palette key (`"teal"`). Absent
   * means no tint — the ordinary `--muted` mark. See `lib/boardLook.ts` for
   * the sixteen, and why none of them adds a step to the ramp.
   */
  color?: string;
  /**
   * The screen stays on while a note filed here is open (`keepsScreenOn` in
   * `lib/boards.ts`) — the owner's ask of 2026-10-05, for a recipe read with
   * floury hands. Set from the folder's own menu; absent means off, never
   * `false`, so a folder switched back is byte-identical to one never switched.
   * Rides in the same synced preferences row as the mark and the hue, and an
   * older client carries it through untouched, since folders are spread whole.
   */
  awake?: true;
  /**
   * Marks the one stored entry that is the Inspiration board (`inspirationOf`
   * in `lib/boards.ts`). It rides in the same synced `prefs.boards` list as
   * every folder, so no migration: a client that has never heard of it reads
   * an ordinary folder. Absent on every folder the user made.
   */
  kind?: "inspiration";
}
