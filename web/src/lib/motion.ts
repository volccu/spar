/**
 * One motion language for the whole app.
 *
 * Two curves and a handful of durations, and nothing invents its own. Motion
 * here has one job: keep you oriented when the screen changes. It is never
 * decoration, so everything is short, everything is directional, and nothing
 * bounces.
 *
 * `NUDGE` below is the one exception and is scoped to say so: it is not
 * orienting motion at all, it is a mark answering the pointer, and it is the
 * only curve in the app that overshoots. Read its own note before reaching
 * for it.
 *
 * ENTER is a hard decelerate — most of the distance is covered in the first
 * third, so the move reads as *fast* and the end reads as *settled*. That is
 * what "snappy" actually is: not a short duration, but an early arrival.
 * EXIT is the mirror: things leaving should not linger, so they accelerate
 * away and never decelerate into nothing.
 *
 * Nothing here scales a box non-uniformly. A container that changes shape
 * changes its *clip*, and the words inside stay the size they were — squashing
 * text for the length of a move is the "stretchy" feel, and it is a bug.
 */

/*
 * styles.css restates both curves as --ease-enter/--ease-exit, because a CSS
 * `animation` shorthand cannot read a JS export. That is a second copy of the
 * same decision, not a second decision — the values must match byte-for-byte,
 * and styles.test.ts checks it. If you change one, change the other too.
 */
export const ENTER = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EXIT = "cubic-bezier(0.45, 0, 0.9, 0.35)";

/**
 * The third curve, and the only one that overshoots.
 *
 * Everything above is orienting motion — the screen changed and the move tells
 * you where things went — and orienting motion does not bounce, because an
 * overshoot is the machine adding a flourish to a fact. This one is not that.
 * It drives a *mark answering the pointer*: the trash lid tipping open under
 * the cursor, and whatever joins it. Nothing on screen has moved, nothing is
 * being reported, and the whole point is that the part feels like a physical
 * thing on a hinge — which is what the small overshoot buys and what a
 * decelerate cannot say.
 *
 * It is deliberately the *narrowest* possible exception. It may be used for a
 * hover gesture on a mark and nowhere else; a layer, a card, a sheet or a panel
 * that reaches for it is a layer that should be using ENTER. The app already
 * carries permanent decorative exceptions on exactly these terms — the sync
 * mark's loop, the spinner's, the mascot's — and this is one more, named here
 * rather than left as a literal in the stylesheet so it cannot pass for normal.
 *
 * styles.css restates it as `--ease-nudge` under the same byte-for-byte rule
 * ENTER and EXIT are held to, and styles.test.ts checks all three together.
 */
export const NUDGE = "cubic-bezier(0.34, 1.4, 0.64, 1)";

/**
 * How long a mark takes to answer the pointer.
 *
 * Longer than the app's own moves, and it should be: those are transitions
 * between two screens and want to be over, while this is a small thing moving
 * a short distance in place, where too short reads as a flinch. Under ~200ms
 * the tilt is a glitch; past ~800ms the mark is still moving after you have
 * read the row and moved on.
 *
 * CSS-only — no component animates a mark from JS — so the stylesheet holds
 * the value as `--nav-mark-ms` and this is the note saying where it lives.
 */
export const NAV_MARK_MS = 380;

/**
 * How long the capture bar's lamp takes to reach the caret.
 *
 * Shorter than anything that moves a thing you are looking at, and it has to
 * be: this one runs on keystrokes, so it is spent while you are typing rather
 * than while you are waiting. Nailed to the caret (0) the light snaps between
 * characters and reads as a second cursor; much past this it lags behind a fast
 * hand and turns into a comet, which is the light announcing itself instead of
 * lighting the paper. It is the pool arriving where you already are, and it
 * should be over before you notice it started.
 *
 * Handed to the stylesheet by `CaptureBar` as `--lamp-follow`, which is how
 * every duration but `NAV_MARK_MS` reaches CSS here — so this stays the only
 * copy of the number.
 */
