# Decisions behind SPEC.md

Moved verbatim out of `SPEC.md` on 2026-10-01 (review PL-09), so the rulebook can state
each rule once, short and current. This is the record of how the rules came to be: the
dated stories, the was/now/why, the things tried and withdrawn. **It is history, not
instruction** — where it disagrees with `SPEC.md`, the rulebook is right. Headings follow
the section of `SPEC.md` each passage came from, so `#<heading>` finds it.

## Notes+ — Build Spec v2

**v2 supersedes v1.** v1 bet that AI would do all the organizing and the app would forget on your
behalf. That bet is withdrawn — see §12 for exactly what changed and why. Read this file before
designing any feature.

## 2. Principles (non-negotiable)

1. **Capture asks for nothing.** One text field; type, enter, gone. No title input and no tag
   picker, ever. It **offers** three optional marks beside Save once there is something to save —
   priority, to-do, board — and offering is the whole distinction: every one starts off, Save
   works without touching any of them, and typing-then-Enter costs exactly what it always did.
   This was "zero decisions, no board chooser at capture time, ever" until the owner asked for
   the marks by name; see §12's last row for what the old wording got wrong. The bar may also
   **tell** — never ask — in one line on its top edge: that an address being written is already
   saved ("Saved 3 days ago · Open"), and, only when a capture lands where the screen cannot show
   it, where it went ("In Inbox · Go"). Neither blocks Save or Enter, and neither moves the board
   (owner, 2026-09-27).
2. **Organizing is optional, post-hoc, and one gesture.** v1 said organizing was *forbidden*.
   That was an over-generalisation of principle 1. Organizing must never be *required* — but when
   the user wants it, it costs one tap or one swipe, never a menu dive.

4. **Nothing is destroyed by accident.** Archiving destroys nothing and archived notes stay fully
   searchable. Deleting moves a note to the **trash**, where it stays whole and restorable for 30
   days before a sweep removes it for good; trashed notes are excluded from search, because they
   are on their way out. Exactly two paths may ever destroy a note: that sweep, and the user
   emptying the trash by hand, which asks first. *(v2 said "archive, never delete" — see §12.)*

6. **The 90% path is instant.** Open, scan, capture, edit, find. Every one of these is optimistic
   and local: the UI commits in under 50ms and syncs afterwards. Never a spinner on the hot path.
   Since 2026-09-17 the promise is **measured** on the device it is made on: capture, open, typing
   and find are each timed to the frame that shows their answer, and the About page shows the
   median of the session (`lib/speed.ts`). Nothing is stored and nothing is sent.
7. **Everything can leave.** One download holds the whole archive in a shape that needs nothing
   from this app to read: each note a plain text file, the places a note can be (Inbox, your
   folders, Archive, Trash) as folders, a note's files beside it, the original of an edited note
   beside that, and all of it again as one JSON file (`lib/exportArchive.ts`, from the About
   page). spår replaced an app with Takeout, and a notes app you cannot leave is keeping your notes
   on its own terms. *(Added 2026-09-17, from a design review.)*

## 3. Architecture

> **Explicitly rejected: CRDTs.** CRDTs solve concurrent multi-writer merge. This is one person on
> one device at a time. The cost (Automerge/Yjs, custom sync loop, websockets, document-format
> lock-in) buys nothing here, and Supabase was chosen precisely to avoid sync plumbing. Optimistic
> local writes + an outbox gets the same sub-50ms feel for a fraction of the complexity.

> **Explicitly rejected: a block-based data model.** The usual justification is merge, but merge is
> a text-composition problem, not a storage problem (§7). Blocks would cost a full custom editor
> and buy only cross-note drag-reorder. Notes are markdown text.

## 4. Data model

`raw_content` immutability stays enforced by a BEFORE UPDATE trigger. `body` is freely editable.
This *strengthens* the v1 promise: "show original" is now a real diff, not a claim.

## 5. Layout & visual language

> **Colour in this section is superseded by `DESIGN.md`** (direction: DARKROOM — *a dark room
> with one light in it, and the light is what you wrote*). The app now has **no light mode**, and
> no colour anywhere except one thing: nine tones on one warm greyscale, ground `#0c0a08`, and
> emphasis is a step along that ramp or a rule weight. The single exception is a **folder the user
> made**, which may be tinted — `DESIGN.md` §2b and §12d below hold the terms, and the short of it
> is that every tint sits at a brightness the ramp already had, so nothing on screen got louder.
>
> Everything below about **layout, grid geometry, card faces, motion and the reasoning behind
> them still stands** and is unchanged — geometry was never the problem. The typefaces below are
> also still correct; only the monospace changed, from a system stack to a self-hosted one.
> Where the two disagree about a value or what a state looks like, `DESIGN.md` wins.

**Kill the masonry.** Uniform card heights, deterministic grid. Two columns on phone, more on
desktop. Long content truncates with a hard fade — that's the signal to open the note, not a
failure. No exceptions, no list/grid toggle (a hedge that doubles the layout work).

**No gutters.** Cards tile edge to edge and share their rules — no gap between them, no margin to
the window. Each card draws only its right and bottom rule so tiled neighbours never double a line,
and the outermost edges are the screen itself. Every pixel of gutter was a pixel not showing a
note; on a phone they added up to a whole row. The grid reads as one ruled sheet rather than a tray
of floating tiles. *(Revised after real use — see §12.)*

**A note has no heading the app made.** Not a field, not a derived one. A note is text. The card
shows that text from its first character and cuts it when it runs out of room. If the user wants a
title they write one as the first line — **and a first line opened with `# ` is the note's name**,
exactly as it is an idea's. The open note offers a note with no name a one-tap `Name` above its
text that writes that line, and the card sets it in the voice an idea card names an idea in, on
the line it already occupied. *(Revised after real use — see §12, twice.)*

