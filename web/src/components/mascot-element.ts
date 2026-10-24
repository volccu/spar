import {
  ENTER,
  EXIT,
  POOF_GROW_AT,
  POOF_GROW_FROM,
  POOF_GROW_MS,
  POOF_GROW_PAST,
  POOF_VANISH_MS,
  REDUCED_MOTION_QUERY,
  animates,
  reducedMotion,
} from "../lib/motion";
import { POOF_CENTRE, planPoof, type PoofPlan } from "../lib/poof";
import { onSettingsChange } from "../lib/settings";

/**
 * The creature in the header, and on an empty board.
 *
 * A custom element rather than a React component, and that is the whole point
 * of it. Every state it can be in is a *running animation* — a breath on a
 * 3.4s cycle, legs stepping on 1.36s against a 0.68s body rock — and React's
 * job is to re-render, which is exactly the thing that would restart those
 * cycles from zero. Owning its own shadow root means the app can only ever
 * hand it an attribute; nothing React does upstream can reach inside and
 * twitch it. `components/Mascot.tsx` is the thin wrapper that places it.
 *
 * It is one creature, and only ever one is on screen: while the empty board
 * draws it, the header's copy is away, leaving in a puff of smoke and coming
 * home out of another (`#settle`, below). The smoke is the one part of this
 * file that is the app's motion language rather than the drawing's own, so its
 * durations come from `lib/motion.ts` and its shape from `lib/poof.ts`.
 *
 * The drawing, the keyframes and every duration in them are the finished
 * design, copied across unchanged from the preview it was drawn in
 * (`TEMP/mascot/mascot-standalone.html`, kept as a reference artifact and not
 * as live code). The timings are tuned against each other — the legs step on
 * 1.36s against a 0.68s body rock so a step lands on alternating peaks —
 * so rounding a number or tidying a keyframe percentage breaks the walk.
 * Three things were mapped on the way in, and only three:
 *
 *  - **Colour.** The design themes itself through two inherited custom
 *    properties, which is the right mechanism and the one kept. The values it
 *    suggested are not: `#c06c53` is a hue, and `DESIGN.md` is absolute that
 *    this app has none. The properties are therefore named for what they draw
 *    rather than for a colour role — `--mascot-screen`, not `--mascot-accent`,
 *    because "accent" in an app with no accent is an invitation — and
 *    styles.css sets all three from the ramp. There are no literal fallbacks
 *    here on purpose: a fallback is where a hue creeps back in.
 *  - **The Zs' face.** They are `<text>`, and in the demo they inherited the
 *    page's sans. Inherited here they would come out in Libre Baskerville —
 *    the face the *user's words* are set in — so they are pinned to `--mono`,
 *    the machine face, which is the call the rest of the app already makes for
 *    anything the app itself is saying. Their `font-size` is in viewBox units,
 *    not CSS pixels: it scales with the drawing, so it is a dimension like
 *    `r="3.2"` and not a seventh type size.
 *  - **Reduced motion and a backgrounded tab.** See `refreshMotion` below.
 *    The CSS half of both was already here; the SMIL half was not, and SMIL is
 *    what the two `feTurbulence` filters cost real battery on.
 */

export const MASCOT_TAG = "spar-mascot";

export type MascotState = "idle" | "working" | "empty" | "offline";

interface Drawing {
  /** What a screen reader says when the drawing is focused. */
  label: string;
  antenna: string;
  face: string;
  extras: string;
}

const STATES: Record<MascotState, Drawing> = {
  idle: {
    label: "Synced",
    antenna: '<line x1="50" y1="30" x2="50" y2="18"/><circle class="knob" cx="50" cy="14" r="3.2"/>',
    face: '<circle class="eye mark" cx="39" cy="50" r="3.4"/><circle class="eye eye-r mark" cx="61" cy="50" r="3.4"/><line x1="47" y1="58" x2="53" y2="58"/>',
    extras: "",
  },
  working: {
    label: "Syncing",
    antenna: '<path d="M50 30 Q55 21 61 19" fill="none"/><circle class="knob" cx="63" cy="18" r="3.2"/>',
    face: '<circle class="dot mark" cx="38" cy="52" r="3.2"/><circle class="dot dot-b mark" cx="50" cy="52" r="3.2"/><circle class="dot dot-c mark" cx="62" cy="52" r="3.2"/>',
    extras: "",
  },
  empty: {
    label: "Nothing here yet",
    antenna: '<path d="M50 30 Q50 22 44 19" fill="none"/><circle class="knob" cx="42" cy="18" r="3.2"/>',
    face: '<line x1="35" y1="50" x2="43" y2="50"/><line x1="57" y1="50" x2="65" y2="50"/><circle class="mark" cx="50" cy="58" r="1.9"/>',
    extras:
      '<text class="z" x="72" y="28" font-size="14" font-weight="700">Z</text><text class="z z-b" x="80" y="17" font-size="19" font-weight="700">Z</text>',
  },
  offline: {
    label: "Offline",
    antenna: '<path d="M50 30 L50 24 L58 21" fill="none"/><circle class="knob" cx="60" cy="20" r="3.2"/>',
    face: "",
    extras: "",
  },
};

/**
 * Speaking (`speaking`, 2026-10-16, owner approved): while the bubble beside it
 * stands, the creature turns to it — the eyes go across to the words, the
 * antenna leans that way. Asking (an undo offer) it also rounds its mouth and
 * lifts one small question mark, once. Not states: the app is still synced,
 * syncing or offline underneath, and those keep their own faces — only the
 * calm face turns. The bubble is `components/Speech.tsx`.
 */
export type Speaking = "say" | "ask";

const SPEAKING: Record<Speaking, Drawing> = {
  say: {
    label: STATES.idle.label,
    antenna: STATES.idle.antenna,
    face: '<circle class="eye mark" cx="45" cy="50" r="3.4"/><circle class="eye eye-r mark" cx="66" cy="50" r="3.4"/><line x1="53" y1="58" x2="59" y2="58"/>',
    extras: "",
  },
  ask: {
    label: STATES.idle.label,
    antenna: STATES.idle.antenna,
    face: '<circle class="eye mark" cx="45" cy="49" r="3.4"/><circle class="eye eye-r mark" cx="66" cy="49" r="3.4"/><circle class="o" cx="56" cy="59" r="2.6"/>',
    extras: '<text class="q" x="70" y="20" font-size="22" font-weight="700">?</text>',
  },
};

/** The one state whose face turns to the bubble. */
const STATES_CALM: MascotState = "idle";

/*
 * The moments of 2026-10-16 (owner: "build all of those"). Each is a face drawn
 * over the calm one for a moment, or a one-shot move, or both — never a state:
 * the app is still synced, syncing or offline underneath.
 */

/**
 * Late at night (`isLate`) the calm face is sleepy: eyes shut in two soft
 * u-curves, a small smile, antenna drooping (owner's own drawing, 2026-10-19).
 */
const DROWSY: Drawing = {
  label: STATES.idle.label,
  antenna: '<path d="M50 30 Q51 22 46 18" fill="none"/><circle class="knob" cx="45" cy="17" r="3.2"/>',
  face:
    '<path class="lid" d="M33.5 47.5 Q39 55.5 44.5 47.5"/><path class="lid" d="M55.5 47.5 Q61 55.5 66.5 47.5"/>' +
    '<path class="lid" d="M45.5 57.5 Q50 62 54.5 57.5"/>',
  extras: "",
};

/** Pleased: eyes closed in two arcs. A ticked-off list, a card taken for the archive. */
const PLEASED: Drawing = {
  label: STATES.idle.label,
  antenna: STATES.idle.antenna,
  face: '<path d="M35 52 Q39 46.5 43 52"/><path d="M57 52 Q61 46.5 65 52"/><line x1="47" y1="58" x2="53" y2="58"/>',
  extras: "",
};

/** A search that found nothing: eyes up and aside, the mouth askew. */
const SHRUG_FACE: Drawing = {
  label: STATES.idle.label,
  antenna: STATES.idle.antenna,
  face: '<circle class="eye mark" cx="41" cy="47" r="3.4"/><circle class="eye eye-r mark" cx="63" cy="47" r="3.4"/><line x1="45" y1="60" x2="55" y2="57"/>',
  extras: "",
};

/** Just after a camera flash: screwed-up eyes. */
const SQUINT: Drawing = {
  label: STATES.idle.label,
  antenna: STATES.idle.antenna,
  face: '<path d="M35 47 L42 50.5 L35 54"/><path d="M65 47 L58 50.5 L65 54"/><line x1="47" y1="59" x2="53" y2="59"/>',
  extras: "",
};

/** A card carried over it: mouth open, ready to take it. */
const CATCHING: Drawing = {
  label: STATES.idle.label,
  antenna: '<line x1="50" y1="30" x2="50" y2="16"/><circle class="knob" cx="50" cy="12" r="3.2"/>',
  face: '<circle class="eye mark" cx="39" cy="48" r="3.6"/><circle class="eye eye-r mark" cx="61" cy="48" r="3.6"/><circle class="o" cx="50" cy="59" r="3.4"/>',
  extras: "",
};