export const LAMP_FOLLOW_MS = 110;

/**
 * The lamp coming *up* — when the field takes focus, and when a caret that had
 * gone quiet starts moving again. Longer than the light's own travel, because
 * this one is the field changing state rather than the light chasing a caret,
 * and a texture that snaps on is a texture you notice as an event.
 *
 * It is deliberately not the same number as `LAMP_DIM_MS`, and the asymmetry is
 * the point: a light comes on all at once and goes out slowly, so coming back
 * has to be quick enough to feel like an answer to the keystroke that asked
 * for it, and going out has to be slow enough that nothing is seen to happen.
 */
export const LAMP_FADE_MS = 420;

/**
 * The lamp going *down*, once the field has been left alone for
 * `LAMP_DWELL_MS`.
 *
 * Nearly four times the fade up, because the two are not the same event. Coming
 * on is a reply to something the user just did; going out is something the room
 * does while nobody is watching it, and the whole of the effect is that it is
 * never caught happening. At `LAMP_FADE_MS` on the way out — which is what this
 * used to be — the light did not dim, it switched off, and the eye reads a
 * switch as an event even when nothing was meant by it.
 *
 * Paired with `--ease-exit` in the stylesheet rather than `--ease-enter`, which
 * is the other half of the same fault: `--ease-enter` is a hard decelerate, so
 * the old fade-out spent most of its brightness inside the first fifty
 * milliseconds and then lingered near nothing. Slow at the front is what makes
 * a dimming light unnoticeable; the fast tail at the end is spent below the
 * point where there is anything left to see.
 */
export const LAMP_DIM_MS = 1600;

/**
 * How long the lamp holds its light before it settles back to nothing.
 *
 * A threshold, not a move — it sits beside `PEEK_WAIT_MS` rather than beside
 * `LAMP_FADE_MS`, because it measures a pause, not a travel. While the field
 * is focused the light stays up; after this much silence it fades out, and the
 * next keystroke brings it back. The light is there to answer "where is the
 * caret", and a caret that has not moved for this long has already been found.
 */
export const LAMP_DWELL_MS = 3000;

/**
 * One breath of a lit lamp: the pool swelling and settling back, once.
 *
 * Seven seconds, because the breath is not there to be watched — it is there
 * so that a light which is on for a minute is not a *printed* light. Under
 * about four seconds the swell reads as a pulse and the eye starts counting
 * it; this long, it is only ever noticed when looked for. The stylesheet's
 * `lamp-breathe` keyframes hold the amplitude, and it swells on ENTER and
 * settles on EXIT — an arrival and a departure, like everything else here.
 */
export const LAMP_BREATH_MS = 7000;

/**
 * One pass of the lamp's flicker — a handful of dips of a few percent at
 * irregular spacing, written out in the stylesheet's `lamp-flicker`
 * keyframes.
 *
 * Deliberately not a divisor of `LAMP_BREATH_MS`, and deliberately prime-ish
 * against it: the two loops drift, so a dip never lands on the same point of
 * the breath twice running. A lamp that repeats itself is a lamp you can
 * predict, and a predictable flicker is a metronome — which is the one thing
 * a flicker must not be.
 */
export const LAMP_FLICKER_MS = 3700;

/** A note opening out of its card, and shrinking back into it. */
export const OPEN_MS = 240;
export const CLOSE_MS = 180;
/**
 * A card growing under a resting pointer, and dropping back into its row.
 *
 * Much shorter than opening a note, and deliberately. Opening a note is a
 * change of place and the move is what carries you there; the peek is an answer
 * to a question you asked by not moving, and an answer that takes a quarter of
 * a second to arrive reads as the machine thinking rather than as the screen
 * responding. Long enough to see which card grew, and no longer.
 */
export const PEEK_MS = 200;
/**
 * A note collapsing into the mark of what just happened to it.
 *
 * Long on purpose. At 300ms the shrink and the mark were both technically
 * drawn and neither was *read* — you saw a card go and could not have said
 * where. The mark has to be legible as a mark, held still for a beat, before
 * it is worth drawing at all.
 */
