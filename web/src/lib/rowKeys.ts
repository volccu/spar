import type { KeyboardEvent } from "react";

export function shownRows(root: HTMLElement, selector: string): HTMLElement[] {
  // A row under display:none, its own or a box's around it, cannot take focus,
  // so it is not a row to walk to. Asked of the styles rather than of the
  // layout (`offsetParent`), which jsdom does not have.
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => {
    for (let at: HTMLElement | null = el; at && at !== root; at = at.parentElement) {
      if (getComputedStyle(at).display === "none") return false;
    }
    return true;
  });
}

/**
 * Arrow keys, Home and End walking the rows of a bottom-right panel.
 *
 * `MenuPanel` had this and the selection panel did not, so the one panel a
 * keyboard reaches with notes already picked was Tab-only while the menu the
 * same burger opens was not. One definition, so the two cannot drift again.
 * Wraps at both ends, skips disabled and hidden rows, and answers only the four keys —
 * Escape and everything else are left to the caller.
 */
export function walkRows(e: KeyboardEvent<HTMLElement>, selector: string): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = shownRows(e.currentTarget, selector);
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  // From outside the rows (the panel itself holding focus), ↓ starts at the
  // first row and ↑ at the last, rather than one short of it.
  const next =
    e.key === "Home" || (at === -1 && e.key === "ArrowDown")
      ? 0
      : e.key === "End" || at === -1
        ? items.length - 1
        : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  e.preventDefault();
  e.stopPropagation();
  items[next].focus();
}
