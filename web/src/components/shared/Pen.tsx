import type { CSSProperties, ReactNode } from "react";
import { STRIKE_MS } from "../../lib/motion";

/**
 * How long the pen takes, handed to the stylesheet as an inline custom
 * property so `lib/motion.ts` stays the only copy of the number (the same way
 * the lamp's durations travel, `lib/useLamp.ts`).
 */
export const PEN_STYLE = { "--strike-ms": `${STRIKE_MS}ms` } as CSSProperties;

/**
 * The words of a list item, with the pen that crosses them out when the item
 * is ticked (`.pen` in styles.css; 2026-10-14, owner approved).
 *
 * The strike is a drawn 1px line in the words' own tone, not a text
 * decoration: a `background-image` on an inline box, so it takes a line of its
 * own on every line a wrapped item breaks into (`box-decoration-break:
 * clone`), and it moves no character and changes no metric, which is why the
 * open note's reader may wear it and still lay out where the editor does.
 * Which way it points is the item's own `data-done`; the transition is what
 * makes it a pen, and it only runs when that attribute *changes*, so an item
 * that is already ticked on first paint is simply struck.
 */
export function Pen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={className ? `pen ${className}` : "pen"} style={PEN_STYLE}>
      {children}
    </span>
  );
}
