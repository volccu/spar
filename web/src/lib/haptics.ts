/* --- a receipt in the hand -----------------------------------------------------
   One short pulse when a note lands and when a tick box is ticked — the two
   moments the app takes something into its keeping from a thumb that may not
   be looking at the screen. It is the mascot's nod said to the hand instead of
   the eye (DESIGN.md §1, "The nod" and "The pulse"), held to the same line: a
   receipt, never a reward. One pulse, never a pattern; nothing else in the app
   vibrates; no count, no escalation, no second kind.

   **It is on trial, and it is the owner's gut call.** A vibration is either the
   physical half of the nod or a gimmick, and that is not something to decide on
   paper — so it ships on, with a switch on the About page to turn it off
   (`hapticsSwitch.ts`, which loads with that page), and the switch is per
   device because the phone is the only device with a motor. A reminder's own
   vibration belongs to the notification and not to this.

   **A fifth place** (owner picked it, joy review 2026-10-14 #6): the card in
   Tidy up crossing the line where letting go decides — one tick, like a detent
   in a dial (`pastTheLine`, `useModeLayer`).

   Where the browser has no `navigator.vibrate` (desktops, iOS, Firefox) this
   does nothing at all.
   -------------------------------------------------------------------------- */

export const HAPTICS_KEY = "spar.haptics";
/** Short enough to be felt as a tick rather than heard as a buzz. */
const PULSE_MS = 12;

/** The one pulse. Silent where there is no motor or this device said off. */
export function receipt(): void {
  try {
    if (typeof navigator.vibrate !== "function") return;
    if (localStorage.getItem(HAPTICS_KEY) === "off") return;
    navigator.vibrate(PULSE_MS);
  } catch {
    // Storage that throws, or an engine that refuses before a user gesture:
    // either way the note is kept, and a receipt that did not arrive costs
    // nothing.
  }
}
