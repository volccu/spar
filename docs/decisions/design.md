# Decisions behind DESIGN.md

Moved verbatim out of `DESIGN.md` on 2026-10-01 (review PL-09), so the rulebook can state
each rule once, short and current. This is the record of how the rules came to be: the
dated stories, the was/now/why, the things tried and withdrawn. **It is history, not
instruction** — where it disagrees with `DESIGN.md`, the rulebook is right. Headings follow
the section of `DESIGN.md` each passage came from, so `#<heading>` finds it.

## 0. How to use this file

3. **`SPEC.md` §5** — still correct on *layout, grid geometry, card faces and motion*, all of
   which are unchanged. Its colour and typography paragraphs are superseded here. §12's
   rejection log still stands: anything rejected by name stays rejected.

- **There is no colour.** Not an accent, not a link, not an error, not a hue for state. If you
  want emphasis, move a step along the ramp or change a rule weight. That is the entire kit.
  There is now **exactly one** exception, it is written down in §2b, and it was granted on terms
  that keep the sentence above true of everything the app says about itself: a folder *the user
  made* may be tinted. Read §2b before adding a hue anywhere; if what you are colouring is a
  state, an error, a link or anything the app is reporting, the answer is still no.

## 1. The brand

**The one drawing.** "No illustrations" stood here until the mascot (§11), and it is worth being
exact about what was given up and what was not. The line was never about drawings — it was about
*decoration standing in for content*: a spot illustration on a screen full of notes is an apology
for the notes. An empty board has no notes to apologise for. So exactly one drawing exists.
Everything else the anti-brief refuses still stands, and the mascot itself obeys all of it — one
warm greyscale, no hue, no shadow, silent under `prefers-reduced-motion`.

