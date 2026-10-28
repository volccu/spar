# Notes+ — Build Spec v2

A personal notes app for one user (Android phone + Windows desktop) that replaces Google Keep.
Working title: "spår".

**v2 supersedes v1.** v1 bet that AI would organize and the app would forget on your behalf; that
bet is withdrawn. Read this file before designing any feature. How each rule came about is in
`docs/decisions/spec.md`.

---

## 1. The actual bet

Google Keep's *data model* is fine. Its *interface* is what fails, and it fails in specific,
fixable ways:

- **Masonry chaos.** Staggered card heights destroy the reading path. Your eye jumps erratically.
- **No hierarchy.** A two-line jot and a 4,000-character pasted wall of text get identical
  treatment. The 40-item checklist visually suffocates everything around it.
- **Organizing costs too many taps.** Labelling, reordering, or prioritising is buried in menus,
  so it never happens.
- **No merge.** Two notes about the same thing stay two notes forever, because fixing it means
  open → select → copy → open → paste → format → delete. Nobody does that.
- **The FAB covers content.** A permanent dead zone over the bottom-right of every screen.
- **One undifferentiated scroll.** No way to say "just show me the todos".

We are not out-thinking Keep. We are out-*building* its interface.

The competitor is still "not taking the note at all" — so capture stays sacred. But the second
competitor is "took the note and never found it again", and that one is an interface problem.

## 2. Principles (non-negotiable)

1. **Capture asks for nothing.** One text field; type, enter, gone. No title input and no tag
   picker, ever. It **offers** four optional marks beside Save once there is something to save —
   priority, to-do, board, reminder — and offering is the whole distinction: every one starts off,
   Save works without touching any of them, and typing-then-Enter costs exactly what it always did.
   Each mark is the same one the open note uses for the same thing; the reminder's clock offers the
   open note's four presets, applied at Save, and Save is when the device is asked to ring.
   (Reminder: 2026-10-05, owner approved, review FX-B-06.)
   The bar may also **tell** — never ask — in one line on its top edge: that an address being
   written is already saved ("Saved 3 days ago · Open"); and, only when a capture lands where the
   screen cannot show it, the header's creature says where it went ("Saved to Inbox · Go",
   2026-10-16). Neither blocks Save or Enter, and neither moves the board.
2. **Organizing is optional, post-hoc, and one gesture.** Organizing must never be *required* —
   but when the user wants it, it costs one tap or one swipe, never a menu dive.
3. **The original capture is always recoverable.** `raw_content` is the immutable original.
   Editing writes to `body`. The original is kept forever and is in every download; there is no
   button that shows it (§5, "The open note"). (2026-10-10, owner approved, audit UX-4.)
4. **Nothing is destroyed by accident.** Archiving destroys nothing and archived notes stay fully
   searchable. Deleting moves a note to the **trash**, where it stays whole and restorable for 30
   days before a sweep removes it for good; trashed notes are excluded from search, because they
   are on their way out. Exactly two paths may ever destroy a note: that sweep, and the user
   emptying the trash by hand, which asks first.
5. **A note needs no metadata to work.** There is no AI layer (see §8) — every field beyond the
   text itself is something the user sets by hand, or leaves unset. Every surface must look right
   with raw text alone.
6. **The 90% path is instant.** Open, scan, capture, edit, find. Every one of these is optimistic
   and local: the UI commits in under 50ms and syncs afterwards. Never a spinner on the hot path.
   The promise is **measured** on the device it is made on: capture, open, typing and find are
   each timed to the frame that shows their answer, and the About page shows the median of the
   session (`lib/speed.ts`). Nothing is stored and nothing is sent.
7. **Everything can leave.** One download holds the whole archive in a shape that needs nothing
   from this app to read: each note a plain text file, the places a note can be (Inbox, your
   folders, Archive, Trash) as folders, a note's files beside it, the original of an edited note
   beside that, and all of it again as one JSON file (`lib/exportArchive.ts`, from the About
   page). A notes app you cannot leave is keeping your notes on its own terms.

## 3. Architecture

**Local-first, single writer.** The UI reads and writes a local IndexedDB store as its source of
truth. A background outbox queue pushes changes to Supabase and pulls remote changes on
reconnect. Conflict resolution is last-write-wins per field.

> **Explicitly rejected: CRDTs.** They solve concurrent multi-writer merge; this is one person on
> one device at a time. Automerge/Yjs, a custom sync loop and websockets buy nothing here, and
> optimistic local writes + an outbox give the same sub-50ms feel.

> **Explicitly rejected: a block-based data model.** Merge is a text-composition problem, not a
> storage problem (§7). Notes are markdown text.

- **Backend:** Supabase (Postgres + `pgvector`, auth, RLS, edge functions). Sync target, not the
  source of truth for the UI.
- **Web/PWA:** Vite + React + TypeScript. Primary UI on desktop browser and Android. Installable,
  with a `share_target` manifest entry.
- **Desktop capture:** Tauri tray app, global hotkey overlay. Deferred until after the first public
  release (2026-10-01, review PL-08); see §11.
- **AI enrichment: removed.** Tried, then cut — see §8 for what it was and why. No Gemini calls,
  no embedding calls, anywhere in the stack.

## 4. Data model

```sql
notes (
  id            uuid primary key default gen_random_uuid(),
  raw_content   text not null,        -- the original capture. IMMUTABLE, enforced by trigger.
  body          text not null,        -- what the UI shows and edits. Defaults to raw_content.
  source        text not null,        -- 'web' | 'overlay' | 'share' | 'import' | 'merge'
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),

  note_type  text,                    -- note|todo|link|recipe|delve|reference|journal. User-set by
                                       -- hand only: the Todo-toggle writes 'todo' on and 'note'
                                       -- off, moving a note to Links writes 'link'; never
                                       -- AI-guessed — there is no AI layer (§8).
  board_id   uuid,                    -- nullable, no FK; null = unfiled. A note lives in at most
                                       -- one board at a time, like a file in a folder (§6). Just
                                       -- an id string matched against prefs.boards below; one
                                       -- person's own boards don't need a foreign key.

  -- organizing (user-owned, all one-gesture)
  priority   smallint default 0,      -- 0 normal, 1 high. One tap. Sorts to top.
  status     text default 'active',   -- 'active' | 'archived' | 'trashed'
  reminder_at timestamptz,            -- the anchor of a reminder (§10)
  reminder_repeat text,               -- 'daily' | 'weekly' | 'monthly' | null (§10a)
  done       boolean,                 -- dead: written null, read by nothing (see CLAUDE.md)

  attachments  jsonb,                 -- files carried by the note
  link_previews jsonb,                -- optional Open Graph previews, and the "gone" verdict (§5)
  merged_from uuid[],                 -- provenance; see §7
  merged_into uuid,                   -- archived source -> its idea
  keep_id    text                     -- import bookkeeping; unique per owner (owner_id, keep_id)
);

-- A person's own folder boards are not a table of rows — there is one shelf per person, so they
-- ride on one row per person (migration 0014, repurposed by 0016). No cursor, no per-row RLS: a
-- pull is "read my row", a push is "write my row", and the conflict rule is "did anyone here
-- actually touch the boards" rather than plain last-write-wins (store/boardSync.ts).
prefs (
  owner_id   uuid primary key default auth.uid(),
  boards     jsonb default '[]',       -- [{id, name, position, …}], the user's own folders in order
  inbox_since timestamptz,             -- the first-open answer (§6), migration 0018
  updated_at timestamptz default now()
);

interactions (id bigserial, note_id uuid, kind text, created_at timestamptz);  -- dead, kept (CLAUDE.md)
```

`raw_content` immutability stays enforced by a BEFORE UPDATE trigger. `body` is freely editable.

## 5. Layout & visual language

