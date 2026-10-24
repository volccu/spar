import { useEffect, useRef } from "react";
import { carryWords } from "../lib/carryTag";
import type { MergeDrag } from "../lib/useMergeDrag";
import type { Board, Note } from "../types";

/**
 * The small tag that rides beside the mouse while a note is carried (review
 * 2026-10-24, UX-17): what is carried, and what letting go would do. The carry
 * is the pointer's own, not a browser drag, so there is no drag image — this is
 * the only thing that follows the pointer. A mouse only: a finger covers the
 * card, and a phone's drawer already names the board under it.
 *
 * Moved by the element's own transform from a listener, never state per frame.
 * Held out of sight until the first move gives it somewhere to be.
 */
export function CarryTag({
  drag,
  notes,
  boards,
}: {
  drag: MergeDrag | null;
  notes: readonly Note[];
  boards: readonly Board[];
}) {
  const el = useRef<HTMLDivElement | null>(null);
  const live = drag !== null;
  useEffect(() => {
    if (!live) return;
    function follow(e: PointerEvent) {
      const tag = el.current;
      if (e.pointerType !== "mouse" || !tag) return;
      // Beside the pointer, and on its left when that would run off the right edge.
      const flip = e.clientX + tag.offsetWidth + 24 > window.innerWidth;
      tag.style.transform = `translate(${flip ? e.clientX - tag.offsetWidth - 14 : e.clientX + 14}px, ${e.clientY + 14}px)`;
      tag.style.visibility = "visible";
    }
    window.addEventListener("pointermove", follow);
    return () => window.removeEventListener("pointermove", follow);
  }, [live]);
  if (!drag) return null;
  const { what, verb } = carryWords(drag, notes, boards);
  return (
    <div ref={el} className="carry-tag" aria-hidden>
      <span className="carry-tag-what">{what}</span>
      {verb && <span className="carry-tag-verb mono">{verb}</span>}
    </div>
  );
}
