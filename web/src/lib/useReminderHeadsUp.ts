import { useEffect, useRef, useState } from "react";
import type { Said } from "../components/Speech";
import type { Note } from "../types";
import { noteName, openingLine } from "./name";
import { nextOccurrence } from "./reminders";

/**
 * A reminder about to ring, said by the header's creature while the app is
 * open (2026-10-16, owner approved): "In 5 minutes: Call the dentist · Open".
 * The push still rings when the time comes; this is the heads-up for somebody
 * already looking at the app, so the note can be opened before it is due.
 *
 * Said once per occurrence per session, for a few seconds, and only for notes
 * that are not in the trash (trashed notes do not ring). Nothing is written
 * anywhere: it is worked out from `reminder_at` and `reminder_repeat`, the same
 * projection the reminder panel shows (`nextOccurrence`).
 */

/** How long before a reminder rings the creature mentions it. */
export const HEADS_UP_MS = 5 * 60_000;
/** How long it says so. */
export const HEADS_UP_SAY_MS = 15_000;
/** The longest single wait; a later reminder is looked at again after this. */
const LONGEST_WAIT_MS = 60 * 60_000;
/** How long a name may run before it gives way. */
const NAME_MAX = 48;

/** The note's own name, else its first line, short enough for the bubble. */
export function headsUpName(body: string): string {
  const name = (noteName(body) ?? openingLine(body) ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "a note";
  return name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name;
}

/** "In 5 minutes: Call the dentist", "In 1 minute: …". Never "in 0". */
export function headsUpWords(body: string, at: number, now: number): string {
  const minutes = Math.max(1, Math.round((at - now) / 60_000));
  return `Ding. In ${minutes} ${minutes === 1 ? "minute" : "minutes"}: ${headsUpName(body)}`;
}

/** The next reminder to ring that is still ahead of `now`, and when. */
export function nextToRing(notes: readonly Note[], now: number): { note: Note; at: number } | null {
  let best: { note: Note; at: number } | null = null;
  for (const note of notes) {
    if (!note.reminder_at || note.status === "trashed") continue;
    const at = nextOccurrence(note, now);
    if (at === null || at <= now) continue;
    if (!best || at < best.at) best = { note, at };
  }
  return best;
}

export function useReminderHeadsUp(notes: readonly Note[], open: (id: string) => void): Said | null {
  const [shown, setShown] = useState<{ key: string; words: string; noteId: string } | null>(null);
  const said = useRef(new Set<string>());
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      const next = nextToRing(notes, now);
      if (!next) return;
      const key = `remind:${next.note.id}:${next.at}`;
      const lead = next.at - now;
      if (lead <= HEADS_UP_MS) {
        if (!said.current.has(key)) {
          said.current.add(key);
          setShown({ key, words: headsUpWords(next.note.body, next.at, now), noteId: next.note.id });
        }
        // Look again once this one has rung, for the one after it.
        timer = window.setTimeout(check, lead + 1_000);
        return;
      }
      timer = window.setTimeout(check, Math.min(lead - HEADS_UP_MS, LONGEST_WAIT_MS));
    };
    check();
    // A tab in the background has its timers held back; coming to the front
    // is the moment to look again.
    const onVisible = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [notes]);

  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => setShown(null), HEADS_UP_SAY_MS);
    return () => window.clearTimeout(t);
  }, [shown]);

  if (!shown) return null;
  const { key, words, noteId } = shown;
  return {
    key,
    words,
    act: {
      verb: "Open",
      label: `Open: ${words}`,
      run: () => {
        setShown(null);
        openRef.current(noteId);
      },
    },
  };
}
