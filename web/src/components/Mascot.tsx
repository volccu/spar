import { useEffect, useRef } from "react";
import { defineMascot, type MascotState, type Speaking } from "./mascot-element";

/**
 * Places the mascot. Everything it *does* is in `mascot-element.ts`.
 *
 * This is deliberately the thinnest wrapper that can exist: it passes three
 * attributes and renders nothing of its own. The element is a custom element
 * precisely so that React cannot reach inside it — every state it can be in is
 * a running animation, and a re-render that recreated the drawing would restart
 * the breathing cycle from zero and twitch visibly.
 *
 * Two rules follow from that and both are load-bearing:
 *
 *  - **The header's mascot is never unmounted.** It sits directly in
 *    `<header>` in App.tsx, above everything that changes — board paging, the
 *    note sheet, search — so nothing that happens on the board can take it off
 *    the screen and put a fresh one back. When it has to be off the screen —
 *    while the empty board draws the creature asleep — it goes *away*, an
 *    attribute the element sets on itself, and the node stays exactly where
 *    it was.
 *  - **A state change is an attribute change, never a new element.** The
 *    element crossfades internally: it dips the screen, swaps the face and
 *    antenna underneath, and brings it back. Replacing the element skips all
 *    of that and hard-cuts.
 */

/**
 * The element is registered by importing its module, which happens the moment
 * anything renders this. Named here as well so the import cannot be dropped as
 * unused, and so a test can register it without rendering anything.
 */
defineMascot();

interface Props {
  state: MascotState;
  /** In CSS pixels. Both placements use 56. */
  size?: number;
  /**
   * The header's instance: where the creature lives. Every other mascot is a
   * visitor, and while one is on screen this one is away — gone in a puff of
   * smoke, its box kept — so there is only ever one creature to be seen. The
   * element decides that for itself (`mascot-element.ts`); this only names
   * which one is home.
   */
  home?: boolean;
  /**
   * Nothing to sync to — the demo, or a device used on its own. Idle is then
   * named "Online" rather than "Synced", which would promise a server that is
   * not there (review CD-03).
   */
  local?: boolean;
  /**
   * Raised each time the board this creature sleeps on is emptied by hand
   * (`useWakeOnEmptied`): it arrives, or turns, awake and then dims to sleep.
   * 0 or absent draws nothing extra.
   */
  wake?: number;
  /** A speech bubble stands beside it (`Speech.tsx`): it turns to it. */
  speaking?: Speaking | null;
  /** Offline with changes still to send: its antenna blinks slowly until they have gone. */
  waiting?: boolean;
  /** Pressed. The press still only startles it; this is told so it can be answered in words. */
  onPoke?: () => void;
}

export function Mascot({ state, size = 56, home = false, local = false, wake = 0, speaking = null, waiting = false, onPoke }: Props) {
  // The element is never re-created for this: the listener is attached to the
  // node it already is, and reaches the newest callback through a ref.
  const el = useRef<HTMLElement | null>(null);
  const poked = useRef(onPoke);
  poked.current = onPoke;
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const heard = () => poked.current?.();
    node.addEventListener("mascot-poke", heard);
    return () => node.removeEventListener("mascot-poke", heard);
  }, []);
  return (
    <spar-mascot
      ref={el}
      state={state}
      size={size}
      home={home ? "" : undefined}
      local={local ? "" : undefined}
      wake={wake > 0 ? String(wake) : undefined}
      speaking={speaking ?? undefined}
      waiting={waiting ? "" : undefined}
    />
  );
}

declare module "react" {
  // The one way React 19 admits a custom element into JSX: its
  // IntrinsicElements interface lives inside a `JSX` namespace, so the
  // namespace here is the shape of React's own types, not a style choice.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "spar-mascot": {
        state?: MascotState;
        size?: number;
        /** Present (as "") on the header's instance only. */
        home?: "";
        /** Present (as "") when there is nothing to sync to. */
        local?: "";
        /** A count that goes up each time the board is emptied by hand. */
        wake?: string;
        /** "say" or "ask" while a speech bubble stands beside it. */
        speaking?: Speaking;
        /** Present (as "") while offline changes wait to be sent. */
        waiting?: "";
        ref?: import("react").Ref<HTMLElement>;
      };
    }
  }
}
