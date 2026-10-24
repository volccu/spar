/**
 * Why the app was opened, when something outside it did the opening.
 *
 * The manifest declares a **launcher shortcut** — long-press the icon on an
 * Android home screen, right-click the taskbar icon on Windows — and a
 * shortcut is nothing but a URL the launcher navigates to. So what one can
 * carry is a query parameter and no more than that: `?do=capture` says *the
 * user asked for the field, not the board*, and the whole of acting on it is
 * putting the caret there.
 *
 * This is the third door into the app and the smallest. `lib/share.ts` is the
 * way out, `lib/shareTarget.ts` is a share coming in with something in its
 * hands, and this one is a person arriving empty-handed who has already
 * decided they are going to write. It needs no worker and no cache because
 * there is nothing to carry — which is why it lives in eleven lines rather
 * than in the two files a share takes.
 *
 * **The parameter is consumed**, exactly as `?note=` and `?shared=1` are: it
 * is a signal from this one launch and not a place to come back to, and a
 * reload weeks later must not throw a keyboard up for no reason.
 *
 * Unlike those two it puts the rest of the query back rather than clearing
 * the whole of it. Nothing sends two of these together today; a reader that
 * quietly eats a parameter it was never asked about is the kind of fault that
 * only turns up in whatever it broke, months later and somewhere else.
 */

/** The one thing a shortcut can ask for. Named here and in the manifest. */
export type LaunchIntent = "capture";

/** The query parameter every shortcut URL carries. Named in the manifest. */
export const LAUNCH_PARAM = "do";

/**
 * Everything a shortcut may ask for. Exported so `publicIcons.test.ts` can
 * hold the manifest to it: the two files are joined by nothing but the string
 * `?do=capture` written out in both, and a launcher shortcut is the one part
 * of the app no screen can show you is broken.
 */
export const INTENTS: readonly LaunchIntent[] = ["capture"];

/**
 * What this launch was for, or `null` — which is every ordinary open, and so
 * nearly all of them.
 *
 * Reads the address bar once and cleans it, whether or not the value meant
 * anything: an unknown `?do=` is a shortcut from a newer manifest than this
 * build, and leaving it in the URL would only let a reload ask again for
 * something this app cannot do.
 *
 * Never throws. A runtime with no `history` to write to is a launch that
 * simply does not get acted on, never a boot that fails.
 */
export function takeLaunchIntent(): LaunchIntent | null {
  try {
    const url = new URL(window.location.href);
    const asked = url.searchParams.get(LAUNCH_PARAM);
    if (asked === null) return null;
    url.searchParams.delete(LAUNCH_PARAM);
    // `text` rides only with `?do=capture`, and is consumed with it: kept for
    // `takeLaunchText`, and gone from the address bar either way.
    const words = url.searchParams.get(LAUNCH_TEXT_PARAM);
    url.searchParams.delete(LAUNCH_TEXT_PARAM);
    const intent = INTENTS.includes(asked as LaunchIntent) ? (asked as LaunchIntent) : null;
    if (intent === "capture" && words) parked = words.slice(0, LAUNCH_TEXT_MAX);
    // Only the address changes: the entry's state may be the open-layer
    // entry `useDismissOnBack` reads, and blanking it would cost a Back.
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    return intent;
  } catch {
    return null;
  }
}

/**
 * The query parameter the desktop bookmark fills (`bookmarklet` below):
 * title, address and selected words for the write field.
 */
export const LAUNCH_TEXT_PARAM = "text";

/** A page can send anything; the field takes a sensible amount of it. */
export const LAUNCH_TEXT_MAX = 20_000;

let parked: string | null = null;

/**
 * The words `?do=capture&text=` brought, once, after `takeLaunchIntent` has
 * read the address (review 2026-10-04, FX-A-03). **They are for the write
 * field and nothing else — unsaved, never auto-saved**, so no page can write a
 * note by linking here; the reader sees them and presses Save. `null` on every
 * ordinary open.
 */
export function takeLaunchText(): string | null {
  const words = parked;
  parked = null;
  return words;
}

/**
 * The "Save to spår" bookmark: a `javascript:` address that opens this app on
 * the page being read, with its title, address and any selected words. Built
 * from the app's own origin so a copy on another host saves to itself.
 */
export function bookmarklet(origin: string): string {
  const base = JSON.stringify(`${origin}/?${LAUNCH_PARAM}=capture&${LAUNCH_TEXT_PARAM}=`);
  return (
    `javascript:(function(){window.open(${base}+encodeURIComponent(` +
    `document.title+'\\n'+location.href+'\\n'+String(getSelection())));})()`
  );
}