/**
 * The one-shot moves, each a class on the svg for its length. Newest wins:
 * starting one takes every other off first, the way poke() and notice() always
 * have, so two never stack and leave rule order to pick.
 */
export type Gesture = "hop" | "yes" | "shrug" | "shake" | "spin" | "gulp" | "flash";
const GESTURE_MS: Record<Gesture, number> = {
  hop: 900,
  yes: 950,
  shrug: 1100,
  shake: 700,
  spin: 800,
  gulp: 700,
  flash: 650,
};
/** The face each move wears over the calm one, and for how long. */
const GESTURE_FACE: Partial<Record<Gesture, [Drawing, number]>> = {
  yes: [PLEASED, 1100],
  gulp: [PLEASED, 900],
  shrug: [SHRUG_FACE, 1400],
  flash: [SQUINT, 900],
};
const ONE_SHOTS = ["poked", "noted", ...(Object.keys(GESTURE_MS) as Gesture[]).map((g) => `g-${g}`)];

/** How long the milestone's sign is held up, from rising to lowered. */
const SIGN_MS = 2600;
/** How long the eyes look toward something before they come back. */
const GLANCE_MS = 1300;
/** How far, in drawing units, a glance moves the eyes at most. */
const GLANCE_X = 4;
const GLANCE_Y = 3;
/** Poked awake late at night, it stays awake this long before it droops again. */
const WOKEN_MS = 10 * 60_000;
/** A horizontal stroke this long across it, quicker than this, is a swipe: it spins. */
const SPIN_SWIPE_PX = 24;
const SPIN_SWIPE_MS = 600;

/** Late: from 23:00 until 05:00, on this device's own clock. */
export function isLate(at: Date = new Date()): boolean {
  const h = at.getHours();
  return h >= 23 || h < 5;
}

/**
 * What the creature asks to know whether it is late. A test suite run at
 * night must not see a drowsy face it never asked for — the deploy hook runs
 * the suite — so the shared test setup hands in a daytime clock
 * (`src/test/daytime.ts`). No argument puts the device's own back.
 */
let lateNow: () => boolean = () => isLate();
export function setLateClock(next?: () => boolean) {
  lateNow = next ?? (() => isLate());
}

/** Whether it is late by the clock the creature reads — what its words ask too. */
export function itIsLate(): boolean {
  return lateNow();
}

const STATE_KEYS = Object.keys(STATES) as MascotState[];
const STATE_CLASSES = STATE_KEYS.map((key) => `is-${key}`);

/**
 * The sleeping creature, poked: one eye opens and looks at you, the other stays
 * shut, the antenna half lifts. Not a state — nothing in the app is ever
 * "peeking" — so it is not in STATES; it is drawn over `empty` for a moment
 * (`PEEK_MS`) and the sleep comes back by the ordinary crossfade, which redraws
 * the Zs and so lifts a fresh one. The shut eye and the mouth are the sleeping
 * face's own lines, so the only thing that changed is the one eye.
 */
const PEEK: Drawing = {
  label: STATES.empty.label,
  antenna: '<path d="M50 30 Q51 22 47 17" fill="none"/><circle class="knob" cx="46" cy="15" r="3.2"/>',
  face: '<line x1="35" y1="50" x2="43" y2="50"/><circle class="eye mark" cx="61" cy="50" r="3.8"/><circle class="mark" cx="50" cy="58" r="1.9"/>',
  extras: "",
};

/**
 * How long the screen dips before the face and antenna are swapped under it.
 * It has to match the `.07s` opacity transition in the stylesheet below — the
 * swap happens at the bottom of the dip, and either half moving on its own
 * turns the crossfade back into the hard cut it exists to prevent.
 */
const SWAP_MS = 70;
/** One startle, from the flinch to the settle. Matches the two poke keyframes. */
const POKE_MS = 800;
/**
 * One nod, from the dip to the settle. Matches the three notice keyframes.
 * Lives here beside POKE_MS rather than in `lib/motion.ts` for the same reason
 * every duration in this file does: it times a picture that happens to move,
 * not the app's motion language.
 */
const NOD_MS = 700;

/**
 * How long the sleeping creature looks at you after a poke before it goes back
 * to sleep: the startle (`POKE_MS`) and then a beat of looking.
 */
const PEEK_MS = 1300;
/**
 * How long a creature that arrives on a board you have just emptied stays
 * awake before it dims to the sleeping face (DESIGN.md §7). About a second:
 * long enough to be seen awake, short enough that the sleep reads as the
 * reason it came.
 */
const AWAKE_MS = 1100;

/*
 * Tapping along: each keystroke in the write box kicks a spring, and the body
 * rides it — a dip at most the size of the capture's nod (scale 1.04 × .94 and
 * two units down, the `notice` keyframe's own numbers), so a burst of typing is
 * a run of small nods and never a bigger move than the app already makes. A
 * spring rather than a keyframe because keys come faster than any keyframe
 * ends: restarting an animation per key snaps it back to the top every time,
 * which is the stutter a class-per-key version showed. A kick adds to whatever
 * the body is already doing, so fast typing simply keeps it a little dipped.
 *
 * Stiff enough that each key is its own bob, back up before the next one
 * lands at an ordinary typing speed, rather than one long squash.
 *
 * The antenna gets a flick of its own with every key, to one side or the
 * other, on a looser spring that wobbles back to upright: the knob jiggling
 * along. The eyes glance down at what you are writing and come back once you
 * stop. Under reduced motion none of it runs.
 */
/** Stiffness and damping of the body's spring (damping ratio ≈ .57: one small rebound). */
const TAP_K = 700;
const TAP_C = 30;
/** The kick one keystroke gives, in units of a full nod per second: about two thirds of a nod. */
const TAP_KICK = 36;
/** The antenna's looser spring, and the flick one keystroke gives it, in degrees per second. */
const TAP_ANTENNA_K = 220;
const TAP_ANTENNA_C = 10;
const TAP_ANTENNA_FLICK = 70;
/** The glance: critically damped, and held this long after the last key. */
const TAP_GLANCE_K = 200;
const TAP_GLANCE_HOLD_MS = 1200;
/** How far the eyes glance down, in drawing units. */
const TAP_GLANCE_PX = 1.8;

/*
 * There is only ever one creature on screen (2026-09-29, asked for by the
 * owner). It lives in the header — the instance placed with `home` — and when
 * any other mascot is drawn, which today means the empty board's, the header's
 * goes away in a puff of smoke, so what is seen is the creature *leaving*, not
 * a twin appearing. The other simply is there: no smoke of its own (2026-10-12,
 * the owner — "it does not need the smoke poof, it can be there"). When the
 * last other mascot leaves, the header's comes back home out of a puff.
 *
 * The three numbers below are thresholds, not moves, and sit here for the same
 * reason `WORKING_ENTER_MS` sits in `lib/mascotState.ts`: they say how long
 * something has to be true before it is worth drawing. The move itself — the
 * smoke — is `POOF_MS` and its neighbours in `lib/motion.ts`.
 */

/**
 * How long the header waits, once no other mascot is on screen, before it
 * comes home. Leaving is instant — the owner's word was "the instant the new
 * mascot appears" — but coming back is held for a moment, because the board
 * passes through states on its way somewhere: paging out of an empty board
 * and into another, or a card replacing the empty state the moment a note is
 * written, can take the other mascot down for a frame or two. Without the
 * wait the header would puff out and back in the middle of one gesture.
 */
const AWAY_GRACE_MS = 180;

/**
 * How long the header's creature has to have been on screen before its leaving
 * is worth drawing. A creature nobody has had time to see cannot be seen
 * moving: on an app that opens straight onto an empty Inbox the header's copy
 * is up for the few frames the store takes to load, and a puff of smoke at
 * that moment reads as a glitch rather than as the creature going anywhere. So
 * below this it simply is not there.
 */
const SEEN_MS = 300;

/**
 * How long a nod asked of the header while it was away is kept for its return.
 * A first note written on an empty Inbox is the case: the capture asks for the
 * nod just as the sleeping mascot gives way to the new card, and the header
 * comes home a moment after that. The nod is the receipt for that note, so it
 * is played when the creature lands — but only if that is soon enough to still
 * be *about* the note. A receipt handed over later is for nothing.
 */
const NOD_KEPT_MS = 1000;

/**
 * The cloud's markup for one play: every puff drawn twice, the same trick
 * every cartoon cloud uses — each puff's outline at double width underneath,
 * then every puff's fill on top, which covers the inside half of every outline
 * and leaves only the line round the outside of the whole cloud. One outline,
 * however many puffs overlap. Rebuilt every play, because no two clouds have
 * the same puffs (`lib/poof.ts`).
 */
function smokeMarkup(plan: PoofPlan): string {
  const circles = (cls: string) =>
    plan.puffs
      .map(
        ({ cx, cy, r }, i) =>
          `<circle class="${cls}" data-puff="${i}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`,
      )
      .join("");
  return `<g class="smoke-lines">${circles("smoke-line")}</g><g class="smoke-fills">${circles("smoke-fill")}</g>`;
}

/**
 * Where the smoke's randomness comes from. `Math.random` in the app; a test
 * hands in a seeded source (`setPoofRandom`) so a cloud can be asserted on.
 */
