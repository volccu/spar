/**
 * Grows a textarea to fit what is in it; the stylesheet caps it.
 *
 * A textarea that scrolls inside a page that also scrolls is unusable on a
 * phone, and the notes here run to 15k characters. The capture bar and the
 * editor each had this as a four-line local function; the bar's one row is
 * exactly `--bar-h` because of it, and the editor never scrolls because of it.
 *
 * Measuring means collapsing the field to `auto` for an instant, and that
 * instant is long enough to hurt: every scroller around the field is briefly
 * shorter, and one scrolled further down than its new height allows is clamped
 * and does not come back when the height does. In a long open note scrolled to
 * its end, each keystroke threw the text up under the caret. So the scroll
 * position of every ancestor is read before the collapse (the layout is still
 * whole then, so the read is cheap) and put back after it. Writing back a
 * position that did not move is a no-op and fires no scroll event.
 */
export function fitTextarea(el: HTMLTextAreaElement): void {
  const held: [Element, number][] = [];
  for (let p: Element | null = el; (p = p.parentElement); ) held.push([p, p.scrollTop]);
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
  for (const [p, top] of held) p.scrollTop = top;
}
