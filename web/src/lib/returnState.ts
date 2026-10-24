/**
 * Where you were when a link took the window.
 *
 * Both anchor sites already ask for a new window (`target="_blank"`), but the
 * runtime this app actually lives in — Firefox on Android, installed as a
 * standalone window — is free to ignore that and navigate the app itself
 * away. Nothing on the web side can forbid it. So a link tap does two things:
 * it asks harder (`window.open` from inside the user's own gesture, in
 * `leaveForLink`), and it writes down where it happened — the open note, the
 * board, the scroll — so that if the window goes anyway, Back walks into a
 * rebooted shell that knows the way back to the exact spot.
 *
 * The restore fires only on a back/forward boot (`isReturnNavigation`): that
 * is the one kind of boot that means "a navigation happened and the user
 * pressed Back out of it". A bfcache resume never re-runs boot at all, which
 * is the better outcome and needs nothing from us; an ordinary open or reload
 * consumes the stash unused, so closing the app can never smuggle an old note
 * back onto the screen days later.
 *
 * sessionStorage on purpose: it survives a same-tab navigation and dies with
 * the window — exactly the life of "where was I before that link".
 */

export interface ReturnSpot {
  openId: string | null;
  boardId: string;
  scrollTop: number;
  when: number;
}

const KEY = "spar-return";

/** A return older than this is a new visit, not a round trip. */
export const RETURN_MAX_MS = 30 * 60_000;

type Provider = () => Omit<ReturnSpot, "when">;

let provider: Provider | null = null;

/**
 * App owns the state; the link renderers only know the moment. Registered
 * the same way the mascot's instance registry works — a module-level way in,
 * so no ref has to be threaded down through the reader's prop chain.
 */
export function provideReturnSpot(fn: Provider | null): void {
  provider = fn;
}

/** Write down where the user is standing, dated. No provider, no stash. */
export function stashReturn(): void {
  if (!provider) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...provider(), when: Date.now() }));
  } catch {
    // Storage refused is a lost safety net, never a lost link.
  }
}

/**
 * Read the stash and consume it — fresh or stale, one boot's read removes it,
 * so a spot is offered exactly once and never to a later, unrelated open.
 */
export function takeReturn(now = Date.now()): ReturnSpot | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const spot = JSON.parse(raw) as ReturnSpot;
    if (typeof spot.when !== "number" || now - spot.when > RETURN_MAX_MS) return null;
    return spot;
  } catch {
    return null;
  }
}

/**
 * True only when this boot is the browser walking Back (or Forward) into the
 * shell — the one boot that means a link navigated the window away and the
 * user asked to come back.
 */
export function isReturnNavigation(): boolean {
  const nav = performance.getEntriesByType?.("navigation")?.[0] as
    | PerformanceNavigationTiming
    | undefined;
  return nav?.type === "back_forward";
}

/**
 * The one click handler both anchor sites share (`NoteInline`, `LinkPreview`)
 * — written once for the same reason the inline grammar has one renderer.
 *
 * `window.open` inside the user's own gesture is never popup-blocked and is a
 * stronger ask than the anchor's `target` on runtimes that ignore attributes.
 * When it is honoured the anchor's own navigation is stood down; when the
 * runtime refuses (`null`), the default click proceeds and the anchor's
 * `target="_blank"` + `rel` fallback carries the link as before, so the link
 * works everywhere and never fires twice. `stopPropagation` stays: without it
 * the reader turns the tap into a caret and swaps in the editor mid-leave.
 *
 * **There is no features string, and there must never be one containing
 * `noopener` or `noreferrer`.** That is the whole of the two-tabs bug: the
 * spec requires `window.open` to return `null` whenever the opener link is
 * severed, *whether or not the window opened*, so the handle stopped being an
 * answer to "did it open" and became a constant `null`. The anchor then never
 * stood down and every link opened twice — measured in Chromium 152, one
 * click producing two targets. A mocked `window.open` cannot show this: the
 * mock returns whatever it was told to and never reads the third argument,
 * which is why the test that asserted the stand-down passed throughout.
 *
 * So the opener is severed by hand instead, on the handle we get back. It
 * costs the `Referer` suppression `noreferrer` was buying on this path — the
 * fallback anchor keeps its `rel`, and a referrer is a smaller loss than a
 * link that cannot say whether it opened.
 */
export function leaveForLink(
  e: { stopPropagation(): void; preventDefault(): void },
  href: string,
): void {
  e.stopPropagation();
  stashReturn();
  const opened = window.open(href, "_blank");
  if (!opened) return;
  try {
    opened.opener = null;
  } catch {
    // Severing refused is a link already open; never a reason to open it twice.
  }
  e.preventDefault();
}