> **Colour and type are `DESIGN.md`'s** (direction: DARKROOM — *a dark room with one light in it,
> and the light is what you wrote*): **dark is the ground** (a light ramp is a device's choice), nine tones on one warm greyscale, ground
> `#0c0a08`, emphasis a step along that ramp or a rule weight, and no colour anywhere except a
> **folder the user made** (`DESIGN.md` §2b, §12d below). Layout, grid geometry, card faces and
> motion below still stand. Where the two disagree about a value or what a state looks like,
> `DESIGN.md` wins.

**Kill the masonry.** Uniform card heights, deterministic grid. Two columns on phone, more on
desktop. Long content truncates with a hard fade — that's the signal to open the note, not a
failure. No exceptions — except the Inspiration board, which is a wall (§6). No list/grid
toggle (a hedge that doubles the layout work).

**No gutters.** Cards tile edge to edge and share their rules — no gap between them, no margin to
the window. Each card draws only its right and bottom rule so tiled neighbours never double a line,
and the outermost edges are the screen itself. The grid reads as one ruled sheet rather than a tray
of floating tiles.

**A note has no heading the app made.** Not a field, not a derived one. The card shows the text
from its first character and cuts it when it runs out of room. **A first line opened with `# ` is
the note's name**, exactly as it is an idea's: the open note offers a note with no name a one-tap
`Name` above its text that writes that line, and the card sets it in the voice an idea card names
an idea in, on the line it already occupied.

**Type-driven card bodies.** The card face is chosen by `note_type`, but only ever to decide how
the text is *arranged*, never to split a heading out of it:
- `todo` → checkboxes, first N items, "+k more"
- saved link → domain in the label row, the note's own words as the body, no raw URL
- everything else → the note's text, cut at the budget, with the hidden mass printed

**Every URL in a note is live.** A quarter of the archive is saved links, and a link you can't tap
is a link you retype. The open note is therefore *read* first and edited on touch: a textarea
cannot hold a working anchor. Both modes are set identically and the caret lands where the finger
did, so there is no visible mode — you touch the note and type.

**Link previews are optional enrichment.** A local title/domain preview renders immediately. When
online, the client may ask the Supabase Edge Function for public Open Graph metadata, which is
stored with the note and syncs to the other device. A missing preview never blocks capture, text,
search, or the live URL.

**A dead link says it is gone.** A page that answers **404 or 410** is recorded as gone inside its
stored preview (no migration — the previews are one jsonb column), and the note shows the word
`gone` in the card's footer, on its Links row and beside the site in the open note; nothing about
the note's text or the address changes, and the link stays live. Nothing else counts as dead: a
403 is a bot wall, a 5xx or a timeout is a moment, a name that will not resolve is the network's.
Because a preview is fetched once, the app also **asks again**: once a session, while online and
idle, the few links (at most five) whose last answer is more than a month old, oldest first. A
re-check writes only the verdict and when it asked — never the title or picture the owner has been
looking at — and a later answer from the page clears the mark. Like every preview write it does
not move the note on its board, which is ordered on the last *edit*.

**Three faces, three jobs.** Marcellus names things (the wordmark, the boards). Libre Baskerville
carries every word the user wrote. IBM Plex Mono carries machine data — counts, dates, `+1.4k`,
`[x]`, sync state. A note is only ever set in Baskerville. All three are self-hosted; the 90% path
may not wait on a font CDN.

**Six sizes, and no seventh.** `10.5` machine data · `12` board names · `13` a note on a card ·
`16.5` a note open, and every field you type into · `21` the wordmark · `34` the sign-in
mark. Capitals and monospace are tracked; Baskerville lowercase never is. Anything that needs a
size not on this list is a sign the layout is wrong, not the scale.

**The ramp is the whole design.** *(See `DESIGN.md` §2.)* Nine tones on one warm greyscale
and nothing else: no colour, no texture, no second family, no ornament. A card has **no fill at
all** — it is the ground, defined entirely by its two rules — so the board is a lattice of
hairlines drawn on black rather than a tray of tiles. The discipline is the identity: the app
cannot compete with its own contents, because the only bright things on any screen are the words.

**The cut lands on a baseline.** A card body is clamped to a whole number of line boxes, so text
can only ever end *on* a line — a sliced last line reads as broken rather than cut. CSS owns the
line count; `useCardMetrics` **measures** a rendered card and derives characters per line from its
real width, because a desktop column runs anywhere from 246px to 323px and one fixed number tuned
for the wide end spills over at the narrow one. Card faces are display-only: blank-line runs are
closed up and addresses are dropped, since a blank line costs an eighth of a phone card. The note
itself is never touched.

**The system bars match the app.** A manifest holds one `theme_color`, so the app writes
`theme-color` from the resolved `--paper` value at startup (`themeColor.ts`): there is exactly one
definition of the background and it lives in the stylesheet.

**Priority is a flag, at the head of the card's footer row.** No stripe, no frame, no tint, no hue:
a coloured accent rail is the most generic move an interface can make, a tinted fill reads as
*disabled*, and a 2px frame was still too much furniture — all three stay rejected. The footer is
the one row a card already keeps its marks in.

**Cards carry no type label.** `NOTE`, `TODO`, `RECIPE`, `DELVE` cost a row at the top of every
card and told you nothing the text itself doesn't. The type still exists in the data and still
picks the card face; it is simply never *shown*. It is edited by hand in exactly one way — the
open note's Todo-toggle (§6, §12b) — and never derived by AI, since there is no AI layer (§8). The
only header row left in the grid is a saved link's domain, which genuinely helps you scan.

**The open note is its text and six marks.** Back, priority, archive, delete, Move, Todo-toggle —
drawn, unlabelled, unframed. No fields, no button that reveals `raw_content`. Move opens the same
board-picker the multi-select panel uses, to file just this note. Todo-toggle sets or clears
`note_type: 'todo'` by hand — the one field a person edits directly now. Everything else the note
needs to say about itself is in the note. At every width the bar also carries the shelf's burger,
beside Back, which opens the board drawer over the note (§6). It is not a seventh mark: it says
where you are, not what is done to this note, which is why it sits with Back and not in the corner.

**The cut fades, on the last line and only there.** An overflowing card's text loses its ink across
the final line box rather than stopping at a hard edge. The card body must therefore *always* be
full when it is cut, so `cutToLines` deliberately hands CSS one line more than it can draw and lets
the clamp eat it. The remainder is still counted at the honest cut, not the overfilled one. The
mask is alpha only, so it survives the card inverting. Checklists never fade — an item is a whole
thing, and half a tick box reads as broken.

**How much more, in three steps.** Under the cut sits one, two or three stacked rules — a level,
filling upward — not a character count: the question is "a bit more, or a lot", not how many
characters. Thresholds are in `cutDepth` and come from the archive's real shape.

**A stamp says how long ago, not what day.** For the first week a note's footer counts: minutes,
then hours, then days to six; on the seventh day the calendar takes over. Every form fits the six
characters the calendar form uses, so nothing in the footer moves. The open note spells it out —
"3 hours ago" — and prints the exact day beside it, with the month named rather than numbered so
that 10/8 can never be read as the eighth of October.

**A list is set as a list.** A dash item, a tick box or a number is a block of its own, on tighter leading
than the prose around it, with the space that buys spent *between* items instead. The gap inside an
item must stay smaller than the gap between two, or a wrapped item reads as two items. Every line
of an item starts at the same left edge as its marker — a hanging indent was tried and rejected,
because the second line read as indented and the note ended up with two left margins.

**Anything you can put into a note goes in one list** (`INSERTS` in `InsertPanel`). A tick box and a
code block today, an image next, and whatever follows lands as one more row rather than as another
control in the bar. It inserts at the caret, on a line of its own, and leaves the cursor where you
would want to keep typing. **Today's date is the one exception**: it is a word in a sentence, so it
goes into the line at the caret, written with the month named and the year always, and leaves the
cursor after it.

**A field you can fill is a field you can empty.** Every text input carries a clear mark while it
has content. In the capture bar it sits in the field's own top corner, never in the bar — Save is
in the bottom corner and is the one control there you must not hit by accident.

**Nothing in this app is coloured except a folder the user made** (`DESIGN.md`, §12d). Android
paints a translucent blue over anything tapped and over selected text; both are turned off, and
every control supplies its own pressed state by inverting — the same mark the app already uses for
"on" and "selected".

**Motion says where things went, and nothing else.** Every move in the app answers one question —
*where did that come from, where did it go, where am I now* — and there is no motion that answers
none of them. One language, defined in `lib/motion.ts`: two curves and a fixed set of durations,
and nothing invents its own. `ENTER` is a hard decelerate, so most of the distance is covered in
the first third and the move reads as fast without being short; `EXIT` accelerates away, because a
thing that is leaving is not the thing you want to watch. Everything is skipped entirely under
`prefers-reduced-motion`.

**A container changes its clip, never its scale.** A note opening is laid out full size from the
first frame; what animates is the clip, from the tapped card's measured rect out to the edges of
the screen. Nothing inside is ever scaled, so the type is set once, at reading size, for the whole
move. The owner rejected scaling the sheet by name — the "stretchy" feel. The one exception is a
card *leaving* the grid, which scales uniformly because the whole object is going, not changing
shape.

**The parts of a move do not travel together.** The frame arrives first; the chrome fades onto it;
the words follow 50ms later and rise a few pixels as they land. One thing leading and another
catching up is what makes a transition read as driven rather than merely long. Because the clip is
a window onto a sheet that is already full size, anything under that window shows through it at
full size — so the chrome must fade in, or opening a top-row card starts on four icons filling a
card-sized hole.

**Boards are a shelf, and paging moves along it.** The deck of cards follows the finger while you
drag (damped, and barely giving at the ends of the shelf, which is how a physical thing says
"nothing past this"), carries on out the side it was pushed, and the next board arrives from the
other side and settles. Direction of travel is the whole message. **A board arrives where you left
it** — each keeps its own scroll position for as long as the app is open, and the slide-in carries
it already at that offset rather than landing at the top and jumping. The tab you are already on
takes you to its top: the deck starts where the view was (a screen short of the top, from further
down) and settles onto the top on the arrival curve, which is a scroll said in the motion language
and never longer than a screen; under reduced motion it is the jump alone.

**The grid closes its own gaps.** When a card leaves, the cards after it are measured before and
after and played from where they *were* to where they now are, so the tiles visibly slide together.
The card that left doesn't just stop existing: a still of it, pinned where it stood, shrinks into
the mark for what happened to it — the bin, the archive box, or the arrow back out. Two things at
once: *this one*, and *this is where it went*. Neither survives being said in words in a toast a
moment later. Deleted or archived from the open note, the sheet itself collapses onto the mark, and
the card's version is suppressed — two shrinking objects saying one thing is one too many.

**A mark that is drawn but not read is not drawn.** The mark reaches full size, then *holds still*,
alone in the empty slot, and the grid does not begin to close until it has. The hold is why
`VANISH_MS` is 460 and not 300.

**A pressed card does not move, and does not invert** — only selection inverts a card (the tap
already opens the note). The usual pixel of travel is wrong here specifically: the cards share their rules
with their neighbours, so shifting one opens a hairline gap on two sides and closes one on the other
two.

**The grid is walkable from a keyboard.** Arrows move by one card or one row, Home and End go to the
ends, Enter opens, Delete trashes with the usual undo. It is built on real focus — the cards are
already buttons — so scrolling into view and the focus ring come for free, and `:focus-visible`
means a mouse user never sees it. The row width is counted from the cards' own positions, never from
the grid's template: the template is a formula and only the browser knows what it resolved to.

**A note you just left draws its own border once.** Two strokes leave the top-left corner together,
one along the top and down the right, the other down the left and along the bottom, and they meet at
the bottom-right; then the figure fades. It fires on capture and on closing a note. The grid is a
wall of near-identical tiles and you have just come back to it from somewhere else — without this
you are returned to a static screen and have to find your note by reading.

**Tick boxes and code are text, not widgets.** A box is the literal characters `[ ]` in the machine
face; a fenced code block keeps its ``` fences in the note and renders them hidden. Both are
therefore still plain text you can select, copy, sync and search — and, critically, the rendered
text still matches the stored text character for character, which is what keeps tap-to-caret
landing where the finger did. Unfenced code is detected only on strong, multi-line evidence, and an
explicit tick box always beats the guess.

**Typing help, and only three rules.** `- ` at the head of a line becomes an en dash; `[] ` becomes
a tick box; a number needs no substitution because `1. ` is already what it should be. Enter
continues any of the three, counting the number up as it goes, and Enter on an empty item ends the
list. Nothing fires unless the caret is sitting exactly on the trigger, so pasting and re-editing
never rewrite text under the user — which is also why inserting into the middle of a numbered list
does **not** renumber the items below it. Those lines are text the user is not typing on, and this
app does not reach for them. The capture bar's To-do mark is no exception: it marks the note as a
to-do and saves the words as written, so a short to-do stays a compact slip on Todos (owner,
2026-10-26; it used to box each line).

**No hue inside a note, and the one emphasis is a link** (`DESIGN.md` §3 and §2b). The app has no
colour anywhere except a folder's own mark on the shelf (§12d), and never
in or on a note. The signal is the brightest tone on a nine-step warm greyscale, and it appears
in exactly one place: a live address inside an open note, which is the only thing in a note that
is not text. It is brighter *and* warmer than the words around it and underlined — two tonal
signals, because either alone is too quiet. Everything else meaning "on", "selected", or "marked"
inverts or raises. Note type is a mono label, not a colour, because four hues across a 241-card
grid reads as confetti — and that is still true of anything drawn on a card. The board tints are
the opposite case and are why they were allowed: eight hues across a *shelf* of eight names is
eight things told apart at a glance, on a row that exists to be scanned rather than read. A canvas
pen may wear the same sixteen (2026-10-28, owner asked): a stroke is the user's drawing, not the
app's state, and hue is how one mark on a drawing is told from another (DESIGN.md §2b).

**Sync is drawn, not spelled.** Two nodes — this device and the other one. At rest they sit exactly
on top of each other, because that is what synced means: two copies of the same thing in the same
place. While syncing they part, dashed data runs across, and they close again. Only the calm states
get the mark. *Offline* and *failed* stay as words, because a silent icon is the wrong way to tell
someone their notes aren't leaving the device.

**Brutalist chrome, humane body.** Hard 1px borders, no shadows, no blur, no rounded corners, high
contrast, flat surfaces. Body text gets generous line-height and a comfortable measure —
brutalism applied to dense text is fatiguing, and this app is dense text. Brutalism also earns its
keep structurally: flat cards with hard rules read as a grid with no depth cues needed.

**Anchored bottom capture bar, and it grows.** Replaces the floating action button entirely — no
permanent dead zone over content, and better one-handed reach on Android. It is a textarea, not an
input: Enter is Save and must stay Save, so **Shift+Enter** breaks the line, and the bar grows with
what is in it up to `--capture-max` and then scrolls.

## 6. Navigation — boards

The home screen is one continuous scroll of a *board*. Default board is the **Inbox**.

**Boards are real folders, not saved filters** (see §12b). Every note carries a nullable
`board_id`. A note lives in **at most one board at a time**,
like a file in a folder on a desktop: filing a note into a board removes it from wherever it was
before, including another folder.

- The shelf has a **fixed shape**, and it divides the user's places from **the app's own boards**
  (2026-10-08, owner approved; it used to divide places from lenses):
  **Inbox, the user's folder boards (in shelf order), Archive** — one run of *places* — then one
  hairline rule and a narrow band of empty space, then **Inspiration, Todos, Links, Files (in the
  order the user put the last three), All** — the app's own boards: one place, then the lenses.
  The place-versus-lens distinction still governs counts and filing. A place is somewhere a
  note **is**, and it is in exactly one of them; moving it into one moves it out of another. A lens
  holds nothing of its own: a note appears in it by what it *is*, filing never puts a note in one
  or takes it out, and their counts therefore sum to more than the archive holds and can never be
  reconciled by arithmetic. There is still only one divider. Inspiration is a **place**, not a
  lens: a note is filed into it by hand like into any folder (single-home), and it stands past the
  line because it is one of the app's own boards. The line now says **the app's own boards begin
  here**; the sentence "past this point nothing is a destination" is true of Todos, Links, Files and
  All and is no longer true of the line as a whole (2026-10-08, owner approved).
  **Archive** closes the places by default rather than opening the lenses: it is the far end of a
  note's life, not a way of looking at one. **All** sits last by default, as the widest lens there
  is. Both can be carried (below). **Trash**
  stands outside the scrolling strip entirely, beside search, as a mark and a count with no name:
  it is a place, but it is the one destination that may never scroll out of reach.
  Nothing is persisted by board index, so the order is free to change; the Inbox is the one
  position that is pinned, because the menu's *Bring in the old notes* row and the landing after a
  folder is deleted both mean board 0 when they say it.
- **Inspiration is a wall.** A built-in board for pictures and links to pictures (owner approved
  2026-10-08): columns of uneven tiles, each picture at its own shape (clamped 1:2–2:1), tapping a
  tile opens a full-screen viewer that swipes through the board's pictures (videos play in place,
  streamed from the source and never saved). Things get in by filing (like any folder), by writing
  while standing on it, and by a one-tap offer when something is shared from the phone. It is not a
  per-folder layout setting and not a list/grid toggle. X and Instagram are out of scope.
- **The shelf is put in order by hand: hold a board and carry it.** Your folders and Archive move
  among themselves, and Inspiration, Todos, Links, Files and All among themselves — **never across
  the hairline**, which would make the one line on the shelf say something false. Only the Inbox
  (the app opens on it) and Trash hold their seats (2026-10-23, owner approved). **Any of the app's
  own boards can be hidden in Settings** — Archive, Inspiration, Todos, Links, Files, All, Trash —
  never the Inbox. Hiding takes a board off the strip and the drawer and moves nothing: its notes
  stay where they are, search still finds them, and a hidden Trash is still the menu's Trash row.
  The order and the hidden list are the account's, synced like the folders. Letting go of a held board *where it was* opens its menu; carrying it is the move; a quick
  swipe is still a scroll, and a tap still a tap. The menu keeps its **Move left/right** (up/down in
  the drawer) rows as the way that needs no pointer, and a lens gets a menu of those two rows
  alone. The order syncs with the folders, in the same preferences row.
- **On a phone the header row says which board you are on, and opens the shelf.** One control — the
  burger, the board's own mark, its name and its count — in the slot the tab strip fills on a
  desktop, at the same height, so search still opens into that slot without anything on screen
  moving. There is no search bar above it: search is revealed, not resident.
- **The shelf lies down on a desktop and stands up on a phone.** Above 700px it is a horizontal
  tab strip: every board in one row, the one you are on raised, one click to any other. Below it the
  same shelf is a **drawer** that slides in from the left — the edge the burger that opens it sits
  on — with each board as a row: its mark, its name and its count, and nothing else. The desktop
  has the burger too, as the first thing in the board row, and it opens the same drawer over the
  strip: the strip is still the one-click path, the drawer is the whole shelf read top to bottom.
  There is no full-screen Shelf *page* and no preview of a board's contents: a shelf is scanned
  for a name. Hold a folder and let go, or right-click it, for **Rename** and **Delete**; the `+`
  makes a folder, one tap and a name. The capture bar stays: a note written while the drawer is
  open lands in the Inbox unfiled, because the drawer is a layer over a board rather than a place
  you are standing.
- **The open note reaches the shelf too, at every width.** The note covers the header row on a
  phone and the strip on a desktop, so its own bar carries the burger, beside Back, and opens the
  same drawer over the note. Choosing a board there closes the note on the way: back into its card
  if that is the board it came from, fading where it stands if not. Back and Escape close the drawer
  first and the note second. A second way to the shelf from a note would be a second shelf.
- **Each board keeps its place, and the board you are on, chosen again, goes to its top.** Paging
  away and back — by swipe, strip tab or drawer — returns you to where you were on that board, for
  the length of the session (a fresh open still lands on the Inbox at the top; the one boot that
  comes back mid-board is Back out of a link, which has its own record). Search and the Reminders
  list borrow the grid without taking the board's place, and leaving them puts it back. A capture
  never scrolls: the new card lands at the top of a board you may be far down, and its trace is how
  it says where it is. On a desktop, clicking the tab you are on scrolls to the top; on a phone the
  header row stays the one control that opens the drawer, and the drawer's row for the board you
  are on closes the drawer and goes to the top. Already at the top, either press does what it did
  before. The drawer over an open note never sends the board to the top — the note shrinks back into
  its card, and the card is still where it was.
- **Horizontal swipe pages between boards.** This is the primary navigation gesture, and what it
  moves along is the shelf: the strip's selected tab — or, on a phone, the board named in the
  header row — changes as you page.
- Trash is not a separate screen with its own Back tab; it is still a tab in the same tablist and
  pages and swipes like every other board, only pinned outside the scroller rather than sitting in
  a row within it.
- **Inbox** is the landing board and the only one with an end to it: every active note that is in
  **no folder**. Everything captured lands here and *leaves* when it is filed, so the count is a
  debt and it can reach zero — which is the one thing All's count could never do. No card on it
  carries the filed mark, because by definition nothing on it is filed. Every empty board is headed
  with its own name, and the line under it says what the zero means. The Inbox's says **"Nothing
  to sort"**: the words of an absence are wrong for the one state in this app that is an
  achievement. **Unless something is being held outside it** — if the first-open question below was
  answered *Leave them*, a couple of hundred never-filed notes sit out of the pile and nothing else
  on screen mentions them again, so the empty state names how many and where the way back is. An
  Inbox that reads *everything is dealt with* while that is untrue is the one thing it must not
  say. The number is the same one the menu row quotes; it is worked out in one place. **And unless
  nothing was ever written** — an archive with no notes in it at all is the third zero, and the
  only one that has achieved nothing: it says, in one sentence, where a first note lands
  (2026-10-05, owner approved, GD-10; the demo counts only notes in use, UX-A-03). **And unless
  what was written went to Todos or Links on its own** — a list or a bare link captured on the Inbox
  — when it names the board each waits on and offers to go there; the routing is unchanged
  (2026-10-05, owner approved, UX-B-02). The app may only say that once it has heard from the server, because a store that is
  empty while the first sync is still running is a device that does not know yet, not an empty
  archive (`lib/serverAnswered.ts`); until then the board shows the spinner, and it stops showing
  it the moment the answer arrives rather than on every later tick.
- **All** is the safety net, at the far end of the lenses: every active note, newest-edited-first
  (priority desc, then last-edited desc, then created desc) — regardless of
  which board it's filed in, or whether it's filed at all. Nothing is ever "lost" in a folder,
  because All always shows it too. It was called **Recent**; only the name changed — the code's
  `kind` is still `recent`.
- **A bare link lives on Links alone** (`linksOnly` in
  `lib/boards.ts`). A note that is nothing but addresses — no word of the user's own beside them,
  no file — is already where it belongs the moment it is written, as a to-do is, so it neither
  waits in the Inbox's pile nor pads All. It becomes an ordinary note again, on every board, the
  moment the user says anything about it: files it into a folder, marks it as a to-do, flags it,
  or sets a reminder on it. Search still finds a bare link, and Archive and Trash are untouched,
  since those are where the user put it.
- **A note with words beside its address can be moved to Links by hand** (`keptOnLinks` in
  `lib/boards.ts`). The Move chooser — the open note's, the selection's, and Tidy up's — offers
  **Links** beside the Inbox row for any note carrying an address. It writes `note_type: "link"`,
  the way the to-do mark writes `"todo"`, and clears `board_id`: the note leaves the Inbox and any
  folder, stays on Links (even if the address is later deleted) and on All, and stops reading as a
  to-do. Choosing a folder or the Inbox takes it off Links again, so a note is still in one place.
  No migration: `note_type` is plain text.
- **A filed note says where it lives with the folder's own mark in its card's footer**, in the row
  that already carries every other fact about a note — on All, in search and in Archive, the three
  places where standing on the board does not already answer it. It is never drawn dimmed:
  dimming the user's own words to report a fact about filing is the one thing a card face may
  never do.
- **Todos, Links, Files are content-derived, not folders.** A note appears in them by what it *is*,
  not by being filed there, and filing a note into a folder board never removes it from these
  three:
  - **Todos** — notes hand-marked as a to-do (the open note's Todo-toggle, §5) OR notes that are
    structurally a checklist (2+ typed tick-box lines) — unless the user turned the mark off
    (`note_type: 'note'`) or moved the note to Links (`isTodoNote` in `lib/boards.ts`).
    Content-based detection, not AI.
  - **Links** — any note containing a URL *anywhere* in its text (a URL regex over the whole
    body), content-detected, plus notes moved there by hand.
  - **Files** — any note carrying an attachment.
- **User folder boards** are created from the `+` on the shelf — a tab at the end of the strip, a
  row at the foot of the drawer — or from the Move chooser, or from inside the Sorter: type a name
  and it exists immediately. Long-press (touch) or right-click (desktop) a folder offers **Rename**
  and **Delete**. Deleting a
  folder **archives** every note filed in it — never trashes or destroys them — and clears their
  `board_id` back to unfiled; the folder itself is then gone, and the app lands you back on the
  Inbox.
- **A note captured while you are standing in a folder is filed into that folder**, and one
  captured on Todos is marked as a todo. Captured anywhere else — Inbox, All, Archive, Trash, the
  open shelf drawer, or in search — it goes to the Inbox unfiled. This is what makes a folder somewhere you can
  work rather than only somewhere things get put.

### The Sorter

Emptying the Inbox from the board itself costs three gestures and a return trip per note — open,
Move, come back. The **Sorter** is the same filing done at one tap each. It is called **Tidy up**
where a person reads it.

- Entered from **a row in the menu**, on any board with notes on it, saying how many are waiting.
  Absent when the board is empty. Todos offers the Ticker in that same row and the Trash offers
  nothing — a note in there has been decided about already. The menu is where this app reaches a
  mode from (Search and Reminders are there too), and the mode grows out of the menu row that was
  tapped.
- One note at a time, read at reading size in the open note's centred column. Below it the
  destinations, **one tap each**: every folder **in the shelf's own order**, **New folder…**,
  **Archive**, and **Delete** last. **Open**, **Important**, **To-do** and **Remind** stand under the
  note's words. On a phone the places are a grid on the floor with **Leave · Archive · Delete** under
  it and **Back** in the head; on a wide window the places are a column beside the note and **Back**
  and **Leave** stand under the note (layout A, 2026-10-24, the owner's pick). When the folders
  would not fit (ten on a phone; on a wide window as many as half its height holds, at least six) they go behind one **Move to
  a board…** row instead. **Inside a folder's own Tidy up the Inbox is a destination, first in the
  list, and that folder is left out.** On a keyboard the numbers **1–9** pick the place in that
  position and **E** archives, as on the board (A still does; 2026-10-10, owner approved, audit UX-9); Delete alone has no key (2026-10-05, owner approved, review
  FX-B-05). A held key answers once, and after every answer the focus is back on the mode itself,
  so a focused Delete never becomes the bin key (UX-B-06). The folders never move while the mode runs: a folder sits
  where it sits on the shelf, and filing twice into one is the same tap twice (`Sorter.tsx`, above
  `file`).
- **Gestures inside the mode, and only inside it:** swipe **right to leave** the note as it is,
  **left to bin** it. The note **follows the finger**, leans a little, and says **Leave** or
  **Delete** at its edge as it is taken; let go past the line and it is flung away and answered, let
  go short and it settles back and nothing is answered. A mode may respend the gesture budget
  within its own screen; nothing about board paging or card long-press changes anywhere else.
- **Swipe-to-file is refused; swipe-to-decide is built.** With more than two destinations a swipe
  cannot say which one it means, so every destination past leave and bin is a button and a swipe
  may never choose a folder. Leave and bin are **two**, opposite, and hard to mistake for each
  other, and the owner asked for them by name. The bin is the cheap half on purpose: a left swipe
  writes `status: "trashed"`, which is a month in the trash with an undo offer on the way, and a
  right swipe writes nothing.
- **Stepping back is a button, not the other swipe.** Both swipes are spent, and a decision you
  can make by flinging your thumb is one you can make by accident, so **Back** is a button: in the
  head band on a phone, under the note on a wide window. On a keyboard the right arrow leaves and the left arrow goes back; **binning has no key**,
  because there is no undoing the twentieth press of one you were holding.
- **A tap on the note's words edits them in place.** The open note's own tap-to-edit: the field
  takes the paragraph's place on the same line grid, the caret where the finger landed, and typing
  writes `body` as the open note does (never `raw_content`). While it is open the swipe, the arrows,
  the number keys, **E** and **A** are the field's, so typing answers nothing; leaving it (a tap elsewhere,
  or **Escape**, which ends the edit and not the mode) keeps what was typed. A note with a link
  edits its whole text, the address included (2026-10-08, owner approved 2026-10-05, review FX-B-03).
- The **capture bar is hidden** while the Sorter runs — you are dealing with what is already in the
  pile, and the destinations need that band of screen more. It returns the moment it closes. The
  undo mark stands at the top of the note instead, where it covers nothing.
- **Important** marks the note and leaves it showing — the one control here that does not spend
  the decision the screen is asking for. It stands under the note with the note's other controls,
  apart from the places. Leave, the one answer here that is not a place, stands on a phone's floor
  as the first of three, as far from Delete as the row allows. (It was **Keep** until
  2026-10-05, owner approved, review CD-07: Keep is Google Keep's name and nothing else here.)
- **Remind** (the clock) offers the open note's four reminder presets; a pick sets the reminder,
  offers it back on the undo mark, and moves on. The note is not filed — it stays where it was and
  comes round again — and a note binned or archived earlier in the run comes back out first
  (2026-10-05, owner approved, review FX-B-01).
- Filing goes through the ordinary `board_id` write and is **undoable one note at a time**, like any
  other move. Leaving changes nothing and the note comes round next time; there is no
  left-forever state. **Leave on a note already answered undoes that answer**: Back to a note
  archived, binned or moved says so above it, and Leave puts it back where it was; filing a binned
  one takes it out of the trash on the way. The summary and Put back count only what still holds.
  Leaving mid-pile costs nothing — whatever is left stays where it was, and
  there is no session to abandon.
- **The end of the pile is a summary, not a vanishing.** Past the last card the mode stays up and
  reports what the run came to — left, moved, archived, deleted, reminded, important, to-do — and offers the run's
  deletes back **all at once**. The ordinary eight-second strip is the right offer for one delete
  and no offer at all for the third of twenty, which has expired long before the reader reaches
  the end and finds out what they did. It is a report and not a celebration (DESIGN.md §1): seven
  counted lines in the machine face, no total and no praise.

### The Ticker

On the Todos board, ticking a box in the open note costs open, tap, come back. The **Ticker** is
the Sorter's shape said about ticking.

- Entered from **the menu**, on the Todos board: the same row the Sorter is entered from on other
  boards, reading **Tick off N lists**, where N is how many lists have something left in them.
  Absent when the answer is none.
- One list at a time, full width, read at reading size, with **every box a button**. Ticking writes
  through the same `tickItem` the open note uses, so the box changes and the run settles under it
  identically; a done item sinks below what is left, wherever it was ticked.
- **The board itself is deliberately not the answer.** A tick box on a card would be a button inside
  a button — a card is one element and has been since the grid was built — and it would turn a card
  face into a control surface, which is the one thing a card face may never be. A mode may respend
  the gesture budget inside its own screen; a board may not.
- **The pile is the lists with something still open in them.** Todos also holds notes merely *marked*
  as a to-do, which may carry no boxes at all, and a screen of nothing to tick should not have been
  offered.
- **A tick never moves you on.** Filing a note is the whole of what the Sorter asks; a list is
  several decisions and you are here for all of them. Ticking the last box does not advance either —
  the foot says *all done*, which is the receipt, and a screen that vanished would take it away.
- At the foot, what is left and one **Archive**: the end of a finished list, and the only thing that
  takes it off the board. Archiving destroys nothing and the note stays fully searchable.
- Between the two, while anything is ticked, **Untick all** and **Clear done** — the whole list in
  one press. Untick all is the list used again every week (the
  shopping): every `[x]` back to `[ ]`, each box in the spelling it was written in, nothing else
  touched. Clear done is the running list that only grows: the ticked items' lines leave the text,
  and every other line stays character for character. Both are the ordinary `body` write, so they
  sync like a tick, and both are **offered back by the ordinary undo**, reversed in place with the
  mode still up; `raw_content` keeps the original regardless. The open note offers the same two, in
  its strip of verbs under the text.
- **The screen stays on while the mode is up** (the Screen Wake Lock API, `lib/useWakeLock.ts`): a
  list is worked through with the phone in one hand and a minute between ticks, and a screen that
  locks between aisles has to be woken for every one. Asked for again when the page comes back to
  the front — the browser drops it when hidden — released when the mode closes, and silent where
  the browser has no wake lock or refuses one.
- Swipe left and right step through the pile, inside this mode and nowhere else. The capture bar is
  hidden for the duration, for the Sorter's reason.

### The first-open question

An archive that predates the Inbox opens it at 237, which is a bill rather than a landing page. So
**once**, on the first open, the app asks — and **neither answer moves, archives or deletes a single
note**:

- **Tidy up** — the whole pile is the Inbox, and the Sorter opens on it at once.
- **Leave them** — one date is stored. Those notes stay active, stay on All, stay in search and
  stay in whatever folder they are in; the Inbox simply starts from today. **Bring in the old
  notes** in the menu undoes it, so the answer is never permanent — and while it is in force the
  empty Inbox says how many are being held outside it, so the pile is never silently forgotten.

The date lives beside the folder list in the one preferences row (migration `0018`) and syncs by the
same rule: a device that answered pushes its answer, a device that was never asked takes the one
already given. Under 20 never-filed notes nothing is asked at all — a pile you could clear in one
sitting is not a bill. Dismissing the question is **not** an answer; it is asked again next open.

### Coming from Google Keep

The app replaces Keep, so the first thing a new person brings is a Keep archive. **Import from Google
Keep** is a menu row (second, under About — done about once, like reading the colophon) and a quiet
offer under the words of the one empty board with nothing behind it: the Inbox of an archive nothing
has ever been written in. The first note written takes the offer away; there is nothing to dismiss.

It reads a **Google Takeout** — the zip itself (split parts together; ZIP64 too), or the unzipped
`Keep` folder, picked or dropped — **on the device**: nothing is uploaded to be read. What a Keep note
becomes (`web/src/lib/keepImport.ts`, following the Phase 0 `src/keep.ts`, which stays as it is):

- **Its text, written once as `raw_content`**, like every capture, `body` equal to it. A **title is
  the note's name** (a `# ` first line, the app's own way of naming a note), so a titled list keeps its tick-box face and lands on
  Todos. A **checklist** is `[ ]` / `[x]` lines. A **saved link** is its address on a line of its
  own, not repeated if the text already has it. **Keep's own created and edited times** are kept, so
  the board orders the archive the way it was written.
- **Pinned is Important** (`priority: 1`) — the one mark that lifts a note to the top of a board.
- **Archived goes to the Archive; Keep's trash is left behind** and counted.
- **Labels become boards as the person says**, on one screen listing each label once with its count:
  a new board (named after the label), a board they already have (the default when one has that
  name), or the Inbox — **the default for a label on one or two notes**. One switch above the rows
  sends every label to a board of its own or to the Inbox, and the screen says how many new boards
  the choices add up to. A note has one board (§6), so the first of its labels that became a board
  wins and **every label that did not is written on its last line** — `Keep labels: work, ideas` —
  so nothing written in Keep is lost. That line is part of the imported text. (A checklist that
  carries it is no longer all tick boxes, so it reads as a note until the line is taken off.)
- **Photographs, drawings and recordings are real files**, through the path a dropped file takes,
  under the same 50 MB limit. A file over it, missing from the Takeout or damaged is **named in the
  summary**, never dropped in silence.
- **Said plainly on the first screen, and not carried:** Keep's colours (the app has none), its
  reminders (Takeout does not export them), and who a note was shared with.

**Safety.** Nothing is written until the last screen. An import **skips every note already here** —
same Keep id, same creation instant. A match **in the trash** (an Undo put it there) is counted apart
and **brought back under the new label choices**, never made twice (2026-10-05, owner approved,
GAP-03); a note with nothing to bring in is listed up front as "Empty, left behind". Running
import is held for the app's life, so closing the screen part-way and opening it again shows its
progress and then its summary, and refuses a second read (GAP-01). A new-board name that matches a
folder files into it, and one that looks like an automatic board's name gets a one-line warning but
still makes its folder (GAP-04). A different note under a taken id (a second Keep account's `Shopping.json`) comes in as
`Shopping@<created>`, because the server holds `keep_id` unique. Notes are written **fifty at a time**
with a count on screen, so five thousand do not freeze the page, and then sync through the ordinary
outbox. **One undo** covers the whole import — on the summary, and on the undo stack for Ctrl+Z —
and it moves the batch **to the trash**, only notes still holding the status the import gave them,
and takes off the shelf any board the import made that is left empty; that undo is itself undoable.
It destroys nothing. It waits for a signed-in device's first answer from the server before reading
anything, so a new phone cannot import what the laptop already brought in. It does not answer the
first-open question silently: a new archive's Inbox starts at the beginning, and when the import
puts 20 or more unfiled notes in it (`INBOX_ASK_MIN`) the summary offers the question's two answers —
Tidy them up, or start the Inbox today (2026-10-05, owner approved, GAP-02). After "Leave them" the
summary says how many imported notes are older than the Inbox's line and on All instead.

**A spår download comes back in too** (2026-10-10, owner approved, audit DATA-4 / UX-3): **Import a
spår download**, the menu row under the Keep one, reads the zip About's "Download everything" made
and brings back every note under its own id — its words, the original it was first written as, its
marks, its folder, its files and its canvases. A note already here, deleted for good here, or in the
download's own Trash is skipped, so the same download imported twice makes nothing twice. A folder
already on the shelf is never renamed or removed by it; one it lacks is added. A file the download
holds only a preview of keeps its place and is named in the summary. One undo moves the import to
the trash, as the Keep import's does.

**Gesture budget (hard rule).** Horizontal swipe is spent on board paging. It cannot also mean
"file this card" — those two would fight on every drag and feel broken. Therefore:
- Screen horizontal swipe → change board. **Inside the Sorter, and only there, it answers the
  card** — right leaves, left bins — and inside the Ticker it steps through the pile. A mode may
  respend the budget within its own screen, never outside it.
- Card long-press → multi-select mode (needed for merge anyway). Continuing the hold into another
  card merges the two directly, on mouse or touch. **Carried on to a board in the shelf instead, the
  held card — or the whole selection — goes there** (2026-10-23, owner's ask): Move for a place,
  Archive, Delete to the trash, Links only when every note has an address, the lenses refused and
  dimmed while it is carried; the board it would land in is lit. On a phone, reaching the board row
  slides the drawer in to be dropped on. It is a carry onto one named, lit board, not a swipe, so
  it does not reopen swipe-to-file. A hold released without moving still enters
  multi-select. **Selecting puts nothing on screen but the selection**: the cards invert, the
  header counts them, and the burger in the capture bar lights up with the number. The verbs are
  behind that burger — the same panel the menu is, each row a mark and a name — and never a bar
  that appears on its own: a panel that arrived the moment a card was held landed under the hand
  still picking cards out. **Where the panel opens follows the hand.** For a thumb it opens
  bottom-right, above the capture bar, because that is the side the thumb is on. For a mouse, a
  right-click on a card picks it and opens the same panel beside the pointer, because a mouse is
  wherever it clicked and the corner can be a screen's width away; the burger stays the second
  way in. Ordered by distance from the thumb: Move,
  Archive and Delete nearest, under one hairline, because they change where a note is; Select all
  furthest, because a stray tap on it throws away the selection picked by hand.
- **Card swipe → archive is withdrawn; a card swipe means nothing.** A card sits inside the element
  that owns board paging, so the two would compete for one finger, and the line above has already
  spent the horizontal swipe. Archiving is a mark in the open note and an action in multi-select.
  **One exception, by the owner's rule (2026-10-16):** a card's row of pictures that holds more than
  it shows slides sideways under a finger that starts on it, to show the rest. It answers nothing —
  no note moves — and a swipe anywhere else on the card, or on a row that fits, still pages.
- Priority, archive, and filing changes happen in the open note and in multi-select bulk actions.
  **Move** files the selection into a real board — single-home, same rule as filing one note — and
  costs one tap, never a menu dive. **Type** is the one field edited by hand: the open note's
  Todo-toggle sets or clears `note_type: 'todo'`. Tagging does not exist in this app — see §12b for
  why it was removed.

**Back closes what is on top.** The phone's back gesture and the browser's back button dismiss the
open note, or the selection, before they do anything else — one history entry, pushed when a layer
opens and consumed when it closes from inside. Back at the grid is *not* trapped: it leaves the
app, the way every other app on the phone behaves.

## 7. Merge

The feature Keep can't do. Select 2+ notes → Merge:

1. Create a **new** note. `body` = the sources' bodies composed in selection order, separated by a
   `———` rule. No headings are inserted: notes have no headings, and nothing renders markdown, so a
   `## ` would just be two literal hash marks living in the text forever.
2. `merged_from = [source ids]`, `source = 'merge'`, highest priority wins.
3. Sources are **archived**, never deleted, and keep a pointer to the merged note.
   The merged note is shown as an **idea** card: one composed place for the
   related notes, with the source count visible without inventing a heading. It
   lands in the folder every source shares, else the Inbox; to-do lists merged
   stay a to-do, on Todos.

Nothing mutates, nothing is lost, and un-merge is trivially possible. This is why the block model
isn't needed: merge is composition over text, and provenance lives in a column.

**Separate** is offered on a composed idea (the canvas menu, beside Dissolve). Every source still
archived into the idea goes back to active in the board it was on — merge never moved it — and the
idea is **archived**, not trashed or destroyed, because its text may hold words written after the
merge. Dissolve stays as the other answer: it sends the idea to the trash. Separate asks nothing
and is undone in one step.

**New note from selection** is the inverse from the other side: in an open note, the selected words
become a new note in the same folder and leave this note's `body` (never `raw_content`), with only
the whitespace at the cut tidied. One undo puts both halves back — the words into the note, the new
note into the trash — and only together.

**Drawing on an idea** (a sketch is an idea born empty). The canvas has a pen, a highlighter, a
Shapes tool (rectangle, ellipse, line, arrow; a closed one may be filled), Text, pictures, a
whole-stroke eraser and a Select tool — a loop for a finger, a box for a mouse — that moves,
stretches, recolours, copies and deletes what it holds. The pen tidies a rough line, ring or box
held still for half a second, and one Undo gives the rough line back (a Settings switch turns it
off). Undo and Redo are the sitting's own, item by item, never stored. **Show everything** fits
the whole drawing in view and **Save as picture** makes a PNG of it. A shape is stored as a stroke
whose points are its outline (`shape`, `fill`, `highlight` on the stroke, no migration), so a
device that has not updated still draws it. *(2026-10-28, owner asked, after a look at FigJam,
Miro, Excalidraw, tldraw and GoodNotes; their team features — stickies, connectors, frames — were
left out on purpose.)*

## 8. AI assist — tried, removed

Phase 0 and the start of Phase 5 built one LLM call plus a Voyage embedding. The owner cut it: it
made the app depend on a cloud round trip for something that used to be instant and local, and
its tags weren't ones the owner would have picked. **Removed entirely, not deferred:** no Gemini
calls, no embedding calls, nothing in the app reads `title`/`gist`/`summary`/`tags`/`embedding`/
`enriched_at`, no semantic search. `note_type` survives as a plain user-set field (§5, §6).

## 9. Search (keyword)

Postgres FTS (`websearch_to_tsquery` over `body`) server-side; substring match locally. One query,
instant-as-you-type. Each word typed also matches without a plural ending — "tyres" finds "tyre",
"boxes" finds "box" — which, matching by substring, can only widen a search; a one-word search
that finds nothing says to try a shorter form of the word. Words inside double quotes must stand
together, in that order — `"go before reading"` does not find "reading before we go" — while every
word outside the quotes searches as before; a quoted phrase is matched as typed, with no plural
taken off (2026-10-05, owner approved, review FX-A-04). Results render as cards, same as everywhere, starting at the match with the
matched words marked; a result opened opens at its first match, marked the same way, until the
first tap into its text. Archived notes included but
visually muted and ranked lower. There is no semantic half — search finds a note by the words
actually in it, never "by meaning" (§12b).

Local-first caveat: search runs against the local store first — instant, offline — and reconciles
with the server on sync, same as every other read in the app.

**Search always covers every note; a folder can be asked to narrow it.** Opened while
standing on one of the user's folders or on the Archive, the search row carries that board's name
as a one-tap toggle at its left end — off each time search opens, so "everything" stays what
search means. On, the results are what that board draws (`matchesBoard`) and nothing else. The
Archive is included because its notes rank at half weight in an everywhere search, so someone
standing there looking for an old note is exactly the person whose results come back buried. Links
is offered it too (the chip reads "Only here"): "that article about X" is a saved page, and an everywhere
search mixes in every note that merely says X (2026-10-05, owner approved, review FX-A-06). The
Inbox, the other lenses and the Trash are not offered it (`canScopeSearch` in `web/src/lib/boards.ts`).

**A note's PDFs are searched by the words inside them.** Each PDF this device holds
the bytes of is read once, at idle, a few seconds after opening — its text layer, capped at
100,000 characters, 300 pages and a 40 MB file — and what came of it (text, none for a scan,
locked, unreadable, too large) is kept in IndexedDB under the attachment id, so it is never read
twice. It is **device-local and derived**: no column, no migration, nothing synced; the other
device reads its own copy the first time it has the file. A hit inside a document counts toward
"every word must be found" and scores half of the same hit in the note's own words.

**A note's pictures are searched by the words in them too** (2026-10-05, owner approved, review
FX-A-07). A screenshot or photograph this device holds is read the same way, at idle, by a text
reader that runs **on the device** — English and Finnish, nothing sent anywhere, no AI service. A
few dozen pictures are read per session at most, none when the phone asks to save data, and what
came of each is kept like a PDF's. The first read downloads the reader once, about 11 MB. Its words
count exactly as a document's do.

## 10. Reminders

`reminder_at` on the note, one tap from the open note. Delivery needs **server-scheduled Web
Push** — the Notification Triggers API never shipped, so purely local scheduled notifications are
not reliable on the web. That means VAPID keys, a service worker, a `push_subscriptions` table,
and `pg_cron` firing an edge function. Works on installed Android PWAs and desktop browsers.

This is the one feature with real platform risk and real infrastructure cost. It gets its own
phase; do not let it leak into the shell.

**Built (migration `0015`, `supabase/functions/send-reminders`, `web/src/store/push.ts`).** Four
decisions in it are worth keeping:

- **Nothing was added to `notes`.** Delivery is bookkeeping, not content. A column would have had
  to be argued about in `CONFLICT_FIELDS`, would move `updated_at`, and could drag a note to the
  top of a board ordered on the last edit — for a fact the user never created. `reminder_deliveries`
  is a separate table and carries *which instant* it delivered, so moving a reminder fires again
  and an unchanged one never fires twice.
- **Nothing is scheduled at set time.** The sweep finds what is due by reading the note, so setting
  a reminder is still one local write: it works offline, and changing your mind cancels nothing.
- **The sweep carries a token of its own, not the service role key.** A scheduled job's arguments
  are readable by anything that can read the job. This token can do exactly one thing — send
  reminders that were already due.
- **Permission is asked when a reminder is set**, never on first open, because at that moment the
  question answers itself. A refusal costs the reminder nothing except *this* device's part in it,
  and the open note then says "not on this device" instead of promising a sound that isn't coming.

### 10a. A reminder that comes round again

`reminder_repeat` (migration `0020`) is one nullable field beside `reminder_at`: **every day, every
week, every month**, or null for the reminder that rings once — which is every reminder this app
could set until now. Three rules, chosen from that same panel once a time is set. A rule with no
anchor is not a reminder, so it is offered only after a time is, and clearing the time clears the
rule in the same write. Picking a preset closes the panel (2026-10-18, dogfooding); opened again it ticks the row,
spells the time out at the top ("Set for Thu 09:00") and shows the rules and Clear. The presets are In 1 hour,
Tonight, Tomorrow and Next week, in the order they ring; after 20:00 Tonight is "Tomorrow evening",
after Tomorrow.

Two decisions in it are the whole design:

- **`reminder_at` is an anchor and nothing ever advances it.** The occurrence is *projected* on the
  way past — `reminder_occurrence` in migration `0020`, mirrored in `web/src/lib/reminders.ts` — so
  the server still never writes a note. That is the property this phase was built around (§10, the
  first bullet): a write there would move `updated_at` and drag the note to the top of a board
  ordered on the last edit, for a fact the user did not create. `reminder_deliveries` already keys
  on the instant delivered, so each occurrence fires once and no occurrence fires twice, with no
  new bookkeeping at all. The non-repeating case then falls out as a special case of one line: with
  no rule, the occurrence *is* the anchor.
- **What the app shows is the occurrence coming, never the anchor.** A repeating reminder is
  therefore never *overdue* — there is nothing to acknowledge, it comes round again by design — and
  the open note reads "reminds in 3 hours · every day". The anchor may be nine months old; counting
  from it would say "due 9 months ago" about a note that rang this morning.

**A day is 24 hours and a week is 7 of those**, measured on the instant, so in a zone that keeps
summer time a daily reminder lands an hour off its wall-clock time for half the year, until the next
time it is set. A month is calendar arithmetic: the 31st clamps to the 28th in February and is the
31st again in March, because every step is measured from the anchor rather than from the step
before it.

**A reminder that rings once clears itself** (2026-10-14, owner asked). Ten minutes after its
moment — time for the sweep to have rung it — the app writes it away (`spentReminder`), on whichever
device is open first. Only on an active note (nothing archived or trashed ever rang) and only where
something rings: with no server, the "passed" mark is the only reminder there is, so it stays.

### 10b. Answering from the shade

A reminder that rings once arrives with two buttons on it — **Later** (an hour on) and **Done**
(clears it) — so it can be dealt with without opening the app, which is what a reminder on a lock
screen is for. Neither reaches the database: the service worker records which button was pressed
and parks it, and the app turns it into an ordinary field write on its next open, through the same
path a tap inside the app takes. "Later" counts from the press, not from the collection, so a
snooze made at nine and collected at two rings at once rather than being quietly postponed again.

**A repeating reminder is offered neither, and that is a decision.** "Later" would move the anchor
of the series and so shift every future occurrence rather than postpone one ringing of it; "Done"
would mean *stop repeating*, which is a change to what the note is for and not a thing to decide
from a lock screen with one thumb. Snoozing a single occurrence would need a second column and is
deliberately not built.

A Later collected after the reminder has already cleared itself still snoozes it, an hour on from
the press; a Done there has nothing left to do.

## 11. Build phases

Each phase ends with something usable. Do not pull later-phase work earlier.

- **Phase 1 — The Shell.** The 90% path, perfected. Real archive seeded locally, board/grid
  rendering, capture, edit, keyword search, archive. No new features.
  *Exit: you stop opening Google Keep.*
- **Phase 2 — Organizing verbs.** Multi-select, merge, one-tap priority, manual type toggling
  (the open note's Todo-toggle), board filing (Move). *Exit: the two-notes-about-one-thing problem
  is dead.*
- **Phase 3 — Reminders.** Web Push infrastructure, `reminder_at` UI. ✅ done — see §10.
  *Exit: a note wakes you up.*
- **Phase 4 — Reach.** ✅ done. Supabase sync hardening, Android share target, launcher shortcut,
  offline queue. *Exit: capture from anywhere, on any device, online or not.* The **Tauri desktop
  overlay is deferred until after the first public release, not cancelled**: it is a new build
  target, and the launcher shortcut and Ctrl+E cover most of it.
  The **launcher shortcut** is built: the manifest declares one shortcut, *New note*, so a
  long-press on the phone's icon and a right-click on the Windows taskbar open the app with the
  caret in the field. There is one on purpose — a second entry would be a menu to read before
  writing.
- **Phase 5 — AI assist.** ❌ **Cancelled, not deferred.** Enrichment, semantic search, tag
  suggestions, and merge-over-embeddings were tried, then removed. See §8 and §12b.

## 12. What changed from v1, and why

The v1 → v2 table and the long "revised after the first week of real use" table — every was / now
/ why, with the owner's own words — are in `docs/decisions/spec.md`. The rules they produced are
stated in the sections above. Two outcomes worth naming here: the user organizes freely, post-hoc,
in one gesture; and nothing decays, resurfaces or archives itself behind the user's back.

## 12b. The v3 pivot: folders, no tags, no AI

Firm, final product decisions, made after tags and AI enrichment had both been live long enough to
judge (the was / now / why is in `docs/decisions/spec.md`):

- **Boards are real folders** — every note carries a nullable `board_id` and lives in at most one
  board (§6).
- **Tagging is removed entirely.** `#word` in a note's text is plain text, nothing more. The
  selection panel's old Tag row is **Move**, which touches only `board_id`.
- **The AI layer is removed entirely** (§8). Search is keyword-only; `note_type` is a manual field.
- **The open note carries Move and the Todo-toggle** beside Back, priority, archive and delete (§5).

## 12c. Inbox, Shelf, Sorter

What the app opens onto, and how you move between boards. The rules are in §6; the was / now / why
for each — Recent → Inbox, the withdrawn Shelf page, the burger on the open note, keeping each
board's place, the Sorter and its swipes, Tidy up on every board, the end-of-pile summary, dragging
the shelf into order, the withdrawn card swipe, and the first-open question — is in
`docs/decisions/spec.md`. **Swipe-to-file is refused** and will be proposed again: with more than
two destinations a swipe cannot say which one it means, and a guess about where your notes go is
worse than a tap that isn't one.

**Out of scope, deliberately**, and none of it became more likely by building the above: a digest or
anything time-boxed on the landing board; sub-folders, or
a note in two folders at once; and any automatic filing, suggested destination or guessed folder
(filing is hand-done — the app does not guess).

## 12d. A board can be recognised before it is read

A folder the user made may carry **its own mark** — any of Lucide's ~1,850, found by name or by
what the folder is about ("fishing" finds a rod and a hook), with the folder as
the default — and **one of sixteen tints**. Both are chosen from one sheet reached by long-pressing
(or right-clicking) the folder's tab or drawer row → **Look**, and both are written straight
through with no Save: the tap changes the shelf behind the sheet. They ride in the same synced
preferences row the folder list already lives in, so there is no migration and they reach the
other device with the shelf.

- **Sixteen tints, folders only**, and they are the app's one hue. `DESIGN.md` §2b holds the terms:
  a mark sits between 0.24 and `--invert`'s luminance (never brighter, so off-whites are possible)
  and its rule at exactly `--rule`'s, so a coloured board never outshines a selected card and no
  step is added to the ramp.
- **A folder may wear any mark in the set**, so it is recognised before its name is read.
- **The eight automatic boards can be neither** — Inbox, Inspiration, All, Todos, Links, Files,
  Archive and Trash draw what they *are* (Inspiration, the eighth: 2026-10-08, owner approved).
- **A tint touches the mark, never a line or a fill.** The rule under the board row stays plain
  `--rule` whatever board you stand on (its tint was withdrawn 2026-10-23, owner's ask). Nothing
  else — no slab, no word, no card, and never a line of the user's own text.

The was / now / why for each, and for capture's three optional marks, is in
`docs/decisions/spec.md`.

**Still out of scope**: a colour on anything that is not a folder the user made, a ninth tint, and
a tint on a card, a note or any state. Those are new arguments, not extensions of this one.

## 13. Open questions

Whether `delve` vs `reference` is one type or two.

**Answered (2026-10-05, owner approved, review FX-A-01): the site name is a link on Links rows only.**
On the Links board's row the site in the footer opens the page itself, in a new tab, as a sibling
link with a 44px-tall hit area; the rest of the row still opens the note. A grid card keeps its one
job, to open.