let poofRandom: () => number = Math.random;

/** For tests: the source every following cloud is planned from. No argument puts `Math.random` back. */
export function setPoofRandom(next?: () => number) {
  poofRandom = next ?? Math.random;
}

const STYLE = `
    :host { display:inline-block; line-height:0; cursor:pointer; -webkit-tap-highlight-color:transparent; touch-action:pan-y; }
    svg { filter:url(#boil); stroke:var(--mascot-line); stroke-width:5.5; stroke-linecap:round; stroke-linejoin:round; fill:none; overflow:visible; }
    .screen { fill:var(--mascot-screen); stroke:none; }
    .knob { fill:var(--mascot-line); stroke:none; }
    .face { stroke:var(--mascot-face); stroke-width:5; }
    .mark { fill:var(--mascot-face); stroke:none; }
    .roll { fill:var(--mascot-face); }
    .z { fill:var(--mascot-line); stroke:none; font-family:var(--mono); }
    .q { fill:var(--mascot-line); stroke:none; font-family:var(--mono); opacity:0; transform-box:fill-box; transform-origin:center; animation:q-float 1.6s ease-out forwards; }
    .o { fill:none; stroke:var(--mascot-face); stroke-width:4; }
    .lean { transform-origin:50px 30px; transition:transform .3s cubic-bezier(.2,.9,.3,1.1); }
    svg.speaking .lean { transform:rotate(11deg); }
    .static-layer { display:none; }
    .is-offline .static-layer { display:initial; }
    .swapping .screen { opacity:.3; }
    .swapping .face, .swapping .extras { opacity:0; }
    .screen, .face, .extras { transition:opacity .07s linear; }
    .eye, .dot { transform-box:fill-box; transform-origin:center; }

    .is-idle .body { transform-origin:50px 75px; animation:breathe 3.4s ease-in-out infinite; }
    .is-idle .antenna { transform-origin:50px 30px; animation:sway 3.4s ease-in-out .18s infinite; }
    .is-idle .eye { animation:blink 5.4s infinite; }

    .is-working .body { transform-origin:50px 75px; animation:waddle .68s ease-in-out infinite alternate; }
    .is-working .antenna { transform-origin:50px 30px; animation:trail .68s ease-in-out .09s infinite alternate; }
    .is-working .leg-l { transform-origin:35px 75px; animation:step-l 1.36s infinite; }
    .is-working .leg-r { transform-origin:65px 75px; animation:step-r 1.36s infinite; }
    .is-working .dot { animation:dot-cycle 1.05s ease-in-out infinite; }
    .is-working .dot-b { animation-delay:.14s; }
    .is-working .dot-c { animation-delay:.28s; }

    .is-empty .body { transform-origin:50px 75px; animation:breathe-slow 4.6s ease-in-out infinite; }
    .is-empty .antenna { transform-origin:50px 30px; animation:nod 4.6s ease-in-out .22s infinite; }
    .is-empty .z { opacity:0; animation:z-float 3.6s linear infinite; }
    .is-empty .z-b { animation-delay:1.8s; }

    .is-offline .body { transform-origin:50px 85px; animation:shiver 5.4s ease-in-out infinite; }
    .is-offline .antenna { transform-origin:50px 30px; animation:slump 5.4s ease-in-out infinite; }
    .is-offline .roll { animation:roll 2.6s linear infinite; }

    /*
     * The startle brings its own pivots rather than borrowing the live state's.
     * transform-origin is not part of the animation shorthand, so leaving it
     * off meant a poke while offline squashed from that state's 50px 85px — the
     * ankles, chosen for a shiver that only moves sideways — and the flinch read
     * as a zoom instead of as weight landing on the body's base.
     */
    svg.poked .body { transform-origin:50px 75px; animation:startle .8s cubic-bezier(.2,.9,.3,1.1); }
    svg.poked .antenna { transform-origin:50px 30px; animation:startle-antenna .8s cubic-bezier(.2,.9,.3,1.1); }
    /*
     * The legs are drawn *outside* the .body group — they have to be, or the
     * walk could not swing them independently of the rock — so the startle has
     * to reach them by name or they stay planted while the body squashes and
     * launches off them. They pivot on the feet at y=85 rather than on the hips
     * the walk uses: a startle is weight landing on the floor and pushing off
     * it. The x of the origin is the one number here that cannot matter, since
     * nothing in startle-legs rotates.
     *
     * Naming each leg rather than the .legs group is deliberate twice over.
     * It is what outscores .is-working .leg-l (0,2,1 against 0,2,0), so the
     * step yields for the length of the startle instead of compounding with it
     * into a half-height leg. And it means every animation in the walk — body,
     * antenna and both legs — is replaced together and so restarts together
     * when the class comes off, which is the only way the 1.36s step keeps
     * landing on alternating peaks of the 0.68s rock. Animating the group
     * would leave the legs running on their old clock against a body that had
     * started a new one, and the walk would come back out of phase.
     */
    svg.poked .leg-l, svg.poked .leg-r { transform-origin:50px 85px; animation:startle-legs .8s cubic-bezier(.2,.9,.3,1.1); }

    /*
     * The nod: a capture's receipt. Everything the startle's two comments above
     * argue holds here unchanged — its own pivots, each leg named individually
     * so the walk restarts in phase — and one thing is new: these rules score
     * the same 0,2,1 as the poked ones, so between the two one-shots rule order
     * is the only tiebreak. It never actually decides anything, because poke()
     * and notice() each strip the other's class before starting — the newest
     * gesture is the one being answered — but the nod sits after the startle so
     * the stylesheet states the same preference the code enforces.
     */
    svg.noted .body { transform-origin:50px 75px; animation:notice .7s ease-in-out; }
    svg.noted .antenna { transform-origin:50px 30px; animation:notice-antenna .7s ease-in-out; }
    svg.noted .leg-l, svg.noted .leg-r { transform-origin:50px 85px; animation:notice-legs .7s ease-in-out; }

    /*
     * The moments (2026-10-16). Each brings its own pivots and names each leg,
     * for the reasons the startle's comments give. The whole-creature moves
     * (hop, spin) turn .creature, which the poof only ever animates by script.
     */
    .look { transition:transform .25s cubic-bezier(.2,.9,.3,1.1); }
    .lid { stroke-width:3.6; }
    .flash { fill:var(--mascot-face); stroke:none; opacity:0; pointer-events:none; }
    .sign { fill:var(--mascot-screen); stroke-width:4; }
    .sign-n { fill:var(--mascot-face); stroke:none; font-family:var(--mono); }
    .prop { animation:sign-up 2.6s cubic-bezier(.2,.9,.3,1.1) forwards; }
    svg.waiting .knob { animation:knob-wait 2.4s ease-in-out infinite; }
    svg.drowsy .body { animation-duration:4.6s; }
    svg.g-hop .creature { transform-origin:50px 85px; animation:hop .9s cubic-bezier(.3,.7,.4,1); }
    svg.g-hop .antenna { transform-origin:50px 30px; animation:hop-antenna .9s ease-in-out; }
    svg.g-yes .body { transform-origin:50px 75px; animation:yes .95s ease-in-out; }
    svg.g-yes .antenna { transform-origin:50px 30px; animation:yes-antenna .95s ease-in-out; }
    svg.g-yes .leg-l, svg.g-yes .leg-r { transform-origin:50px 85px; animation:yes-legs .95s ease-in-out; }
    svg.g-shrug .body { transform-origin:50px 75px; animation:shrug 1.1s ease-in-out; }
    svg.g-shrug .antenna { transform-origin:50px 30px; animation:shrug-antenna 1.1s ease-in-out; }
    svg.g-shrug .leg-l, svg.g-shrug .leg-r { transform-origin:50px 85px; animation:shrug-legs 1.1s ease-in-out; }
    svg.g-shake .body { transform-origin:50px 85px; animation:shake .7s linear; }
    svg.g-shake .antenna { transform-origin:50px 30px; animation:shake-antenna .7s linear; }
    svg.g-spin .creature { transform-origin:50px 62px; animation:spin .8s ease-in-out; }
    svg.g-gulp .body { transform-origin:50px 75px; animation:notice .7s ease-in-out; }
    svg.g-gulp .antenna { transform-origin:50px 30px; animation:notice-antenna .7s ease-in-out; }
    svg.g-gulp .leg-l, svg.g-gulp .leg-r { transform-origin:50px 85px; animation:notice-legs .7s ease-in-out; }
    svg.g-flash .flash { animation:flash .65s ease-out; }

    @keyframes hop { 0%,100% { transform:translateY(0) scale(1,1); } 16% { transform:translateY(0) scale(1.07,.9); } 42% { transform:translateY(-13px) scale(.95,1.06); } 64% { transform:translateY(0) scale(1.08,.9); } 82% { transform:translateY(0) scale(.98,1.02); } }
    @keyframes hop-antenna { 0%,100% { transform:rotate(0deg); } 20% { transform:rotate(-8deg); } 46% { transform:rotate(10deg); } 70% { transform:rotate(-6deg); } }
    @keyframes yes { 0%,40%,80%,100% { transform:translateY(0) scale(1,1); } 20%,60% { transform:translateY(2px) scale(1.03,.95); } }
    @keyframes yes-antenna { 0%,40%,80%,100% { transform:rotate(0deg); } 20%,60% { transform:rotate(9deg); } }
    @keyframes yes-legs { 0%,40%,80%,100% { transform:translateY(0) scaleY(1); } 20%,60% { transform:translateY(0) scaleY(.8); } }
    @keyframes shrug { 0%,100% { transform:translateY(0) scale(1,1); } 25%,65% { transform:translateY(-4px) scale(1.02,.97); } }
    @keyframes shrug-antenna { 0%,100% { transform:rotate(0deg); } 25%,65% { transform:rotate(-14deg); } }
    @keyframes shrug-legs { 0%,100% { transform:translateY(0) scaleY(1); } 25%,65% { transform:translateY(0) scaleY(1.4); } }
    @keyframes shake { 0%,100% { transform:translateX(0); } 10%,50% { transform:translateX(-3px); } 30%,70% { transform:translateX(3px); } 85% { transform:translateX(-1.5px); } }
    @keyframes shake-antenna { 0%,100% { transform:rotate(0deg); } 20%,60% { transform:rotate(12deg); } 40%,80% { transform:rotate(-12deg); } }
    @keyframes spin { 0%,100% { transform:translateY(0) scaleX(1); } 25% { transform:translateY(-3px) scaleX(.08); } 50% { transform:translateY(-4px) scaleX(-1); } 75% { transform:translateY(-3px) scaleX(-.08); } }
    @keyframes flash { 0% { opacity:0; } 12% { opacity:.95; } 100% { opacity:0; } }
    @keyframes sign-up { 0% { transform:translateY(34px); opacity:0; } 14% { transform:translateY(-3px); opacity:1; } 22% { transform:translateY(0); opacity:1; } 82% { transform:translateY(0); opacity:1; } 100% { transform:translateY(34px); opacity:0; } }
    @keyframes knob-wait { 0%,100% { opacity:1; } 50% { opacity:.15; } }

    @keyframes breathe { 0%,100% { transform:scale(1,1); } 50% { transform:scale(1.04,.94); } }
    @keyframes sway { 0%,100% { transform:rotate(-4deg); } 50% { transform:rotate(4deg); } }
    @keyframes blink { 0%,94%,100% { transform:scaleY(1); } 96% { transform:scaleY(.06); } }
    @keyframes waddle { 0% { transform:rotate(-7deg) translateY(-1px); } 100% { transform:rotate(7deg) translateY(-1px); } }
    @keyframes trail { 0% { transform:rotate(5deg); } 100% { transform:rotate(-5deg); } }
    @keyframes step-l { 0%,100% { transform:translateY(0) scaleY(1); } 25% { transform:translateY(-7px) scaleY(.72); } 50% { transform:translateY(0) scaleY(1); } }
    @keyframes step-r { 0%,50%,100% { transform:translateY(0) scaleY(1); } 75% { transform:translateY(-7px) scaleY(.72); } }
    @keyframes dot-cycle { 0%,66%,100% { transform:translateY(0); opacity:.35; } 30% { transform:translateY(-5px); opacity:1; } }
    @keyframes breathe-slow { 0%,100% { transform:scale(1,1); } 50% { transform:scale(1.06,.91); } }
    @keyframes nod { 0%,100% { transform:rotate(0deg); } 50% { transform:rotate(6deg); } }
    @keyframes z-float { 0% { transform:translate(0,0) scale(.5) rotate(-6deg); opacity:0; } 22% { opacity:1; } 100% { transform:translate(11px,-26px) scale(1.1) rotate(8deg); opacity:0; } }
    @keyframes shiver { 0%,82%,100% { transform:translateX(0); } 86% { transform:translateX(-2px); } 90% { transform:translateX(2px); } 94% { transform:translateX(-1px); } }
    @keyframes slump { 0%,100% { transform:rotate(2deg); } 50% { transform:rotate(-3deg); } }
    @keyframes roll { 0% { transform:translateY(-8px); } 100% { transform:translateY(31px); } }
    @keyframes startle { 0% { transform:scale(1,1) translateY(0); } 12% { transform:scale(1.14,.86) translateY(3px); } 32% { transform:scale(.93,1.09) translateY(-7px); } 54% { transform:scale(1.05,.96) translateY(0); } 74% { transform:scale(.98,1.02) translateY(0); } 100% { transform:scale(1,1) translateY(0); } }
    @keyframes startle-antenna { 0% { transform:rotate(0deg); } 18% { transform:rotate(-15deg); } 44% { transform:rotate(12deg); } 68% { transform:rotate(-5deg); } 100% { transform:rotate(0deg); } }
    /*
     * Read straight off the startle above, because the legs are holding the
     * body up and a leg that disagrees with the body it carries is the whole
     * tell. The body is 30..75 and scales about its base; the legs are 75..85
     * and scale about their feet, so each step here is the arithmetic of where
     * that base ended up. At 12% the base is driven down to y=78 (a .86 squash
     * plus 3px of travel), leaving 7 of the leg's 10 units: .7. At 32% the base
     * is at y=68, so the legs go up the same 7px, and stretch a little rather
     * than tucking — a startle yanks the body off its feet, it does not jump.
     * 54% and 74% are the landing and the rebound against a base that is home.
     *
     * Every step carries both functions in the same order for the same reason
     * the body's does: matched lists interpolate componentwise, and a step that
     * dropped its translateY(0) would make the browser fall back to matrices.
     */
    @keyframes startle-legs { 0% { transform:translateY(0) scaleY(1); } 12% { transform:translateY(0) scaleY(.7); } 32% { transform:translateY(-7px) scaleY(1.06); } 54% { transform:translateY(0) scaleY(.94); } 74% { transform:translateY(0) scaleY(1.02); } 100% { transform:translateY(0) scaleY(1); } }
    /*
     * A fraction of the startle: the body settles two units instead of being
     * yanked seven, and nothing overshoots hard enough to want the startle's
     * bouncing curve. The legs follow the same arithmetic as startle-legs —
     * at 30% the body's base is at y=77 (a .94 squash keeps it at 75, plus 2px
     * of travel), so the legs keep 8 of their 10 units; at 65% the base rises
     * to 74 and the legs simply ride up the same pixel. Both functions in the
     * same order in every step, or the browser falls back to matrices.
     */
    @keyframes notice { 0% { transform:scale(1,1) translateY(0); } 30% { transform:scale(1.04,.94) translateY(2px); } 65% { transform:scale(1,1) translateY(-1px); } 100% { transform:scale(1,1) translateY(0); } }
    @keyframes notice-antenna { 0% { transform:rotate(0deg); } 35% { transform:rotate(8deg); } 70% { transform:rotate(-3deg); } 100% { transform:rotate(0deg); } }
    @keyframes q-float { 0% { opacity:0; transform:translate(0,4px) scale(.6); } 15% { opacity:1; transform:translate(2px,-2px) scale(1); } 60% { opacity:1; transform:translate(5px,-7px) scale(1); } 100% { opacity:0; transform:translate(8px,-14px) scale(1.05); } }
    @keyframes notice-legs { 0% { transform:translateY(0) scaleY(1); } 30% { transform:translateY(0) scaleY(.8); } 65% { transform:translateY(-1px) scaleY(1); } 100% { transform:translateY(0) scaleY(1); } }

    :host([hidden-tab]) svg, :host([hidden-tab]) svg * { animation-play-state:paused; }
    @media ${REDUCED_MOTION_QUERY} {
      svg, svg * { animation:none !important; }
      .is-empty .z { opacity:.55; }
    }
    :host([reduced]) svg, :host([reduced]) svg * { animation:none !important; }
    :host([reduced]) .is-empty .z { opacity:.55; }
  `;

