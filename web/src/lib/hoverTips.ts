/**
 * The app's own hover hint, in place of the browser's.
 *
 * Every `title` in the app stays where it is and keeps meaning what it meant;
 * this only changes how it is drawn. The browser's own box is grey, rounded,
 * shadowed and in the system face — none of which this app has — so while a
 * mouse rests on an element that carries a `title`, the attribute is lifted
 * off (which is the only way to keep the browser's box from also appearing),
 * the same words are shown in the app's own hint, and the attribute goes back
 * the moment the pointer leaves. Nothing in a component has to know.
 *
 * Mouse only. A finger has no hover, and a long press is already spoken for.
 * The hint waits `SHOW_WAIT_MS` before it comes up; once one has been up, the
 * next comes up at once for `WARM_MS`, the way a desktop's own hints behave,
 * so a pointer run along the board strip reads every name without waiting at
 * each. A press, a key, a wheel or a scroll puts it away, and it does not come
 * back until the pointer has left that element.
 *
 * An element whose only name was its `title` (an icon button) is given the
 * same words as an `aria-label` for as long as the title is off it, so a
 * screen reader asking at that moment still hears a name.
 */
import { animates, ENTER, TIP_IN_MS } from "./motion";

/** How long the pointer rests before a hint comes up. */
export const SHOW_WAIT_MS = 450;
/** After a hint goes, how long the next one skips the wait. */
export const WARM_MS = 500;
/** Space between the element and its hint, and between a hint and the edge. */
const GAP_PX = 6;
const EDGE_PX = 8;

export function startHoverTips(doc: Document = document): () => void {
  const win = doc.defaultView ?? window;
  let tip: HTMLDivElement | null = null;
  let anchor: Element | null = null;
  let words = "";
  let labelled = false;
  let shown = false;
  let spent = false;
  let lastHidden = -Infinity;
  let timer: number | undefined;

  const tipEl = () => {
    if (!tip) {
      tip = doc.createElement("div");
      tip.className = "hover-tip";
      // The words are already the element's own name or description; read
      // twice is noise.
      tip.setAttribute("aria-hidden", "true");
      tip.hidden = true;
      doc.body.appendChild(tip);
    }
    return tip;
  };

  const hide = () => {
    win.clearTimeout(timer);
    timer = undefined;
    if (!shown) return;
    shown = false;
    lastHidden = win.performance.now();
    if (tip) tip.hidden = true;
  };

  const place = (el: HTMLDivElement, target: Element) => {
    const r = target.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = win.innerWidth;
    const vh = win.innerHeight;
    let top = r.bottom + GAP_PX;
    if (top + h > vh - EDGE_PX && r.top - GAP_PX - h >= EDGE_PX) top = r.top - GAP_PX - h;
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, EDGE_PX), vw - w - EDGE_PX);
    el.style.left = `${Math.round(Math.max(left, EDGE_PX))}px`;
    el.style.top = `${Math.round(top)}px`;
  };

  const show = (fade: boolean) => {
    timer = undefined;
    if (!anchor || !anchor.isConnected || spent || !words.trim()) return;
    const el = tipEl();
    el.textContent = words;
    el.hidden = false;
    place(el, anchor);
    shown = true;
    if (fade && animates(el)) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TIP_IN_MS, easing: ENTER });
    }
  };

  // React may set the title again while it is lifted off (a verb that
  // changes its words on click). Take the new words, and keep it off.
  const watch = new win.MutationObserver(() => {
    if (!anchor) return;
    const next = anchor.getAttribute("title");
    if (next === null) return;
    words = next;
    anchor.removeAttribute("title");
    if (labelled) anchor.setAttribute("aria-label", next);
    if (shown && tip) {
      tip.textContent = next;
      place(tip, anchor);
    }
  });

  const release = () => {
    hide();
    watch.disconnect();
    if (anchor) {
      if (!anchor.hasAttribute("title")) anchor.setAttribute("title", words);
      if (labelled && anchor.getAttribute("aria-label") === words) anchor.removeAttribute("aria-label");
    }
    anchor = null;
    words = "";
    labelled = false;
    spent = false;
  };

  const take = (el: Element) => {
    const title = el.getAttribute("title") ?? "";
    if (!title.trim()) return;
    anchor = el;
    words = title;
    el.removeAttribute("title");
    if (
      !el.hasAttribute("aria-label") &&
      !el.hasAttribute("aria-labelledby") &&
      !(el.textContent ?? "").trim()
    ) {
      el.setAttribute("aria-label", title);
      labelled = true;
    }
    watch.observe(el, { attributes: true, attributeFilter: ["title"] });
    const warm = win.performance.now() - lastHidden < WARM_MS;
    timer = win.setTimeout(() => show(!warm), warm ? 0 : SHOW_WAIT_MS);
  };

  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const target = e.target;
    if (!(target instanceof win.Element)) return;
    const el = target.closest("[title]");
    if (el === anchor && el !== null) return;
    if (anchor && anchor.isConnected && anchor.contains(target)) return;
    release();
    if (el) take(el);
  };

  const onOut = (e: PointerEvent) => {
    if (!anchor) return;
    const to = e.relatedTarget;
    if (to instanceof win.Node && anchor.contains(to)) return;
    release();
  };

  // Something was done: the hint has said its piece until the pointer leaves.
  const putAway = () => {
    if (!anchor) return;
    spent = true;
    hide();
  };

  const opts = { capture: true, passive: true } as const;
  doc.addEventListener("pointerover", onOver, opts);
  doc.addEventListener("pointerout", onOut, opts);
  doc.addEventListener("pointerdown", putAway, opts);
  doc.addEventListener("keydown", putAway, opts);
  doc.addEventListener("wheel", putAway, opts);
  doc.addEventListener("scroll", putAway, opts);
  win.addEventListener("blur", release);

  return () => {
    release();
    doc.removeEventListener("pointerover", onOver, opts);
    doc.removeEventListener("pointerout", onOut, opts);
    doc.removeEventListener("pointerdown", putAway, opts);
    doc.removeEventListener("keydown", putAway, opts);
    doc.removeEventListener("wheel", putAway, opts);
    doc.removeEventListener("scroll", putAway, opts);
    win.removeEventListener("blur", release);
    tip?.remove();
    tip = null;
  };
}