export const VANISH_MS = 460;

/**
 * How long the grid waits before closing the gap. The card leaving and the
 * cards moving are two events, and playing them together made the second one
 * cover the first. This holds the grid exactly where it was until the mark has
 * had its beat, then slides everything shut.
 */
export const REFLOW_HOLD_MS = 380;
/** Paging boards: out is faster than in, so the new board is what you watch. */
export const SLIDE_OUT_MS = 120;
export const SLIDE_IN_MS = 280;
/** Cards closing the gap left by one that went away. */
export const REFLOW_MS = 280;

/**
 * A card drawing its own border once, after it was written or after you closed
 * it — two strokes from the top-left corner, meeting again at the bottom-right.
 *
 * It exists because the grid is a wall of near-identical tiles and you have
 * just come back to it from somewhere else. Without it you are returned to a
 * static screen and have to find your note again by reading. The whole figure
 * must be finished and gone by this, or it stops being feedback and starts
 * being decoration. The stylesheet's own timings — two 130ms strokes, then
 * a 260ms fade from 320ms — end at 580ms; this is the ceiling they sit
 * under, not a sum of them, and the card is unmounted at it.
 */
export const TRACE_MS = 640;

/**
 * The mascot moving house: a puff of smoke in the header as it leaves for the
 * empty board, and another as it comes home (`mascot-element.ts`, 2026-09-29,
 * asked for by the owner; the sleeping one on the board simply is there,
 * 2026-10-12).
 *
 * There is only ever one creature on screen. It lives in the header, and when
 * an empty board draws it asleep in the middle of the room the header's copy
 * has to *go* rather than stand beside it as a twin. A cut would say "there
 * were two and now there is one"; the smoke says "it went over there", which
 * makes this orienting motion — the same job every other number in this file
 * does — rather than one of the element's own loops, whose durations stay in
 * the element because they time a picture, not a move.
 *
 * No two clouds are alike (`lib/poof.ts` draws a new one every play), so the
 * whole cloud, first puff to last wisp, is a range rather than one number:
 * `POOF_MIN_MS` to `POOF_MS`. Under about 300ms it reads as a flash; past
 * about 550 it is still hanging in the header after the eye has gone to the
 * board. The puffs swell on ENTER and thin on EXIT — most of the size arrives
 * at once — so the cloud never bounces and never needs NUDGE.
 */
export const POOF_MS = 520;
/** The shortest a cloud ever lasts — see POOF_MS. */
export const POOF_MIN_MS = 400;
/**
 * How long the creature itself takes to shrink into the cloud (its growing out
 * of one is POOF_GROW_MS). Much shorter than the cloud, because the cloud is what covers it: by
 * the time the smoke is thickest the creature has already gone, or is already
 * there. Leaving takes EXIT and arriving takes ENTER, like everything else.
 */
export const POOF_VANISH_MS = 160;
/**
 * Coming home, the creature grows out of the cloud rather than standing up
 * inside it (2026-10-23, owner: "it looks very static and just pops up behind
 * the smoke"). It starts small (`POOF_GROW_FROM` of its size) a little before
 * the cloud is at its thickest (`POOF_GROW_AT`, a fraction of the cloud's own
 * length), and is still growing as the smoke thins, so the growth is what is
 * seen. It passes its size by `POOF_GROW_PAST` and settles back, which is the
 * difference between a thing arriving and a picture being swapped. ENTER
 * between the keyframes; the settle is a keyframe, not NUDGE, which stays the
 * pointer's alone.
 */
export const POOF_GROW_MS = 380;
/** See POOF_GROW_MS. */
export const POOF_GROW_FROM = 0.15;
/** See POOF_GROW_MS. */
export const POOF_GROW_AT = 0.3;
/** See POOF_GROW_MS. */
export const POOF_GROW_PAST = 1.06;
/**
 * The window the puffs start in, each at its own random moment inside it (the
 * small wisps up to half as late again). A cloud whose puffs all swell
 * together is one circle getting bigger; scattered over a few tens of
 * milliseconds it billows, and every puff is out inside the first fifth.
 */