**Three faces, three jobs.** Marcellus names things (the wordmark, the boards). Libre Baskerville
carries every word the user wrote. IBM Plex Mono carries machine data — counts, dates, `+1.4k`,
`[x]`, sync state. A note is only ever set in Baskerville. All three are self-hosted; the 90% path
may not wait on a font CDN. *(Only the machine face changed: it was a system monospace stack, so
the app's most exacting typography rendered differently on every device it ran on.)*

**Six sizes, and no seventh.** `10.5` machine data · `12` board names · `13` a note on a card ·
`16.5` a note open, and every field you type into · `21` the wordmark · `34` the sign-in
mark. Capitals and monospace are tracked; Baskerville lowercase never is. Anything that needs a
size not on this list is a sign the layout is wrong, not the scale. *(This used to also carry
tags at `13`; tagging is gone — see §12b.)*

**The ramp is the whole design.** *(New — see `DESIGN.md` §2.)* Nine tones on one warm greyscale
and nothing else: no colour, no texture, no second family, no ornament. A card has **no fill at
all** — it is the ground, defined entirely by its two rules — so the board is a lattice of
hairlines drawn on black rather than a tray of tiles. The discipline is the identity: the app
cannot compete with its own contents, because the only bright things on any screen are the words.

**The system bars match the app.** An installed PWA takes its status- and gesture-bar colour from
the manifest, and a manifest holds one `theme_color` — it cannot answer to `prefers-color-scheme`.
A dark-mode phone therefore got white bands top and bottom. The app writes `theme-color` from the
resolved `--paper` value at startup and on every scheme change, so there is still exactly one
definition of the background and it lives in the stylesheet.

**Priority is a flag, at the head of the card's footer row.** No stripe, no frame, no tint, no hue:
a coloured accent rail is the most generic move an interface can make, a tinted fill reads as
*disabled*, and a 2px frame was still too much furniture — all three stay rejected. For years it
was nine pixels of ink flush in the card's top-left corner, which was right for a square: inset a
few pixels off it, the square read as an element placed *near* the text and the eye kept trying to
relate it to the first line, so it went into the corner itself and belonged to the card the way the
card's own rules do. A flag cannot do that — it is a glyph, and a glyph in that corner *is* the
thing sitting near the text — so it moved to the footer, the one row a card already keeps its marks
in. *(Revised four times after real use — see §12.)*

**The open note is its text and six marks.** Back, priority, archive, delete, Move, Todo-toggle —
drawn, unlabelled, unframed. No fields, no button that reveals `raw_content`. Move opens the same
board-picker the multi-select panel uses, to file just this note. Todo-toggle sets or clears
`note_type: 'todo'` by hand — the one field a person edits directly now. Everything else the note
needs to say about itself is in the note. *(Revised after real use, then revised again — see §12
and §12b.)* On a phone the bar also carries the shelf's burger, beside Back, which opens the board
drawer over the note (§6). It is not a seventh mark: it says where you are, not what is done to
this note, which is why it sits with Back and not in the corner.

**The cut fades, on the last line and only there.** An overflowing card's text loses its ink across
the final line box rather than stopping at a hard edge. That means the card body must *always* be
full when it is cut, so `cutToLines` deliberately hands CSS one line more than it can draw and lets
the clamp eat it — cut to exactly the budget, the estimate often stopped on line seven of eight and
the fade landed somewhere in the middle of the card. The remainder is still counted at the honest
cut, not the overfilled one. The mask is alpha only, so it survives the card inverting. Checklists
never fade — an item is a whole thing, and half a tick box reads as broken.

**How much more, in three steps.** Under the cut sits one, two or three stacked rules — a level,
filling upward — not a character count. `+1.4k` was exact and unreadable: nobody converts 1,400
characters into an amount of reading, and the question was never "how many characters", it was "a
bit more, or a lot". Thresholds are in `cutDepth` and come from the archive's real shape.

**A stamp says how long ago, not what day.** For the first week a note's footer counts: minutes,
then hours, then days to six. "5 AUG" is a date the reader has to subtract today from before it
tells them anything; "2 DAYS" is the answer they wanted. On the seventh day counting stops being
easier than reading and the calendar takes over. Every form fits the six characters the calendar
form already used, so nothing in the footer moves. The open note spells it out — "3 hours ago" —
and prints the exact day beside it, with the month named rather than numbered so that 10/8 can
never be read as the eighth of October.

**Nothing in this app is coloured except a folder the user made.** *(Revised twice — see
`DESIGN.md`. It used to read "nothing is blue except a link"; there is no longer a link colour
either. Then it read "nothing at all", until boards got their eight tints — §12d.)* Android paints a
translucent blue over anything tapped and over selected text; both are turned off, and every
control supplies its own pressed state by inverting — the same mark the app already uses for "on"
and "selected".

**A container changes its clip, never its scale.** A note opening is laid out full size from the
first frame; what animates is the clip, from the tapped card's measured rect out to the edges of
the screen. Nothing inside is ever scaled, so the type is set once, at reading size, for the whole
move. Scaling the sheet was the "stretchy" feel the user rejected by name — it squashed every
letter for 200ms and then let go. The one exception is a card *leaving* the grid, which scales
uniformly because the whole object is going, not changing shape.

**Boards are a shelf, and paging moves along it.** The deck of cards follows the finger while you
drag (damped, and barely giving at the ends of the shelf, which is how a physical thing says
"nothing past this"), carries on out the side it was pushed, and the next board arrives from the
other side and settles. Direction of travel is the whole message. Boards used to swap between two
frames, which said a change had happened and nothing about which way you had gone. **A board
arrives where you left it** — each keeps its own scroll position for as long as the app is open,
and the slide-in carries it already at that offset rather than landing at the top and jumping. The
tab you are already on takes you to its top: the deck starts where the view was (a screen short of
the top, from further down) and settles onto the top on the arrival curve, which is a scroll said in
the motion language and never longer than a screen; under reduced motion it is the jump alone.

**A mark that is drawn but not read is not drawn.** The mark reaches full size, then *holds still*,
alone in the empty slot, and the grid does not begin to close until it has. Playing the two together
meant the movement covered the very thing it was announcing: the note went, and you could not have
said where. The hold is why `VANISH_MS` is 460 and not 300.

**Typing help, and only three rules.** `- ` at the head of a line becomes an en dash; `[] ` becomes
a tick box; a number needs no substitution because `1. ` is already what it should be. Enter
continues any of the three, counting the number up as it goes, and Enter on an empty item ends the
list. Nothing fires unless the caret is sitting exactly on the trigger, so pasting and re-editing
never rewrite text under the user — which is also why inserting into the middle of a numbered list
does **not** renumber the items below it. Those lines are text the user is not typing on, and this
app does not reach for them. The one exception is asked for: the capture bar's To-do mark, pressed
on a note of two or more lines, saves each line as a tick box (2026-10-01, owner approved, review
UX-05).

**No hue inside a note, and the one emphasis is a link.** *(Revised — see `DESIGN.md` §3 and
§2b.)* The app has no colour anywhere except a folder's own mark on the shelf (§12d), and never
in or on a note. The signal is the brightest tone on a nine-step warm greyscale, and it appears
in exactly one place: a live address inside an open note, which is the only thing in a note that
is not text. It is brighter *and* warmer than the words around it and underlined — two tonal
signals, because either alone is too quiet. Everything else meaning "on", "selected", or "marked"
inverts or raises. Note type is a mono label, not a colour, because four hues across a 241-card
grid reads as confetti — and that is still true of anything drawn on a card. The board tints are
the opposite case and are why they were allowed: eight hues across a *shelf* of eight names is
eight things told apart at a glance, on a row that exists to be scanned rather than read.

**Anchored bottom capture bar, and it grows.** Replaces the floating action button entirely — no
permanent dead zone over content, and better one-handed reach on Android. It is a textarea, not an
input: Enter is Save and must stay Save, so **Shift+Enter** breaks the line, and the bar grows with
what is in it up to `--capture-max` and then scrolls. A single-row input silently refused to hold
anything longer than one line, which is a strange thing for the app's only capture surface to do.

**2026-10-08 — the wall (§5, owner approved).** *Was:* "Kill the masonry … No exceptions." *Now:*
no exceptions but one: the Inspiration board, §6. *Why:* the objection to masonry was the reading
path Keep's broke on text notes; a board of pictures has no such path to protect, and a picture's
shape is the information. It is one board, not a list/grid toggle and not a per-folder setting, so
the hedge that "doubles the layout work" stays refused.

## 6. Navigation — boards

**Boards are real folders, not saved filters** — this reverses the original model; see §12b for
why. Every note carries a nullable `board_id`. A note lives in **at most one board at a time**,
like a file in a folder on a desktop: filing a note into a board removes it from wherever it was
before, including another folder.

- The shelf has a **fixed shape**, and it divides on **what a board does, never on who made it**:
  **Inbox, the user's folder boards (in shelf order), Archive** — one run of *places* — then one
  hairline rule and a narrow band of empty space, then **Todos, Links, Files (in the order the user put them), All** — one run of
  *lenses*. A place is somewhere a
  note **is**, and it is in exactly one of them; moving it into one moves it out of another. A lens
  holds nothing of its own: a note appears in it by what it *is*, filing never puts a note in one
  or takes it out, and their counts therefore sum to more than the archive holds and can never be
  reconciled by arithmetic. The divider says exactly that — **past this point nothing is a
  destination** — and there is still only one of it.
  The strip used to run the app's own boards and then the user's, with the hairline where the
  user's began. That division was true and useless: nobody navigating a notes app is asking which
  of these rows they made. It also put the four rows you can never file into between the Inbox and
  every destination you own — your first folder was the seventh stop on the shelf and six swipes
  away on a phone. Now the boards you actually file into stand next to the board everything lands
  on. **Archive** closes the places rather than opening the lenses: it is the far end of a note's
  life, not a way of looking at one. **All** sits last, as the widest lens there is. **Trash**
  stands outside the scrolling strip entirely, beside search, as a mark and a count with no name:
  it is a place, but it is the one destination that may never scroll out of reach.
  Nothing is persisted by board index, so the order is free to change; the Inbox is the one
  position that is pinned, because the menu's *Bring in the old notes* row and the landing after a
  folder is deleted both mean board 0 when they say it.
- **The shelf is put in order by hand: hold a board and carry it** (asked for 2026-09-29). Your
  folders move among your folders, and Todos, Links and Files among themselves — **never across the
  hairline**, which would make the one line on the shelf say something false. The Inbox, Archive,
  All and Trash hold their seats: the Inbox is board 0, Archive closes the places, All is the
  answer only when nothing narrower is, and Trash is not in the strip. Letting go of a held board
  *where it was* opens its menu, as before; carrying it is the move; a quick swipe is still a
  scroll, and a tap still a tap. The menu keeps its **Move left/right** (up/down in the drawer)
  rows as the way that needs no pointer, and a lens gets a menu of those two rows alone. The order
  syncs with the folders, in the same preferences row; see §12c.
- **On a phone the header row says which board you are on, and opens the shelf.** One control — the
  burger, the board's own mark, its name and its count — in the slot the tab strip fills on a
  desktop, at the same height, so search still opens into that slot without anything on screen
  moving. There is no search bar above it: search is revealed, not resident (see §12;
  three designs were tried for those forty pixels).
- **The shelf lies down on a desktop and stands up on a phone.** Above 700px it is a horizontal
  tab strip: every board in one row, the one you are on raised, one click to any other. Below it the
  same shelf is a **drawer** that slides in from the left — the edge the burger that opens it sits
  on — with each board as a row: its mark, its name and its count, and nothing else. The desktop
  has the burger too, as the first thing in the board row, and it opens the same drawer over the
  strip: the strip is still the one-click path, the drawer is the whole shelf read top to bottom
  when the row has more folders than it shows (asked for 2026-09-16). (A full-screen
  Shelf *page* with a two-line preview of each board's contents replaced both for a few days and was
  withdrawn: the preview turned a shelf you could take in at a glance into a wall of half-sentences,
  and the page was a detour on a window wide enough for the strip.) Hold a folder and let go, or
  right-click it, for **Rename** and **Delete**; the `+` makes a folder, one tap and a name. The capture bar
  stays: a note written while the drawer is open lands in the Inbox unfiled, because the drawer is a
  layer over a board rather than a place you are standing.
- **The open note reaches the shelf too, at every width.** The note covers the header row on a
  phone and the strip on a desktop, so its own bar carries the burger, beside Back, and opens the
  same drawer over the note. Choosing a board there closes the note on the way: back into its card
  if that is the board it came from, fading where it stands if not. Back and Escape close the drawer
  first and the note second. The desktop was left for its own answer for a while, and the answer is
  the phone's: the drawer has stood beside the strip since 2026-09-16, so the note's burger opens
  the same one, with the same seams, and a second way to the shelf from a note would be a second
  shelf.

- **Inbox** is the landing board and the only one with an end to it: every active note that is in
  **no folder**. Everything captured lands here and *leaves* when it is filed, so the count is a
  debt and it can reach zero — which is the one thing All's count could never do. No card on it
  carries the filed mark, because by definition nothing on it is filed. Every empty board is headed
  with its own name, and the line under it says what the zero means (2026-10-01, owner approved,
  review UI-28). The Inbox's says **"Nothing to sort"**: the words of an absence are wrong for the
  one state in this app that is an achievement. **Unless something is being held outside it** — if the first-open question below was
  answered *Leave them*, a couple of hundred never-filed notes sit out of the pile and nothing else
  on screen mentions them again, so the empty state names how many and where the way back is. An
  Inbox that reads *everything is dealt with* while that is untrue is the one thing it must not
  say. The number is the same one the menu row quotes; it is worked out in one place. **And unless
  nothing was ever written** — an archive with no notes in it at all is the third zero, and the
  only one that has achieved nothing: it says **"Nothing written yet"** and names where a first
  note lands. The app may only say that once it has heard from the server, because a store that is
  empty while the first sync is still running is a device that does not know yet, not an empty
  archive (`lib/serverAnswered.ts`); until then the board shows the spinner, and it stops showing
  it the moment the answer arrives rather than on every later tick.
- **All** is the safety net, at the far end of the lenses: every active note, newest-edited-first
  (priority desc, then last-edited desc, then created desc) — regardless of
  which board it's filed in, or whether it's filed at all. Nothing is ever "lost" in a folder,
  because All always shows it too. It was called **Recent**, and the name was the reported fault:
  "Recent" and "Inbox" both mean *newly arrived*, so two neighbouring rows made the same promise
  and only one of them could keep it. "All" collides with nothing and is the only one-word answer
  to what the board holds. Only the name changed — the code's `kind` is still `recent`.
- **A bare link lives on Links alone** (the owner's rule, 2026-09-16; `linksOnly` in
  `lib/boards.ts`). A note that is nothing but addresses — no word of the user's own beside them,
  no file — is already where it belongs the moment it is written, as a to-do is, so it neither
  waits in the Inbox's pile nor pads All. It becomes an ordinary note again, on every board, the
  moment the user says anything about it: files it into a folder, marks it as a to-do, flags it,
  or sets a reminder on it. The last two were added on 2026-09-22 — without them, flagging a bare
  link quietly took it *out* of the Inbox, the opposite of what a flag asks for. Search still
  finds a bare link, and Archive and Trash are untouched, since those are where the user put it.
- **A note with words beside its address can be moved to Links by hand** (the owner's ask,
  2026-09-27; `keptOnLinks` in `lib/boards.ts`). Such a note is an ordinary note to the rule above,
  so it sat in the Inbox with no folder it belonged in. The Move chooser — the open note's, the
  selection's, and Tidy up's — offers **Links** beside the Inbox row for any note carrying an
  address. It writes `note_type: "link"`, the way the to-do mark writes `"todo"`, and clears
  `board_id`: the note leaves the Inbox and any folder, stays on Links (even if the address is
  later deleted) and on All, and stops reading as a to-do. Choosing a folder or the Inbox takes it
  off Links again, so a note is still in one place. No migration: `note_type` is plain text.
  A filed note says where it lives with **the folder's own mark
  in its card's footer**, in the row that already carries every other fact about a note — here, in
  search and in Archive, the three places where standing on the board does not already answer it.
  It was **drawn dimmed** for a while and is not any more: dashing a card's rules and dropping the
  whole body to muted was the app dimming the user's own words in order to report a fact about
  filing, which is the one thing a card face may never do. It
  replaces the old "Unsorted" board (all notes minus tagged), which is retired now that tagging is
  gone (§12b).

  - **Todos** — notes hand-marked as a to-do (the open note's Todo-toggle, §5) OR notes that are
    structurally a checklist (2+ typed tick-box lines). The second half is unchanged: content-based
    detection, not AI.
  - **Links** — any note containing a URL *anywhere* in its text (a URL regex over the whole
    body), content-detected. This widens the old behaviour, which only matched a note whose
    overall "face" was a saved link.
  - **Files** — any note carrying an attachment. Unchanged, already content-based.

**2026-10-08 — Inspiration (§6, owner approved).** *Was:* the shelf was places, one hairline, then
lenses, and the line said "past this point nothing is a destination". *Now:* Inbox, the user's
folders, Archive — places — then the line, then **Inspiration, Todos, Links, Files, All**, the
app's own boards; the line says "the app's own boards begin here" and the old sentence is true of
four of the five. *Why:* a place to put pictures that shows them, kept to the single-home rule by
making it a place rather than a lens (a note is filed into it by hand and leaves wherever it was).
It holds its seat, cannot be renamed, deleted or dressed, and the owner's existing `insp` folder
becomes it with no note touched. Things get in by filing, by writing while standing on it, and by
a one-tap offer on a share from the phone. X and Instagram are out of scope for now: reaching their pictures would take an outside service seeing
the link, which this app does not use.

## The Sorter

Emptying the Inbox from the board itself costs three gestures and a return trip per note — open,
Move, come back — which is a fair part of why most notes were never filed at all. The **Sorter** is
the same filing done at one tap each. It is called **Tidy up** where a person reads it.

- Entered from **a row in the menu**, on any board with notes on it, saying how many are waiting.
  Absent when the board is empty. It was the Inbox's alone until 2026-09-24; tidying a folder you
  have already filed into is the same job said about a different pile, and there was no way to do
  it without emptying the folder back out first. Todos offers the Ticker in that same row and the
  Trash offers nothing — a note in there has been decided about already.
- **It was a line across the top of the board until 2026-09-25**, and the owner moved it into the
  menu. Nothing about the line was wrong except where it stood: forty pixels of chrome between the
  reader and their own notes, on every board that had a pile, for an offer taken perhaps once in a
  sitting. The menu is where this app reaches a mode from — Search and Reminders were already
  there — so it is one rule rather than two. Two things went with the line and are not missed: the
  trick that kept its box while a search emptied it so the grid did not jump, and the rect it grew
  out of, which now comes from the menu row that was tapped.
- One note at a time, read at reading size in the open note's centred column. Below it the
  destinations, wrapped in rows under the thumb and **one tap each**: every folder **in the shelf's
  own order**, **New folder…**, **Archive**, and **Delete** last; **Keep** and **Important** are in
  the head, beside the count of where you are in the pile, along with **Back**. When the folders
  would take more than two rows (four on a phone, six on a wide window) they go behind one **Move to
  a board…** row instead. *(2026-10-01, owner approved, review PL-02 — this had been "every folder
  behind a Move row" since 2026-09-26, which cost every filed note a second tap.)* **Inside a
  folder's own Tidy up the Inbox is a destination, first in the list, and that folder is left out**
  (review UX-19). On a keyboard the numbers **1–9** pick the place in that position, Archive and
  Delete excepted. The
  folders never move while the mode runs. They were most-recently-used first, and moving the
  chosen folder to the head under a finger still on the glass sent the next tap into a different
  folder — so a folder sits where it sits on the shelf, and filing twice into one is the same tap
  twice (`Sorter.tsx`, above `file`).
- **Gestures inside the mode, and only inside it:** swipe **right to keep** the note as it is,
  **left to bin** it. The note **follows the finger**, leans a little, and says **Keep** or
  **Delete** at its edge as it is taken; let go past the line and it is flung away and answered, let
  go short and it settles back and nothing is answered (review 2026-10-01, UX-08). A mode may
  respend the gesture budget within its own screen; nothing about board paging or card long-press
  changes anywhere else.
- **Swipe-to-file is still deliberately not built, and swipe-to-decide now is.** The rule used to
  refuse both, and the reason it gave — *with more than two destinations a swipe cannot say which
  one it means* — is narrower than the rule it was carrying. Keep and bin are **two**, they are
  opposite, and a hand that means one can hardly produce the other; the owner asked for them by
  name (2026-09-24). Every destination past those two is still a button, and a swipe may never
  choose a folder. The bin is the cheap half on purpose: a left swipe writes `status: "trashed"`,
  which is a month in the trash with an undo offer on the way, and a right swipe writes nothing.

- The **capture bar is hidden** while the Sorter runs — you are dealing with what is already in the
  pile, and the destinations need that band of screen more. It returns the moment it closes. The
  undo mark stands at the top of the note instead, where it covers nothing (2026-10-01, review
  UX-01).
- **Important** marks the note and leaves it showing — the one control here that does not spend
  the decision the screen is asking for. It is in the head band for that reason and for one more:
  at the foot every row is a **place**, and a row that is not one is how a thumb aiming for it
  lands in the bin instead (the 2026-09-04 audit, F13, which is why Keep is up there too).
- Filing goes through the ordinary `board_id` write and is **undoable one note at a time**, like any
  other move. Keeping changes nothing and the note comes round next time; there is no
  kept-forever state. **Keep on a note already answered undoes that answer**: Back to a note
  archived, binned or moved says so above it, and Keep puts it back where it was; filing a binned
  one takes it out of the trash on the way. The summary and Put back count only what still holds.
  *(2026-10-01, owner approved, review UX-03.)* Leaving mid-pile costs nothing — whatever is left stays where it was, and
  there is no session to abandon.

## The Ticker

Ticking a box was granted to the open note and only there (§12: *a checklist you can read but not
tick is a screenshot of a checklist*). On the Todos board it still cost open, tap, come back — three
gestures and a return trip for a decision that took none, which is the same arithmetic that left most
notes unfiled and got the Sorter built. The **Ticker** is the Sorter's shape said about ticking.

- Entered from **a line at the top of the Todos board** — the same line, the same class and the same
  rules as the Sorter's, saying how many lists have something left in them. Absent when the answer
  is none.

- Between the two, while anything is ticked, **Untick all** and **Clear done** — the whole list in
  one press, where it used to be one tap a box. Untick all is the list used again every week (the
  shopping): every `[x]` back to `[ ]`, each box in the spelling it was written in, nothing else
  touched. Clear done is the running list that only grows: the ticked items' lines leave the text,
  and every other line stays character for character. Both are the ordinary `body` write, so they
  sync like a tick, and both are **offered back by the ordinary undo**, reversed in place with the
  mode still up; `raw_content` keeps the original regardless. The open note offers the same two, in
  its strip of verbs under the text.

## Coming from Google Keep

- **Labels become boards as the person says**, on one screen listing each label once with its count:
  a new board (named after the label), a board they already have (the default when one has that
  name), or the Inbox — **the default for a label on one or two notes**. One switch above the rows
  sends every label to a board of its own or to the Inbox, and the screen says how many new boards
  the choices add up to (2026-10-01, owner approved, review UX-21). A note has one board (§6), so the first of its labels that became a board
  wins and **every label that did not is written on its last line** — `Keep labels: work, ideas` —
  so nothing written in Keep is lost. That line is part of the imported text. (A checklist that
  carries it is no longer all tick boxes, so it reads as a note until the line is taken off.)

- Card long-press → multi-select mode (needed for merge anyway). Continuing the hold into another
  card merges the two directly, on mouse or touch. A hold released without moving still enters
  multi-select. **Selecting puts nothing on screen but the selection**: the cards invert, the
  header counts them, and the burger in the capture bar lights up with the number. The verbs are
  behind that burger — the same panel the menu is, each row a mark and a name — and never a bar
  that appears on its own: a panel that arrived the moment a card was held landed under the hand
  still picking cards out. **Where the panel opens follows the hand.** For a thumb it opens
  bottom-right, above the capture bar, because that is the side the thumb is on. For a mouse, a
  right-click on a card picks it and opens the same panel beside the pointer, because a mouse is
  wherever it clicked and the corner can be a screen's width away; the burger stays the second
  way in (2026-10-01, owner approved, review UX-11). Ordered by distance from the thumb: Move,
  Archive and Delete nearest, under one hairline, because they change where a note is; Select all
  furthest, because a stray tap on it throws away the selection picked by hand.
- **Card swipe → archive is withdrawn.** It stood here as a hard rule for months and was never
  built — no commit in the history ever added it. What kept it unbuilt is the same thing that
  should keep it that way: a card sits inside the element that owns board paging, so the two
  would compete for one finger, and the line above has already spent the horizontal swipe.
  Archiving is a mark in the open note and an action in multi-select. Recorded rather than
  deleted, because a rule that describes nothing makes every true rule beside it less
  trustworthy.

## 7. Merge

- **Where a merge lands** (2026-10-13, owner approved, review UX-07). The idea used to land in the
  Inbox whatever its sources were, with no type: two shopping lists merged to tick one left Todos
  and their folder, and came back as one more thing in the pile. It now lands in the folder every
  source shares (still the Inbox when they disagree), and a merge of to-do lists is a to-do.

## 8. AI assist — tried, removed

Phase 0 and the start of Phase 5 built one LLM call (`{title, gist, summary, note_type, tags}`)
plus a separate Voyage embedding, meant to seed search, tag suggestions and type detection. It
reached only a handful of real notes before the owner cut it, for two reasons: it made the app depend on a
cloud round trip for something that used to be instant and local, and the tags it suggested
weren't tags the owner would have picked — an unpredictable middleman sitting on a field the app
now treats as either automatic-from-content or fully manual, nothing in between. **Removed
entirely, not deferred:** no Gemini calls, no embedding calls, no `title`/`gist`/`summary`/
`tags`/`embedding`/`enriched_at` columns, no semantic search. `note_type` survives as a plain
user-set field (§5, §6). See §12b for the full pivot this was part of.

## 9. Search (keyword)

Postgres FTS (`websearch_to_tsquery` over `body`) server-side; substring match locally. One query,
instant-as-you-type. Each word typed also matches without a plural ending — "tyres" finds "tyre",
"boxes" finds "box" — which, matching by substring, can only widen a search; a one-word search
that finds nothing says to try a shorter form of the word (2026-10-01, owner approved, review
UX-27). Results render as cards, same as everywhere, starting at the match with the
matched words marked; a result opened opens at its first match, marked the same way, until the
first tap into its text. Archived notes included but
visually muted and ranked lower. There is no semantic half — search finds a note by the words
actually in it, never "by meaning" (§12b).

**Search always covers every note; a folder can be asked to narrow it** (2026-09-27). Opened while
standing on one of the user's folders or on the Archive, the search row carries that board's name
as a one-tap toggle at its left end — off each time search opens, so "everything" stays what
search means. On, the results are what that board draws (`matchesBoard`) and nothing else. The
Archive is included because its notes rank at half weight in an everywhere search, so someone
standing there looking for an old note is exactly the person whose results come back buried; the
Inbox, the lenses and the Trash are not offered it (`canScopeSearch` in `web/src/lib/boards.ts`).

**A note's PDFs are searched by the words inside them** (2026-09-27). Each PDF this device holds
the bytes of is read once, at idle, a few seconds after opening — its text layer, capped at
100,000 characters, 300 pages and a 40 MB file — and what came of it (text, none for a scan,
locked, unreadable, too large) is kept in IndexedDB under the attachment id, so it is never read
twice. It is **device-local and derived**: no column, no migration, nothing synced; the other
device reads its own copy the first time it has the file. A hit inside a document counts toward
"every word must be found" and scores half of the same hit in the note's own words.

## 10a. A reminder that comes round again

`reminder_repeat` (migration `0020`) is one nullable field beside `reminder_at`: **every day, every
week, every month**, or null for the reminder that rings once — which is every reminder this app
could set until now. Three rules, chosen from that same panel once a time is set. A rule with no
anchor is not a reminder, so it is offered only after a time is, and clearing the time clears the
rule in the same write. Picking the time leaves the panel open, ticks the row, spells the time out
at the top ("Set for Thu 09:00") and shows the rules there and then. The presets are In 1 hour,
Tonight, Tomorrow and Next week, in the order they ring; after 20:00 Tonight is "Tomorrow evening",
after Tomorrow. *(2026-10-01, owner approved, review UX-15 and UX-22.)*

## 11. Build phases

- **Phase 4 — Reach.** ✅ done. Supabase sync hardening, Android share target, launcher shortcut,
  offline queue. *Exit: capture from anywhere, on any device, online or not.* The **Tauri desktop
  overlay is deferred until after the first public release, not cancelled** (2026-10-01, owner
  approved, review PL-08): it is a new build target, and the launcher shortcut and Ctrl+E cover
  most of it.
  The **launcher shortcut** is the cheapest half of that exit and is built: the manifest declares
  one shortcut, *New note*, so a long-press on the phone's icon and a right-click on the Windows
  taskbar both open the app with the caret in the field. There is one of them on purpose — the
  app already lands on the Inbox with the bar under the thumb, so a shortcut can only remove the
  moment of looking for where to write, and a second entry would be a menu to read before writing.

## 12. What changed from v1, and why

| v1 | v2 | Why |
|---|---|---|
| AI does all organizing; user never files or tags | User organizes freely, post-hoc, one gesture | v1 conflated "no decisions at capture" with "no organizing ever". Only the first is a real principle. |
| `raw_content` immutable, no editing at all | `raw_content` immutable + editable `body` | Keep-parity requires editing. The trigger literally blocked it. Splitting the column keeps the promise honest. |
| Warmth decays, notes silently auto-archive | **Cut** | Once the user owns boards and priority, an app that silently archives their notes behind their back is hostile, not helpful. |
| "Resurfacing is the soul" | Demoted to Phase 5, optional | It was the soul of a memory app. This is a notes app with a good interface. |
| Curated "Now" feed as home | One board scroll, default "All" | The user wants Keep's continuous scroll, filtered — not a curated digest. |
| AI enrichment is the product | AI is an assist layer | It earns its place via search, tag suggestions, and type detection. Nothing depends on it. |

### Revised again after the first week of real use

| Was | Now | Why |
|---|---|---|
| Cards show a title (AI's, or the first line promoted) above the body | No heading anywhere — the card is the note's text from character one | The owner's verdict after using it daily: *"I don't want a separate heading and the main note in a note. I don't see why notes need a heading."* A promoted first line is a heading wearing a disguise. |
| *(2026-09-14)* No heading anywhere; a `# ` first line is only a bold line on the card | A `# ` first line is the note's **name**, as it already was an idea's: a one-tap `Name` above an unnamed open note writes it, and the card sets it in the idea name's voice on the line it already had | The owner asked for *"a way to name/give header to a note just like the ideaboards have."* The earlier verdict refused a heading **the app** made or split off; this one is still the user's own first line, written on request, so nothing is promoted or derived. Not a field, no schema change, no second content model. |
| Merge composes `## Heading` sections joined by `---` | Sources joined by a `———` rule, words untouched | Nothing renders markdown, so those hash marks were literal characters sitting in the text forever. |
| Long text renders `title + gist + fade` | Long text renders its own words, cut | Follows from the above, and nearly every note has no gist to render anyway. |
| System sans throughout, mono chrome | Marcellus / Libre Baskerville / IBM Plex Mono, three jobs | The owner picked the pair. Self-hosted, because the 90% path may not wait on a CDN — including the machine face, which was a system stack and so rendered the app's most exacting typography differently on every OS. |
| URLs are inert text inside a textarea | Every URL is a live link; notes are read first, edited on touch | A quarter of the archive is saved links. A link you can't tap is a link you retype. |
| Priority draws a coloured rail down the card's left edge | A flag at the head of the card's footer row, no hue | The owner's verdict: *"never use this AI looking highlight, i hate it."* An accent rail is the most generic move available; a tinted fill read as *disabled*; the frame that replaced it was still too much furniture. The square that replaced all three then became a flag, which says "marked" by itself where a square only says it to somebody already told — and a glyph cannot sit in the corner a square could, so it moved to the row a card already keeps its marks in. |
| Cards label their type: NOTE / TODO / RECIPE | No label on the card; type lives on the open note | *"They take up valuable visual space (cognitive load) and do not help scan notes."* Correct — the text says what the note is. |
| Card text budget is a constant per breakpoint | Measured from a rendered card at runtime | Desktop columns range 246–323px. One number cannot serve both ends, and the wrong one either clips text or wastes a line. |
| "Archive, never delete" — no delete flow at all | Delete moves to a trash that empties after 30 days | Too absolute. A note captured by mistake is noise the archive carries forever. The invariant that actually mattered was *never destroy something by accident*, and a month-long holding pen keeps it. |
| Search is a permanent bar under the top bar | Search lives in the menu, revealed when asked for | *"I very seldom use the search function and now it takes up a lot of space."* A row of screen every day for something used weekly. |
| Panels open bottom-left | Panels open bottom-right | That is the side the thumb is on. |
| The capture bar's right slot is a permanently disabled Save | Save with text in the field, Menu without | There is nothing to save when the field is empty, and that corner is the best real estate on the screen. |
| Sync state flips the instant the sync finishes | The working mark is held for one full turn of its animation | A sync takes under a second, so the mark flickered — you registered a twitch, not a sync. |
| Cards float in a gutter, with a margin to the window | No gutters; cards tile edge to edge and share rules | The gutters cost a whole row of notes on a phone and bought nothing. |
| Multi-select replaces the top bar | A panel anchored bottom-left, actions stacked | The actions were appearing a whole screen away from the finger that opened them. |
| Sync state is the word "SYNCED" / "SYNCING" | A drawn mark: two nodes that part, stream, and close | Words for problems, a mark for the calm states. |
| The open note carries a type picker and a tag editor | Neither. The note is its text and four actions | *"I'm not using them and they take up unnecessary space."* Type is still derived from the text, which is how nearly every note was always classified anyway. |
| An "Original" button reveals `raw_content` once it diverges | No such control | *"I don't see how or why I'd use it."* The column is still immutable and still there; it just isn't something the interface offers. |
| Back / Priority / Archive / Delete are bordered text buttons | Unlabelled marks, no frame | Four bordered rectangles across the top of every note, to read words you learn once. |
| The primary action in a panel inverts to paper-on-ink | Position is the only emphasis | Inside the then-inverted panel it was a second, louder contrast step: *"it sticks out too much, too much contrast."* Nearest the thumb already says which one is the default. |
| The panels are inverted slabs — bone, with the rows in dark type | Drawn on the ground with an edge, rows in ink | *"that bright 'white' — it's hard to see the options."* A bone block in the corner of a black screen is the brightest thing in sight, and the eye adapts to it, so the dark rows go flat. A panel is furniture and takes the furniture's grammar (DESIGN.md §5). |
| Panel rows are 33px | 44px | Thumb-sized. The type stays at the machine size; the row is what you aim at, not the glyph. |
| Overflowing card text stops at a hard edge | It fades out over its last line | *That* the note continues, read without reading; the rule and the `+1.4k` still say *how much*. |
| Android paints its own blue over anything tapped | Every control supplies its own pressed state, inverting | There is no blue in this app. Selection inverts for the same reason. |
| Opening a note replaces the grid between two frames | It opens out of the card, and closes back into it | You keep your place in the grid instead of re-finding it every time. |
| Tick boxes exist only as a card face | Typed, ticked, and continued in the note itself | A checklist you can read but not tick is a screenshot of a checklist. |
| Code in a note is prose | Detected, ruled off, set in the machine face, copyable | Measured against the real archive: **zero** false positives across the whole archive. |
| A list item is a line of prose like any other | Its own block, tighter leading, hanging indent | A wrapped item read as two lines of paragraph. Tightening the leading inside an item and spending that space between items is what groups it. |
| The fade lands wherever the text happens to stop | Always on the card's last line | The character budget is an estimate, so the text often ended on line 7 of 8 and the fade sat mid-card. Overfill by a line and let the clamp eat it. |
| Priority square inset 4px from the corner | Flush into the corner | Floated off the corner it read as an element placed near the first line, and the spacing was awkward against it. |
| `+1.4k` under the cut | One, two or three stacked rules | *"Feels abstract or hard to understand."* Right — a character count is not an amount of reading. Three steps answer the actual question. |
| Capture is a one-row input; Enter saves and nothing reaches line two | A textarea that grows; Enter saves, Shift+Enter breaks the line | The app's only capture surface could not hold a two-line note. |
| The note is scaled from the card's rect to the screen | It is full size from the first frame; only its clip moves | *"I don't like the 'stretchy' feel it gives."* A non-uniform scale squashes every letter for the length of the move. A clip changes the shape of the container and costs the contents nothing. |
| Motion timings are chosen per animation | Two curves and a fixed set of durations in `lib/motion.ts` | Six transitions inventing their own easing is six apps. |
| Boards swap between two frames | The deck follows the finger, leaves one side and arrives from the other | *"I'd like the user to get a sense of how they move in the app."* An instant swap says a change happened but not which way you went. |
| A deleted card simply stops existing and the grid re-forms | It shrinks into the mark for what happened to it, and the grid slides shut | The owner's vision, unedited. The grid re-forming between two frames gave no way to tell what moved where — and no way to see which note you just lost. |
| Deleting from the open note closes it like any other close | The sheet collapses onto the mark, dead centre | The note is the thing you are looking at, so the note is the thing that should go. Its card's version is suppressed so there is only one object shrinking. |
| The vanish and the grid closing play together, in 300ms | The mark holds alone for a beat; the grid waits 380ms | *"It's a bit too fast, I don't even register a trash icon."* Right — the movement was covering the thing it was announcing. A mark that is drawn but not read is not drawn. |
| A pressed card shifts a pixel down and right | It only inverts | *"That looks bad since we are going for a flush grid."* Correct, and worse than it looks: neighbours share rules, so moving one card opens a hairline gap on two sides. |
| Wrapped list lines hang under the item's first word | Flush with the marker | *"I'd like the text to be left aligned."* The hanging indent gave the note a second left margin, and the second line read as indented. |
| Items sit 0.4em apart | 0.75em | At the tighter setting a list read as one block of text rather than as separate points. |
| Code is found only in a note that is entirely code | Found anywhere in a note that mixes prose and code | Notes are usually a paragraph, a snippet, then another paragraph. The run no longer has to *start* on a strong line, and the evidence must be spread across at least half of it — one dense line can no longer drag innocent ones in behind it. Still **zero** false positives on the whole real archive. |
| A tick box or a fence has to be typed | An insert list at the caret, opened from the note's bar | Typing ``` twice to open a code block is a thing you have to know. The list is also where "add image" will land. |
| Text fields have no clear control | A clear mark whenever there is text | Emptying a field by holding backspace is not a control. |
| The grid can only be used by touch or mouse | Arrows, Home/End, Enter and Delete walk it | It is a desktop app too. Built on real focus, so scrolling and the focus ring came for free. |
| Closing a note returns you to a static grid | The card you were in draws its own border once | *"So the user is not just snapped to a static screen."* The grid is a wall of near-identical tiles; without the trace you find your note again by reading. |

## 12b. The v3 pivot: folders, no tags, no AI

A second round of firm, final product decisions, made after tags and AI enrichment had both been
live long enough to judge. Unlike §12's table, these are not quoted from the owner in the moment —
they're recorded here as plain factual reasoning about the decision, not a fabricated quote.

| Was | Now | Why |
|---|---|---|
| A board is only ever a saved filter (`all`/`tag:x`/`type:todo`/`archive`); no note "lives in" a board | Every note carries a nullable `board_id`; a note lives in at most one board, like a file in a folder | Zero filing pressure sounded right and turned out to mean nothing was ever actually filed. A real folder gives organizing somewhere to land, and Recent (below) keeps the safety net a saved filter used to provide. |
| Default/landing board is "All" | Default/landing board is **Recent** — every active note, newest-edited-first, regardless of folder | Folders can now hold a note exclusively, so the app needs an always-complete view that doesn't depend on remembering which folder something was filed in. Recent is that view, and it retires the old "Unsorted" board along with it. |
| `#tag` typed in the body is interactive: tap-to-pin as a board, and the selection panel's Tag row writes `#tag` into each note | Tagging removed entirely. `#word` in a note's text is plain text, nothing more | Tags were meant to be the zero-friction organizing verb; in practice a real folder does that job better and a folder, unlike a tag, can only put a note in one place — no ambiguity about where something "actually" lives. |
| The AI enrichment layer (Gemini + Voyage) generates `title`/`gist`/`summary`/`note_type`/`tags` and powers hybrid semantic search | Removed entirely. Search is keyword-only; `note_type` is a manual field | It tied every capture to a cloud call and produced tag suggestions the owner wouldn't have picked by hand — see §8. Un-enriched was already the normal case for 237 of 241 notes; removing the layer just makes that official. |
| The open note is its text and four marks: Back, priority, archive, delete | Six marks: the same four, plus **Move** (file into a board) and **Todo-toggle** (set/clear `note_type: 'todo'` by hand) | Filing needs a home now that boards are real folders, and type needs a hand-editable control now that nothing infers it. Both are one tap, same as every other mark on the note — no field, no menu. |
| The multi-select panel's Tag row writes a `#tag` into each selected note's body | Renamed **Move**: files the whole selection into a real board, single-home, same as filing one note | Tags are gone, so the row's job changed with them — no text is touched, only `board_id`. |

## 12c. Inbox, Shelf, Sorter

What the app opens onto, and how you move between boards. Recorded as plain factual reasoning about
the decision, like §12b — not quoted.

| Was | Now | Why |
|---|---|---|
| **Recent** is board 0: every active note, filed or not | **Inbox** is board 0: every active note in **no folder** | Recent was the landing board *and* the safety net, which means it could never tell you anything — it is all the other boards at once, so its count can never reach zero and a large part of the first screen was spent drawing filed notes dimmed in order to say "not really this one". The Inbox has an end to it. Recent survives one place along, unchanged, and is still the answer to "where did that note go". |
| Filed notes are dimmed on the landing board | Dimming is **Recent's alone** | The Inbox has no filed notes in it by definition, so there is nothing there to dim. |
| Boards live in a horizontal scrolling tab strip, with a drawer standing in for it on a phone | **Unchanged** — the strip on a desktop, the drawer on a phone, and since 2026-09-16 the drawer on a desktop as well, behind a burger at the left end of the strip. A full-screen **Shelf** page with a two-line preview of each board's contents replaced both for a few days, and is withdrawn | The page cost a screen and an animation to answer a question a wide window already had room for, and the preview was the part that actually hurt: a shelf is scanned for a *name*, so lines of other notes' opening words are lines to read past. What the two shapes share is the one thing that matters — the same `goToBoard`, the same long-press into Rename/Delete, the same `+`. |
| The board you are on is a highlighted tab among others | **On a phone only**, the header row *is* the board you are on, and opens the drawer | One control, not two: the burger and the name answer the same question, and a 40px target beside a word you cannot tap is a control with a dead half. Same box as a tab, so search still takes that slot at the same height. On a desktop the raised tab says it, as it always has. |
| Another board is reached from an open note by Back, then the burger | **On a phone**, the note's bar carries the burger too, beside Back, and opens the same drawer over the note | The note is a full-screen sheet over the header row, so the one control that answers "how do I get to another board" was underneath it, and every trip cost a Back first. It is the same drawer, not a second list, and it is not a seventh mark on the note: it sits with Back because both say where you are, and the six in the corner are still the things done to the note. Choosing a board closes the note on the way, and Back closes the drawer before the note. **Answered for the desktop the same way**: a desktop note covers the strip exactly as a phone's covers the header row, and once the desktop had the drawer too, the note's burger opens it there as well. |
| Paging to a board lands at its top, and the tab you are on does nothing | Each board **keeps its scroll position** for the session, and the board you are on, **chosen again, goes to its top** — its strip tab on a desktop, its drawer row on a phone | Forty cards down the Archive, a trip to the Inbox and back cost the reader their place, and had to be found again by reading. The tab you are already on was the one press on the shelf that meant nothing, and the top is the one place a reader deep in a board wants and has no short way to. The phone's header row keeps its one job — it opens the drawer — so the drawer's own row is the way to the top there. A capture does not scroll, and the drawer over a note does not send its board anywhere. |
| Emptying the pile means open → Move → back, per note | The **Sorter**: one note, the folders under your thumb, one tap each | Three gestures and a return trip per note is a fair part of why most notes were never filed at all. |
| — | **Swipe-to-file is refused** | It is the first idea anyone has for the Sorter and it cannot work: with more than two destinations a swipe cannot say which one it means, so the gesture becomes a guess — and a guess about where your notes go is worse than a tap that isn't one. Recorded here because it will be proposed again. **Still true of filing, and no longer true of deciding** — see the row below. |
| The Sorter's swipe **steps** through the pile | The Sorter's swipe **answers the card**: right keeps, left bins | The owner's ask, 2026-09-24. The refusal above was carrying a rule wider than its own reason: keep and bin are two, opposite, and unmistakable for each other, which is precisely the case the reason allows. Folders stay buttons. Stepping back became the **Back** button, because a decision made by flinging a thumb is one made by accident. |
| The Sorter is the **Inbox's** mode | **Tidy up** is offered on every board with notes on it | Tidying a folder is the same job said about a different pile, and there was no way to reach it without emptying the folder back out first. Todos keeps the Ticker; the Trash has no line. |
| The Sorter **vanishes** at the end of the pile | It ends on a **summary**, with the run's deletes offered back at once | Twenty cards in, "the board looks different now" is not an answer, and the eight-second strip expired nineteen cards ago. |
| A folder is reordered from its menu, one step at a time, and **it is not a drag** | **Hold a board and carry it** along its own run; letting go where it was is the menu; the Move rows stay | The owner's ask, 2026-09-29: the menu's Move left/right was "very manual or unintuitive". The drag had been refused because the long-press was spent on the menu and a drag would fight the drawer's scroll. Both were answered, not waived: a hold has two endings, and the menu waits for the release to learn which; a press that moves before the hold completes is still the scroll. Todos, Links and Files move too, among themselves — never across the hairline — and their order rides with the folders in the one preferences row. The Inbox, Archive, All and Trash keep their seats. |
| — | The Sorter's swipes are **in-mode only** | A mode may respend the gesture budget inside its own screen. Outside it, a horizontal swipe still pages boards and a card long-press still selects — that budget has not moved. |
| Card swipe → archive | **Withdrawn — a card swipe means nothing** | It was a hard rule in §6 for months and no commit ever built it. A card sits inside the element that owns board paging, so the two would compete for one finger, and the horizontal swipe is already spent. Archiving is a mark in the open note and an action in multi-select. Recorded because a rule that describes nothing makes the true rules beside it less trustworthy. |
| — | The **first-open question**, asked once | An archive that predates the Inbox opens it at 237, which is a bill rather than a landing page. Neither answer moves a note: one puts the whole pile in the Inbox, the other stores a date and leaves the old ones on Recent and in search. Dismissing it is not an answer, and "Bring in the old notes" in the menu reverses it, so nothing about it is permanent. |

*("Colour-coding boards, there being no colour" stood in that list and has since been built —
see §12d. It is the one place in the app that has a hue, and it is the user's folders only.
"Dragging folders into order on the shelf" stood there too, and was built on 2026-09-29 at the
owner's asking — see the row above.)*

## 12d. A board can be recognised before it is read

| Was | Now | Why |
|---|---|---|
| Colour-coding boards is out of scope, "there being no colour" | **Eight tints, folders only**, and they are the app's one hue | The old line treated "no colour" as a fact about the whole app. It is a fact about what the *app* says — an error, a link, a state. A board is a **name the user chose**, and hue is recognised faster than any word can be read, which is the whole reason a shelf is worth colouring and a status is not. `DESIGN.md` §2b holds the terms it was granted on: every tint sits at exactly `--muted`'s luminance or `--rule`'s, so a coloured board is the same tone turned rather than a brighter one, and no step is added to the ramp. |
| Every board wears the folder mark | A folder may wear any mark in the set | The other half of the same question. A shelf is scanned for a name; a mark that is *this board's* mark answers before the name is read, which is what the shelf row has always been for. |
| — | The seven automatic boards can be neither | Inbox, Recent, Todos, Links, Files, Archive and Trash draw what they *are*. An Inbox with a bicycle on it is the app lying about itself, and a hue on one is exactly the "colour for state" the design refuses. |
| — | A tint touches **a mark and one hairline**, never a fill | The rule under the board row takes the hue of the board you are standing on, at the same 1.73:1 the rule always measured. Nothing else — no slab, no word, no card, and never a line of the user's own text. |
| Capture offers nothing at all — "no board chooser at capture time, **ever**" | Three optional marks beside Save: priority, to-do, board | The owner, on having to write a note, open it, and press a mark: *"it should be a option, not the default that user HAS to enter these so quick capture remains"*. The old rule collapsed two different things — being **asked** for a decision, which is what makes capture slow, and being **offered** one, which costs a glance. A writer usually knows a thing is urgent before the first word; making them save it, find the card, open it and press a flag spends four gestures on a decision that was already made. Nothing is required, nothing is pre-selected, Enter still saves, and every mark is the same one the open note already uses for the same thing. |

## 13. Open questions

Whether `delve` vs `reference` is one type or two. Whether the domain chip on a link card should
itself be tappable — it would save a tap on 26% of notes, but it puts a second target on a card
whose only job is to open. Image/attachment support — only a few percent of real notes have images, so probably
Phase 4 or never.

*(Closed, then reopened by the v3 pivot: whether tag boards should be retired "now that nothing
can create a tag." They stayed once, on the grounds that tags were still hand-typed and one gesture
away. §12b reopened the question at the root instead — tags themselves are gone, so tag boards are
gone with them. Boards are real folders now, and `prefs` migration `0014`'s pinned-tag-board sync
no longer applies.)*
