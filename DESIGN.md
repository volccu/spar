# spår — Design System & Brand Guideline

**Direction: DARKROOM**

Version 2.0 · Supersedes `SPEC.md` §5 on colour and typography.

---

## 0. How to use this file

This is the **absolute source of truth** for the visual layer of spår. If this file and any
other document, comment, or existing line of CSS disagree about a tone, a typeface, a size, a
rule weight, or what a state looks like — **this file wins, and the other one is a bug.**

(The CSS this file names as `styles.css` lives in the area files under `web/src/styles/`, behind
the one entry `web/src/styles.css`.)

Precedence, highest first:

1. **The hard invariants** — those are about *data and behaviour* (`raw_content` is
   immutable, the rendered note equals the stored note, the gesture budget, the outbox rule).
   They are load-bearing and test-enforced. Never trade one away for an aesthetic.
2. **This file** — everything about how the app *looks*.
3. **`SPEC.md` §5** — still correct on *layout, grid geometry, card faces and motion*. Its colour
   and typography paragraphs are superseded here. Anything rejected by name in `SPEC.md` or in
   `docs/decisions/` stays rejected.

Three rules for anyone extending this system:

- **Every value comes from a token.** If you are typing a hex code, a font stack, a size, an
  easing or a duration into a component, you are doing it wrong.
- **The scale has no spare slots.** Nine tones, six type sizes, three icon sizes, two rule
  weights, two motion curves, one spacing scale (§8). Needing one more is a design failure, not a
  token shortage.
- **There is no colour.** Not an accent, not a link, not an error, not a hue for state. If you
  want emphasis, move a step along the ramp or change a rule weight. That is the entire kit.
  There is **exactly one** exception, written down in §2b: a folder *the user made* may be tinted.
  Read §2b before adding a hue anywhere; if what you are colouring is a state, an error, a link or
  anything the app is reporting, the answer is still no.

How each rule here came about — the dated stories, what was tried and withdrawn — is in
`docs/decisions/design.md`, under the same section names.

---

## 1. The brand

**spår** — Swedish for *trace*, *track*, *the mark something left behind*.

**What the app is.** One person's archive of a few hundred notes. Dense prose, saved links,
lists, photographs, PDFs. No teams, no sharing, no onboarding. Opened dozens of times a day,
usually to *find* something, sometimes to *put something down before it is lost*.

**The one-sentence thesis.**

> A dark room with one light in it, and the light is what you wrote.

**What that buys.** The app has no colour and its ground is dark, so it cannot compete with its own
contents. (A device may choose the light ramp instead, §2 — the same room with the paper turned
over, and every rule below holds in it.) The brightest thing on any screen is always the user's words; the second brightest is
the one address inside them. Everything else — every bar, tab, rule, panel and control — lives
in the bottom fifth of the ramp and is legible without ever being loud.

**Adjectives, in order.** Precise · warm · unlit · exact · unfashionable.

**Anti-brief.** Not friendly, not playful, not "productivity" — with one owner-made exception: the
creature may be playful in how it *moves* while it tells you something useful (2026-10-16, §1
"It speaks"), and its words carry one small sound in the Small Machine voice the owner picked
(2026-10-19, §1 "It speaks"). Nothing else the app writes is playful. No colour, no gradients, no
shadows, no rounded corners (one exception: the key cap, §6), no emoji in chrome, no light theme by default (it is a device's
choice, §2), no motivational empty states. It does not celebrate you for capturing a note.

**The one drawing** is the mascot (`components/Mascot.tsx`). The anti-brief refuses *decoration
standing in for content*; an empty board has no notes to apologise for, so exactly one drawing
exists, and it obeys the rest of the anti-brief — one warm greyscale, no hue, no shadow, silent
under `prefers-reduced-motion`. *Why a creature at all* was the owner's taste; the rules below say
where it may go, not why it exists.

**Where it lives — four homes, and a fifth is a new argument:** **the header**, where the creature
*is* how sync is drawn; **the app icon** (§12); **the empty board**; and **the About page**, beside
the wordmark at the head of the page while the page covers the header. It is never drawn per card
or per row, never inside the grid of notes, and never on a search that found nothing.

**One creature, and only ever one on screen.** The header is where it lives; while the empty board
draws it, the header's is *away*: it goes in a small puff of smoke, the sleeping one is simply
there, and when the board fills, or you leave it, the header's comes home out of another puff. No
two clouds are alike — the puffs billow out of the creature's middle, swell, drift and thin each in
its own way — but every one is one cloud in the drawing's own two tones and nothing more: the
shell's line round the outside, the screen's tone inside. It is over in about half a second
(`POOF_MIN_MS`–`POOF_MS`, `lib/motion.ts`).
Under `prefers-reduced-motion` there is no smoke: the swap is simply made. The header keeps its
box while the creature is away, so the row never moves, and nothing is left there to reach.