export const POOF_STAGGER_MS = 60;

/*
 * There is no LINEAR here any more.
 *
 * One stood in this spot, for the two fades in NoteView — the chrome arriving
 * on an opening note, the words leaving ahead of a close — on the argument
 * that a wash of opacity has no destination and so no curve to arrive on.
 * It was a good argument and it lost: the user asked, by name, that nothing
 * in the app move at a constant rate, fades included. Both now take ENTER and
 * EXIT like every other arrival and departure here.
 *
 * What is still allowed to be linear is a *picture* of a constant rate, and
 * only that: the undo clock's sweep, which is a countdown and would be lying
 * if it hurried; the sync mark's flowing stream and the spinner's falling
 * sand, which are loops, and a loop that eases pulses. Those are literals in
 * styles.css, each named one at a time in styles.test.ts's allowlist so that
 * adding a fourth has to be an argument rather than a habit.
 */

/**
 * A picture that arrived late coming up out of the dark, like a print in a
 * developer tray (`lib/usePrint.ts`, 2026-10-14, owner approved).
 *
 * Slow at the front and done at the back — the picture is there as a ghost
 * before it is there at all — and well under a second, because it is a
 * picture arriving, not a show. Only a picture that was *not* ready when it
 * was drawn gets it; one already on the device appears at once. Tone only: the
 * element's own opacity from nothing to wherever the stylesheet puts it, so no
 * colour, no scale, no blur. Run from script (`animates`), never the stylesheet.
 */
export const PRINT_MS = 520;

/**
 * The pen going through a ticked item, left to right, and the words settling to
 * muted as it passes (`components/shared/Pen.tsx`, 2026-10-14, owner approved).
 *
 * About a fifth of a second: a tick is the most repeated happy action in the
 * app and it must never make you wait for your own hand. Un-ticking wipes the
 * same line back the other way in the same time. The Ticker's Archive mark
 * steps from muted to ink on it too, when the last box goes. A CSS transition
 * (the strike is a drawn line, so it cannot be a decoration), so the number
 * reaches the stylesheet as the inline custom property `--strike-ms`, the way
 * every lamp duration does, and this stays the only copy.
 */
export const STRIKE_MS = 200;

/**
 * A note opened from a search result lighting up around its hits: the matched
 * words stand at full ink while the rest of the note starts muted and comes up
 * to ink, the lamp falling on what you asked for and then the page opening
 * round it (`NoteReader`, `.reader[data-dim]`; 2026-10-14, owner approved).
 *
 * A breath, not a beat. The first part is a hold — the eye has to be given
 * the muted page long enough to land on the hit — and the rise after it
 * arrives on ENTER. It is over before there is any reason to have started
 * typing, and typing ends it at once (the note drops its hits at the first
 * tap). CSS-only, so it reaches the stylesheet as `--lit-ms`, an inline
 * custom property, and this stays the only copy of the number.
 */
export const LIT_MS = 640;

/** The bar's chrome fading in once the note sheet starts opening — see
 *  `openMorph` in NoteView.tsx. */
export const BAR_FADE_IN_MS = 140;
/** The words rising in behind the bar, once the frame has led the move. */
export const WORDS_RISE_MS = 200;
/** How long the words hold back before rising in, so the frame arrives first. */
export const WORDS_RISE_DELAY_MS = 50;
/** The words fading out first when a note closes back into its card. */
export const WORDS_FADE_CLOSE_MS = 90;
/** The words fading out first when a note collapses into its vanish mark. */
export const WORDS_FADE_VANISH_MS = 80;

/**
 * A card that just arrived — captured, or put back from the trash — fading
 * in while the grid below it is still sliding its gap shut. Deliberately
 * its own number rather than a reuse of `REFLOW_MS`: an arrival and a
 * slide-together are two different moves that happen to run a similar
 * length, not one move wearing two names.
 */