/*
 * Away: the header's creature while another one is on screen. The host keeps
 * its box, so the wordmark beside it does not move; only the drawing goes, and
 * nothing can be pressed where it was. The smoke is drawn in the creature's own
 * tones — the shell's line round the outside of the cloud, the screen's tone
 * inside it — so moving house adds nothing to the three the drawing has always
 * taken. Its motion is script, from lib/motion.ts; all this says is where each
 * part rests. Kept out of STYLE so that this comment, unlike the ones in there,
 * is not shipped inside the string.
 */
const AWAY_STYLE =
  ":host([away]){pointer-events:none}" +
  ":host([away]) .creature{opacity:0}" +
  ".creature{transform-origin:50px 62px}" +
  `.smoke{opacity:0;pointer-events:none;transform-origin:${POOF_CENTRE.x}px ${POOF_CENTRE.y}px}` +
  ".smoke circle{transform-box:fill-box;transform-origin:center}" +
  ".smoke-line{fill:none;stroke:var(--mascot-line);stroke-width:7}" +
  ".smoke-fill{fill:var(--mascot-screen);stroke:none}";

const MARKUP = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="boil">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" result="n">
            <animate attributeName="seed" values="1;2;3;4" dur="0.4s" repeatCount="indefinite" calcMode="discrete"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.5" xChannelSelector="R" yChannelSelector="G"/>
        </filter>
        <filter id="tv" x="0%" y="0%" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="3" seed="3" result="n">
            <animate attributeName="seed" values="3;11;19;27;35;43" dur="0.28s" repeatCount="indefinite" calcMode="discrete"/>
          </feTurbulence>
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0" result="mono"/>
          <feComponentTransfer in="mono"><feFuncA type="discrete" tableValues="0 0 0 0.55 1"/></feComponentTransfer>
        </filter>
        <clipPath id="screen-clip"><rect x="28" y="38" width="44" height="29" rx="5"/></clipPath>
      </defs>
      <g class="creature">
      <g class="props"></g>
      <g class="legs">
        <line class="leg-l" x1="35" y1="75" x2="35" y2="85"/>
        <line class="leg-r" x1="65" y1="75" x2="65" y2="85"/>
      </g>
      <g class="tap-body"><g class="body">
        <rect class="shell" x="20" y="30" width="60" height="45" rx="9"/>
        <rect class="screen" x="28" y="38" width="44" height="29" rx="5"/>
        <g class="static-layer" clip-path="url(#screen-clip)">
          <rect x="28" y="38" width="44" height="29" filter="url(#tv)"/>
          <rect class="roll" x="28" y="38" width="44" height="6" opacity=".16" stroke="none"/>
        </g>
        <g class="look"><g class="face"></g></g>
        <rect class="flash" x="28" y="38" width="44" height="29" rx="5"/>
        <g class="lean"><g class="tap-antenna"><g class="antenna"></g></g></g>
      </g></g>
      <g class="extras"></g>
      </g>
      <g class="smoke"></g>
    </svg>
  `;

/**
 * Parsed once. Every instance clones it, so the stylesheet and the drawing are
 * read by the HTML parser one time however many mascots the page puts up.
 */
let template: HTMLTemplateElement | null = null;

function contents(): DocumentFragment {
  if (!template) {
    template = document.createElement("template");
    template.innerHTML = `<style>${STYLE}${AWAY_STYLE}</style>${MARKUP}`;
  }
  return template.content.cloneNode(true) as DocumentFragment;
}

/**
 * Every mascot currently in a document. Two listeners serve all of them —
 * one for the tab going away, one for the motion preference changing under a
 * mascot that has been on screen for minutes — rather than a pair each.
 */
const instances = new Set<SparMascot>();
let listening = false;
/** The header's pending return — one for the page, however many come and go. */
let returnTimer = 0;

function listenOnce() {
  if (listening) return;
  listening = true;
  const refreshAll = () => instances.forEach((mascot) => mascot.refreshMotion());
  document.addEventListener("visibilitychange", refreshAll);
  window.matchMedia?.(REDUCED_MOTION_QUERY)?.addEventListener?.("change", refreshAll);
  // The device's own Reduced setting (lib/settings.ts). A microtask later, so
  // lib/theme.ts has already put `data-motion` on <html> for this same write.
  onSettingsChange(() => queueMicrotask(refreshAll));
  // Late at night the calm face goes drowsy; the clock is asked once a minute.
  window.setInterval(() => instances.forEach((mascot) => mascot.refreshLate()), 60_000);
}

class SparMascot extends HTMLElement {
  static get observedAttributes() {
    return ["state", "size", "home", "local", "wake", "speaking", "waiting"];
  }

  #svg: SVGSVGElement | null = null;
  /**
   * The three groups repainted on a state change. They are `…Layer` rather
   * than the obvious `#face` because `#face` is four hex digits with a word
   * boundary after it, and styles.test.ts reads every component looking for
   * exactly that — a private field would have been reported as a hardcoded
   * colour. Better a suffix here than a hole in the check that keeps hues out.
   */
  #faceLayer: Element | null = null;
  #antennaLayer: Element | null = null;
  #extrasLayer: Element | null = null;
  #swapTimer = 0;
  #pokeTimer = 0;
  #noticeTimer = 0;
  /** The drawing, and the cloud drawn over it, for the poof. */
  #creature: SVGGElement | null = null;
  #smoke: SVGGElement | null = null;
  #poof: Animation[] = [];
  /** The header's creature, gone while another one is on screen. */
  #away = false;
  /** Away and done leaving: nothing to draw, so nothing runs (refreshMotion). */
  #resting = false;
  /** When the creature last came to be on screen at home — see SEEN_MS. */
  #shownAt = 0;
  /** When a nod was asked of it while it was away — see NOD_KEPT_MS. */
  #nodAskedAt = Number.NEGATIVE_INFINITY;
  /** A face drawn over the state for a moment (the peek, the awake arrival). */
  #transientTimer = 0;
  /** Tapping along: the parts the spring moves, and the spring itself. */
  #tapBody: SVGGElement | null = null;
  #tapAntenna: SVGGElement | null = null;
  #legs: SVGGElement | null = null;
  #tapFrame = 0;
  #tapPrev = 0;
  #lastTapAt = Number.NEGATIVE_INFINITY;
  #dip = 0;
  #dipV = 0;
  #lean = 0;
  #leanV = 0;
  #glance = 0;
  #glanceV = 0;
  /** The moments (2026-10-16): the one-shot move running, the sign, the glance. */
  #gestureTimer = 0;
  #signTimer = 0;
  #glanceTimer = 0;
  #props: SVGGElement | null = null;
  #look: SVGGElement | null = null;
  /** Poked awake late at night: when, so it stays awake for `WOKEN_MS`. */
  #wokenAt = Number.NEGATIVE_INFINITY;
  /** Drawn drowsy right now — what the minute's check compares against. */
  #drowsy = false;
  /** A card is being carried over it. */
  #catching = false;
  /** Where a pointer went down on it, for telling a swipe from a poke. */
  #stroke: { x: number; y: number; at: number } | null = null;
  /** A swipe just spun it: the click that follows the stroke is not a poke. */
  #spun = false;

  connectedCallback() {
    if (!this.shadowRoot) {
      const root = this.attachShadow({ mode: "open" });
      root.append(contents());

      this.#svg = root.querySelector("svg");
      this.#faceLayer = root.querySelector(".face");
      this.#antennaLayer = root.querySelector(".antenna");
      this.#extrasLayer = root.querySelector(".extras");
      this.#creature = root.querySelector(".creature");
      this.#smoke = root.querySelector(".smoke");
      this.#tapBody = root.querySelector(".tap-body");
      this.#tapAntenna = root.querySelector(".tap-antenna");
      this.#legs = root.querySelector(".legs");
      this.#props = root.querySelector(".props");
      this.#look = root.querySelector(".look");

      // A quick sideways stroke across it spins it round once, and is not a
      // poke as well (2026-10-16, owner approved).
      this.addEventListener("pointerdown", (e) => {
        this.#spun = false;
        this.#stroke = { x: e.clientX, y: e.clientY, at: performance.now() };
      });
      this.addEventListener("pointerup", (e) => {
        const from = this.#stroke;
        this.#stroke = null;
        if (!from) return;
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        if (Math.abs(dx) < SPIN_SWIPE_PX || Math.abs(dy) > Math.abs(dx) || performance.now() - from.at > SPIN_SWIPE_MS) return;
        // Where it cannot spin (reduced motion), the stroke stays a poke.
        if (this.#away || reducedMotion()) return;
        this.#spun = true;
        window.setTimeout(() => (this.#spun = false), 400);
        this.play("spin");
      });
      this.addEventListener("pointercancel", () => (this.#stroke = null));
      this.addEventListener("click", () => {
        if (this.#spun) {
          this.#spun = false;
          return;
        }
        this.poke();
      });
      this.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.poke();
        }
      });
      listenOnce();
    }
    instances.add(this);
    this.#shownAt = Date.now();
    this.#applySize();
    this.refreshMotion();
    this.#drowsy = lateNow() && Date.now() - this.#wokenAt > WOKEN_MS;
    this.#render(this.state, true);
    this.#svg?.classList.toggle("waiting", this.hasAttribute("waiting"));
    if (this.hasAttribute("wake")) this.#wake();
    SparMascot.#settle();
  }

  disconnectedCallback() {
    window.clearTimeout(this.#transientTimer);
    this.#stopTap();
    window.clearTimeout(this.#swapTimer);
    window.clearTimeout(this.#pokeTimer);
    window.clearTimeout(this.#noticeTimer);
    window.clearTimeout(this.#gestureTimer);
    window.clearTimeout(this.#signTimer);
    window.clearTimeout(this.#glanceTimer);
    this.#stopPoof();
    instances.delete(this);
    SparMascot.#settle();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (!this.#svg) return;
    if (name === "size") this.#applySize();
    if (name === "state") this.#render(asState(newValue), oldValue === null);
    if (name === "home" && this.isConnected) SparMascot.#settle();
    if (name === "local") this.#applyA11y(asState(this.getAttribute("state")));
    if (name === "wake" && newValue !== null && newValue !== oldValue && this.isConnected) this.#wake();
    if (name === "speaking" && newValue !== oldValue) this.#speak();
    if (name === "waiting") this.#svg?.classList.toggle("waiting", newValue !== null);
  }

  /** The instance that lives in the header. Read, never set, from here. */
  get #home(): boolean {
    return this.hasAttribute("home");
  }

  /**
   * Where the one creature is, decided for every mascot on the page at once
   * whenever one of them arrives, leaves or changes role — the single source
   * of truth for "away". Nothing in React holds it: the header's element is
   * never re-rendered for it, only told by its own registry, so the node the
   * session started with is the node it ends with.
   *
   * Any mascot that is not the header's is a visitor, and while one is
   * connected the header's is away. Leaving happens at once; coming back waits
   * `AWAY_GRACE_MS`, and a visitor arriving inside that wait cancels it, which
   * is what keeps the header still while the board passes between two empty
   * states. The smoke is the header's alone: it leaves in a puff — only when
   * it has actually been seen at home (`SEEN_MS`) — and the visitor that sent
   * it away simply is there, with no smoke of its own. Coming home, the
   * header's grows back out of a puff in its own place.
   */
  static #settle() {
    const all = [...instances];
    const homes = all.filter((m) => m.#home);
    const visitors = all.filter((m) => !m.#home);
    if (visitors.length > 0) {
      window.clearTimeout(returnTimer);
      returnTimer = 0;
      const seen = homes.some((m) => !m.#away && Date.now() - m.#shownAt >= SEEN_MS);
      for (const home of homes) home.#leave(seen);
      return;
    }
    if (!homes.some((m) => m.#away)) return;
    window.clearTimeout(returnTimer);
    returnTimer = window.setTimeout(() => {
      returnTimer = 0;
      instances.forEach((m) => {
        if (m.#home) m.#comeHome();
      });
    }, AWAY_GRACE_MS);
  }

  #leave(animate: boolean) {
    if (this.#away) return;
    this.#away = true;
    // An owed nod is for a creature on its way home, and this one has just
    // left: whatever it was owed, the visitor on the board has answered.
    this.#nodAskedAt = Number.NEGATIVE_INFINITY;
    this.#stopTap();
    this.setAttribute("away", "");
    this.#applyA11y(this.state);
    this.#puff("out", () => {
      this.#resting = true;
      this.refreshMotion();
    }, animate);
  }

  #comeHome() {
    if (!this.#away) return;
    const owed = Date.now() - this.#nodAskedAt <= NOD_KEPT_MS;
    this.#away = false;
    this.#resting = false;
    this.#shownAt = Date.now();
    this.removeAttribute("away");
    this.#applyA11y(this.state);
    this.refreshMotion();
    this.#puff("in", () => {
      if (owed) this.notice();
    });
  }

  /**
   * The creature shrinking into a cloud, or growing out of one. The cloud is
   * planned anew every time (`lib/poof.ts`): its puffs billow out of the
   * creature's middle on ENTER, swell and drift outward, then thin and go on
   * EXIT, each at its own moment, while the cloud as a whole turns a little,
   * rises a little and fades. Only the creature's half differs: leaving, it
   * shrinks on EXIT under the smoke; arriving, it grows out of it from small,
   * still growing as the smoke thins (POOF_GROW_MS).
   *
   * Under reduced motion, and wherever the browser cannot animate, there is no
   * smoke: the swap is simply made, and `done` runs at once.
   */
  #puff(way: "in" | "out", done: () => void, animate = true) {
    this.#stopPoof();
    const creature = this.#creature;
    const smoke = this.#smoke;
    if (!animate || !smoke || !animates(creature)) {
      done();
      return;
    }
    const plan = planPoof(poofRandom);
    smoke.innerHTML = smokeMarkup(plan);
    const here = { opacity: 1, transform: "scale(1)" };
    const gone = { opacity: 0, transform: "scale(0.6)" };
    // Coming home it grows out of the cloud, from small, past its size and
    // back (POOF_GROW_MS) — and may outlast the cloud, so it is not one of the
    // animations the cloud's end cancels.
    const self =
      way === "out"
        ? creature.animate([here, gone], { duration: POOF_VANISH_MS, easing: EXIT })
        : creature.animate(
            [
              { opacity: 0, transform: `scale(${POOF_GROW_FROM})`, easing: ENTER },
              { opacity: 1, transform: `scale(${POOF_GROW_PAST})`, offset: 0.7, easing: ENTER },
              here,
            ],
            { duration: POOF_GROW_MS, delay: Math.round(plan.total * POOF_GROW_AT), fill: "backwards" },
          );
    const running: Animation[] = [self];
    // Both drawings of a puff — its outline and its fill — move as one, or
    // the outline would show through the cloud.
    for (const circle of smoke.querySelectorAll<SVGCircleElement>("circle")) {
      const p = plan.puffs[Number(circle.dataset.puff)];
      running.push(
        circle.animate(
          [
            { transform: `translate(${px(p.fromX)}, ${px(p.fromY)}) scale(${p.fromScale.toFixed(3)})`, easing: ENTER },
            {
              transform: `translate(${px(p.toX / 2)}, ${px(p.toY / 2)}) scale(${p.peakScale.toFixed(3)})`,
              offset: p.peakAt,
              easing: EXIT,
            },
            { transform: `translate(${px(p.toX)}, ${px(p.toY)}) scale(${p.toScale.toFixed(3)})` },
          ],
          // Held at both ends: small before it starts, and thinned after it
          // goes — not back at full size while the rest of the cloud is up.
          { duration: p.duration, delay: p.delay, fill: "both" },
        ),
      );
    }
    // The cloud as a whole turns a few degrees and rises a little as it goes.
    running.push(
      smoke.animate(
        [
          { transform: "translate(0px, 0px) rotate(0deg)" },
          { transform: `translate(${px(plan.riseX)}, ${px(plan.riseY)}) rotate(${plan.turn.toFixed(2)}deg)` },
        ],
        { duration: plan.total, easing: ENTER },
      ),
    );
    // And comes up at once and thins away: faded as one group rather than
    // puff by puff, or each outline would show through the fills as it went.
    const cloud = smoke.animate(
      [
        { opacity: 0, easing: ENTER },
        { opacity: 1, offset: 0.1 },
        { opacity: 1, offset: plan.fadeFrom, easing: EXIT },
        { opacity: 0 },
      ],
      { duration: plan.total },
    );
    running.push(cloud);
    cloud.onfinish = () => {
      // The puffs are held at their ends; let them go with the cloud.
      for (const animation of running) if (animation !== cloud && animation !== self) animation.cancel();
      this.#poof = [];
      done();
    };
    this.#poof = running;
  }

  #stopPoof() {
    for (const animation of this.#poof) animation.cancel();
    this.#poof = [];
  }

  get state(): MascotState {
    return asState(this.getAttribute("state"));
  }

  set state(value: MascotState) {
    this.setAttribute("state", value);
  }

  /**
   * A startle: the body flinches and the antenna recoils, then it goes back to
   * whatever it was doing. It opens nothing — a control that both plays an
   * animation and opens something reads as broken — and the event is heard
   * by the header, which answers it in the speech bubble with how sync stands.
   *
   * The startle is silent when motion is turned down; the event still goes.
   */
  poke() {
    // Nothing is there to poke while it is away; the host is inert as well,
    // and this is the half that holds for a caller reaching it from code.
    if (this.#away) return;
    // Drowsy late at night, a poke wakes it for a while (2026-10-16).
    if (this.#drowsy) {
      this.#wokenAt = Date.now();
      this.refreshLate();
    }
    // Under reduced motion there is no startle, but the poke is still heard:
    // it is answered in words (`lib/useSpeech.ts`), which need no motion.
    if (reducedMotion()) {
      this.dispatchEvent(new CustomEvent("mascot-poke", { bubbles: true }));
      return;
    }
    const svg = this.#svg;
    if (!svg) return;
    // The newest gesture is the one being answered: a poke landing mid-nod
    // takes the nod's class off rather than letting the two one-shots stack
    // and leave rule order to pick which of them shows. notice() does the
    // same to a startle, so neither ever plays under the other.
    svg.classList.remove(...ONE_SHOTS);
    window.clearTimeout(this.#noticeTimer);
    window.clearTimeout(this.#gestureTimer);
    // Forces the class removal to take effect before it goes back on, so a
    // second poke restarts the startle instead of being swallowed by the first.
    void svg.getBoundingClientRect();
    svg.classList.add("poked");
    window.clearTimeout(this.#pokeTimer);
    this.#pokeTimer = window.setTimeout(() => svg.classList.remove("poked"), POKE_MS);
    // Asleep, the startle also opens one eye: it looks at you for a moment and
    // goes back to sleep, and the crossfade back redraws the Zs, so a fresh one
    // lifts. A second poke while it looks keeps it looking.
    if (this.state === "empty") this.#showFor(PEEK, "empty", PEEK_MS);
    this.dispatchEvent(new CustomEvent("mascot-poke", { bubbles: true }));
  }

  /**
   * Arriving on a board you have just emptied (`wake`, set by the empty board):
   * the creature comes in awake, eyes open, and after `AWAKE_MS` dims to the
   * sleeping face by the ordinary crossfade. Opening the app onto a board that
   * was already empty never sets it, so that creature is simply asleep. Only
   * the face changes; it adds no move and says nothing.
   */
  #wake() {
    if (reducedMotion() || this.#away || this.state !== "empty") return;
    this.#showFor(STATES.idle, "idle", AWAKE_MS);
  }

  /** The bubble beside it, if one stands: `say` or `ask`, else null. */
  get #speaking(): Speaking | null {
    const value = this.getAttribute("speaking");
    return value === "say" || value === "ask" ? value : null;
  }

  /**
   * The bubble came, changed or went. The antenna leans by its transition, and
   * the calm face crossfades to the turned one (or back) like any state
   * change; a busy or offline face is left alone, and so is a poke's peek. No
   * nod: the nod is a capture's receipt and nothing else's. Under reduced
   * motion the face still turns; nothing moves.
   */
  #speak() {
    this.#svg?.classList.toggle("speaking", this.#speaking !== null && !reducedMotion());
    if (this.state === STATES_CALM && !this.#transientTimer) this.#render(this.state, false);
  }

  /** Draws `drawing` over the current state, then crossfades back to the state's own. */
  #showFor(drawing: Drawing, look: MascotState, ms: number) {
    window.clearTimeout(this.#swapTimer);
    this.#svg?.classList.remove("swapping");
    this.#paint(this.state, drawing, look);
    window.clearTimeout(this.#transientTimer);
    this.#transientTimer = window.setTimeout(() => {
      this.#transientTimer = 0;
      this.#render(this.state, false);
    }, ms);
  }

  /**
   * One keystroke in the write box: a small dip on the body's spring, a
   * flick of the antenna, and the eyes on your words. See TAP_K above.
   * `strength` is less than 1 for a deletion. Silent under reduced motion,
   * while away, in a hidden tab, and while asleep: a sleeping creature does
   * not tap along.
   */
  tap(strength = 1) {
    if (reducedMotion() || this.#away || document.hidden || this.state === "empty") return;
    if (!this.#tapBody) return;
    this.#dipV += TAP_KICK * strength * (1 - Math.max(0, Math.min(1, this.#dip)));
    this.#leanV += TAP_ANTENNA_FLICK * strength * (Math.random() < 0.5 ? -1 : 1);
    this.#lastTapAt = performance.now();
    if (!this.#tapFrame) {
      this.#tapPrev = this.#lastTapAt;
      this.#tapFrame = requestAnimationFrame(this.#tapStep);
    }
  }

  #tapStep = (now: number) => {
    // Never more than a twentieth of a second at once: a frame that arrives
    // late (a busy main thread, a tab coming back) must not fling the spring.
    const dt = Math.min(Math.max(0, now - this.#tapPrev) / 1000, 1 / 20);
    this.#tapPrev = now;
    const looking = now - this.#lastTapAt < TAP_GLANCE_HOLD_MS ? 1 : 0;
    const steps = Math.max(1, Math.ceil(dt * 240));
    const h = dt / steps;
    const glanceC = 2 * Math.sqrt(TAP_GLANCE_K);
    for (let i = 0; i < steps; i++) {
      this.#dipV += (-TAP_K * this.#dip - TAP_C * this.#dipV) * h;
      this.#dip += this.#dipV * h;
      this.#leanV += (-TAP_ANTENNA_K * this.#lean - TAP_ANTENNA_C * this.#leanV) * h;
      this.#lean += this.#leanV * h;
      this.#glanceV += (-TAP_GLANCE_K * (this.#glance - looking) - glanceC * this.#glanceV) * h;
      this.#glance += this.#glanceV * h;
    }
    this.#dip = Math.max(-0.5, Math.min(1.2, this.#dip));
    const still =
      !looking &&
      Math.abs(this.#dip) < 0.002 &&
      Math.abs(this.#dipV) < 0.02 &&
      Math.abs(this.#lean) < 0.05 &&
      Math.abs(this.#leanV) < 0.5 &&
      Math.abs(this.#glance) < 0.005;
    if (still) {
      this.#stopTap();
      return;
    }
    this.#drawTap();
    this.#tapFrame = requestAnimationFrame(this.#tapStep);
  };

  /**
   * The body dips about its base and drops; the legs shorten by exactly that
   * drop, about the feet, so the body never leaves its legs (the preview's
   * version slid the body down over them). The antenna turns about its root.
   */
  #drawTap() {
    const d = this.#dip;
    const drop = 2 * d;
    this.#tapBody?.setAttribute(
      "transform",
      `translate(0 ${drop.toFixed(3)}) translate(50 75) scale(${(1 + 0.04 * d).toFixed(4)} ${(1 - 0.06 * d).toFixed(4)}) translate(-50 -75)`,
    );
    this.#legs?.setAttribute("transform", `translate(0 85) scale(1 ${((10 - drop) / 10).toFixed(4)}) translate(0 -85)`);
    this.#tapAntenna?.setAttribute("transform", `rotate(${this.#lean.toFixed(3)} 50 30)`);
    this.#faceLayer?.setAttribute("transform", `translate(0 ${(TAP_GLANCE_PX * this.#glance).toFixed(3)})`);
  }

  #stopTap() {
    if (this.#tapFrame) cancelAnimationFrame(this.#tapFrame);
    this.#tapFrame = 0;
    this.#dip = this.#dipV = this.#lean = this.#leanV = this.#glance = this.#glanceV = 0;
    this.#tapBody?.removeAttribute("transform");
    this.#legs?.removeAttribute("transform");
    this.#tapAntenna?.removeAttribute("transform");
    this.#faceLayer?.removeAttribute("transform");
  }

  /**
   * A nod: the body dips once and the antenna bobs, then it goes back to
   * whatever it was doing. Played when a note lands — a receipt, not a
   * reward (DESIGN.md §1 draws that line) — and quieter than the startle on
   * purpose: the startle answers being touched, this answers something
   * arriving. It is not a state, because a save is an event and not a
   * status; the walk, the sleep and the static all keep running underneath
   * and come back in phase when the class drops.
   *
   * Silent when motion is turned down, exactly as the startle is: a nod that
   * cannot move is nothing, and the app must never owe one.
   */
  notice() {
    if (reducedMotion()) return;
    // Away, there is nothing to nod — the visitor on the board has been asked
    // too, and answers. The request is kept for a moment instead, because the
    // capture that asked is often the very thing bringing this one home: see
    // NOD_KEPT_MS.
    if (this.#away) {
      this.#nodAskedAt = Date.now();
      return;
    }
    const svg = this.#svg;
    if (!svg) return;
    // Newest wins, both ways round — see poke().
    svg.classList.remove(...ONE_SHOTS);
    window.clearTimeout(this.#pokeTimer);
    window.clearTimeout(this.#gestureTimer);
    // Same forced reflow as poke(): the removal must land before the class
    // goes back on, or the second capture of a burst never restarts the nod.
    void svg.getBoundingClientRect();
    svg.classList.add("noted");
    window.clearTimeout(this.#noticeTimer);
    this.#noticeTimer = window.setTimeout(() => svg.classList.remove("noted"), NOD_MS);
  }

  /**
   * Whether this creature can be seen right now: home (or a visitor), on the
   * page, and not under a layer — the Sorter, the open note on a phone. Asked
   * by the point at its middle, so a sheet covering it counts and a bubble
   * beside it does not. Where the browser cannot say (a test), it is seen.
   */
  seen(): boolean {
    if (this.#away || !this.isConnected) return false;
    if (typeof document.elementFromPoint !== "function") return true;
    const r = this.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === this || (hit !== null && this.contains(hit));
  }

  /**
   * One of the moments' moves (`Gesture`), and the face it wears over the calm
   * one. Newest wins, as between the startle and the nod. Silent under reduced
   * motion and while away, like every move here.
   */
  play(gesture: Gesture) {
    const svg = this.#svg;
    if (!svg || this.#away || reducedMotion()) return;
    svg.classList.remove(...ONE_SHOTS);
    window.clearTimeout(this.#pokeTimer);
    window.clearTimeout(this.#noticeTimer);
    window.clearTimeout(this.#gestureTimer);
    // The same forced reflow as poke(): the same move twice restarts.
    void svg.getBoundingClientRect();
    const cls = `g-${gesture}`;
    svg.classList.add(cls);
    this.#gestureTimer = window.setTimeout(() => svg.classList.remove(cls), GESTURE_MS[gesture]);
    const face = GESTURE_FACE[gesture];
    if (face && this.state === STATES_CALM && !this.#catching) this.#showFor(face[0], STATES_CALM, face[1]);
  }

  /**
   * A milestone: a little sign with the number on it comes up from behind,
   * is held a moment, and goes down again. Under reduced motion it simply
   * stands for the same time — the number is the point, not the move.
   */
  holdSign(n: number) {
    const props = this.#props;
    if (!props || this.#away) return;
    const text = String(Math.trunc(n));
    const size = text.length > 4 ? 9 : 12;
    props.innerHTML =
      `<g class="prop"><line x1="77" y1="50" x2="84" y2="22"/>` +
      `<rect class="sign" x="66" y="3" width="36" height="20" rx="3"/>` +
      `<text class="sign-n" x="84" y="${size === 12 ? 17.3 : 16.3}" text-anchor="middle" font-size="${size}" font-weight="700">${text}</text></g>`;
    window.clearTimeout(this.#signTimer);
    this.#signTimer = window.setTimeout(() => (props.innerHTML = ""), SIGN_MS);
  }

  /** The eyes go toward a point on the page for a moment, and come back. */
  glanceAt(x: number, y: number) {
    const look = this.#look;
    if (!look || this.#away || reducedMotion()) return;
    const r = this.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    look.style.transform = `translate(${((dx / len) * GLANCE_X).toFixed(2)}px, ${((dy / len) * GLANCE_Y).toFixed(2)}px)`;
    window.clearTimeout(this.#glanceTimer);
    this.#glanceTimer = window.setTimeout(() => (look.style.transform = ""), GLANCE_MS);
  }

  /** A card carried over it, or carried away again: it opens its mouth for it. */
  catching(on: boolean) {
    if (this.#catching === on) return;
    this.#catching = on;
    if (this.state === STATES_CALM) this.#render(this.state, false);
  }

  /**
   * Late at night the calm face goes drowsy, until a poke wakes it for
   * `WOKEN_MS`. Asked on arrival and once a minute (`listenOnce`).
   */
  refreshLate() {
    const late = lateNow() && Date.now() - this.#wokenAt > WOKEN_MS;
    if (late === this.#drowsy) return;
    this.#drowsy = late;
    if (this.state === STATES_CALM && !this.#transientTimer) this.#render(this.state, false);
  }

  /**
   * Stops everything moving when the tab is in the background or the user has
   * asked for less motion — and *everything* here means the SMIL as well.
   *
   * The stylesheet above pauses the CSS keyframes both ways round. What it
   * cannot reach is the `<animate>` driving each `feTurbulence` seed, which no
   * media query has ever been able to touch — and those two filters are the
   * expensive part of this drawing, so a backgrounded tab was still paying for
   * them. `pauseAnimations()` is the SVG document's own timeline control and
   * stops them dead; the filters stay applied, so what is left is the drawing
   * frozen mid-wobble rather than a second, tidier drawing.
   */
  refreshMotion() {
    // A creature that has finished leaving is drawing nothing, and pays for
    // nothing either — the same pause, for the same reason, as a hidden tab.
    const reduced = reducedMotion();
    const still = document.hidden || reduced || this.#resting;
    if (still) this.#stopTap();
    this.toggleAttribute("hidden-tab", still);
    // The shadow root cannot see <html>'s `data-motion`, so the device's
    // Reduced setting reaches its stylesheet as this attribute, beside the
    // media query that carries the system's.
    this.toggleAttribute("reduced", reduced);
    const svg = this.#svg;
    // jsdom implements neither half of the SMIL timeline.
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    if (still) svg.pauseAnimations();
    else svg.unpauseAnimations();
  }

  #applySize() {
    const px = Number(this.getAttribute("size")) || 56;
    this.#svg?.setAttribute("width", String(px));
    this.#svg?.setAttribute("height", String(px));
  }

  /**
   * Perceivable, and reachable, but never a status.
   *
   * Every mascot can be poked, so every mascot has to be something a keyboard
   * can reach and a screen reader can name — a control that only a pointer can
   * find is worse than a drawing that does nothing. Hence the tab stop and the
   * label, on both instances.
   *
   * What this still cannot do is *report*. A screen reader will not reliably
   * re-announce a label that changed on an element which is not a live region,
   * so the state is spoken by the live region beside the header mascot (see
   * App.tsx) and the label here only ever answers "what am I looking at" for
   * somebody who has landed on it.
   *
   * Except while it is away. Then there is nothing there to name or reach, so
   * the header's creature leaves the tab order and the accessibility tree and
   * goes inert, and the one on the board is the one a keyboard finds. The
   * live region beside the header is a sibling, not a child, and goes on
   * speaking throughout.
   */
  #applyA11y(key: MascotState) {
    this.setAttribute("role", "img");
    // `local`: nothing to sync to, so idle is not "Synced" (review CD-03).
    this.setAttribute("aria-label", STATES[key] === STATES.idle && this.hasAttribute("local") ? "Online" : STATES[key].label);
    if (this.#away) {
      this.removeAttribute("tabindex");
      this.setAttribute("aria-hidden", "true");
      this.setAttribute("inert", "");
    } else {
      this.setAttribute("tabindex", "0");
      this.removeAttribute("aria-hidden");
      this.removeAttribute("inert");
    }
  }

  #paint(key: MascotState, drawing: Drawing = this.#drawingFor(key), look: MascotState = key) {
    if (this.#faceLayer) this.#faceLayer.innerHTML = drawing.face;
    if (this.#antennaLayer) this.#antennaLayer.innerHTML = drawing.antenna;
    if (this.#extrasLayer) this.#extrasLayer.innerHTML = drawing.extras;
    this.#svg?.classList.remove(...STATE_CLASSES);
    this.#svg?.classList.add(`is-${look}`);
    this.#svg?.classList.toggle("drowsy", drawing === DROWSY);
    this.#applyA11y(key);
  }

  /** The state's own drawing, turned to the bubble when the face is the calm one. */
  #drawingFor(look: MascotState): Drawing {
    if (look !== STATES_CALM) return STATES[look];
    if (this.#catching) return CATCHING;
    const speaking = this.#speaking;
    if (speaking) return SPEAKING[speaking];
    return this.#drowsy ? DROWSY : STATES[look];
  }

  /**
   * A state change is a crossfade, not a cut: the screen dips, the face and
   * antenna are swapped underneath it, and it comes back up. Only the very
   * first paint is immediate — there is nothing yet to fade from.
   */
  #render(key: MascotState, immediate: boolean) {
    window.clearTimeout(this.#swapTimer);
    window.clearTimeout(this.#transientTimer);
    this.#transientTimer = 0;
    const next = key;
    if (next === "empty") this.#stopTap();
    if (immediate) {
      this.#paint(key);
      return;
    }
    this.#svg?.classList.add("swapping");
    this.#swapTimer = window.setTimeout(() => {
      this.#paint(key);
      requestAnimationFrame(() => this.#svg?.classList.remove("swapping"));
    }, SWAP_MS);
  }
}

/** A length for a transform, rounded so the keyframes stay readable. */
function px(value: number): string {
  return `${value.toFixed(2)}px`;
}

function asState(value: string | null): MascotState {
  return value && value in STATES ? (value as MascotState) : "idle";
}

/**
 * Nods every mascot currently in a document. The trigger has to come from
 * React — a capture happens in App.tsx — but `Mascot.tsx` deliberately
 * exposes no ref and no imperative surface, so the module's own registry is
 * the way in. It must stay a walk of `instances`, never a ref: it cannot
 * cause a remount, it is not a second source of truth for `state`, and an
 * instance unmounting mid-capture — the empty board's, replaced by the very
 * note being captured — has already left the set and is skipped rather than
 * twitched on its way out. The header's, while it is away, keeps the request
 * for its return rather than nodding where nobody can see it (NOD_KEPT_MS).
 */
export function mascotNotice() {
  instances.forEach((mascot) => mascot.notice());
}

/**
 * Taps every mascot along to one keystroke in the write box: in practice the
 * header's, since a sleeping one does not tap and an away one is not there.
 * The same walk of `instances` as `mascotNotice`, for the same reasons.
 */
export function mascotTap(strength = 1) {
  instances.forEach((mascot) => mascot.tap(strength));
}

/**
 * The moments (2026-10-16), said to whichever creature can be seen — the
 * header's, or the empty board's while that one is the creature on screen.
 * Each walks `instances` for the reasons `mascotNotice` gives.
 *
 * A moment that happens where no creature can be seen (under the open note on
 * a phone) is kept for `keepMs` and played the moment one can: a picture is
 * shared in behind the note, then Back, and the flash plays as the board comes
 * back. Past that it is for nothing and is dropped.
 */
export function whenSeen(run: (mascot: SparMascot) => void, keepMs: number) {
  const tryNow = () => {
    const seen = [...instances].filter((mascot) => mascot.seen());
    seen.forEach(run);
    return seen.length > 0;
  };
  if (tryNow() || keepMs <= 0) return;
  const until = Date.now() + keepMs;
  const timer = window.setInterval(() => {
    if (tryNow() || Date.now() > until) window.clearInterval(timer);
  }, 200);
}

/** One of the moves, played where it can be seen (kept up to `keepMs` until it can). */
export function mascotPlay(gesture: Gesture, keepMs = 0) {
  whenSeen((mascot) => mascot.play(gesture), keepMs);
}

/** A milestone's number, held up on a sign, with a hop. */
export function mascotSign(n: number, keepMs = 0) {
  whenSeen((mascot) => {
    mascot.holdSign(n);
    mascot.play("hop");
  }, keepMs);
}

/** The eyes go toward a point on the page (a board's tab, say). */
export function mascotGlance(x: number, y: number) {
  whenSeen((mascot) => mascot.glanceAt(x, y), 0);
}

/** A card carried over the creature (true) or away from it (false). */
export function mascotCatching(on: boolean) {
  instances.forEach((mascot) => mascot.catching(on));
}

/** Idempotent: the module can be imported from anywhere, including a test. */
export function defineMascot() {
  if (typeof customElements === "undefined") return;
  if (!customElements.get(MASCOT_TAG)) customElements.define(MASCOT_TAG, SparMascot);
}

defineMascot();