**Where it lives — corrected 2026-09-17, because this paragraph had stopped being true.** It said
the drawing "appears in exactly one place" and "never shares a screen with a note", and for a
while it did. It has since been given two more homes, each argued where it was made, and this
file was never told: **the header**, where the creature *is* how sync is drawn and stands beside
the notes on every screen, and **the app
icon** (§12). The empty board is the third. What still holds is narrower and is the part that
matters: it is never drawn per card or per row, never inside the grid of notes, and never on a
search that found nothing. **The About page is the fourth home**: beside the wordmark at the head
of the page, the masthead said again, visiting while the page covers the header (2026-10-01, the
owner's ask, review UI-20). A fifth is a new argument. And said plainly, since this section
is about honesty: *why a creature at all* was the owner's taste before it was anyone's argument —
the reasons above explain where it may go, not why it exists. That is allowed; it should be named.

**One creature, and only ever one on screen — 2026-09-29, asked for by the owner.** Three homes
had meant that an empty board showed two: the one asleep in the middle of the board and the one
still standing in the header, a twin where there should be a creature. Now the header is where it
lives, and while the empty board draws it the header's is *away*: it goes in a small puff of
smoke and the sleeping one arrives out of another, so what is seen is the creature moving across
the room; when the board fills, or you leave it, the header's comes home the same way. The smoke
is the drawing's own two tones and nothing more — the shell's line round the outside of the cloud,
the screen's tone inside it — and it bursts and thins in `POOF_MS` from `lib/motion.ts`, because a
thing moving between two places is orienting motion, which is what that file is for. Under
`prefers-reduced-motion` there is no smoke at all: the swap is simply made. The header keeps its
box while the creature is away, so the wordmark never moves, and nothing is left there to reach.

**The smoke, 2026-10-12, asked for by the owner.** Two changes. The sleeping creature no longer
arrives out of a cloud — "it can be there" — so the only smoke is the header's, as it leaves and
as it comes home. And the cloud is no longer the same six puffs every time: each play draws a new
one, a few big puffs and a few small wisps, which billow out of the creature's middle, swell, drift
up and outward and thin away unevenly. What holds it together as *one* cloud is unchanged: one
outline round all of it, the drawing's own two tones, and about half a second.

**The robot became a note card — 2026-10-13, owner approved, review CH-03.** The review found
that a box on legs with an antenna and a screen for a face is the stock chatbot icon: a stranger
reads "AI app" before reading anything else, in an app that removed its AI layer. The owner looked
at two rounds of mockups (seven creatures) and picked **F · Dog-ear**: a note card that got up and
left, one corner folded down, glancing back over its shoulder. It is drawn as flat cut paper, so
the hand-drawn "boil" filter and the screen's static went with the robot. Every state was mapped
onto the new body and every timing kept: idle breathes and blinks (each half-dome eye drops flat
onto its base), working walks with its eyes ahead, asleep the domes shut and the card leans back,
offline is a blank card that shivers (the robot's dead screen had no face either), the startle's
hop flips the folded corner over once, the nod dips. On the light ramp the tones turn over as the
mockup showed them: the shadow and the pupils become the ink, the eye whites the paper. The
header's 10px trim was kept as the owner saw it.

**The robot came back — 2026-10-14, owner's call.** A day after the card went live the owner
said they liked the old mascot and asked for it back. The CH-03 change was undone whole: the
robot's drawing, its boil filter and screen static, its tones, the icon, its PNGs and `og.png`.
The card story above stays as the record of what was tried.

**The nod.** "It does not celebrate you for capturing a note" stands, and the mascot's nod is not
an exception to it — it is why the word is *celebrate*. When a note lands, the creature dips
once, seven tenths of a second, and goes back to whatever it was doing. That is a receipt, not a
reward: the same fact the new card's border trace already states spatially — your note arrived —
said by the thing whose whole job is to stand for the machine, at the moment the machine took
something into its keeping. Nothing is awarded and nothing is praised: no words, no mark, no
count, no sound, and under `prefers-reduced-motion` no nod at all, with nothing owed in its
place — a receipt you can turn off was never a prize. Celebration flatters the writer;
acknowledgement reassures them the machine has the note, which for an app whose one promise is
*put it down and it is kept* is information, not decoration. The day the nod grows a message, a
streak, or a second move, it has crossed the line this paragraph exists to draw.

**The pulse.** The nod has a twin for the hand: one 12ms vibration when a note lands and when a
tick box is ticked (`lib/haptics.ts`), on a phone that has a motor and nowhere else. It is the
same receipt said to a thumb that may not be looking at the screen, and it is held to every term
above — one pulse, never a pattern, no count, nothing else in the app vibrates. **It is on trial.**
Whether it is the physical half of the nod or a gimmick is a gut call that cannot be made on
paper, so it shipped on (2026-09-17) with a per-device switch on the About page. If it is turned
off and stays off, take it out rather than leaving a dead switch behind.
**It has one more place since 2026-09-29: a board picked up off the shelf** to be carried
(`lib/useBoardPress.ts`). The same pulse, under the same switch, and the same kind of receipt —
the app has taken the board into your hand — said at the one moment the thumb is *covering* the
thing that changed, so the eye cannot be told. Still one pulse and no second kind: letting go says
nothing, because the board settling into its seat is on screen.

**The colophon.** The About page (`components/About.tsx`, from the menu) is the one screen that
says what the app does with a note — the original kept, the trash's thirty days, nothing read by
anyone — and it holds the export. It is a book's colophon, not a settings page: the reading face
at the reading size on the note's measure, section names in Marcellus, the machine's own numbers
(build, counts, measured speeds) in mono. It is the natural home for any future *fact about the
app*, and the wrong home for a preference. It holds two switches — the pulse, and the Inbox's count
on the app's icon, shown only in an installed app that can badge (2026-10-01, owner approved,
review PL-12) — and a third is an argument, not an addition. The list of keys is such a fact, and it is drawn in the page's voices rather than as a
cheat sheet: what a key does in the reading face, the key in the same hairline box every
shortcut hint in the app wears, and nothing on a device with no keyboard.

## `--card` is the ground, and that is the design

This began as a 1.08:1 lift — already nearly invisible — and went to zero deliberately. Every step
of lift is a step of the app asserting itself in front of a few hundred notes, and none of them buys
anything the rules are not already doing at 1.61:1.

## `opacity` is not a step along the ramp

It is also the way small text quietly stops being legible. The board counts were drawn at
`--muted` at half strength for as long as boards have had counts: that computes to `#504a42` on
the ground, **2.26:1**, against the 4.5 floor this file verifies `--muted` at for that very row —
on every board you are not standing on, at `--t-data`, which on the phone's drawer is the whole
shelf. Nothing was wrong with wanting a count quieter than its name; what was wrong was reaching
past the ramp for it, when the count was already in the machine face at the smallest size beside
tracked capitals, and `--muted` under `--ink` is exactly the step being asked for.

## There is no light mode

Adding one back is not a small change, it is a different design: every tone is placed against a
single ground, the signal exists only because there is headroom above the body text on a dark
ramp, and the `--card`/`--paper` step is set to a near-invisible 1.08 precisely because that is
how unlit paper behaves. On a light ground each of those decisions inverts into a different one.

### 2026-10-11 — a light ramp, as the device's choice (owner approved)

**Was:** "There is no light mode", stated in DESIGN.md §1 and §2, both CLAUDE files and the
stylesheet, and tested (`styles.test.ts` "has no light mode").
**Now:** Settings offers System / Light / Dark per device, Dark the default. The owner overrode
the rule knowingly, after reading why it was there.
**Why it is still one design:** the paragraph above was right that a light mode is a different
design if it is drawn as one — a white theme with the app's greys on it. So it was not. Each
decision it names was turned over rather than dropped: one ground (now the lightest tone), every
step toward the words, the card still the ground, and the signal's headroom moved *below* the ink —
the ink stops at `#312a23` so an address can be `#140c05`, 1.37:1 past it, darker and warmer.
The proposal was measured before it was built (WCAG 2.1, the same floors): ink 12.32 / 10.70,
muted 6.24 / 5.42, paper on `--invert` 8.77, signal 16.88.

**What it cost, accepted by the owner:**
- **The pale tints.** Mirroring the sixteen left two marks 0.028 apart in OKLab; re-solved inside
  the turned-over span they hold 0.0465, but Bone, Oat and Stone become barely-coloured dark
  greys. A pale mark on paper cannot be read.
- **The lamp is a shade.** `screen` draws nothing on paper, so the wash multiplies; the light
  shows the tooth as its shadow, and the dials are scaled to 0.62 to stay under `--raised`.
- **The splash.** The manifest holds one `theme_color`; an installed app opens dark before the
  page runs, whichever ramp is chosen.

**Raised 2026-10-13 (owner note on review LEAD-01: "the light mode contrast is not that good, it
is hard to read text").** The ramp already cleared its floors (muted 6.24, ink 12.32), and was
still hard to read, because the tone that carries the small mono counts, stamps and settings text
is `--muted`. A census of every text run on the light ramp found nothing under 5.4:1; the fix was
to raise the whole span anyway: muted 7.79, invert 9.95, ink 12.99, signal 17.83, same order, same
hue and saturation per tone. The signal's 1.37:1 headroom over the ink bounds the ink: paper
against pure black is 18.3:1, so the ink cannot go past about 13. The price: ink against muted
is now 1.67:1 (was 1.97:1), the tint set had to move two marks that landed beside the darker
`--muted` (Bone `#44433b` to `#5a5950`, Oat `#594a34` to `#725940`), and the cursor SVGs carry the
new ink. Dark did not change, and a new device now starts dark (same day).

**How it is held:** one `:root[data-theme="light"]` block, keyed on the *resolved* theme
(`lib/theme.ts`, and `public/theme-boot.js` before first paint because the CSP allows no inline
script), never a `prefers-color-scheme` branch — so there is one copy of each ramp to drift.
`styles.test.ts` now runs every contrast, tint and lamp rule on both. The same day, the device's
**Reduced** motion setting was joined to `prefers-reduced-motion` by a build step
(`lib/motionSetting.ts`) rather than a hand-copied block per media query.

## Why this is not the thin end of a wedge

Every rule in §2 exists to stop the app competing with the user's words. A coloured error, a
coloured link, a coloured "on" is *the interface asserting itself* over a note. A board is not
that. It is a **name the user chose**, it is their content rather than the app's chrome, and it is
the one thing on screen a person navigates to dozens of times a day by looking for it. Hue is
recognised faster than any word can be read, which is the entire argument for spending it here and
nowhere else.

## The terms: no tint adds a step to the ramp

**The key is what a synced board stores, so it never changes;** the value and the name shown in the
picker can. This set replaced a brighter one on 2026-10-01 (owner approved, review UI-21), and each
key kept the slot of the old colour nearest it, so a board already tinted keeps its family.

### 2026-10-08 — eight pigments became sixteen outdoor-gear earths (owner approved)

| Was | Now | Why |
|---|---|---|
| Eight tints, every mark at exactly `--muted`'s luminance (0.2608 – 0.2637) | Sixteen, a mark anywhere from 0.24 up to `--invert`'s 0.4633, never above it | The owner asked for a larger set in the "gorpcore" register — bone, sand, oat, clay, rust, ochre, khaki, moss, olive, fern, forest, sage, slate, stone, dusk, plum — and **an off-white cannot sit at 0.262**. Bone is pale by definition. The question was how far the brightness law could give without becoming emphasis |
| One brightness, "the same tone turned" | A span with a hard ceiling at `--invert` | `--invert` is already the brightest thing a *content* surface may be, so a mark that stops there never outshines a selected card, and `--ink` (0.672) stays the only tone above it: the user's words remain the brightest thing on screen. The floor of 0.24 keeps every mark at 5.5:1 or better on the ground (the floor is 4.5) |
| Rules at `--rule` (0.042), tolerance 0.004 | **Unchanged** | The hairline under the board row is the thing that must stay quiet whatever the hue, and it did not need to move. The rules' chroma is capped (0.043 at most) so a dark rule stays a trace of the hue, not a coloured line |
| Eight marks no closer than ΔE 0.044 (OKLab) | Sixteen marks no closer than **0.045**, and none closer to untinted `--muted` | Doubling the set in a band this narrow would have crowded it. The set was optimised, not eyeballed: hue and chroma ranges per colour name chosen first (so "olive" stays olive), then a search for the largest minimum pairwise OKLab distance, with lightness solved to a target luminance and measured on the rounded 8-bit hex. The test now recomputes the distances itself |
| Three pale marks were impossible | Bone (Y 0.450, chroma 0.011), Oat (0.373, 0.026) and Stone (0.310, 0.017) | They are the point of the span. They are low-chroma enough that they read as a lighter version of the room's own warm grey, not as a hue — which is what the rule against colour is protecting |

**The keys.** A key is stored in synced data, so none was renamed and an unknown key still means
"no tint". Each of the eight old keys took the *nearest* of the new colours (OKLab distance in
brackets): `ember` → Rust (0.016), `ochre` → Ochre (0.013), `moss` → Moss (0.018), `sage` → **Fern**
(0.029; Olive was equally near), `teal` → **Forest** (0.008), `steel` → Slate (0.008), `iris` →
Dusk (0.019), `plum` → Plum (0.020). Eight keys were added: `bone`, `oat`, `sand`, `stone`, `clay`,
`khaki`, `olive` and **`salvia`**, which is the colour *called* Sage. That is the one awkward
corner: the old `sage` slot was a mid green (what the owner's list calls Fern), so the key `sage`
shows "Fern" and the grey-green the owner calls Sage is `salvia`. Swapping them would strip the
colour from every board that already wears one, so it is documented rather than tidied.

**The picker.** Seventeen cells (No colour and the sixteen) in a grid of nine columns and two rows,
left-aligned and capped at the 44px touch size; at 390px the columns give to 43px and at 360px to
40px, as the single row of nine already did. The eighteenth cell is empty rather than the row
wrapping a tenth swatch onto a line of its own. The swatches are still the board's own mark, never
a block of colour.

**What it is not.** Not a licence for brighter marks: the ceiling is `--invert`, and the test fails
above it. Not a licence for chroma either — the highest is 0.087 (Fern), and the three pale ones
are nearly colourless. Not a seventeenth: sixteen is the whole set for the reason the type scale
has six sizes.

### 2026-10-23 — the coloured hairline under the board row is withdrawn (owner's ask)

| Was | Now | Why |
|---|---|---|
| A tinted folder's hue also reached the hairline under the board row, through `--here-tint`, at `--rule`'s luminance (sixteen `--board-<h>-rule` twins per ramp) | The row's hairline is plain `--rule` on every board; the tint reaches the mark only, through `--board-tint` | The owner asked for "the colour line" gone when a folder is coloured. The twins existed for that line alone, so they went with it; `styles.test.ts` now fails if `--here-tint` or a `-rule` twin comes back |

## 2c. The second exception — the film, and the lamps that show it

**Three surfaces are lit, and only three: the focused write box, the open note's editor, and the
board you are on.** Each was added after the one before it and each is argued for in its own words
below; none of them arrived by citing the others.

## Why a texture at all, when nothing else has one

Because the capture bar was the one field in the app with **no focus state whatsoever**. §3 says a
text field takes one inset rule of ink, and every other field does. The write box cannot: it is not
a box on a screen, it is a 58px band flush to three edges of it, permanently present, and a bright
rule drawn round the inside of that band is a frame around the bottom of the app for as long as
anybody is writing. So it was given `outline: none` and left with a blinking caret, which on a
phone at arm's length is not an answer to *is this thing listening*.

Every tonal answer was tried first and they are all in `TEMP/capture-focus.html`: brightening the
bar's top rule, sweeping it in, lifting the field to `--raised`, a mark in the margin, lighting the
rule over the field's width only. They work. They are also all the app clearing its throat — one
more bright hairline on a screen that is already a lattice of them, or the chrome's `--raised`
borrowed by a content surface. The texture says the same thing without adding a line, because it
is not a mark at all: it is the surface admitting there is a light on it.

## The terms

- **It adds no tone.** The film names no colour: `feTurbulence` generates its own image and
  `feColorMatrix` desaturates it, so what tiles the field is grey noise and there is no tenth
  step on the ramp hiding inside the data URI. **It is then warmed to the lamp's own grey**
  (2026-09-21, asked for by the owner): a second matrix scales the channels to roughly
  `--invert`'s proportions, 1 : .95 : .86. Neutral grey laid over this warm paper read as
  blue-grey beside it — the one cool thing in the room, and most visible on the board tab. It is
  a ratio, not a colour; the grain still has no tone of its own, it takes the light's.
- **The grain drifts, slowly, on every lit surface** (2026-09-21, asked for by the owner). The
  film is laid twice, once at 160px and once at 224px so the two tilings never line up, and each
  copy glides its own way over a 90-second lap (`lamp-drift`). Where they cross, the grain
  re-forms: dust turning in a beam, not a pattern sliding. This is the one loop a board tab runs,
  and it may run there where the breath and the flicker may not because **it touches no
  brightness** — the lift is untouched and a selected tab is exactly as lit at every frame. It is
  linear and its duration is a literal, the spinner's exception: a picture that loops, where an
  eased drift would pulse once a lap. Reduced motion stops it everywhere.

- **The flame is alive, and only on the two write surfaces.** This line used to say "no loop", and
  it was true for about a day. A lit surface that holds perfectly still reads as a *printed*
  highlight rather than as a light in the room, so the write box and the note editor now carry two
  slow loops: a **breath**, one swell and settle over `LAMP_BREATH_MS`, out on ENTER and back on
  EXIT; and a **flicker**, a handful of dips of a few percent at deliberately uneven spacing over
  `LAMP_FLICKER_MS`. The two periods do not divide into one another, so a dip never lands twice on
  the same point of the breath — even spacing is a metronome, and the eye finds a metronome in
  about two passes.
- **The board you are on does not breathe, and this is not a detail.** A board tab is a *state* —
  it says where you are — and a state that flickers reads as a fault in the app. The mechanism is
  built around this: both loops drive `--breath-gain` and `--flicker-gain`, two registered numbers
  that every lit surface multiplies its lift by, and the three board surfaces run no animation, so
  they read the registered `1` and light exactly as they always have. `styles.test.ts` holds the
  line in both directions — the write surfaces must animate, the boards must not.
- **Both loops go under reduced motion**, unlike the travel and the fade. Those are removed because
  the light should simply already be where the caret is; these carry no information at all, and are
  precisely the kind of ambient movement the preference is asking not to see. A resting lamp leaves
  both **running**. This line used to say it *paused* them — a lamp that has gone out is not
  breathing — and that was right while the light was gone in a quarter of a second. It stopped
  being right the moment the fade-out was slowed (below): the loops would halt dead while the pool
  is still plainly lit, and a breath that stops in view is a larger event than the fade it was
  meant to tidy up after. An unfocused lamp has been running both all along, so leaving them alone
  costs nothing and is what the surface was already doing.
- **The lamp goes out four times more slowly than it comes on, and the asymmetry is the point.**
  A light comes on all at once and dies slowly — so coming back is `LAMP_FADE_MS`, quick enough to
  read as an answer to the keystroke that asked for it, and going out is `LAMP_DIM_MS`, slow enough
  that it is never caught happening. They were one number for as long as the lamp existed, and at
  the fade-up's speed the light did not dim on the way out, it *switched off*: an event, which is
  the one thing a light settling because nobody is typing must not be. The curves carry the other
  half of it — out on EXIT, which starts slow, and back on ENTER, which arrives early. The old
  fade-out inherited ENTER, a hard decelerate, so it spent most of its brightness inside the first
  fifty milliseconds and then lingered near nothing, which is the shape of a switch drawn as a fade.

## The open note's editor

This section used to say the editor deliberately did not get the lamp, and that if it ever wanted
one that was the argument made again rather than this licence stretched. Here is that argument.

The write box needed a focus state because it had none. **The editor is the opposite case: it has
too little to distinguish it from the thing it replaces.** Reading a note and writing in one happen
in the same place, at the same size, on the same line grid — the reader and the editor are two
elements built to break lines identically so that swapping between them is invisible. That is the
right design and it stays. (It was not true until 2026-09-17: headings, lists, code and hidden
marks all set the reader on a different grid, and a tap reflowed the note. §8 says what changed.) But it means the only thing separating *reading* from *writing* is a
blinking caret, and a caret is one hairline in a column of Baskerville.

So the light here answers the same question the write box's does — *is this thing listening* — and
it must answer it without ever becoming a mode. The words do not move, the measure does not change,
nothing appears in the margin. The paper under the line you are on is simply lit.

**It is the dimmer of the two, deliberately, and held below the write box by a test.** It was
designed at `--lamp-lift` 2.2% against the write box's 3.4%, with a pool of 150 × 40 against
175 × 52; the owner then turned it down by hand to **0.02% and 80 × 40** (`c3628cf`, "kept as
found"), and those are the numbers on screen. The test holds only the ordering — dimmer and
tighter than the write box — because the numbers are the owner's dial. The argument stands at
either strength:

- **Dimmer,** because a capture bar is a place you arrived at and an open note is a place you were
  already reading. A light that announces itself at the moment a paragraph becomes editable is a
  mode, which is the one thing this may not be.
- **Tighter,** and this matters more than it looks: the measure here is 33em, roughly three times a
  one-line capture bar. The write box's pool inside it would light a third of a line at once and
  stop pointing anywhere. At 40px against a 27px line the pool is about a line and a half tall, so
  it hugs the line being written.

Everything else is shared and unchanged — the same `--film`, the same mask, the same measurement
through `lib/caret.ts`, which was written against *any* textarea and mirror for exactly this reason
and needed no change to take a second caller.

## The board you are on

The shelf used to say *this is where you are* with a flat `--raised` fill behind the tab's name.
That worked and was never wrong. What it was, was **a shape**: a rectangle with four edges, sitting
in a strip that is already a row of rectangles divided by hairlines, on a screen whose whole
structure is rules meeting rules. The fill said "here" by drawing one more box.

A pool has no edge. Lighting the tab says the same thing with nothing added to the lattice — the
board you are on is not wearing a box, it is the one the light is on. And it is the same light: the
write box is lit because it is listening, the editor because the words have become editable, the
board because it is where you are. A reader who has learned what the glow means in one place has
learned it in all three. **That is the test another surface has to pass** — not "would a texture
look good here", but "does the light mean the same thing here as it already does everywhere else".
It is a narrow gate and it is meant to be.

## 3. The signal — emphasis without colour

**A text field never takes the ring — it takes one inset rule of ink** (`1px solid var(--ink)` at
−1px offset, the canvas label's rule). The ring's licence rests on "keyboard users only", and for
a field that premise is false: every engine treats a field as expecting keyboard input, so
`:focus-visible` matches on an ordinary tap — which put the brightest tone on the ramp around the
search box on every use, in an app whose premise is that the words are the only bright thing on
screen. And a ring drawn 2px *outside* a box that sits flush to three edges is not a ring: it
clips at the viewport and lands on the hairlines it crosses. A field's focus is not an
accessibility event, it is the state the field is in — so it is drawn inside the box, in ink,
identically for touch and keyboard. Keyboard focus stays visible; it just stops shouting.

## Three faces, three jobs

**IBM Plex Mono is the one addition to the original three.** The machine voice used to be a
system stack — Consolas on Windows, SF Mono on macOS, something else on Android — so the app's
most exacting typography, set at 10.5px on a fixed 22px footer baseline, rendered differently on
every device it ran on. It is now self-hosted like the other two.

**The open note uses neither the 700 cut nor the italic** (2026-09-17). The reader must lay every
character where the editing textarea does, and both cuts are a different width from the regular
one. Bold there is `-webkit-text-stroke` over the regular cut; italic is the regular cut slanted by
the browser, through `--body-roman` (an alias, `Libre Baskerville Roman`, that declares no italic
face). Cards, which are never edited in place, keep the real cuts.

Preloaded for first paint: `libre-baskerville-latin`, `libre-baskerville-bold-latin`,
`libre-baskerville-italic-latin`, `marcellus-latin`, `plex-mono-400-latin`. The bold and italic
joined the list on 2026-09-17: left to load on first use, they arrived after the text was laid out
and re-broke it a moment later.

## Leading and tracking

A list item in the open note was set on `--lh-item` with a margin between items well above the
difference, so a wrapped item read as one thing. **That is withdrawn** (2026-09-17): the reader
must break lines exactly as the textarea does, and the textarea has one leading and no gaps, so an
item in the open note is on `--lh-read` with nothing between items. The grouping survives on cards,
in `--card-item-lh` and `--card-item-gap` below.

## 5. State grammar — what "on" looks like

**The panels are chrome, and are drawn on the ground.** The menu, the selection's verbs, the
Move chooser, the reminder panel and the note's insert panel are one surface (`.selpanel`), and
until 2026-09-16 it was an inverted slab: `--invert` with its rows in `--paper`. On a phone that
is a 200px block of bone standing up out of the black — the brightest thing on the screen, and
the rows on it *harder* to read for it, because the eye adapts to the slab and the dark type on
it goes flat. The owner said so. A panel is a list of verbs, which is furniture, so it takes the
furniture's grammar: the ground, a `--rule` edge (the same surface as the right-click menu and the
search overlay), rows in `--ink` divided by `--rule-soft`, `--raised` under the pointer, and the
invert only for the instant a row is pressed. The one bright thing in that corner is the burger
that opened it, which still inverts to say the selection is on.

**Inverting goes to `--invert`, not to `--ink`.** It used to flip straight to the full bone the
words are set in, which on a light ground was correct and on this one is a flare: a selected card
became a 206px block of near-cream, and the multi-select panel a cream slab, on a screen whose
brightest thing is otherwise a line of text.

The window is narrower than it looks, and was found by walking both edges. At the full bone
(1.0×) it flares. At 1.88× below it, the state lost its punch — a selected card stopped reading
as selected. `--invert` sits at **1.41×** below the body bone: a clear step down from the words
without becoming a grey, and still 9.66:1 against the ground.

**Why chrome raises instead of inverting.** Inversion is how a *note* says something was done to
it, and that has to stay unmistakable. But the furniture used to say "on" the same way, and on a
dark ground a solid bone slab — the board you are on, plus two buttons in the bar corner — made
the app's furniture the loudest thing on a screen full of notes.

- **A pressed card does nothing — it must never move, and it no longer inverts either.** Cards
  share their rules with their neighbours in a zero-gutter grid, so one pixel of travel opens a
  hairline gap on two sides and closes one on the other two; that left the ink as the only thing a
  press could safely change, and it inverted. That is withdrawn. A card is not a button: the tap
  opens the note, which is the whole of the feedback owed, and on a phone a scroll that begins on a
  card held the invert white for as long as the finger was down. Nothing marks a press on a card.
- **Selection inverts the card**, so at a glance you see the *shape* of what you picked — and now
  that the press has stopped borrowing it, the invert says exactly one thing. Everything on the
  slab goes to `--paper`: names, ticked items, links, and the idea's snapshot and a link's box,
  which drop their dark fill and become `--paper` outlines. Only a photograph keeps its own tones
  (2026-10-01, owner approved, UI-01).
- **Priority is a flag, at the head of the card's footer row.** No stripe, no frame, no tint, no
  hue: the coloured rail, the tinted fill (it read as *disabled*) and the 2px frame have each been
  tried and rejected by name, and none of them may come back. It was a 9px filled square flush in
  the card's top-left corner for years, which was right for a shape at furniture scale; a flag is a
  glyph, and a glyph in that corner floats over the first line — the exact "element placed *near*
  the text" failure the flush corner existed to avoid. So it sits in the one row a card already
  keeps its marks in, at the one size they are all drawn at, at full ink rather than the row's
  muted. A canvas note has no such row and keeps it above the text instead.

**The key cap: one radius, granted once (2026-10-08, owner approved).** A shortcut used to be
one `--rule` hairline box, mono, tracked, no radius, no fill, holding the whole label — "CTRL E"
in a single rectangle. The owner disliked it, and the reasons were visible: a modifier and a
letter are two keys but read as one word; tracking spread "CTRL" thin inside a box tight on its
sides; and a box with no fill and square corners looks like a form field's outline rather than a
key. The redesign looked at how Linear, Raycast, GitHub, Vercel and Notion draw the same thing
and took what they agree on: **one cap per key** with a small gap between ("Ctrl" "E", or "⌘"
"K"), centred and untracked lettering, one cap height (18px) with a minimum width so a single
letter is a square, a faint fill and a fine edge so it reads as an object, and a small corner.

| | Was | Now |
|---|---|---|
| Unit | one box per shortcut | one cap per key, 4px apart |
| Lettering | uppercase mono, `--track-data` | mono, untracked, as written ("Ctrl") |
| Size | 3px/5px padding round the text | 18px tall, 18px at least wide |
| Fill and edge | none; 1px `--rule` | `--rule-faint`; 1px `--rule` |
| Corner | square | `--r-key`, 3px |

The owner said so in terms: "rounded is ok for an element like this, but keep the visual
language consistent and high quality." So **the no-radius rule has exactly one exception**, it is
a token (`--r-key`) so it is greppable, `styles.test.ts` fails if any other rule spends it or if
any other `border-radius` is not zero, and the shape was kept to the system's grammar in
everything else: no shadow, no bevel, no bottom-edge "key depth", a ramp tone for the fill and
the same `--muted` lettering. A circle, a pill or a rounded card is still refused; this is a
small cap and nothing about it generalises.

## 7. Marks

**2026-10-13.** The tier strokes were written as a unitless `calc()`, which Firefox does not read
for `stroke-width`, so there every mark fell back to one user unit and was drawn at 1.00, 0.83 and
0.58px on the three tiers against Chromium's 1.5 (measured; the owner's phone and PC both run
Firefox). `* 1px` makes it a length, and a px inside an SVG is a user unit, so Chromium's drawing
is unchanged. The weights, tiers and numbers in DESIGN.md §7 were always right; only one engine drew them.

**Never hard-code a width on a mark.** 14 is a ceiling, not a preference: `.card-foot` is a fixed
22px box, so a larger footer mark grows every card on the board. Its words sit mid-band: 8px above
them under the rule, 8px below to the card's edge (2026-10-01, owner approved, UI-23).

**2026-10-08 — a third drawn mark.** `IconInspiration`, a framed picture whose sun lifts under the
pointer (`.icon-inspo-sun`), because no icon set has a word for "the board of pictures" and the
mark must be recognised before the name is read. Its hover is a part of the mark and sits under
the same reduced-motion guard as the other drawn marks.

**2026-10-12 — a folder's mark comes from Lucide (owner approved).** The owner asked for a better,
more varied set: there was no fitting mark for "fishing", and a folder should find one for
whatever part of a life it holds. Heroicons' 325 are drawn for interfaces — arrows, documents,
devices — and its names say what a drawing is, never what it is for. Lucide (the owner's choice)
has some 1,850, a far wider spread of everyday things (fishing gear, sport, pets, food, tools,
family), and a list of plain words per mark, which is what makes them findable. It was weighed
against the chrome rules and fits them: an outline set on the same 24 grid, round caps and joins
like Heroicons', drawn by the same `.icon` tiers, so its own stroke of 2 never shows — the CSS
sets 1.5 / 1.8 / 2.57 as for every mark. Some twenty drawings carry a dot filled in
`currentColor` half a unit across (a palette's wells, a chart's points); that is the mark's own
colour at the size of a pen point, not a fill, and was kept.

Only the folder's mark changed. The chrome stays Heroicons, imported one at a time (§15 still
asks why), because its outline/solid pairs are the "solid means on" grammar. Folders already
dressed keep exactly the Heroicons mark they wear: names are never rewritten, and the older set
loads only while a board still wears one.

## 7b. The pointer

**On a desktop the app draws its own.** It was the last piece of the interface the operating system
was still drawing — a soft grey arrow with a drop shadow under it, which is the only shadow anywhere
near this app and the only object on screen not on the ramp. Every cursor is now a token in
`:root` (`--cursor-default`, `--cursor-pointer`, `--cursor-text`, `--cursor-grab`,
`--cursor-grabbing`, `--cursor-crosshair`, `--cursor-zoom-in`, `--cursor-zoom-out`,
`--cursor-resize`), and nothing outside that block writes a cursor keyword.

## 8. Layout

- **The app derives no heading; the user may write one.** One heading level, and the second is
  not coming back. In the open note a heading is its muted `# ` and its words at a heavier stroke,
  at reading size on reading leading, with no space of its own. It used to belong to what follows
  it — `--t-name`, space above several times the space below — and that was withdrawn on
  2026-09-17, because it moved every line after it when a tap swapped the reader for the editor.
  On a card it takes no size step at all.

- **A `# ` line at the top of a note is its name, and it speaks in the idea name's voice.** On the
  card that one line is set in the display face at `--t-nav` in capitals, cut to one line, in the
  slot it already had — never a row added above the text, so the card keeps its height. In the
  open note a note with no name offers a muted **Add a name** above its text, the same control an
  unnamed idea's "Idea" is in the canvas bar, worded as an offer and a full 44px tall (2026-10-01,
  owner approved, UX-23).

- **The bottom bar is anchored, never floating.** Panels open bottom-right, where the thumb is —
  except a folder's menu opened from the desktop strip, which hangs under its tab, names the folder
  on its first line, and keeps Delete last past the heavier rule (2026-10-01, owner approved,
  review UI-15); and a mouse's right-click on a card, which opens the selection's panel at the
  pointer instead (review UX-11).
  Rows are ~44px, and **no row inverts to mark itself primary**.

- **A band on the edge of the screen pays the system's inset.** The app is served
  `viewport-fit=cover` and installed `standalone`, so on a phone it owns the strip behind the
  status bar and the one the gesture bar sits in — which is what lets `--paper` paint into both
  instead of leaving the system a band to guess our colour for. Every band that lands on an edge
  therefore carries `env(safe-area-inset-top)` or `-bottom`, and `env()` resolves to `0` where
  there is no inset, so it costs nothing anywhere else.
  **The trap is a full-screen layer**, because those are `inset: 0` and the padding belongs to the
  *band*, not to the layer — four were missing it, and two of those were layers whose other end
  already paid: the open note's bar of six marks and the Sorter's head sat under the clock, the
  picture viewer's Save row and its `2 / 5` counter sat under the gesture bar, and the phone's
  shelf drawer, which stands the full height, was short at both ends. `styles.test.ts` names every
  band and the edge it answers for.

**2026-10-08 — one wall (§8, owner approved).** *Was:* "No masonry. Uniform card heights,
deterministic grid." *Now:* the same, everywhere but the Inspiration board, which is columns of
uneven tiles — still edge to edge with no gutter, a `--rule` hairline on each tile's right and
bottom, ratios clamped 1:2–2:1 so no tile becomes a strip. *Why:* the reason for the rule was text
notes of uneven length turning the reading path to confetti; a picture's shape is its information
and a uniform card would crop it away. The tone, rule and type rules apply to a tile unchanged — a
selected tile inverts, and a photograph keeps its own tones — so the exception is one of geometry
and nothing else. Not a layout switch.

## Spacing

Added 2026-10-05 (review STD-01, owner approved). The style census of that review found 28 distinct
paddings and 10 gaps and no scale behind any of them; the scale in §8 is the census's most-used
values, with 13 named `--gutter` because the one side margin had drifted to 13, 15 and 19
(UI-A-09). The same review settled mono tracking — 843 counts and boxes were already untracked, so
the rule was written to match them and the 0.15/0.16em strays came to 0.1em (QA-11) — and replaced
the dialog's `rgba(0,0,0,.62)` with `--scrim`, the paper at the same alpha.

## The board row

**2026-10-13, review UX-08.** At 1280px with four folders the strip hid Todos, Links, Files and
All behind "3 more", against SPEC §6's "every board in one row, one click to any other". The
review blamed a 115px tab minimum; there was none (the 115px was Home's own content: mark, name,
count and 12px padding either side). The fix is in two steps: the tab names are tracked at
`--track-tab` 0.08em instead of 0.15em and the padding is 10px, and then, only if the strip still
overflows, the five built-in boards drop their names. Measured at 1280: 11 tabs, 1106px of 1106
available, no "more" cell; at 1024 it still scrolls, as a strip of that many boards must.

On a desktop it holds the tab strip: every board in one row, each one its mark, its name in the
display face at `--t-nav` in tracked capitals, and its count in the machine face at `--t-data`,
untracked. It scrolls sideways when there are more folders than fit, and masks to transparent at
whichever edge still has tabs past it, so the row never ends in a hard cut mid-word. A mouse wheel
over it scrolls it sideways, and while anything is out of sight a cell at its right end — the
count of boards past the edge and a step mark, in the machine face behind a `--rule` edge — brings
them into view, then turns round to offer the way back; it is what keeps All one click away
(2026-10-01, owner approved, review UX-04). Tabs are 12px either side of a 6px gap.

The strip is in two runs: the places (Inbox, the user's folders, Archive), then the lenses (Todos,
Links, Files, All), divided by one rule at `--rule` laid over Archive's own soft rule and followed
by a 10px band of empty ground — the division is said with space, and there is still one line
(2026-10-01, owner approved, review UX-16). Archive sits at the end of the places. Trash stands outside
the scroller entirely, beside search, as a mark and a count with no name — it is the one
destination that may never scroll out of reach.

**The lens run has its own ground (2026-10-08, owner approved).** The shelf already put a rule
between places and lenses, but every row on either side still looked alike, so Todos and All read
as boards someone had made. The owner asked for "a bit lighter background, not crazy much
different". Done as one new token, `--lens-ground` (`#18140f`, 1.08:1 against the ground), laid on
the lens tabs and rows and on Trash, which closes the run on both the strip and the drawer. It is a
band and not a box per tab: the tabs' own soft rules still run across it. It is kept well under
`--raised` (1.17:1 below it) and the selected tab's lamp, because the one thing it must never do is
look like "the board you are on". Selected, hover, pressed and carried states are unchanged and sit
on top of it — the band is written with `:where()` so it has no specificity of its own. The phone's
header row, which names one board, is unchanged. Tried and refused: a hairline box round the run
(a second line), and tinting the lens marks (colour belongs to a folder the user made).

**The board does not label where the ordering changes, and dividers across it are refused.** Period
rules — "today", "this week", "this month", "earlier", one full-width rule wherever the board's
edit-order crossed into the next — were built and withdrawn on sight. Reading the ordering out loud
sounds like a gain and is not: cards tile edge to edge with no gutters precisely so the screen is
*all note*, and cutting that wall into labelled sections spends rows on furniture and breaks the
one block of notes into pieces. They also cost the pinned row height the peek depends on. The
stamp in each card's footer already says when. This will be proposed again; that is the answer.

## The shelf, standing up

- **A row says nothing about what is inside the board.** A two-line preview of each board's top
  notes was built here and withdrawn: what you are looking for on this screen is a *name*, and every
  line that is not a name is a line to read past. The board is one tap away.
- The board you are on is raised one step and its text goes muted → full ink, the same two quiet
  signals the strip's own selected tab uses.
- The `+` row at the foot is the same shape as every row above it, and opens into a field in place.
- **On a phone the rows stand at the foot of the drawer**, where the thumb is, in the same order;
  a shelf taller than the screen starts at the top and scrolls (2026-10-01, owner approved, review
  UX-17).

**2026-10-08 — the line moved by one board** (owner approved). The strip's one hairline used to
fall where the lenses began. It now falls before **Inspiration**, the first of the app's own
boards, and the `--lens-ground` band starts there; Inspiration is a place that stands on the band,
not tinted (§2b) and with a hand-drawn mark of its own (§7). The rule is still one line and still
said with space, so nothing here adds a second.

## The Sorter

- The note is set exactly as it is read anywhere else — body face, `--t-read`, `--lh-read` — in
  the open note's own centred column (`calc(33 * var(--t-read))`), and scrolls if it is long. A note
  whose end you cannot see is a note you cannot place. *(2026-10-01, review UI-14.)*
- **A swipe carries the card, and its words are tone and a hairline, never colour.** The note leans
  a few degrees about its foot and follows the finger; **Keep** or **Delete** comes up in the corner
  it is leaving towards, in ink on the ground in a 1px `--ink` box, from nothing to whole at the
  line where letting go decides. The only edge a carried card has is a `--rule` hairline — this
  system has no shadow. *(2026-10-01, review UX-08.)*
- **Something that cannot be pressed is drawn in a tone the ramp has.** A mark takes `--rule`, a row
  of words steps from ink to `--muted`; neither is ever a fraction of a tone (`opacity`), which
  computes to a grey the palette does not contain. *(2026-10-01, review UI-18.)*
- **Destinations are targets before they are words:** 44px, the name in the display face because a
  folder is a named place, the count in the machine face because it is data. They are separated by
  1px of `--rule-soft` showing through, the same hairline grid the cards use.
- **Skip sits in the head band beside the count, muted.** It is navigation, not a destination, so
  it is not among the destinations: at the foot it was the full-width row at the very bottom of a
  phone — which is *nearest* the thumb, not furthest — with Delete the full-width row directly above
  it, and a thumb aiming at Skip that landed high deleted (2026-09-04 audit). Nothing at the foot
  should be easier to hit than a folder, and nothing sits past Delete now.
- The capture bar is **not drawn at all** while this runs, and the undo mark stands at the top of
  the note, floated so the words run round it — the foot is all destinations, and the head band
  has no room on a phone. *(2026-10-01, review UX-01: floated over the band it covered the ✕.)*

## 9. The cut fade

A cut card's last line fades out rather than stopping mid-word — but **only that line, and only
left to right.** This replaced a vertical version and is the one place in the system where a
design decision changed for a reason that had nothing to do with the ramp move to black; it was
wrong before, and the move just made it obvious.

**Why the old vertical fade was answering the wrong question.** It dimmed the entire final line
box, uniformly, from top to bottom, then cut it off at the same height every line above it was
already ending at. That reads as *one darker line sitting above a hard edge*, not as *text
running on past the edge*. A line of prose doesn't get dimmer as it's read — it runs out of room,
and that happens on the right, where reading stops. The eye already expects a trailing sentence to
fade at its own end. A vertical fade said something true about the wrong axis.

**The fix fades left to right, on the last line only.** Every line above it stays at full ink,
because only the last one is unfinished. Legible where reading isn't interrupted, gone by the
edge the text is actually cut off at.

**It is an overlay, not a mask, on purpose.** A mask changes the *text's own alpha* — which is what
made the old version read as "dimmer" rather than "ending". The fade is instead an opaque overlay
painted in the surface's own colour, sitting in front of the text: letters vanish behind the
surface exactly the way they would if the card were narrower, which is the effect a trailing edge
is supposed to have.

**`--cut-bg` is what makes this survive a card's own state changes, and it must never be a
literal.** The surface a cut card fades into isn't always the same colour: at rest it is
`var(--card)`; selected, the card inverts to `var(--invert)`, and the fade has to
follow it there or the old surface colour is left sitting on top of the new one as a visible
patch — a seam exactly where the fade used to just work, because the old version was alpha and
alpha survives anything painted under it for free. An overlay does not get that for free; it has
to be told. So every state that inverts a card also sets `--cut-bg` to match, and the fallback
resolves to `--card` everywhere else. `styles.test.ts` enforces both halves: `--cut-bg` may only
ever be assigned `var(--card)` or `var(--invert)`, and the gradient must fall back to `--card`
rather than a hardcoded value.

Two conditions on that, each of them a bug the first version shipped. **The dim
applies only where a matched word is actually drawn**, not merely because a query
is running: a note can match on an attachment's filename, or on a word that lives
inside a URL the card's face strips, and dimming the whole of such a card leaves
every word a step down the ramp with nothing at full ink to have earned it. The
face carries `data-dim` on the container that holds the hits, and the stylesheet
keys on that rather than on the search. **And a card that starts partway into a
note is a cut card**, so it says so with the cut mark and the fade the same way a
card cut at the bottom does — the lines wound past are hidden lines like any
other, and a fragment presented as a whole note is the one thing the mark exists
to prevent. On the inverted slab of a selected card neither step
applies: `--paper` is the bottom of the ramp and there is nothing below it to
emphasise with, so every word on that card is `--paper` and the hit is as legible
as its neighbours rather than more so.

## 10. Motion

- **Nothing moves at a constant rate. A `linear` timing function is allowed only for a picture of
  a constant rate** — never for a move, and a fade is a move. This was asked for outright, after
  `lib/motion.ts` had spent a while exporting a `LINEAR` for the two fades in the open note on the
  argument that a wash of opacity has no destination to arrive on. It does not any more: an
  arrival takes `ENTER`, a departure takes `EXIT`, and that includes every fade in the app.
  Exactly three things are pictures of a constant rate and stay linear — **the undo countdown**,
  which is a clock and would be lying if it hurried; **the sync mark's flowing stream**; and **the
  spinner's falling sand**, both loops, and a loop that eases pulses. Each is a literal in
  `styles.css` named one at a time in `styles.test.ts`'s allowlist, so a fourth has to be argued
  for rather than picked up by habit.
- **The undo countdown** is **the offer's own border being drawn on**, clockwise from the top, over
  the eight seconds — empty at 0%, a complete rule at 100%, and then the offer goes. The strip it
  used to drain along the top of is gone with it: what happened ("Archived 3") is announced and
  is on the hover, and on screen is the button you would press — with one word, the verb, for
  its first 2.5 seconds, and then the arrow alone.

## 11. Voice & copy

**2026-10-13, owner approved, review UI-01: every control is words, not tracked capitals.** The
review counted 24 tracked uppercase runs on one phone screen and no control in sentence case: the
best-known look of an AI-made dark app, and every button sounding the same. The owner asked for
what good apps do, so first the notes in `look-notes.md` (Things, Bear, Apple Notes, Linear, iA
Writer; thin public sources, and none states casing outright): a control is one or two words in
the reading size, sentence case, no tracking; capitals stay for overlines and data. So buttons,
menu and panel rows, dialog buttons, Settings' navigation and segments, Leave, Archive on the
Ticker and the insert panel are `--body` at `--t-text`, one grouped rule beside `.mono` in the
foundation stylesheet. The machine's mono capitals stay for counts, stamps, key caps and state
words ("offline", "1 selected"). A board's name stays Marcellus capitals. **Settings (UI-05) the
same day:** Theme became words like Motion, the repeated "Settings" group label went, the
remaining group labels took the headings' voice, and About lost its outside-link arrow.

- **Empty is an invitation, not a mood.** The name of the place in Marcellus at `--t-name`, one
  line of body italic under it, and above them the mascot — a small machine asleep, because
  nothing has been written here yet (`components/Mascot.tsx`, and see §1). Still no exclamation
  mark, and **the words did not change to make room for it**: the drawing joined the copy that was
  already there rather than replacing it with a mood. It is the app's only illustration and this is
  its only home — not on a search that found nothing, which is a mode rather than a place, and not
  while a board is still loading, where it would read as the thing you are waiting for.
  **It stands in the middle of the room it has** (2026-09-29, the owner's ask): centred between
  the board strip and the capture bar, on a phone and on a desktop, where it used to hang from the
  strip with the screen dark underneath. Centred by auto margins and never by alignment, so a
  screen too short for it — a phone on its side, a keyboard up — gets it top-aligned and
  scrollable rather than cut off above the strip.
- **An empty Inbox's offers finish its sentence, so they are said in its voice** (2026-09-29).
  "Import from Google Keep", and in the demo "Try it with sample notes" above it, were muted mono
  caps in hairline boxes, and the owner found them cheap — rightly: that face is the machine
  reporting, and these are the invitation the italic line makes, answered. They are set in
  `--body` at `--t-text`, upright, in sentence case, each with the mark the same action wears
  elsewhere, stacked a thumb tall and reaching into the paragraph's side padding, each label on
  one line beside its mark rather than centred and broken in two (2026-10-01, owner approved,
  review UI-19). The first step is one step up the
  ramp — a `--muted` edge and `--ink` words against the second's `--rule` and `--muted` — and
  that is the whole hierarchy: no fill, no weight, no colour. They raise under the pointer and
  invert when pressed, like every other piece of furniture. This is not a licence for sentence-case
  buttons elsewhere; a label on a bar is still the machine's.

## 12. Assets

**App icon** (`web/public/icon.svg`) — the mascot, idle, in the ramp's own tones: paper ground,
`--muted` shell and legs, `--raised` screen, `--ink` face. It reads at 48px where a wordmark would
not, and it is the same creature the header draws, so the thing on the home screen is the thing
that answers when the app opens. Everything drawn sits inside the maskable safe circle. *(This
paragraph described "three traces of unequal length" — the name drawn as marks — for some time
after the icon became the mascot; corrected 2026-09-17.)*

*2026-10-13 (review CH-03):* the icon became the note card with the header. The card on its legs
reaches outside the maskable circle at full size, so the icon draws it at .95, moved to the
smallest circle round it. The PNGs and `og.png` were redrawn from the same geometry.

*2026-10-14:* the robot came back, and the icon, its PNGs and `og.png` with it.

## 14. What changed from v1.0, and why

v1.0 of this file described a light-and-dark "printing plate" direction in verdigris and warm
bone, with a grain texture, a Swedish grotesque for names, and an ultramarine link. **The owner
rejected it: it read as boilerplate, the green was cold, and it had replaced a black background
they liked.** This version is built from that feedback.

| v1.0 | Now | Why |
|---|---|---|
| Verdigris plate, light + dark | Warm near-black, **dark only** | The green was cold and unwanted, and the light scheme was carrying design decisions that only make sense on a light ground |
| Ultramarine link | The top of the ramp, plus an underline | No colour anywhere. Emphasis is tonal or it does not happen |
| A grain texture on plate surfaces | Removed entirely | Read as an effect rather than as material |
| Familjen Grotesk for names | **Marcellus**, restored | The owner's own face, and it was never the problem |
| IBM Plex Mono | **Kept** | The one part of the v1.0 typography worth keeping: the machine voice was a system stack rendering differently on every device |
| A 3px rail under the selected board tab | Removed | The raised fill and ink text already say it. One thing too many |
| The open note as a card-coloured sheet | Reverted to the ground | It was a fix for a grain problem that no longer exists |
| Code blocks and previews on the plate | Reverted to card | Same |
| White alphas inside inverted panels | `--on-ink-rule` / `--on-ink-wash` | Pre-existing bug, exposed by going dark-only: an inverted surface is a bone slab, so white dividers on it drew nothing |
| Dialog scrim at 0.38 black | 0.62 | 0.38 was tuned for a light ground and did almost nothing over near-black |
| Cards lifted 1.08:1 off the ground | **Flush — `--card` *is* the ground** | Every step of lift is the app asserting itself in front of a few hundred notes, and the rules already do the separating |
| Inverting to full `--ink` | **`--invert` `#bfb4a2`** | A selected card was a 206px block of near-cream on a black screen. 1.41× dimmer, still 9.66:1 against the ground |
| `--rule-faint` at `#1e1913` | `#241e17` | 1.13:1 on the black — the canvas graph paper was not there at all |
| The quiet drawing pencil on `--rule-soft` | `--rule` | A pencil you cannot see is not a quiet pencil, it is a broken one |
| Selected-card text at `opacity: 0.85` | 0.9 | The fill beneath it is dimmer now, so the same transparency was costing legibility rather than taking the edge off |
| The cut fade dimmed the last line top to bottom | **Fades left to right, and only that line** (§9) | Prose doesn't dim as it's read, it runs out of room — that happens on the right. Rebuilt as an overlay in `--cut-bg` rather than a mask, so it can follow a card into `--invert` |
| The panels (menu, selection verbs, Move, reminder, insert) as inverted slabs | **The ground with a `--rule` edge, rows in `--ink`** (§5) | A bone block in the corner of a black screen was the brightest thing in sight and its rows were hard to read for it. A panel is a list of verbs — furniture — so it raises rather than inverts, and the `--on-ink-*` tokens are left with no user |

| A horizontal tab strip for the boards (a drawer for it on a phone) | **Unchanged.** A full-screen Shelf page with a two-line preview of each board's contents replaced both, and is withdrawn | A wide window already holds the whole strip, so a page over it is a detour; and the preview turned a shelf you scan for a name into a wall of half-sentences |
| The board you are on is a raised tab among tabs | Unchanged on a desktop; **on a phone** the header row is the board you are on, with no fill at rest | Alone in a row there is nothing to contrast against, and a raised slab across the top of the screen for an undisputed fact is furniture |
| Every board wears the folder mark, in `--muted` | A folder **the user made** may take any mark from the icon set and one of eight tints (§2b) | Hue is recognised faster than a word can be read, and a folder is a name the user chose rather than a state the app is reporting. Granted on terms that add no step to the ramp: every tint is `--muted`'s own brightness or `--rule`'s |
| The undo offer is a full-width strip with a draining rule and its own words | **The undo arrow, saying its verb ("Deleted") for its first 2.5s**, its border drawn on clockwise over the window, standing **in** a screen's furniture — a cell of the capture bar, the top of the Sorter's note — never floating over the board | Two of the strip's three parts were furniture; what is left is the thing you would press, with the clock as its own edge. The bare arrow read as "back" on a phone, and floating, it covered cards and controls (2026-10-01, owner approved, review UX-01/02/09) |
| A filed note on Recent: dashed rules, body at `--muted` | Full ink, and the folder's mark in the footer | The app was dimming the user's own words to report a fact about filing |
| Nine tick boxes, one line each, ellipsised | An item may wrap; the card shows fewer, whole ones | Nine fragments you cannot read is worse than four you can |
| The open note set as a document: headings at `--t-name` with air above, lists on `--lh-item` with gaps and a numbered column, code in mono in a ruled box, bold and italic in their own cuts, marks hidden | **One line grid** (§4, §8): marks drawn in `--muted`, headings and bold by stroke, italic slanted from the regular cut, code in the reading face beside a margin hairline, grip and Copy in the margin | Tapping from reading into editing reflowed the whole note. The owner chose to fix it on 2026-09-17: the layout must never shift under an ordinary action |

Nothing in the **data model, motion language or grid geometry** has changed in any revision — the
grid row is still pinned at `--card-h`, and the period dividers that would have un-pinned it were
withdrawn (§8). **Card-face logic** is the one exception, from the board and card handoff above:
the face now steps a Keep-import tag line down the ramp, charges a blank line half a line box, and
lets a checklist item wrap rather than ellipsising it — none of which touch the data model, the
gesture budget, or the cut fade's own mechanics. The **gesture budget** has not changed, with one bounded
addition: inside the Sorter, and only there, a horizontal swipe steps through the pile (`SPEC.md`
§6, §12c).

## 15. Borrowed on purpose — the conventions, and whether their reasons are written

*Added 2026-09-17, step 6 of a design-theory review.* The critique that review
answers is aimed at one habit: copying a convention because it works somewhere else, without
knowing why. Dark, monochrome, hairline interfaces are a fashion as this is written, so the
*reasons* are the only thing separating this design from that fashion. Most of this file is
reasons; this table is the audit of the conventions that were not.

Four kinds of answer, and each is labelled honestly:

- **Argued** — a reason specific to this app is already written, and where.
- **Now argued** — no reason was written; the one below was written on 2026-09-17 against
  `SPEC.md` §1–2 and §1 above. **The owner should confirm or replace it**; until then it is a
  proposal, not history.
- **Preference** — the owner chose it. Legitimate, and said out loud rather than dressed up.
- **Open** — no honest reason was found. It may be habit, and it is a question.

| Convention | Status | Reason |
|---|---|---|
| Bottom-anchored capture bar | Argued | No dead zone over the notes, and a thumb's reach on Android — Keep's FAB was a named failure (`SPEC.md` §1, §5) |
| Stamps that count ("3d") | Argued | A date makes the reader subtract today (§11, `SPEC.md` §5) |
| Ctrl+K for search | Argued, and named as copied | Search is revealed, not resident, so it needs a key; K because it is the key every app now uses (`lib/hotkeys.ts`) — copying for recognition, said as such |
| Undo offered after every removal | Argued | Nothing is destroyed by accident (`SPEC.md` §2.4) |
| The undo window is 8 seconds | **Open** | `UNDO_MS = 8000` carries no reason anywhere. Long enough to reach for, short enough to go — but nobody measured either |
| Warm greyscale | Argued | One material lit at nine strengths, not grey with a tint (§2) |
| A dark ground, and no light mode | **Preference** | The owner rejected v1.0 partly because it "had replaced a black background they liked" (§14). What follows from it is argued — on a dark ground the words are literally the brightest thing, which is the thesis — but the choice came first and was taste |
| Marcellus, Libre Baskerville, IBM Plex Mono | **Preference**, with reasons after | The owner picked the pair (`SPEC.md` §12); Plex was kept from v1.0. Baskerville is a reading serif for long prose and the layout is calibrated to it; self-hosting is argued (§4). None of that is why these three and not others |
| The burger mark (menu, shelf) | **Now argued** | Everything except writing and finding lives behind one mark, and three bars is the one mark a phone user already reads as *the rest is in here*. That is copying for recognition — the same honest reason Ctrl+K has — and it is the right trade for a control whose whole job is to be found |
| The drawer, from the left | Argued, once the burger is | The shelf is a line and the drawer hangs off its near end: a rightward swipe standing on the Inbox opens it. That, not "the burger is on the left", is the reason |
| A grid of equal cards, not a list | **Now argued** | The job is scanning a few hundred mostly short notes for one (§1). Columns of equal cards put roughly twice as many *different* notes on a phone screen as a list of the same text size, and the uniform height keeps the reading path Keep's masonry broke (`SPEC.md` §1). The Links board is a list because a link is read by its name, and that exception is argued — and one wall, argued in the 2026-10-08 Inspiration spec: a picture's shape is the information. If this reason does not hold for the owner, the honest answer is that the grid came from Keep |
| Long-press to select | **Now argued** | Tap already opens and a horizontal swipe already pages, so a hold is the only gesture left on a card — and it is the one that can continue into a merge drag, which a checkbox mode could not |
| Right-click to select, on a desktop | **Now argued** | It is the desktop's own hold: a mouse has no long press worth waiting for, and right-click is where a desktop user already looks for "do something to this" |
| Swipe between boards | **Now argued** | On a 390px screen the row holds three tabs, and a one-handed thumb cannot reach the top of the screen to pick the next; the swipe is the shelf walked where the thumb already is |
| No pull-to-refresh | **Now argued** | There is nothing to refresh: the notes are local and sync runs by itself, on a timer and every time the app comes to the front. A pull would promise work the app never needs to be asked for |
| Heroicons | **Open**, likely habit | Nothing records why this set. What fits after the fact is that it ships matching outline and solid drawings, which is exactly the "outline rests, solid is on" grammar of §7 — but its round caps needed an exception to the hard-edged chrome, so it was not chosen *for* the design. Worth knowing the next time a mark is missing from it |
| Sentence case | **Now argued** | Capitals already belong to two voices — a place's name in Marcellus and the machine in mono. Title Case on a button would spend capitals on chrome and blur which voice is speaking |
| Uppercase mono for machine strings | Argued | "The machine speaking, the only thing allowed to shout" (§11) |
| Back is an arrow; stepping to the next file is a chevron | **Open**, a contradiction | `Icons.tsx` says an arrow means *move this thing* and a chevron means *the thing beside this one* — and Back is an arrow while nothing moves. Either Back becomes a chevron or the rule is restated; that is the owner's call |
| The ✕ to close | Argued in place, not in glyph | One mark that clears and then closes (search); the glyph is the universal one and needs no more |
| The mascot | **Preference**, placements argued | See §1, "Where it lives" |
| The name and the icon | Argued | *spår* is a trace (§1); the icon is the creature that answers when the app opens (§12) |

Two things came out of this audit that were not reasons but errors in this file, and both are
fixed above: §1 said the one drawing lived only on an empty board, and §12 described an icon the
app no longer has. A document that is the source of truth has to be re-read against the app, not
only written.