export const REFLOW_ARRIVE_MS = 220;

/**
 * A drag let go of without going far enough to mean anything, sliding back to
 * where it started — the deck when a board swipe is abandoned
 * (`useBoardPaging`), and the open note's body when a swipe to the note beside
 * it is (`useNoteSwiping`). One move, so one name and one function —
 * `settleBack` in `lib/swipe.ts`: the two gestures differ in what they would
 * have done, not in how a refusal settles.
 *
 * This used to say the second one was "a card when an archive swipe is", which
 * was never true of any code in this repository. A card carries no swipe at
 * all: it sits inside the element that owns board paging, so the two would
 * compete for one finger, and the rule that promised it is withdrawn
 * (`SPEC.md` §6 and §12). `useNoteSwiping` has only ever moved *between*
 * notes, inside the open note's own layer, and archives nothing.
 */
export const SETTLE_BACK_MS = 220;

/**
 * The end-of-run report writing itself in (joy review 2026-10-14, #9): each
 * line's hairline draws left to right, one after another, the way a note traces
 * its border. The whole report is under three quarters of a second even with
 * seven lines; a line's own stroke is short, and the gap between lines is what
 * makes it read as a hand writing down a list rather than a page appearing.
 */
export const TALLY_DRAW_MS = 160;
export const TALLY_STAGGER_MS = 70;


/**
 * A board carried along the shelf (`lib/useBoardPress.ts`): the neighbours
 * stepping aside to show where it would land, and the board settling into
 * that seat when it is let go.
 *
 * Making way is the shorter of the two because it happens *under* the finger
 * and has to keep up with it — a gap that opens a beat late reads as the shelf
 * disagreeing with you. Settling is the one move a reader watches from start
 * to end, so it takes a little longer and arrives on ENTER like everything
 * else. A drag abandoned (Escape, a cancelled pointer) is neither of these:
 * it is `SETTLE_BACK_MS`, the refusal every other drag here settles on.
 * Under reduced motion none of the three runs; the tabs simply are where they
 * are.
 */
export const MAKE_WAY_MS = 140;
export const SHELF_DROP_MS = 200;

/**
 * A count's digits changing — the film counter (joy review #1, 2026-10-14,
 * owner approved). The old digit slides up out of a one-digit window and the
 * new one rises in behind it, by clip, on ENTER. Short and calm: the Inbox
 * draining under Tidy up is a tick-tick-tick you catch at the edge of your
 * eye, and a roll that is still turning when the next one starts is a
 * machine stuck rather than counting. Never on first paint, never under
 * reduced motion (`animates()`), never when a count merely appears.
 */
export const COUNT_ROLL_MS = 200;

/**
 * The light coming on when the app is opened cold (joy review #10, 2026-10-14,
 * owner approved — the one exception to "the board you are on does not
 * animate", DESIGN.md §2c). The lit board comes up from dark to its normal
 * lamp, once, on the first paint of the session, and nothing waits for it.
 * About half a second: slower than the lamp coming on under a caret
 * (`LAMP_FADE_MS`) because nobody is waiting on it, quicker than anything
 * you would stop to watch.
 */
export const COLD_LAMP_MS = 500;

/**
 * A new device's first screenful of cards being dealt (joy review #15,
 * 2026-10-14, owner approved): each card is revealed by a clip along ENTER,
 * one after another. `DEAL_TOTAL_MS` is the ceiling for the whole thing, last
 * card finished; the stagger is worked out from it, so a full screen is
 * dealt as fast as a short one is. Only ever on the first sync of an empty
 * device, never on an ordinary open.
 */
export const DEAL_CARD_MS = 180;
export const DEAL_TOTAL_MS = 380;
export const DEAL_STEP_MS = 40;
export const DEAL_MAX_CARDS = 12;