**It speaks** (2026-10-16, owner approved — option B of the mockups). **The wordmark is gone from
the header**: the creature is the app's identity, and where the name stood it says, in a speech
bubble, the one thing worth saying right now — what you just did with Undo beside it ("Deleted 1
note · Undo"), where a capture went ("Tucked into Inbox · Go"), "Uh-oh. Didn't sync · Details",
"Ooh. A new version is ready · Reload", the connection going and coming back, a link being written
that you already saved ("Hm. You saved this 3 days ago · Open"), a reminder about to ring ("Ding. In
5 minutes: Call the dentist · Open", once, a few minutes ahead, while the app is open), and, when
poked, how sync stands ("Beep. All synced · 2 minutes ago", "Zzz…" in place of "Beep." late at night); a double tap syncs now, the creature walking while it does. The bubble is part of the drawing — the creature's two tones, its
boiling line, its curves, one outline round the bubble and its tail — and grows out of its mouth
by clip. **The words are not part of the
drawing:** the reading face at `--t-text`, flat, still, at most one verb, which is a real button
set like every other control. **The voice is Small Machine** (owner's pick of ten, 2026-10-19): at
most one small sound per line (Poof., Hm., Beep., Whirr., Ding., Ooh., Uh-oh., Zzz…, Done.), the
facts as plain as ever, never "Uh-oh" when things went well, the action words never changed; a
delete offered back says "Poof.", every other undo offer is plain. The character is in the motion only: it turns its
eyes and leans its antenna to the bubble, and asking (an undo) it rounds its mouth and lifts one
question mark. It never nods for it — the nod stays a capture's receipt. On an empty board it comes
up from its sleep to say it, and its place there is kept. On a short screen, where the header folds
away, the undo and the receipt stay on the capture bar instead.

**The nod is a receipt, not a reward.** When a note lands, the creature dips once, seven tenths of
a second, and goes back to whatever it was doing. No words, no mark, no count, no sound, and under
`prefers-reduced-motion` no nod at all, with nothing owed in its place. "It does not celebrate you"
still stands: the day the nod grows a message, a streak, or a second move, it has crossed the line.

**Three small answers, owner-chosen 2026-10-14 (joy review), and no more.** While you type in the
write box it **taps along**: each key a small bob on a spring, never deeper than the nod, the legs
taking exactly the body's drop, the antenna flicking, the eyes glancing down at the words.
**Poked asleep, it opens one eye**, looks at you, and goes back to sleep with a fresh Z. And on a
board **you have just emptied yourself**, it arrives awake and dims to sleep after about a second;
on a board that was already empty it is simply asleep. All three are silent, wordless, and gone
under `prefers-reduced-motion`.

**The pulse** is the nod's twin for the hand: one 12ms vibration (`lib/haptics.ts`), on a phone
that has a motor and nowhere else, when a note lands, when a tick box is ticked, when a board
is picked up off the shelf to be carried (`lib/useBoardPress.ts`) — letting go says nothing — and
when a note dragged in Tidy up crosses the line where letting go decides (2026-10-14). One
pulse, never a pattern, no count, nothing else in the app vibrates. **It is on trial**, behind a
per-device switch in Settings: if it is turned off and stays off, take it out rather than
leaving a dead switch behind.

**The colophon.** The About page (`components/About.tsx`, from Settings) is the one screen that
says what the app does with a note — the original kept, the trash's thirty days, nothing read by
anyone. It is a book's colophon, not a settings page: the reading face at the reading size on the
note's measure, section names in Marcellus. It is the natural home for any future *fact about the
app*, and the wrong home for a preference, so **it holds no switch** — its two moved to Settings
with the export, the account and the device's numbers (2026-10-11, owner approved). The list of
keys is such a fact, and it is drawn in the page's voices rather than as a cheat sheet: what a key
does in the reading face, the key in the same hairline box every shortcut hint in the app wears,
and nothing on a device with no keyboard.

**Settings** (`components/Settings.tsx`; the cog at the header's far right since 2026-10-12, the menu's first row only while the header is folded, Ctrl/Cmd+comma; 2026-10-11, owner
approved) is where every preference lives, and the way in and out of the notes: the Keep import,
a spår download, the export, the account, the device's build, counts and measured speeds. Its shape
is a settings screen's, the owner's reference: sections down the left under a search field, the
section's rows on the right — the words on the left in the reading face, the control on the right
— and on a phone the sections are a list a tap goes into. It is chrome: the section you are in
and the answer in force are **raised**, never inverted; answers are side-by-side segments in words
(Theme as plainly as Motion: System, Light, Dark), in the reading face; the sections' own group
names (Your notes, Account) are set like the blocks' headings, Marcellus capitals, and the first
group has none because the title already says Settings; the About row is a page inside the app and
carries no outside-link arrow; nothing is coloured. **Every setting is this device's** (`lib/settings.ts`,
localStorage, never synced — the owner's choice, so no setting needs a column), and every change
is made on the press, with no Save. A new setting is a row here; it is never a row on About, in a
menu, or on a board.

---

## 2. The ramp

**This is the whole design.** Nine tones on one warm greyscale. There is nothing else — no
accent, no second family, no texture, no ornament. The discipline *is* the identity: get these
nine exactly right and add nothing.

| # | Token | Value | HSL | Luminance | Job |
|---|---|---|---|---|---|
| 1 | `--paper` | `#0c0a08` | 30° 20% 4% | 0.0031 | The ground. Bars, board strip, under the grid, sheets, the canvas |
| 1 | `--card` | `#0c0a08` | 30° 20% 4% | 0.0031 | A note — **the same value as the ground**, see below |
| 2 | `--rule-faint` | `#241e17` | 33° 22% 12% | 0.0148 | The spatial canvas grid, and nothing else |
| 3 | `--raised` | `#29221a` | 32° 22% 13% | 0.0169 | Chrome, engaged |
| 4 | `--rule-soft` | `#2d251c` | 32° 23% 14% | 0.0196 | A division *inside* one thing |
| 5 | `--rule` | `#423830` | 27° 16% 22% | 0.0420 | The *edge* of a thing |
| 6 | `--invert` | `#bfb4a2` | 35° 18% 69% | 0.4633 | The fill a **content** surface takes when it is on |
| 7 | `--muted` | `#948b7d` | 37° 10% 54% | 0.2624 | Secondary text |
| 8 | `--ink` | `#ded5c6` | 38° 27% 82% | 0.6720 | The user's words |
| 9 | `--signal` | `#fff8e8` | 42° 100% 95% | 0.9422 | A live address, and nothing else |

Plus three values that only exist *on top of* an inverted surface — see §5 — and the one that
darkens the room behind a dialog.

| Token | Value | Job |
|---|---|---|
| `--signal-ink` | `#0c0a08` | Text on the signal when it becomes a fill (a hovered link) |
| `--on-ink-rule` | `rgba(12,10,8,0.24)` | A divider drawn on an inverted slab |
| `--on-ink-wash` | `rgba(12,10,8,0.1)` | A hover wash on an inverted slab |
| `--lens-ground` | `#18140f` | The faint ground under the app's own boards (Inspiration, Todos, Links, Files, All, and Trash) on the strip and in the drawer — lighter than the paper by 1.08:1, under `--raised` at 1.17, used for nothing else *(2026-10-08, owner approved)* |
| `--scrim` | `rgba(12,10,8,0.62)` | The backdrop behind a blocking dialog — the paper itself, so the dark is the room's own *(2026-10-05, owner approved, review STD-01)* |

### `--card` is the ground, and that is the design

`--card` and `--paper` hold **the same value**. A card has no fill at all: it is defined entirely
by its two rules, so the board is not a tray of tiles but a lattice of hairlines drawn straight
onto the black. The only things with any brightness on the whole screen are the words.

A lift of any size is the app asserting itself in front of a few hundred notes, and the rules
already do the separating at 1.73:1.

**Keep the two tokens separate even though the values match.** `--card` still means *a surface
holding the user's words*, which is a different statement from *the ground*, and it is what every
sheet-like surface in the stylesheet is asking for. It is also the single line to change if a
future revision ever wants the sheets lifted off the ground again. Do not collapse them.

One consequence to watch: **anything that used to rely on `--card` standing out against `--paper`
now needs its own edge.** Every such surface in the app already draws a border; the one that did
not — the lightbox close button, which sits over a photograph — now takes `--raised` plus a rule.

### Why warm, and why these

**The ground is warm near-black, not neutral charcoal.** `#0c0a08` is black with a trace of
amber in it. That single decision is what lets all nine tones read as *one material lit at
different strengths* rather than as grey with a tint applied on top. Hue holds between 27° and
42° the whole way up.

**Saturation is not constant, and should not be.** It is heaviest in the shadows (20–23%), thins
right down through the mid tones — `--muted` sits at 10%, because at that lightness a warm cast
stops reading as warmth and starts reading as a colour cast on small text — and comes back in
the highlight. This is how warm greyscales behave in print and in film, and flattening it makes
the ramp look synthetic.

### `opacity` is not a step along the ramp

**A tone is one of the nine, and a fraction of one is not.** Writing `opacity: 0.5` on an element
whose colour is a ramp token mixes a value at paint time that this palette does not contain — and
it does it invisibly, because `styles.test.ts`'s "no colour outside the token block" check reads
hex, and there is no hex to read. It is the one way a tenth tone can get in without anyone typing
one.

It is also the way small text quietly stops being legible: board counts at half-strength `--muted`
computed to **2.26:1** against the 4.5 floor. A count quieter than its name is `--muted` under
`--ink`, already in the machine face at the smallest size.

So: **a thing that should be quieter takes the next tone down, or a lighter rule, and never a
fraction of the tone it has.** `styles.test.ts` holds the counts to that. The four alpha values in
the table above are the exception and the only one: three exist *because* an inverted slab needs
darkening rather than lightening, and `--scrim` because a dialog must darken everything behind it;
each is the paper with the alpha baked in, declared as a token and named — a fifth is a new
argument.

**`--ink` stops short of white on purpose.** Pure white on near-black halates, and this app is
15,000-character walls of prose. Stopping at 0.672 luminance also leaves headroom above the body
text, which is the only reason a signal can exist at all without a hue.

### Verified contrast

Measured, not estimated (WCAG 2.1 relative luminance). Any change to the ramp must re-run these.

| Pair | Ratio | Floor |
|---|---|---|
| `--ink` on the ground — body text | **13.59** | 7.0 |
| `--ink` on `--raised` — engaged chrome | **10.79** | 7.0 |
| `--muted` on the ground — footers, board names | **5.88** | 4.5 |
| `--muted` on `--raised` | **4.67** | 4.5 |
| `--signal` on the ground — links | **18.68** | 4.5 |
| `--paper` on `--invert` — text on an inverted slab | **9.66** | 7.0 |
| `--rule` against the ground — a card's edge | 1.73 | — |
| `--rule-soft` against the ground — an internal hairline | 1.31 | — |
| `--rule-faint` against the ground — the canvas grid | 1.20 | — |
| `--raised` against the ground — engaged chrome | 1.26 | — |
| `--lens-ground` against the ground — the lens run | 1.08 | — |
| `--muted` on `--lens-ground` — a lens's name and count | **5.45** | 4.5 |
| `--invert` against the ground — a selected card | 9.66 | — |

**A faint ratio does not survive being moved onto a dark ground.** The eye picks up small
*darkenings* of a bright surface easily; lifting near-black by the same proportion is invisible.
Two values in this system were carried over from the light design and had to be re-found on the
black — `--rule-faint`, whose whole job is making canvas movement visible while dragging, and the
quiet drawing pencil, which is `--rule`, never `--rule-soft`. If you port any other "subtle" value from a light context, re-check it by
eye, not by keeping the ratio.

**`--muted` is the tone that fails first.** If you move anything, check it before anything else.

### The light ramp — the device's choice

**Dark is the ground; a light ramp exists as the device's choice** *(2026-10-11, owner approved)*.
Settings offers System, Light and Dark; Dark is the default, and System is light only when the
device says so. The choice is the device's, never synced (`lib/settings.ts`).

It is **the same ramp turned over, not a white theme beside it**. The paper is the lightest tone
and every step goes *toward the words*, so every move the dark ramp makes upward this one makes
downward: raised chrome is a shade darker than the paper, an inverted card is a dark slab with paper
type, and **the signal's headroom is below the ink** — the ink stops short of black so a live
address can be darker and warmer than the words round it, by the same 1.37:1. Hue holds 28°–40°;
saturation is heaviest at the paper and the signal and thinnest at `--muted`, as on the dark side.

| Token | Dark | Light | Light on the paper |
|---|---|---|---|
| `--paper` / `--card` | `#0c0a08` | `#f3efe7` | — |
| `--lens-ground` | `#18140f` | `#eee9e2` | 1.05 |
| `--rule-faint` | `#241e17` | `#e9e3db` | 1.11 |
| `--raised` | `#29221a` | `#e6dfd7` | 1.15 |
| `--rule-soft` | `#2d251c` | `#e1d9d1` | 1.22 |
| `--rule` | `#423830` | `#cfc6bd` | 1.47 |
| `--muted` | `#948b7d` | `#4e4940` | **7.79** (6.76 on raised) |
| `--invert` | `#bfb4a2` | `#3f3931` | 9.95 (paper type on it) |
| `--ink` | `#ded5c6` | `#2d2620` | **12.99** (11.28 on raised) |
| `--signal` | `#fff8e8` | `#070402` | **17.83** |
| `--signal-ink` | `#0c0a08` | `#f3efe7` | — |

The alphas are the light paper at the same strengths (`--on-ink-*` at 0.24 and 0.1 — lighter
than the dark slab they are drawn on), and `--scrim` is the paper at 0.55: the room still recedes
into its own ground. Muted on the lens run is 7.40. The floors are the dark ramp's, and
`styles.test.ts` runs every pair on both ramps. **Every text tone on paper clears 7:1** (muted
7.79 on the paper, 6.76 on `--raised`, the lowest pair, over the 4.5 floor) *(2026-10-13, owner
note, review LEAD-01: the light mode was hard to read, and the small secondary text was the part)*.

**The hairline steps are smaller than the dark ones on purpose** (`--rule` 1.47 against 1.73): a
faint darkening of a bright surface reads far more easily than the same lift of near-black (the
paragraph above, read the other way).

**How it is built.** One block, `:root[data-theme="light"]`, straight after the token block,
restating every colour token and nothing else, with `color-scheme: light`. `data-theme` on
`<html>` is always the *resolved* answer, put there by `lib/theme.ts` and, before first paint,
by `public/theme-boot.js` — so the stylesheet has **no `prefers-color-scheme` branch** and one
copy of each ramp. Nothing outside the two blocks knows which one it is drawn in. Two things are
not ramp tones and still differ: on paper a photograph on a card is not dimmed (`--shot-opacity`,
the 0.68 is a damper for glare on the black) and a document's first page is shown as itself, warmed
(`--doc-filter`), not as the negative §5 describes.

---

## 2b. The one exception — a board the user made

The app has no colour. A **folder the user made** may have one, and nothing else in the system
may. This section is the whole licence; `lib/boardLook.ts` holds the values and
`styles.test.ts`'s *"the board tints"* block holds them to it.

### Why this is not the thin end of a wedge

A board is not chrome: it is a **name the user chose**, their content rather than the app's, and
the one thing on screen a person navigates to dozens of times a day by looking for it. Hue is
recognised faster than any word can be read — the entire argument for spending it here and
nowhere else. A coloured error, link or "on" is still the interface asserting itself, and refused.

The eight automatic boards — Inbox, Inspiration, All, Todos, Links, Files, Archive, Trash —
**cannot be tinted**, and that is the same rule seen from the other side. They are the app's own
rows, and colouring one would be exactly the "hue for state" §0 refuses. (Four of the eight are not
places at all but *lenses* — All, Todos, Links and Files hold nothing of their own. The strip's one
hairline is drawn where **the app's own boards** begin — Inspiration, a place, among them; see
`SPEC.md` §6. The tinting rule does not care which kind a row is, only that the user did not make
it.) **Inspiration is one of the app's own boards and cannot be tinted or given a mark**; its own
hand-drawn mark answers the pointer (§7) (2026-10-08, owner approved).

### The terms: no tint adds a step to the ramp

*(Rewritten 2026-10-08, owner approved: sixteen tints in place of eight, and the mark's brightness
loosened from one value to a span. The story and the numbers it replaced are in
`docs/decisions/design.md`.)*

The licence is not "hues are allowed now". It is that **these** hues are free. Each of the sixteen
exists at two strengths, and both sit inside the ramp the app already has:

| | Luminance | On the ground | Bounded by | Where it is allowed |
|---|---|---|---|---|
| `--board-<hue>` | 0.24 – 0.4633 (these are 0.247 – 0.450) | 5.5 – 9.4:1 | Floor: nothing dimmer than 0.24 (about `--muted`'s 0.2624 less a little). Ceiling: **`--invert`'s 0.4633, never brighter** | The board's **mark** |
| `--board-<hue>-rule` | 0.042 (±0.004; these are 0.0414 – 0.0426) | 1.72 – 1.74:1 | `--rule` (0.0420, 1.73:1), exactly | The **hairline** under the board row |

So a coloured mark never outshines the brightest thing a *content* surface may be (`--invert`), and
`--ink` (0.672) stays the only tone above it: the user's words are still the brightest thing on the
screen. The range exists so that **off-whites are possible** — a bone or an oat cannot be pale and
sit at `--muted`'s brightness. The line under the board row is unchanged: exactly as quiet as the
line that was there before it, whatever the hue.

The sixteen are **earthy, muted outdoor-gear colours, not a rainbow**: bone and oat and sand,
clay and rust and ochre, khaki and moss and olive, fern and forest and sage, slate and stone, dusk
and plum. Dusty, warm-leaning (the warm ones richer than the cool), so each reads as something seen
under the room's own amber light rather than a label colour laid on top of it. The three palest
(Bone, Oat, Stone) are barely coloured at all (chroma 0.011 – 0.026) and are the reason the span
exists. In the order the picker shows them:

| Key | Shown as | Mark | Rule |
|---|---|---|---|
| `bone` | Bone | `#b5b3ab` | `#3b3a34` |
| `sand` | Sand | `#c69c79` | `#4b3523` |
| `oat` | Oat | `#aea393` | `#41392d` |
| `clay` | Clay | `#b98a7c` | `#4f332b` |
| `ember` | Rust | `#b97961` | `#4e332a` |
| `ochre` | Ochre | `#a78a5c` | `#463820` |
| `khaki` | Khaki | `#a29f74` | `#3d3b20` |
| `moss` | Moss | `#8e965e` | `#383c22` |
| `olive` | Olive | `#7b8e6f` | `#303e27` |
| `sage` | Fern | `#67a078` | `#273f2e` |
| `teal` | Forest | `#639392` | `#1a4040` |
| `salvia` | Sage | `#81a291` | `#263f33` |
| `steel` | Slate | `#6c8fb1` | `#283c4f` |
| `stone` | Stone | `#9098a2` | `#343a41` |
| `iris` | Dusk | `#948cb2` | `#3c364f` |
| `plum` | Plum | `#b3859c` | `#4c323f` |

**The key is what a synced board stores, so it never changes;** the value and the name shown in the
picker can. Each of the eight original keys therefore keeps the new colour *nearest* it (nearest in
OKLab, ΔE 0.008 – 0.029), so a board already tinted keeps its family: `ember` is now Rust, `sage` is
**Fern** and `teal` is **Forest** (the colour called Sage is the new key `salvia`), and the rest keep
their name. A key the app does not know is "no tint", as before.

**Solved, not eyeballed.** Hue and chroma were chosen in OKLCH (chroma 0.011 – 0.087), the lightness
for each was searched for its target luminance, and the whole set was then optimised for the largest
minimum distance: **no two marks closer than ΔE 0.045 in OKLab, and none closer than that to
untinted `--muted`.** An edit that drifts has quietly turned the tint into emphasis, which is the
thing this section exists to prevent — so re-solve rather than nudge, and the test will say so if you
don't (it checks the span, the 4.5:1 floor, the rules at `--rule`, and the distances).

### On the light ramp

The sixteen are re-solved for paper rather than mirrored *(2026-10-11, owner approved)*: each keeps
its OKLCH hue; its lightness is searched between **5.5:1 on the paper and `--invert`, never
darker** — the same span turned over, so no mark passes the ink — at chroma no more than 0.095,
and the set is held to the same OKLab spacing, from `--muted` too (0.044 today, over the test's
0.04). **The pale three (Bone, Oat, Stone) become
barely-coloured dark greys, Oat a dark brown now that `--muted` sits near it**: on a light
ground a pale mark is an unreadable one. That is the one
loss, accepted. The values live in the light block; the keys and names do not change.

### And what a tint may touch

**A mark, and nothing else.** Never a line, never a fill, never a slab, never a word, never a
card, and never a line of the user's own text. It reaches the stylesheet through exactly one custom
property — `--board-tint` on the mark — set inline from the board's own colour. A second is a new
argument, not an extension of this one. (The hairline under the board row took the hue too, at
rule strength, until 2026-10-23: the owner asked for it gone, and it is plain `--rule` again.)

Sixteen is the whole set and there is no seventeenth, for the same reason the type scale has six
sizes: a seventeenth is a design failure, not a token shortage.

### Its mark, too

The same panel gives a folder a **mark** from the icon set (§7) — the folder is the default and
the way back. That is not an exception to anything: it is one of the set's own drawings at
`icon-inline`, on the same greyscale every other mark takes unless the board is also tinted. It
is here because it is the other half of the same question — *how do I recognise this board
without reading it* — and because it is chosen on the same sheet.

---

## 2c. The second exception — the film, and the lamps that show it

Emphasis in this app is a step along the ramp or a rule weight, and until now that was the whole
list. There is now a third thing: **one texture, in a named few places, visible only where a light
falls on it.** This section is its whole licence. `--film` in `styles.css`'s token block holds the
grain, *the lamp* holds the mechanism, and `styles.test.ts`'s *"the film"* block holds both to what
is written here.

**Three surfaces are lit, and only three: the focused write box, the open note's editor, and the
board you are on.** Each was argued for in its own words; none arrived by citing the others.

### What it is

The write box, focused, is lit. A pool of light sits under the caret and travels with it, and
inside that pool — and nowhere else — the field shows the **tooth of a sheet of paper**: a fine
grain, tiled across the whole field, drifting too slowly to be watched (see *The terms*).

The light paints almost nothing of its own. It is a **mask**. Its only job is to decide how much
of the paper you are allowed to see, which is why the grain appears to crawl under the caret while
nothing is animating: the film is nailed down and the light moves over it.

### Why a texture at all, when nothing else has one

The capture bar was the one field with **no focus state**: §3's inset rule of ink cannot go round a
58px band flush to three edges of the screen without framing the bottom of the app. Every tonal
answer (a brighter top rule, `--raised`, a margin mark) adds one more bright hairline; the texture
says *this is listening* without adding a line.

### The terms

Narrow, and stated so that the next texture has to argue for itself rather than cite this one.

- **It adds no tone.** The film names no colour: `feTurbulence` generates its own image and
  `feColorMatrix` desaturates it, so there is no tenth step on the ramp hiding inside the data URI.
  **It is then warmed to the lamp's own grey**: a second matrix scales the channels to roughly
  `--invert`'s proportions, 1 : .95 : .86 (neutral grey read as blue-grey on this warm paper). It
  is a ratio, not a colour.
- **The grain drifts, slowly, on every lit surface.** The film is laid twice, once at 160px and
  once at 224px so the two tilings never line up, and each copy glides its own way over a 90-second
  lap (`lamp-drift`). This is the one loop a board tab runs, and it may run there because **it
  touches no brightness** — a selected tab is exactly as lit at every frame. It is linear and its
  duration is a literal, the spinner's exception. Reduced motion stops it everywhere.
- **It is `--invert`, not `--signal`.** The lift under the pool is a flat wash of `--invert` at
  0.8%. The top of the ramp is a live address and stays that way (§3); inversion is what a
  *content* surface does when something is being done to it, and something is — you are writing
  in it. This is the faintest possible amount of that.
- **The only gradient is the mask.** The lift is a flat colour, faded entirely by the mask, so no
  gradient anywhere in this feature shades a surface. §9's rule is untouched.
- **It exists in three places, and they are named.** The capture bar's field, the open note's
  editor, and the board you are on. Not the search box, not a card, not a panel. The list in
  `styles.test.ts` is what a fourth one has to get past, and getting past it means writing the
  argument here first.
- **No canvas and no particles**, ever. Two background layers and a mask, and the only work on a
  keystroke is the mask re-rasterising as the light glides.
- **The flame is alive, and only on the two write surfaces.** The write box and the note editor
  carry two slow loops: a **breath**, one swell and settle over `LAMP_BREATH_MS`, out on ENTER and
  back on EXIT; and a **flicker**, a handful of dips of a few percent at deliberately uneven spacing
  over `LAMP_FLICKER_MS`. The two periods do not divide into one another, so a dip never lands twice
  on the same point of the breath.
- **The board you are on does not breathe.** A board tab is a *state*, and a state that flickers
  reads as a fault. Both loops drive `--breath-gain` and `--flicker-gain`, two registered numbers
  every lit surface multiplies its lift by; the three board surfaces run no animation, so they read
  the registered `1`. `styles.test.ts` holds the line in both directions — the write surfaces must
  animate, the boards must not. **One arrival is allowed** (2026-10-14, owner approved): on a
  cold open the lit tab comes up from dark to its glow once, about half a second, and never again
  that session (`lib/coldLight.ts`). Nothing waits for it.
- **Both loops go under reduced motion**, unlike the travel and the fade: they carry no information.
  A resting lamp leaves both **running** — never paused, because the slow fade-out keeps the pool
  visibly lit and a breath that stops in view is a larger event than the fade.
- **The lamp goes out four times more slowly than it comes on.** Coming back is `LAMP_FADE_MS`,
  quick enough to answer the keystroke; going out is `LAMP_DIM_MS`, slow enough never to be caught
  happening — a light settling must not be an event. Out on EXIT, which starts slow; back on ENTER,
  which arrives early.
- **Reduced motion keeps the light and drops the travel.** The texture is the answer to *where is
  the caret*, so removing it would answer a preference about movement by taking away information.

### The open note's editor

The editor has **too little to distinguish it from the thing it replaces**: reading and writing a
note happen in the same place, at the same size, on the same line grid (§8), so the only thing
separating them is a blinking caret. The light answers *is this thing listening* without ever
becoming a mode — the words do not move, the measure does not change, nothing appears in the
margin. The paper under the line you are on is simply lit.

**It is the dimmer and tighter of the two, held below the write box by a test.** The numbers on
screen are the owner's own dial — **`--lamp-lift` 0.02% and a pool of 80 × 40**, against the write box's 3.4% and 175 × 52 (`c3628cf`, "kept
as found") — so the test holds only the ordering. Dimmer, because a light that announces itself
when a paragraph becomes editable is a mode; tighter, because the measure is 33em and a pool 40px
tall against a 27px line hugs the line being written.

Everything else is shared — the same `--film`, the same mask, the same measurement through
`lib/caret.ts`.

### The board you are on

The third lit surface, and the argument made again rather than borrowed.

The tab used to say *here* with a flat `--raised` fill — one more box in a lattice of boxes. A pool
has no edge: the board you are on is the one the light is on. It is the same light meaning the same
thing — the write box is lit because it is listening, the editor because the words are editable,
the board because it is where you are. **That is the test another surface has to pass:** does the
light mean the same thing there as it already does everywhere else.

The terms above hold unchanged, with three things stated for this surface specifically:

- **It replaces the fill, it does not join it.** A lit tab has no `--raised` background. Two
  signals, as before: the light, and the name going muted → full ink.
- **It may be brighter than the write box's and may never be brighter than what it replaced.**
  `--lamp-lift` is 13% here against the write box's 3.4%, because this lamp is carrying state that
  a slab used to carry alone. `--raised` is `--invert` at roughly 16% over the paper, and that is
  the ceiling — past it the lamp is louder than the fill it was meant to be quieter than.
  `styles.test.ts` holds the 16%.
- **Being on a board looks the same everywhere a board is named.** The strip tab, the trash tab
  beside it, and the phone's drawer row all take it. Three selectors, one fact; a board that looks
  selected one way on a desktop and another way on a phone is two designs.

### On the light ramp

`screen` can only lighten, so on paper the lamp drew nothing. There the wash of `--invert`
**multiplies**: the light shows the tooth as its shade *(2026-10-11, owner approved — the metaphor
does not survive the turn, the mechanism and its meaning do)*. `--raised` stays the ceiling, and on
paper 13% of `--invert` multiplied is louder than `--raised` (1.24 against 1.15), so the ramp sets
`--lamp-scale` 0.62 beside `--lamp-blend`: the board you are on lands at 8%, the write box at
2.1%. Each surface keeps its own one dial; the same `--film` serves both ramps.

### What it is not an opening for

A texture on a card, on a panel, on a search box, or on a shelf row that is merely hovered or
pressed. Note that *behind the words of a note* is now on the allowed side of that line and the
distinction is exact: the editor's lamp lights the line being **written**, and a note being **read**
has no lamp at all, because there is no caret to put one under and nothing being done to the paper.

The film is legible because the surfaces are counted and because it is never seen whole — a grain
spread evenly over a surface is a surface with a finish on it, which is a different design and a
much larger claim than this one. **Nothing may show the film unmasked.**

---

## 3. The signal — emphasis without colour

A live address inside an open note is the only emphasised thing in the entire app, and it is
marked with **two signals, both tonal**:

1. It is set at the **top of the ramp** — brighter *and* warmer than the words around it,
   1.37:1 above them.
2. It is **underlined**, 1px, offset 2px so the rule clears Baskerville's descenders.

Both are needed. The tonal lift alone is too quiet inside a paragraph; an underline alone looks
like every other underlined thing in the app. Together, an address is the brightest thing in the
note — which is exactly what it is. **Hovered, it inverts** to `--signal-ink` on `--signal`,
reusing the app's existing word for "this one" rather than inventing a second.

`:focus-visible` is `2px solid var(--signal)` at 2px offset. That is the one non-link use, and it
is permitted because it is the browser's accessibility contract, not the app's vocabulary.

**A text field never takes the ring — it takes one inset rule of ink** (`1px solid var(--ink)` at
−1px offset, the canvas label's rule), identically for touch and keyboard. `:focus-visible`
matches a field on an ordinary tap, and a ring 2px outside a box flush to three edges clips at the
viewport. Keyboard focus stays visible; it just stops shouting.

**Never give anything else the signal.** Not an error, not a primary button, not a selected
state. Errors take full-ink text beside a **3px ink rule** on their leading edge.

---

## 4. Typography

### Three faces, three jobs

| Role | Face | Token | Weight | Job |
|---|---|---|---|---|
| **Names** | **Marcellus** | `--display` | 400 only | The wordmark, board names, the folder title, empty-state and dialog headings, the sign-in mark |
| **Words** | **Libre Baskerville** | `--body` | 400, 400 italic, 700 | Every character the user wrote, and every field they type into |
| **Machine** | **IBM Plex Mono** | `--mono` | 400, 700 | Counts, stamps, `[x]`, `+1.4k`, sync state, key caps. Not button labels: a control is in words, §11 |

**Marcellus is an inscriptional Roman** — drawn for capitals cut into stone, which is exactly
what the app asks of it. One weight only; it has no bold, and asking the browser to fake one
turns an elegant face into a smudge.

**Libre Baskerville carries the notes.** It is 90% of the pixels, tuned across the real archive,
and `useCardMetrics` is calibrated to its average character width (`AVG_CHAR_PX = 6.63`). **If
you ever change it, you must re-measure that constant over the real archive** or every card face
will over- or under-fill.

**IBM Plex Mono is self-hosted like the other two**, so the machine voice — set at 10.5px on a
fixed 22px footer baseline — renders the same on every device.

All three live in `web/public/fonts`. **Never add a font CDN**; the 90% path may not wait on a
network round-trip. Every `@font-face` declares **the one weight its file actually holds** — a
file that claims `400 700` makes the browser match bold to the regular cut and decline to
synthesise, so bold silently renders as regular.

**The open note uses neither the 700 cut nor the italic.** The reader must lay every character
where the editing textarea does, and both cuts are a different width from the regular one. Bold
there is `-webkit-text-stroke` over the regular cut; italic is the regular cut slanted by the
browser, through `--body-roman` (an alias, `Libre Baskerville Roman`, that declares no italic
face). Cards, which are never edited in place, keep the real cuts.

Preloaded for first paint: `libre-baskerville-latin`, `libre-baskerville-bold-latin`,
`libre-baskerville-italic-latin`, `marcellus-latin`, `plex-mono-400-latin` — the bold and italic
too, or they arrive after the text is laid out and re-break it.

### Six sizes, and no seventh

| Token | Size | Face | Job |
|---|---|---|---|
| `--t-data` | 10.5px | mono | Counts, stamps, `[x]`, state, key caps |
| `--t-nav` | 12px | Marcellus caps | Board names, and only board names |
| `--t-text` | 13px | body | A note on a card; tags; interface prose; every button and menu row, in sentence case *(2026-10-13, owner approved, review UI-01)* |
| `--t-read` | 16.5px | body | An open note, and every field you type into; and the wordmark, in Marcellus capitals tracked at `--track-mark` (2026-10-08, owner approved) |
| `--t-name` | 21px | Marcellus | Headings of empty places |
| `--t-mark` | 34px | Marcellus caps | The sign-in mark, once |

10.5 and 12 are close in number and never confusable: 12px Marcellus capitals stand well above
10.5px mono, because caps are measured to cap height.

**The wordmark is at `--t-read`, not `--t-name`** (2026-10-08, owner approved; it left the header on
2026-10-16 and stands on the sign-in screen and About): at 21px its capitals
were 15px tall beside a creature whose shell is 25, and the name outweighed the drawing it labels.
At 16.5 the capitals are 11.5px, centred on the creature's eye line, and no seventh size was
needed. The masthead is on the 8px grid: a 56px creature box, 8px above and 16px below it (an
80px band, 81 with its rule), 16px side margins and a 16px word-space between shell and name —
`--head-*` and `--mascot-*` in `:root`; `.about-head` reads the same tokens.

### Leading and tracking

| Token | Value | Job |
|---|---|---|
| `--lh-chrome` | 1.1 | The furniture, set solid |
| `--lh-read` | 1.65 | Prose, open and on a card |
| `--lh-item` | 1.3 | Short pulled-in text in the chrome (a link preview's title); no longer a list item in the open note |
| `--track-caps` | 0.15em | Marcellus capitals at nav size |
| `--track-tab` | 0.08em | The board strip's tab names only — tighter, so the strip holds more *(2026-10-13, review UX-08)* |
| `--track-data` | 0.1em | Mono labels — states, stamps, key hints, the Tick off and Tidy up heads |
| `--track-mark` | 0.22em | The wordmark and the sign-in mark |

**A list item in the open note is on `--lh-read` with nothing between items**: the reader must break
lines exactly as the textarea does, and the textarea has one leading and no gaps. The grouping
survives on cards, in `--card-item-lh` and `--card-item-gap` below.

**Counts and boxes are mono set untracked** — board counts, the canvas's count, `[ ]` and the
Ticker's boxes. A number or a box is read as a shape, and spacing it out loosens the column it
lines up in. Every other mono run is on `--track-data`; there is no third mono tracking
*(2026-10-05, owner approved, review QA-11/STD-01)*.

**Libre Baskerville lowercase is never tracked.** Letterspacing a text serif is the oldest tell
of an amateur. Only capitals and monospace are tracked, ever.

Card metrics are pixel values, not ratios, because a card shows a whole number of lines:

```
--card-lh        19.5px          one line box on a card
--card-lines     8 (9 ≥ 700px)   how many it shows
--card-item-lh   16.5px  ┐ these two must sum to exactly --card-lh, or a list
--card-item-gap  3px     ┘ stops costing what the cut was measured against
--card-h         206px (230px ≥ 700px)
--row-lh         20px            a Links row's line box: whole, so stacked rows
                                 never sit on a half pixel (2026-10-05, UI-A-01)
```

---

## 5. State grammar — what "on" looks like

There is no colour for state. Two moves, and which one you use depends on *what kind of thing*
it is.

| The thing | Move | Looks like |
|---|---|---|
| **Content** — a card, Save, the `+` button | **Invert** | `background: var(--invert); color: var(--paper)` |
| **Chrome** — board tabs, shelf rows, tool buttons, the menu and its panels, search close | **Raise** | `background: var(--raised); color: var(--ink)` |

**The panels are chrome, and are drawn on the ground.** The menu, the selection's verbs, the
Move chooser, the reminder panel and the note's insert panel are one surface (`.selpanel`): the
ground, a `--rule` edge (the same surface as the right-click menu and the search overlay), rows in
`--ink` divided by `--rule-soft`, `--raised` under the pointer, and the invert only for the instant
a row is pressed. Never an inverted slab — a bone block in a black screen is the brightest thing
in sight and its rows go flat. The one bright thing in that corner is the burger that opened it,
which still inverts to say the selection is on.

**Inverting goes to `--invert`, not to `--ink`.** Full bone is a flare on this ground. `--invert`
sits at **1.41×** below the body bone — at 1.0× it flares, at 1.88× a selected card stops reading
as selected — and is still 9.66:1 against the ground. On it, a selected card's body and foot are
`--paper` at `opacity: 0.9`.

**Thin marks do not take `--invert` and must stay at full `--ink`:** the priority flag, the
1px strokes of the trace animation, the undo clock. A hairline dimmed is a hairline you cannot
see. Only slabs need the restraint.

**An inverted surface is a light slab.** Easy to get wrong: anything drawn *inside* an inverted
panel must be **darker** than the fill, not lighter. That is what `--on-ink-rule` and
`--on-ink-wash` are for. A white alpha on an inverted surface draws nothing at all.

**A hovered link is the one place `--signal` becomes a fill**, and it stays at full brightness
rather than dimming. It is a few words wide, mouse-only, and momentary — and it is the signal.

**Why chrome raises instead of inverting.** Inversion is how a *note* says something was done to
it, and that has to stay unmistakable; furniture inverting made it the loudest thing on screen.

**Never take a chrome control back to an ink fill. Never spread `--raised` to a card.**

Fixed state rules:

- **A pressed card does nothing — it never moves and never inverts.** One pixel of travel opens a
  hairline gap in a zero-gutter grid, and a card is not a button: the tap opens the note, which is
  the whole of the feedback owed. Nothing marks a press on a card.
- **Selection inverts the card**, so at a glance you see the *shape* of what you picked. Everything
  on the slab goes to `--paper`: names, ticked items, links, and the idea's snapshot and a link's
  box, which drop their dark fill and become `--paper` outlines. Only a photograph keeps its own
  tones.
- **A document page on a card is a negative, shown from its top**: dark page, light type, at full
  opacity, so a PDF is recognised by its heading instead of reading as a grey slab. Photographs
  keep their own tones (2026-10-05, owner approved, review GD-01).
- **Priority is a flag, at the head of the card's footer row.** No stripe, no frame, no tint, no
  hue: the coloured rail, the tinted fill (it read as *disabled*) and the 2px frame were each tried
  and rejected by name, and none of them may come back. A glyph in the card's top-left corner
  floats over the first line, so it sits in the one row a card already keeps its marks in, at the
  one size they are all drawn at, at full ink rather than the row's muted. A canvas note has no
  such row and keeps it above the text instead.
- **The board you are on takes the raised fill and full ink, and nothing more.** That is the tab
  in the strip and the row in the drawer alike; a 3px rail under the selected tab was built and
  removed — it worked, and it was still one thing too many. The ramp is the design; nothing gets
  added to it.
- **The phone's header row has no fill at rest.** In the strip the board you are on is raised
  *against the others*; alone in a row it has nothing to contrast with, and a raised slab across the
  top of the screen for a fact nothing disputes is exactly the furniture the ramp exists to
  prevent. Full ink alone says it, and the row raises only while pressed or while the drawer is
  open — with the burger going solid at the same time, which is the set's own "on" grammar said in
  the glyph.
- **Nothing carries a UA highlight.** The Android tap highlight and the selection colour are both
  turned off globally; `::selection` inverts to `--paper` on `--ink`.

---

## 6. Rules and borders

Two weights, and each means something different. The third — a 3px rail — exists **only** on the
leading edge of an error.

| Weight | Token | Meaning |
|---|---|---|
| 1px | `--rule-soft` | A division inside one thing — card footers, control dividers |
| 1px | `--rule` | The edge of a thing — card edges, bar bottoms, dialog borders |
| 3px | `--ink` | *This failed*, and nothing else |

**Never a radius (one exception, the key cap below). Never a shadow. Never a blur. Never a gradient.** A `box-shadow` standing in
for a rule is a shadow the next person will generalise from.

**Cards draw only their right and bottom rule**, so tiled neighbours never double a line and the
outermost edges are the screen.

**An archived card draws those two rules dashed**, at the same 1px `--rule`, and its words in
`--muted` — the one card whose edge reports a state: put away, still whole, still found by a
search. It is the only dashed edge on a card; filing a note never dashes one *(2026-10-05, owner approved, review QA-11)*.

**A shortcut is drawn where the thing it opens is.** A key name is machine data,
so it takes the machine voice at `--t-data`, and **each key is its own cap**: "Ctrl" and "E"
(or "⌘" and "K") are two small caps with a 4px gap between them, never one box with a space in
it. A cap is 18px tall and at least 18px wide, so a single letter is a square; its glyph is
centred and **untracked** (spreading a word across a tiny box is what made "CTRL E" look off). It
takes a faint fill from the ramp (`--rule-faint`), a 1px `--rule` edge and **one small radius,
`--r-key` (3px)** *(2026-10-08, owner approved: "rounded is ok for an element like this")*. That
radius is the one exception to "never a radius", it belongs to the key cap alone, and no other
element may take the token. No shadow, no bevel: a cap is told from a box by its size and its
corner, not by standing off the page. It is never drawn on a device that has no such key.

**A card's footer rule runs the full width of the card.** It is the same hairline at the same
weight, un-inset: the lattice gains a horizontal member, and a cut card's fade — which paints in
the card's own colour — ends on a line rather than dissolving into the ground its neighbour is
made of.

---

## 7. Marks

Heroicons 24 outline, imported **one component at a time** in `Icons.tsx`
(`@heroicons/react/24/outline/TrashIcon`), never the barrel — the barrel pulls the whole set and
the build stops tree-shaking. `npm run build` reporting a three-figure module count is the check.

**A folder's chosen mark is Lucide** (2026-10-12, owner approved): any of its ~1,850 outline
marks, so a folder finds one for what it is about. Drawn at the same tiers and strokes as every
mark below, in the folder's tint and nothing else. Folders dressed earlier keep their Heroicons
mark. The sets load only behind dynamic imports (`web/CLAUDE.md`, "Marks").

**Outline is the resting state. Solid means the control is on.** Only priority-set, archived and
menu-open swap to 24 solid. 20 and 14 are the 24 drawing *scaled*, never the 20/16 solid sets.

| Class | Size | `--icon-stroke` | Job |
|---|---|---|---|
| `.icon-nav` | 24px | 1.5 | Bar controls |
| `.icon-inline` | 20px | 1.8 | Controls inside a row or panel |
| `.icon-data` | 14px | 2.57 | Footer marks on a monospace baseline |

A 1.5 stroke on a 24 grid thins as the box shrinks, so each tier sets its stroke in **user units**
chosen to land back on 1.5px on screen. `--icon-weight` scales the set to its neighbour's
font-weight — 400 everywhere, a footer mark beside a bold count included. **The declaration
must stay on `.icon` in CSS**: it beats the stroke-width attribute Heroicons and Lucide set on the
same element, and the paths inherit the computed value.

**Never hard-code a width on a mark.** 14 is a ceiling, not a preference: `.card-foot` is a fixed
22px box, so a larger footer mark grows every card on the board. Its words sit mid-band: 8px above
them under the rule, 8px below to the card's edge.

**Curves are allowed on glyphs and nowhere else.** Heroicons and Lucide draw with round caps and
joins and are kept as drawn. Rules and borders stay hard.

**Three marks are drawn, not imported**, because no icon set has a word for them: `IconCut` (one,
two or three stacked rules — a *level*, never a character count), `SyncMark` (two nodes that
sit exactly on top of each other at rest, part with a dashed stream while syncing, and close
again) and `IconInspiration` (a framed picture whose sun lifts under the pointer,
`.icon-inspo-sun`; 2026-10-08). Only `idle` and `working` get the sync mark; `offline` and
`error` stay as **words**.

---

## 7b. The pointer

**On a desktop the app draws its own.** The operating system's arrow, with its drop shadow, was the
only object on screen not on the ramp. Every cursor is a token in
`:root` (`--cursor-default`, `--cursor-pointer`, `--cursor-text`, `--cursor-grab`,
`--cursor-grabbing`, `--cursor-crosshair`, `--cursor-zoom-in`, `--cursor-zoom-out`,
`--cursor-resize`), and nothing outside that block writes a cursor keyword.

Four rules, all of them rules this file already had:

- **Two tones and no third.** `--paper` and `--ink`. Carrying both is also what makes the pointer
  legible everywhere — an ink keyline reads on the ground, a paper fill reads on an inverted card,
  and the arrow is never lost against either.
- **Hard corners.** Mitre joins, butt caps, no radius and no curve. A lens is a **square**; a
  circle would be a second rounded thing beside the key cap's corner (§6). There is no hand: a plump cartoon
  glove is the opposite of everything above it, so taking hold of the canvas is four hard
  arrowheads on two crossed rules.
- **The state grammar, said once more.** A resting pointer is an **outline** — a hairline shape on
  the ground, exactly like a card. Over something you can act on it **inverts** to a solid, exactly
  like a selected card. Held, the move mark fills at its centre.
- **Desktop only.** A `@media (hover: none), (pointer: coarse)` block returns every token to the
  keyword it stands in for, so a phone pays nothing — not even the bytes, since a cursor no rule
  resolves to is never decoded. Each token also carries its keyword as the `url()` fallback, so a
  browser that declines the SVG lands back on exactly what it replaced.

A data URI cannot reference a custom property, so the two ramp values are written out inside each
drawing (URL-encoded, hence `%23`). That is why the cursors live in the token block, which is the
one place in the stylesheet a literal is allowed to appear.

**A folder's chosen mark answers hover too** (2026-10-08, owner approved). The stock glyphs have no
named parts, so a picked mark moves as a whole: a lift of about a pixel with a five-degree tilt that
settles back, once, on `--nav-mark-ms` and `--ease-nudge`, under the same row triggers and the same
reduced-motion guard as the hand-drawn marks. The class is `icon-picked`, set on the picked glyph
only (`BoardIcon`, the Move chooser's `BoardMark`); the default folder keeps its flap.

---

## 8. Layout

Unchanged from `SPEC.md` §5, and unchanged by this revision. Geometry was not the problem.

- **No masonry — except the Inspiration wall.** Uniform card heights, deterministic grid, hard fade
  truncation on overflow, everywhere but one board: Inspiration is a wall of columns of uneven
  tiles (still no gutters, a `--rule` hairline right and bottom of each tile, ratios clamped
  1:2–2:1). The Links board's picture rows (tiles on a desktop) are the other geometry of its own. Never a layout switch
  (2026-10-08, owner approved). **Todos counts its rows in thirds** (2026-10-17, owner picked
  it from mockups): a to-do whose words fit in two lines is a *slip*, one third of a card tall,
  and every other card there spans three — the same columns, hairlines and no gutters.
- **No gutters.** Cards tile edge to edge with no gap and no margin to the window.
- **Every row is exactly one card tall** (`grid-auto-rows: var(--card-h)`; on Todos one third of
  one, rounded down to a whole pixel), which is what lets a
  card grow on hover without the grid moving.
- **The cut lands on a baseline.** `useCardMetrics` measures a *rendered* card and derives
  characters-per-line from its real width, because a desktop column runs 246–323px.
- **The cut card's last line fades left to right, never top to bottom.** See §9.
- **The card face is chosen by `note_type`** and only ever decides how text is *arranged*.
- **The app derives no heading; the user may write one.** One heading level, and the second is
  not coming back. In the open note a heading is its muted `# ` and its words at a heavier stroke,
  at reading size on reading leading, with no space of its own — anything more moves every line
  after it when a tap swaps the reader for the editor. On a card it takes no size step at all.
- **Reading a note and editing it are one picture.** Nothing in the reader may change where a
  character lands: no size, no leading, no margin, no padding, no other face on any run. The marks
  the user typed (`**`, `*`, backticks, `# `, fences) are drawn in `--muted`, never hidden; inline
  code is the reading face; the list grip stands in the margin. The owner's rule is that the
  layout never shifts under an ordinary action. **One exception, the owner's (2026-10-23): a code
  block being read is code** — IBM Plex Mono at `--t-text` on a whole 20px line (`--row-lh`), on a
  `--rule-faint` panel with a `--rule` edge, `--s-5` above and below inside it and `--s-4` of space
  outside it, its fences muted at `--t-data` as the panel's first and last line, long lines
  scrolling sideways and cut at the edge (never faded), Copy at its top right. Tapping in to edit
  sets it back in the reading face on the same panel, and that shift is accepted. No highlighting,
  tonal or otherwise. On a card a line of code is one line: indented as written, never wrapped,
  giving way with an ellipsis.
- **A `# ` line at the top of a note is its name, and it speaks in the idea name's voice.** On the
  card that one line is set in the display face at `--t-nav` in capitals, cut to one line, in the
  slot it already had — never a row added above the text, so the card keeps its height. In the
  open note a note with no name offers a muted **Add a name** above its text, the same control an
  unnamed idea's "Idea" is in the canvas bar, worded as an offer and a full 44px tall.
- **An idea card is the one card with a header row of words**, because it is the one card that
  shows none of the note's own — its face is a picture of a canvas. The row is the name the user
  gave the place, set in the display face at `--t-nav` in capitals, the same way the folder bar and
  the board tabs name places. It takes its space out of the picture, never out of the card. Unnamed,
  no label is drawn — a row reading "Idea" over a picture of an idea is a label, and cards carry no
  labels — but the first source's own opening line stands under the picture, in the user's words
  (2026-10-05, review UX-A-09).
- **The bottom bar is anchored, never floating.** Panels open bottom-right, where the thumb is —
  except a folder's menu opened from the desktop strip, which hangs under its tab, names the folder
  on its first line, and keeps Delete last past the heavier rule; a mouse's right-click on a
  card, which opens the selection's panel at the pointer instead; and, with a mouse, the open
  note's reminder panel, which hangs under its line, and its Move chooser, under its mark — where
  the panel opens follows the hand *(2026-10-05, owner approved, review UI-A-03)*. Every panel
  stops at the visible height and scrolls inside itself *(review QA-03)*. Rows are ~44px, and **no row
  inverts to mark itself primary**.
- **Search is revealed, not resident.** It lives in the menu, and in the header row's own slot.
- **A band on the edge of the screen pays the system's inset.** The app is served
  `viewport-fit=cover` and installed `standalone`, so on a phone it owns the strip behind the
  status bar and the one the gesture bar sits in — which is what lets `--paper` paint into both
  instead of leaving the system a band to guess our colour for. Every band that lands on an edge
  therefore carries `env(safe-area-inset-top)` or `-bottom`, and `env()` resolves to `0` where
  there is no inset, so it costs nothing anywhere else.
  **The trap is a full-screen layer**: those are `inset: 0`, and the padding belongs to the *band*
  inside — the open note's bar, the Sorter's head, the picture viewer's Save row and counter, both
  ends of the phone's shelf drawer. `styles.test.ts` names every band and the edge it answers for.
- **A panel is never wider than the screen it is drawn on.** The bottom-right panels are anchored
  `right: 0` and sized by their contents, so a row too wide for the window grows off the *left*
  edge — where what is lost is each row's mark and the first characters of its name, with nothing
  to scroll, because the overflow is past the viewport rather than inside a box. A folder name near
  `BOARD_NAME_MAX` does it on any phone narrower than a Pixel. The panel is capped at `100vw` —
  the window's own width, not a chosen size — and the **name** is the one thing in a row allowed
  to give way, ending in an ellipsis.

### Spacing

One scale, in whole pixels, declared with the other tokens. New and touched rules take their
space from it; existing values are not rewritten wholesale. `styles.spacing.test.ts` counts the px space
each area file still holds: a count may fall, never rise *(2026-10-18, UX review)*.

| Token | px | Use |
|---|---|---|
| `--s-1` | 2 | Hairline nudges, a focus inset |
| `--s-2` | 4 | An icon to its label inside a control |
| `--s-3` | 6 | The gap between marks in a bar |
| `--s-4` | 8 | The default gap; a panel row's padding |
| `--s-5` | 12 | A control's padding |
| `--gutter` | 13 | **The one side margin**: card text, the board row's mark, the write field's words |
| `--s-6` | 16 | Sheet and panel padding |
| `--s-7` | 24 | Section spacing |
| `--s-8` | 32 | Page-level spacing — About, sign-in |

11, 15, 17 and 18 survive only as optical corrections against a line box, each with a comment
saying so. A height built from line boxes comes out in whole pixels, never a .5 — a half pixel
loses every second rule *(2026-10-05, owner approved, review STD-01)*.

### The board row

On a desktop it holds the tab strip: every board in one row, each one its mark, its name in the
display face at `--t-nav` in capitals at `--track-tab`, and its count in the machine face at
`--t-data`, untracked. It scrolls sideways when there are more folders than fit, and masks to transparent at
whichever edge still has tabs past it, so the row never ends in a hard cut mid-word. A mouse wheel
over it scrolls it sideways, and while anything is out of sight a cell at its right end — the
count of boards past the edge and a step mark, in the machine face behind a `--rule` edge — brings
them into view, then turns round to offer the way back; it is what keeps All one click away. Tabs
are 10px either side of a 6px gap. **Short of room, the app's own boards stand as their mark and
their count** (Inspiration, Todos, Links, Files, All — never a folder the user made): the strip
measures itself, and when its full-width form would run past its edge the names go, kept for a
screen reader and as the tab's tooltip (`fitBoards`, `.boards[data-compact]`; 2026-10-13, owner
approved, review UX-08). Four folders on a 1280px laptop now show every board.

The strip is in two runs: the places (Inbox, the user's folders, Archive), then the app's own boards
(Inspiration, Todos, Links, Files, All). The strip draws no rule between them (2026-10-12, owner);
the lifted ground below marks where they begin. **The line falls before Inspiration — the app's own boards — and the lens band
starts there** (2026-10-08, owner approved). Archive sits at the end of the places. **That run
stands on one faint lifted ground** (`--lens-ground`): Inspiration, Todos, Links, Files, All and
Trash, a quiet band
with the tabs' own hairlines running across it, so the built-in ways of looking read differently
from the boards the user made without ever resembling the board you are on (that is the lamp, three
steps brighter). The drawer's rows take the same ground, Trash included. Trash stands outside
the scroller entirely, beside search, as a mark and a count with no name — it is the one
destination that may never scroll out of reach.

**The board does not label where the ordering changes, and dividers across it are refused.** Period
rules ("today", "this week", "earlier") were built and withdrawn on sight: they spend rows on
furniture, break the one block of notes into pieces, and un-pin the row height the peek depends
on. The stamp in each card's footer already says when. This will be proposed again; that is the
answer.

On a phone the same 40-odd pixels hold one control instead:

    [ burger ]  BOARD NAME  count                           [ search mark ]

- The left side is **a single target**: the burger, the board's own mark, its name and its count.
  The mark and the name answer the same question, and a 40px icon beside a word you cannot tap is a
  control with a dead half.
- Its height may not change, because **search opens into this slot** and nothing else on screen is
  allowed to move when it does. Same padding as a tab, so the row is the same height at both widths.
- The board name goes to ellipsis rather than wrapping. The row is a label, not a paragraph.

**On a phone the row may stand at the foot instead, on the capture bar** — a setting on the
device, Top by default (2026-10-11, owner approved). It is the same row, not a strip: the burger,
the board you are on, search's mark, and search and Reminders still open in it. From the bottom
edge up: the gesture inset (the bar pays it), the capture bar, the row, the grid, the header. Its
one rule moves to the edge that faces the grid — the here-rule's tint with it — and the bar's own
top rule is the line under it, so there is still one line on each side. Suggestions open upward
over the grid, and the bar's one line stands on the row instead of covering it. **While the write
field holds the caret the row is not drawn**: that is the keyboard up, and forty pixels of what
the keyboard leaves are worth more as notes. A desktop's strip is always at the top, and so is a
short screen's row, which carries the folded header's creature.

### The shelf, standing up

On a phone the shelf is a drawer: full height at the **left** edge, because that is the edge the
burger that opens it sits on, sliding in over the board and leaving the capture bar alone. On a
desktop the same drawer opens from a burger at the left end of the board row — muted at rest like
the search mark at the row's other end, since the raised tab already says where you are — and
stands over the strip rather than in place of it. Paper,
one rule down its right side, and nothing else — this system has no scrim under a panel and no
shadow to lift one off the page. A blocking dialog's backdrop (`.dialog-scrim`) is `--scrim`, the
paper at 0.62.

- **A row is a board, and it is one line:** the board's mark, its name in the display face, its
  count in the machine face out at the right edge, with the name taking the slack so the counts line
  up down that edge — the whole advantage of reading a shelf as a column.
- **A row says nothing about what is inside the board** — no preview of its notes. What you are
  looking for on this screen is a *name*, and every line that is not a name is a line to read past.
- The board you are on is raised one step and its text goes muted → full ink, the same two quiet
  signals the strip's own selected tab uses.
- The `+` row at the foot is the same shape as every row above it, and opens into a field in place.
- **On a phone the rows stand at the foot of the drawer**, where the thumb is, in the same order;
  a shelf taller than the screen starts at the top and scrolls.
- **A board held to be carried is pressed, kept** — a drawer row and a strip tab alike
  (`[data-lifted]` in `styles.css`). The press's own step onto `--raised` and to full ink, plus the
  one thing a press does not have: an edge of its own in `--rule`, the weight every real edge takes,
  so it reads as a thing lifted out of the row rather than a row being touched. No shadow, no scale
  and no tilt — this system lifts by tone and by rule, never by depth. Its neighbours step aside on
  `MAKE_WAY_MS` to show the seat it would take, and under reduced motion simply are there.
- **An open note opens it too**, from a burger beside Back in the note's bar. It is the same drawer,
  lifted over the sheet, and that burger goes solid while it is open, exactly as the board row's
  does.

### The Sorter

One note, and the folders under the thumb. Three bands, top to bottom: where you are in the pile,
the note, and where it can go. The note takes whatever height is left, which is what keeps the
destinations on the floor of every size of screen without a measured number anywhere.

- The note is set exactly as it is read anywhere else — body face, `--t-read`, `--lh-read` — in
  the open note's own centred column (`calc(33 * var(--t-read))`), and scrolls if it is long. A note
  whose end you cannot see is a note you cannot place.
- **A swipe carries the card, and its words are tone and a hairline, never colour.** The note leans
  a few degrees about its foot and follows the finger; **Keep** or **Delete** comes up in the corner
  it is leaving towards, in ink on the ground in a 1px `--ink` box, from nothing to whole at the
  line where letting go decides. The only edge a carried card has is a `--rule` hairline — this
  system has no shadow.
- **Something that cannot be pressed is drawn in a tone the ramp has.** A mark takes `--rule`, a row
  of words steps from ink to `--muted`; neither is ever a fraction of a tone (`opacity`), which
  computes to a grey the palette does not contain.
- **Destinations are targets before they are words:** 44px, the name in the display face because a
  folder is a named place, the count in the machine face because it is data. They are separated by
  1px of `--rule-soft` showing through, the same hairline grid the cards use.
- **Keep, Important, To-do and Back sit in the head band beside the count**, Keep a `--muted` word. They are not places, so they
  are not among the destinations: a non-place at the foot is where a thumb aiming for it lands in
  the bin. Nothing at the foot should be easier to hit than a folder, and nothing sits past Delete.
- The capture bar is **not drawn at all** while this runs, and the undo mark stands at the top of
  the note, floated so the words run round it — the foot is all destinations, and the head band
  has no room on a phone (floated over the band, it covered the ✕).

---

## 9. The cut fade

A cut card's last line fades out rather than stopping mid-word — but **only that line, and only
left to right**, because a line of prose doesn't get dimmer as it's read: it runs out of room on
the right. Every line above it stays at full ink.

**It is an overlay, not a mask, on purpose.** A mask changes the text's own alpha, which reads as
"dimmer" rather than "ending". The fade is an opaque overlay painted in the surface's own colour,
in front of the text, so letters vanish behind the surface as if the card were narrower.

```css
.card-body[data-cut="true"]::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: var(--card-lh);
  background: linear-gradient(
    to right,
    transparent 0%, transparent 46%,
    color-mix(in srgb, var(--cut-bg, var(--card)) 22%, transparent) 64%,
    color-mix(in srgb, var(--cut-bg, var(--card)) 62%, transparent) 80%,
    color-mix(in srgb, var(--cut-bg, var(--card)) 90%, transparent) 92%,
    var(--cut-bg, var(--card)) 100%
  );
  pointer-events: none;
}
```

**The stops are eased, for the same reason the vertical fade's were.** A straight two-stop ramp
does not read as an even fade, because perceived lightness is a curve and alpha is a line. The
first 46% of the line stays completely untouched — a fade that starts the instant reading does is
worse than none — and the covering only becomes total in the last 8%.

**`--cut-bg` is what makes this survive a card's own state changes, and it must never be a
literal.** At rest a cut card fades into `var(--card)`; selected, it inverts to `var(--invert)`,
and an overlay has to be told, or the old surface colour sits on the new one as a patch. So every
state that inverts a card also sets `--cut-bg` to match, and the fallback
resolves to `--card` everywhere else. `styles.test.ts` enforces both halves: `--cut-bg` may only
ever be assigned `var(--card)` or `var(--invert)`, and the gradient must fall back to `--card`
rather than a hardcoded value.

**Checklists still never fade.** This attaches only to `.card-body[data-cut="true"]`, which is the
plain-text card face; a checklist is a different render path entirely and an item is still a whole
thing — half a tick box reads as broken, same as it always did. It may now wrap to a second line
box rather than being ellipsised on one: nine truncated fragments you cannot read is worse than
four whole ones you can, and what is hidden is still counted into the footer's cut level.

**A leading tag line — the `#todo` a Keep import left on line one — is drawn one step down the
ramp.** It is a filing artifact rather than the note, and the user's own words all stay at
`--ink`; the hierarchy comes from taking the noise off the top, never from dimming anything.
Never when it is the only line: then it is the note. A blank line on a card costs half a line box,
charged the same in `cutToLines` and in the stylesheet — the card is a cut, not the note, and the
open note is unchanged either way.

**A search result shows the words you searched for.** A card normally shows the
note from its first character; while a query is running it starts at the line the
first match is on, and the matched words stay at `--ink` while the rest of the
face drops to `--muted`. It is the same step the tag line takes, used for the
same reason, so it adds no tone and no colour. Both are facts about the query
rather than the note: nothing is stored and the open note is untouched. For a
search of several words the card (and the note opened from it) starts at the
first line holding the most of them, and when that line holds more than one, its
hits keep `--ink` while every other hit steps one tone down to `--invert` — still
an existing tone, still above the `--muted` words around them (2026-10-05, owner
approved, review UI-A-11).

Two conditions on that. **The dim
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

---

## 10. Motion

**All motion comes from `lib/motion.ts`** — two curves (`ENTER`, `EXIT`) and a fixed set of
durations. **Never hard-code an easing or a duration**; if none fits, the move is wrong.
Everything is skipped under `prefers-reduced-motion`, which `animates()` folds in.

- **A container changes its clip, never its scale.** The note sheet is full-screen from the first
  frame and animates `clip-path` out of the tapped card's rect. The user rejected the scale
  version by name as *"the 'stretchy' feel"*.
- **Boards are a shelf and paging moves along it.** Never `fill: "both"` on the enter animation —
  a filled animation outranks an inline style forever and freezes the next drag.
- **The grid closes its own gaps**, and a card that leaves shrinks into the mark for what happened
  to it. **The mark holds still, alone, before the grid moves.**
- **Nothing moves at a constant rate. A `linear` timing function is allowed only for a picture of
  a constant rate** — never for a move, and a fade is a move: an arrival takes `ENTER`, a departure
  takes `EXIT`, and that includes every fade in the app.
  Exactly three things are pictures of a constant rate and stay linear — **the undo countdown**,
  which is a clock and would be lying if it hurried; **the sync mark's flowing stream**; and **the
  spinner's falling sand**, both loops, and a loop that eases pulses. Each is a literal in
  `styles.css` named one at a time in `styles.test.ts`'s allowlist, so a fourth has to be argued
  for rather than picked up by habit.
- **Small things that answer the hand** (2026-10-14, owner approved, the joy review): a count
  that changes **turns like a film counter**, old digits up and out of a small window, new ones
  in (`Count`, never on first paint); **a tick draws its strike-through** left to right as a 1px
  line in the words' own tone, never a text decoration, so nothing moves (`Pen`, `STRIKE_MS`); a
  **picture that arrives late comes up out of the dark** like a print, and one already here
  appears at once (`usePrint`, `PRINT_MS`); a note **opened from search lights its hits first**
  and the rest comes up to ink (`LIT_MS`); and **a new device is dealt its first screenful** of
  cards by clip, once, under 400ms. All are tone or clip, none is a hue, all go under reduced
  motion.
- **The undo countdown** is, on the board, **the bubble's own outline drawn on in ink**, from the
  top-left corner clockwise over the eight seconds, linear, and then the bubble goes. In a mode (Tidy up, Tick off, the open
  note) and on a short screen it is **the offer's own border being drawn on**, clockwise from the
  top — one word, the verb, for its first 2.5 seconds, and then the arrow alone. Both are the same
  clock, and both are left undrawn under reduced motion.

---

## 11. Voice & copy

- **Sentence case everywhere.** No Title Case buttons.
- **Active voice, and an action keeps its name through the whole flow.**
- **Errors state what happened and what to do.** No apologies, no "oops", never vague.
- **Empty is an invitation, not a mood.** The name of the place in Marcellus at `--t-name`, one
  line of body italic under it, and above them the mascot — a small machine asleep, because
  nothing has been written here yet (`components/Mascot.tsx`, and see §1). No exclamation mark,
  and the drawing joins the copy rather than replacing it with a mood. Not on a search that found
  nothing, which is a mode rather than a place, and not while a board is still loading, where it
  would read as the thing you are waiting for. **It stands in the middle of the room it has**:
  centred between the board strip and the capture bar, at every width, by auto margins and never
  by alignment, so a screen too short for it — a phone on its side, a keyboard up — gets it
  top-aligned and scrollable rather than cut off above the strip.
- **An empty Inbox's offers finish its sentence, so they are said in its voice.** "Import from
  Google Keep", in the demo "Try it with sample notes" above it, and "Go to Todos" / "Go to Links"
  when a list or a bare link is why it is empty (2026-10-05, UX-B-02), are set in `--body` at
  `--t-text`, upright, in sentence case, each with the mark the same action wears elsewhere,
  stacked a thumb tall and reaching into the paragraph's side padding, each label on one line
  beside its mark. The first step is one step up the ramp — a `--muted` edge and `--ink` words
  against the second's `--rule` and `--muted` — and that is the whole hierarchy: no fill, no
  weight, no colour. They raise under the pointer and invert when pressed, like every other piece
  of furniture. **Since 2026-10-13 (owner approved, review UI-01) this is how every control
  is set**: menu and panel rows, dialog and settings buttons, segments, Leave, Archive on the
  Ticker, the insert panel's marks. Reading face, `--t-text`, sentence case, no tracking. Tracked
  capitals were the best-known tell of an AI-made dark app, and every button sounded the same;
  the apps people like (Things, Bear, Linear, Apple's own) say a control in plain words. A name
  of a board stays in Marcellus capitals; counts, stamps, key caps and state words stay mono.
- **Machine strings are uppercase mono.** That is the machine speaking, and it is the only thing
  in the app allowed to shout. A machine string is data (a count, a time, a key, a state), never a
  control. **A sentence of advice is not a machine string**: a line the reader
  is asked to act on or know — "Notifications are blocked for this site…", "1 note leaves the
  trash within 3 days", "not on this device" — is set like the empty board's line, the reading
  face in italic at `--t-text`, sentence case, in `--muted` (`.advice`). Capitals stay for labels,
  counts and states. *(2026-10-05, owner approved, review CD-05.)*
- **A stamp counts, it does not date.** Minutes, hours, then days to six, then the calendar. Every
  form is ≤ 6 characters so the card footer never reflows.
- **A stamp counts from the last edit, not from the capture** — the same thing the board is now
  ordered on, and a card whose position and whose stamp disagree is a board you cannot read. For the
  many notes never touched since they were written the two are the same date, so the archive looks
  no different. The open note leads with the edit and keeps the capture date behind it
  ("written 10 Aug 2026"), dropped entirely when both fall on the same day.

---

## 12. Assets

**App icon** (`web/public/icon.svg`) — the mascot, idle, in the ramp's own tones: paper ground,
`--muted` shell and legs, `--raised` screen, `--ink` face. It reads at 48px where a wordmark would
not, and it is the same creature the header draws, so the thing on the home screen is the thing
that answers when the app opens. Everything drawn sits inside the maskable safe circle.

**System bars** — an installed PWA takes its bar colour from the manifest, which holds exactly one
`theme_color`. `themeColor.ts` writes `theme-color` from the **resolved `--paper` value**, and
again whenever `data-theme` changes, so there is one definition of the ground and it lives in
`styles.css`. The manifest and the `index.html` meta are first-paint fallbacks only (dark;
`theme-boot.js` gives a light device the light paper) and must be updated together with the ramp.
**An installed app's splash stays dark** whichever ramp is chosen: the manifest cannot answer to a
setting (2026-10-11, accepted).

---

## 13. Applying it — checklists

### Adding any new surface

1. Which tone is it? Pick from the nine in §2 by *job*, never by eye.
2. What is its edge? `--rule` if it is the edge of a thing, `--rule-soft` if it divides the inside
   of one.
3. Does it have an "on" state? Invert if it is content, raise if it is chrome. If it inverts,
   remember the surface becomes a **bone slab** and anything on it must be darker.
4. Whose voice? The user's → `--body`. Machine data → `--mono`, uppercase, tracked — counts and
   boxes untracked. The name of a place → `--display`.
5. Does it move? A curve and a duration from `lib/motion.ts`, or it does not move.

### Never

- Any colour, anywhere, for any reason — **except** a folder the user made, on §2b's terms, and
  even then only its mark
- A hex code, font stack, size, easing or duration outside the token block
- A new spacing value off the scale in §8, or a height that lands on a half pixel
- `opacity` used to make a quieter tone — take the next tone down, or a lighter rule
- `--signal` on anything that is not a live address (focus rings excepted) — and a **text field**
  never takes the ring at all, so a field that declares no outline of its own is a field that has
  silently fallen through to it
- `--raised` on a card
- A white alpha inside an inverted surface
- A `prefers-color-scheme` branch, or a third ramp — light is the one block keyed on the resolved
  `data-theme`, and dark stays the default
- A border-radius (the key cap's `--r-key` is the one, §6), shadow, blur, gradient, or texture
- A seventh type size, or a rule weight that is not 1px or the error's 3px
- A hard-coded icon width, or a barrel import from `@heroicons/react` or `lucide-react` — the
  board look picker's sets (`lib/iconSet.ts`, `lib/lucideSet.ts`, `lib/markSearch.ts`) are
  reached only by a **dynamic** import, and nothing may import them statically
- A bare `cursor:` keyword outside the token block — every one is `var(--cursor-*)`
- A font CDN, or tracking on Baskerville lowercase
- A gutter between cards

### Always

- Contrast re-measured against §2 if any tone moves — check `--muted` first, and count any
  `opacity` on the element as part of the tone
- Keyboard focus visible
- `env(safe-area-inset-*)` on any band that reaches an edge of the screen, layers included
- A thumb's `--hit` on anything a finger presses, the canvas's own toolbar included
- `prefers-reduced-motion` respected completely, not shortened
- Down to 360px wide, and up past 1920

---

## 14. What changed from v1.0, and why

v1.0 of this file — a light-and-dark "printing plate" in verdigris and bone, with a grain texture, a
Swedish grotesque (Familjen Grotesk, not to return for names) and an ultramarine link — was rejected by the owner. The full v1.0 → now table,
and every later was / now / why, is in `docs/decisions/design.md`. Its outcomes are the rules
above; nothing it withdrew may come back without a new argument.

---

## 15. Borrowed on purpose — the conventions, and whether their reasons are written

A 2026-09-17 design-theory review audited which borrowed conventions have a reason written for
them; the whole table is in `docs/decisions/design.md`. Still open from it, for the owner:

- **The undo window is 8 seconds** (`UNDO_MS = 8000`) and nobody measured why.
- **Heroicons** is likely habit: its round caps needed an exception to the hard-edged chrome.
- **Back is an arrow while nothing moves**, against `Icons.tsx`'s own rule (an arrow moves a
  thing, a chevron is the thing beside this one). Either Back becomes a chevron or the rule is
  restated.
- The rows marked **"Now argued"** there (the burger, the grid of equal cards, long-press and
  right-click to select, swiping between boards, no pull-to-refresh, sentence case) are proposals
  until the owner confirms or replaces them.

**Re-read this file against the app, not only write it** — the audit found two places where it
described an app that no longer existed.
