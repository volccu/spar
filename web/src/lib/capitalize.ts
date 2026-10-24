/**
 * The first letter of a new note is set upright, once, at capture.
 *
 * This runs in exactly two places — `create` and `createWithFiles` in
 * `store/useNotes.ts` — *before* the note exists, so `raw_content` and `body`
 * agree from their first byte and never diverge over one letter. It never runs
 * on an edit: rewriting text the user is not currently typing is the one thing
 * this app never does, so a capital lowered by hand afterwards stays lowered.
 *
 * It reads past the one marker a capture legitimately opens with — a heading,
 * a dash item, a tick box, a numbered item — and capitalises the letter after
 * it. Everything else stands as typed: an address (capitalising the scheme
 * breaks the link), code, a digit, an emoji, a letter already upright.
 */

/**
 * The markers `autoformat`/`blocks` know: one or two hashes, a tick box, a
 * dash/star item, a number bounded at three digits (the same bound NUM_RE
 * carries, for the same reason — "1998." opening a note is a year, not a list).
 */
const MARKER = /^(?:#{1,2} |\[ \] |[-–*] |\d{1,3}[.)] )/;

/** `linkify`'s own opening (lib/links.ts LINK_RE), anchored. */
const ADDRESS = /^(?:https?:\/\/|www\.)/i;

export function capitalizeCapture(text: string): string {
  const marker = text.match(MARKER)?.[0] ?? "";
  const rest = text.slice(marker.length);
  if (ADDRESS.test(rest)) return text;
  // A word that is not a plain word stands as typed (bughunt 2026-10-15): a
  // capital inside it ("iPhone", "eBay"), or a dot, @, slash or colon with
  // more after it ("example.com", "me@example.com", "src/app"). A full stop
  // or colon that ends the word ("milk.", "note:") is punctuation, not this.
  const word = rest.match(/^\S*/)?.[0] ?? "";
  if (/\p{Lu}/u.test(word.slice(1)) || /[.@/:][\p{L}\p{N}]/u.test(word)) return text;

  const point = rest.codePointAt(0);
  if (point === undefined) return text;
  const first = String.fromCodePoint(point);
  if (!/^\p{Ll}$/u.test(first)) return text;

  const upper = first.toUpperCase();
  // Some letters uppercase into two ("ß" → "SS"). One letter is the promise;
  // a capture that would grow by a character is left alone.
  if (upper.length !== first.length) return text;

  return marker + upper + rest.slice(first.length);
}