/**
 * A hover hint coming up (`lib/hoverTips.ts`), on ENTER. Quick, because the
 * wait before it is the part that keeps it out of the way; the fade is only so
 * it does not snap on like a flicker. It goes at once, and a hint that follows
 * straight on from another skips the fade, so running the pointer along the
 * board strip reads as one label changing its words.
 */
export const TIP_IN_MS = 120;

/**
 * The one definition of the preference, exported because a component that has
 * to *keep listening* (rather than read once) still has to name the same query
 * — see `Mascot`, whose boil is SMIL and cannot be reached by a media query at
 * all. Written twice, the two would drift.
 */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * True when the system asks for less motion **or** this device chose Reduced
 * in Settings (2026-10-11, owner approved). The setting reaches here as
 * `data-motion="reduced"` on <html>, put there by `lib/theme.ts` — the same
 * attribute the stylesheet keys its copy of every reduced-motion block on
 * (`lib/motionSetting.ts`), so script and CSS can never disagree. It adds to
 * the system's answer and never takes it away.
 */
export function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.documentElement.dataset.motion === "reduced") {
    return true;
  }
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/**
 * True when this element can actually play an animation and the user has not
 * asked us not to. jsdom has no Web Animations, so every caller needs the
 * check anyway — folding the preference into it means no caller can forget it.
 */
export function animates(el: Element | null | undefined): el is HTMLElement {
  return (
    Boolean(el) &&
    typeof (el as HTMLElement).animate === "function" &&
    !reducedMotion()
  );
}

/** Cancels whatever is still running on an element, filled or not. */
export function stopAnimations(el: Element | null | undefined) {
  if (!el || typeof el.getAnimations !== "function") return;
  for (const a of el.getAnimations()) a.cancel();
}

/**
 * Calls `done` once: when `animation` finishes, or `lateMs` from now if it
 * never does.
 *
 * A tab put in the background never fires `onfinish`, so anything that waits
 * on an animation — a layer's close, a swipe that commits on landing — would
 * wait for ever and strand itself on screen. Each of those carries a backup
 * timer, and whichever comes first is the one that counts: the finish calls
 * the timer off, and a finish after the timer does nothing. The margin is the
 * caller's own; keep it wide enough that a busy machine does not cut a move
 * that is still running (the picture's close was cut at 140 ms, 2026-10-09).
 *
 * Hands back what calls the timer off, for a caller torn down before either
 * comes: an unowned timer holding a close is aimed at whatever layer is up
 * when it goes off.
 */
export function finishOnce(animation: Animation, done: () => void, lateMs: number): () => void {
  let over = false;
  const finish = () => {
    if (over) return;
    over = true;
    window.clearTimeout(late);
    done();
  };
  animation.onfinish = finish;
  const late = window.setTimeout(finish, lateMs);
  return () => window.clearTimeout(late);
}

/* --- clips ------------------------------------------------------------------
   A full-screen layer can be made to look card-sized by clipping it, and a clip
   costs the contents nothing: the type stays the size it was set at for the
   whole move. These build the two clips the app needs, both against the
   viewport, both clamped to it so a card half-scrolled off the top can't ask
   for a negative inset. */

export const FULL_CLIP = "inset(0px 0px 0px 0px)";

/** The rect a card occupies, expressed as a clip on a fixed full-screen layer. */
export function clipOfRect(from: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): string {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const top = Math.max(0, Math.min(from.top, h));
  const left = Math.max(0, Math.min(from.left, w));
  const right = Math.max(0, w - Math.min(from.right, w));
  const bottom = Math.max(0, h - Math.min(from.bottom, h));
  return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

/** A square in the middle of the screen — where a note goes when it's gone. */
export function clipOfCentre(size: number): string {
  const w = window.innerWidth || 1;
  const h = window.innerHeight || 1;
  const x = Math.max(0, (w - size) / 2);
  const y = Math.max(0, (h - size) / 2);
  return `inset(${y}px ${x}px ${y}px ${x}px)`;
}
