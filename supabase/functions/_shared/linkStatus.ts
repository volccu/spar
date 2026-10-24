// linkStatus.ts — what a page's HTTP status says about the page.
//
// Pure, dependency-free, and shared on purpose, as `notification.ts` is: the
// `link-preview` function reads its verdict from here, and the root test suite
// (`tests/linkStatus.test.ts`) imports the same file without Deno — the only
// place the rule is checked before it decides that somebody's saved link is
// dead.

/**
 * The two answers that mean the page is no longer there, and the only two.
 *
 * **404** is "nothing here" and **410** is "there was, and it was taken away on
 * purpose". Everything else a server can say is about the *asking*, not the
 * page: 403 and 401 are a bot wall or a login in front of a page that may be
 * perfectly alive, 429 is throttling, every 5xx is the server having a bad
 * moment, and a timeout or a name that will not resolve is the network's. A
 * link marked dead on any of those would be the app telling the owner a page
 * is gone because it was turned away at the door — so they stay what they
 * always were, a failure to fetch, and the note is left as it stands.
 */
export const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

/** What one response in the redirect walk means for the preview. */
export type PageVerdict = "redirect" | "page" | "gone" | "failed";

/**
 * The verdict on one upstream status, read the way the function's own
 * redirect walk reads it: a 3xx is a step to take, a 2xx is a page to read,
 * 404/410 is a page that is not there, and anything else is a fetch that did
 * not work this time.
 */
export function pageVerdict(status: number): PageVerdict {
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 200 && status < 300) return "page";
  if (GONE_STATUSES.has(status)) return "gone";
  return "failed";
}

/**
 * Whether the caller wants the page's picture fetched.
 *
 * The re-check the app runs on old links (`web/src/store/useLinkUnfurl.ts`)
 * asks only whether the page is still there, and sends `check: true`; its
 * answer is written as a verdict and nothing else, so pulling an og:image of
 * up to three megabytes through here for it would be bandwidth thrown away.
 * Anything but a literal `true` is the ordinary unfurl, which is how a client
 * that has never heard of the flag keeps getting exactly what it always got.
 */
export function wantsPicture(body: { check?: unknown }): boolean {
  return body.check !== true;
}
