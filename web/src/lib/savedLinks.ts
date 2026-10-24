import type { Note } from "../types";
import { addressKeys } from "./links";
import { fullDate, timeWords } from "./when";

/**
 * Whether an address being written — or the whole note — is already in
 * another note.
 *
 * The capture bar asks this about its own words (web/CLAUDE.md, "The capture
 * bar: the field and the keyboard"), and it asks on every keystroke once there
 * is an address in the field — so the archive is not scanned per keystroke.
 * It is indexed once per `notes` identity, lazily, on the first question that
 * needs it, and each note's addresses are read out of its text once per
 * version of that note (`keysOf`, keyed on the object the store replaces on
 * every write). A burst of typing in an open note therefore costs the index
 * the one changed note, and a board that never has an address typed into its
 * bar never builds it at all.
 *
 * Only notes that still exist count: active and archived. The trash is on its
 * way out and search does not find it either, so "already saved" pointing
 * there would send somebody to restore a note in order to read it.
 *
 * **The whole text counts too** (the owner's ask of 2026-10-05, after a read
 * of the archive found the same block pasted in up to four times): a note
 * whose words are the field's words, spacing and capitals aside, answers
 * before any note that only shares an address with it. It is the same line
 * and the same Open — information, never a question, and Save is unchanged.
 */

/**
 * Shorter than this, a note's whole text is a scrap ("test", "Osta") that two
 * notes may share without being the same thought — and the line would flicker
 * on every word typed past one. Counted after spacing is closed up.
 */
export const SAME_TEXT_MIN = 8;

/**
 * The note's words as one comparable string, or null for a scrap. Spacing of
 * every kind closes to one space and capitals fold, so a note pasted twice
 * with a stray blank line still matches itself. The prefix keeps it from ever
 * colliding with an address key in the shared index.
 */
export function textKey(text: string): string | null {
  const words = text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return words.length >= SAME_TEXT_MIN ? `text:${words}` : null;
}

const keysCache = new WeakMap<Note, string[]>();

/** Its whole text where that is long enough to count, then its addresses. */
function keysOf(note: Note): string[] {
  const cached = keysCache.get(note);
  if (cached) return cached;
  const keys = searchKeys(note.body ?? "");
  keysCache.set(note, keys);
  return keys;
}

/** What a text is looked up by, in the order a match is believed. */
function searchKeys(text: string): string[] {
  const whole = textKey(text);
  const addresses = addressKeys(text);
  return whole ? [whole, ...addresses] : addresses;
}

/** Which notes already hold each address, and each whole text. */
export type LinkIndex = ReadonlyMap<string, readonly Note[]>;

/** Every address and whole text in the archive, with the notes that carry it. */
export function linkIndex(notes: readonly Note[]): LinkIndex {
  const index = new Map<string, Note[]>();
  for (const note of notes) {
    if (note.status !== "active" && note.status !== "archived") continue;
    // A note naming one address twice is still one note holding it.
    for (const key of new Set(keysOf(note))) {
      const held = index.get(key);
      if (held) held.push(note);
      else index.set(key, [note]);
    }
  }
  return index;
}

/**
 * Where two notes carry the same address the **active** one wins over an
 * archived one — it is the copy still in use — and then the newest, which is
 * the one the reader is likeliest to remember saving.
 */
function outranks(a: Note, b: Note): boolean {
  if (a.status !== b.status) return a.status === "active";
  return (a.created_at ?? "") > (b.created_at ?? "");
}

/**
 * The note that already holds `text`, or one of its addresses, or null. The
 * whole text is asked first, then each address in order, and the first that
 * has a note answers; `except` is a note that must not answer for itself — a shared page that has just been saved is in the index already,
 * and is the newest copy of its own address by construction.
 */
export function savedTwin(index: LinkIndex, text: string, except?: string): Note | null {
  for (const key of searchKeys(text)) {
    let best: Note | null = null;
    for (const note of index.get(key) ?? []) {
      if (note.id === except) continue;
      if (!best || outranks(note, best)) best = note;
    }
    if (best) return best;
  }
  return null;
}

/**
 * "Saved 3 days ago", "Saved on 5 Aug" — when the note holding an address was
 * written, in the grammar the open note already uses (`lib/when.ts`), with the
 * calendar taking over once counting stops being useful. An archived copy says
 * so, since opening it lands somewhere no board in front of you shows.
 */
export function savedWords(note: Note, now: number): string {
  const when = timeWords(note.created_at, now);
  const date = when ?? (note.created_at ? `on ${fullDate(note.created_at, now)}` : "");
  const saved = date ? `Saved ${date}` : "Already saved";
  return note.status === "archived" ? `${saved}, archived` : saved;
}

/**
 * `linkIndex`, built only when first asked for and then kept for as long as
 * the notes it was built from. Handed a new list, it forgets the old index.
 */
export function lazyLinkIndex(): (notes: readonly Note[]) => LinkIndex {
  let from: readonly Note[] | null = null;
  let built: LinkIndex = new Map();
  return (notes) => {
    if (notes !== from) {
      built = linkIndex(notes);
      from = notes;
    }
    return built;
  };
}
