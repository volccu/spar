/**
 * A server's trouble, said in the app's words (review CD-01, 2026-10-05).
 *
 * What a server or the network library answers is written for whoever runs the
 * server — "Failed to fetch", "JWT expired", "Signups not allowed for otp" —
 * and printed as it stands it names no cause and no next step. Every place that
 * shows such a failure says one plain sentence instead: what went wrong, then
 * what to do. The raw words go to the console, where whoever is asked to help
 * can still read them (quality bar §4, rule 2).
 *
 * Only the failures a person can actually meet are told apart; anything else
 * falls back to a sentence that is true of every failure.
 */

/** No answer at all: the network, a dead server, a blocked request. */
export function isUnreachable(raw: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|could not be reached|did not answer|err_(connection|name|internet)|timed? ?out/i.test(
    raw,
  );
}

/**
 * Narrower than `isUnreachable`: the request never left, or nothing answered
 * it — the network library's own words for that, and nothing a server can say.
 * A "timed out" is left out on purpose, because a database says it too. This is
 * what makes the sync loop call the device offline (`useSync`).
 */
export function isNoAnswer(raw: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_(internet|name_not_resolved|connection|network)/i.test(
    raw,
  );
}

/** The server would not take this device's credentials, or the app's key. */
export function isRefusedSignIn(raw: string): boolean {
  return /jwt|invalid api key|no api key|refresh token|token (has )?expired|invalid token|\b401\b|unauthori[sz]ed/i.test(raw);
}

function rateLimited(raw: string): boolean {
  return /rate limit|too many|\b429\b|security purposes/i.test(raw);
}

/**
 * Sign-in's sentence for a failure. `ownWords` is for a backend that already
 * answers in sentences of its own (a spår server's account replies): those
 * stand, and only a failure that never reached it is translated.
 */
export function signInWords(raw: string, ownWords = false): string {
  if (raw !== "") console.error("sign-in failed:", raw);
  if (/signups? not allowed/i.test(raw)) {
    return "No account for that address. Check the spelling. Signing in never creates a new account.";
  }
  if (isUnreachable(raw)) {
    return "The server could not be reached. Check the connection and try again, or use this device only.";
  }
  if (rateLimited(raw)) return ownWords ? raw : "Too many tries. Wait a minute, then try again.";
  if (ownWords) return raw;
  if (/invalid.*email|email.*invalid|validate email/i.test(raw)) {
    return "That is not an email address the server can take. Check the spelling.";
  }
  if (isRefusedSignIn(raw)) {
    return "The server turned the request away. Try again later, or use this device only.";
  }
  return "Signing in did not work. Try again, or use this device only.";
}

/**
 * The sync-failed dialog's first sentence. What follows it there is the same
 * for every failure: the notes are still on this device and sync tries again.
 */
export function syncWords(raw: string | null): string {
  if (!raw) return "The last sync did not finish.";
  const file = refusedFile(raw);
  if (file !== null) return `The server would not take the file “${file}”.`;
  if (isUnreachable(raw)) return "The server could not be reached.";
  if (isRefusedSignIn(raw)) {
    return "The server did not accept this device's sign-in. If this keeps happening, sign out and sign in again.";
  }
  return "The server would not take the last sync.";
}

/**
 * How an upload the server turned away names its file to this dialog
 * (`uploadPending` in `store/attachments.ts`, audit BUG-2): this, the file's
 * name, a line break, then the server's own words.
 */
export const FILE_REFUSED = "file refused: ";

/** The name of the file the server turned away, or null when the failure was not that. */
function refusedFile(raw: string): string | null {
  if (!raw.startsWith(FILE_REFUSED)) return null;
  return raw.slice(FILE_REFUSED.length).split("\n")[0];
}

/**
 * The whole of the sync-failed dialog: `syncWords`, then what happens next —
 * which for a file the server would not take is not "tries again": that file
 * waits until the app is opened again or its row is asked to send it.
 */
export function syncFailedMessage(raw: string | null): string {
  const next =
    raw !== null && refusedFile(raw) !== null
      ? "It stays on this device and is not sent again until the app is reopened or you tap “send again” on the file. Everything else keeps syncing."
      : "Everything is still saved on this device, and sync tries again on its own.";
  return `${syncWords(raw)}\n\n${next}`;
}
