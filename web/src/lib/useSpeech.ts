import { createElement, useCallback, useEffect, useRef, useState } from "react";
import type { BarLine } from "../components/CaptureLine";
import { Hotkey } from "../components/Hotkey";
import type { Said } from "../components/Speech";
import { UNDO_MS, undoable, type Undo } from "../store/useUndo";
import type { Note } from "../types";
import { UNDO_KEY, hasKeyboard, hotkeyTitle } from "./hotkeys";
import { useMoment } from "./mascotMoments";
import { reminderWhen } from "./reminders";
import { twinWords, useTwin } from "./twinSaid";
import { useReminderHeadsUp } from "./useReminderHeadsUp";
import { useWeatherLine, useWeatherOnPoke, type WeatherSaid } from "./useWeatherLine";
import { itIsLate } from "../components/mascot-element";

/**
 * What the header's creature says, and when (2026-10-16, owner approved;
 * `components/Speech.tsx` draws it). One sentence at a time, chosen in this
 * order — the thing you just did first, the state of the app last:
 *
 *  1. the undo offer, or a notice with nothing to undo ("Copied 3 notes");
 *  2. where a capture went, when the screen cannot show it ("Saved to Inbox · Go");
 *  3. a link being written that is already saved ("You saved this 3 days ago · Open");
 *     and, level with these three, a moment (`lib/mascotMoments.ts`: "12 filed,
 *     3 left", "Emptied 14 notes", "Nothing for …") — the newest of them wins,
 *     except that a moment never covers an offer that can still be undone;
 *  4. the answer to a poke — how sync stands — or to a double tap, which syncs now;
 *  5. a reminder about to ring ("In 5 minutes: Call the dentist · Open");
 *  6. the connection going ("Offline…") or coming back, said once;
 *  7. a sync that failed, until it stops failing ("Couldn't sync · Details");
 *  8. the weather, now and then (`useWeatherLine`, 2026-10-23);
 *  9. a new version waiting, until it is taken ("Reload").
 *
 * The words say what happened, in the Small Machine voice the owner picked
 * (2026-10-19): at most one small sound per line ("Poof.", "Hm.", "Beep."),
 * the facts as plain as ever, and the action words never change. Every one of
 * them is also said by the header's permanently mounted live regions, which is
 * where a reader hears it.
 */

/** How long the answer to a poke stands. */
const POKE_SAY_MS = 4_000;
/** Two pokes this close together are a double tap: sync now. */
export const DOUBLE_TAP_MS = 400;
/** A sync asked for by a double tap that has not finished by now is given up on, quietly. */
const SYNC_ASK_MS = 30_000;
/** How long the connection going, or coming back, is said for. */
const LINK_SAY_MS = 6_000;

export const OFFLINE_WORDS = "Hm. Offline. Your notes are safe here.";

/**
 * The undo offer's message as a sentence. The stack's messages are short —
 * "Archived 3" — because they were written for a mark with no room; in a
 * bubble the count is given its noun. Only the bare verb-and-count forms are
 * touched: a message that already names its thing ("Moved 3 to Links",
 * "Deleted Recipes") is said as it is.
 */
export function spokenUndo(message: string): string {
  const marked = /^Marked (important|to-do) (\d+)$/.exec(message);
  if (marked) {
    const n = Number(marked[2]);
    return `Marked ${n} ${n === 1 ? "note" : "notes"} ${marked[1] === "to-do" ? "as to-do" : "important"}`;
  }
  const bare = /^(Archived|Unarchived|Deleted|Put back|Moved|Merged|Copied|Unmarked) (\d+)$/.exec(message);
  if (!bare) return message;
  const n = Number(bare[2]);
  return `${bare[1]} ${n} ${n === 1 ? "note" : "notes"}`;
}

/** A delete offered back goes with a small "Poof."; every other offer is said plain. */
export function voicedUndo(words: string): string {
  return /^Deleted /.test(words) ? `Poof. ${words}` : words;
}

/**
 * The receipt for a capture that carried the bar's reminder mark: the time it
 * will ring, said back, and one press to take the reminder off again (the note
 * stays). Pushed onto the undo stack like any offer, so Ctrl+Z reaches it.
 */
export function reminderReceipt(note: Note): Omit<Undo, "key"> {
  const at = note.reminder_at ?? null;
  return {
    message: at ? `Reminder set · ${reminderWhen(at)}` : "Reminder set",
    steps: at ? [{ id: note.id, expect: { reminder_at: at }, revert: { reminder_at: null } }] : [],
  };
}

/** "just now", "2 minutes ago", "3 hours ago": how long since the last clean sync. */
export function agoWords(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

interface Options {
  /** The undo offer standing on the board, if any. */
  offer: Undo | null;
  onUndo: () => void;
  /** A capture's receipt for a note that landed off the screen. */
  landed: BarLine | null;
  /** The sync failed: the sentence that explains it, and the way to read it. */
  failed: { label: string; open: () => void } | null;
  updateReady: boolean;
  onUpdate: () => void;
  online: boolean;
  /** There is a server to sync to (signed in). */
  syncs: boolean;
  /** A sync is drawn as running. */
  working: boolean;
  /** When the last sync finished clean. */
  syncedAt: number | null;
  /** How much is waiting to go up, asked when the connection comes back. */
  unsent: () => Promise<number>;
  /** Sync now, for a double tap. */
  syncNow?: () => void;
  /** The notes, for the reminder about to ring. */
  notes?: readonly Note[];
  /** Opens a note by id, for the reminder's Open. */
  openNote?: (id: string) => void;
  /** Something is being written, read or tidied: the weather waits (`useWeatherLine`). */
  quiet?: boolean;
}

const NO_NOTES: readonly Note[] = [];
const NOWHERE = () => {};

interface Passing {
  said: Said;
  /** Raised on each saying, so the same words said twice still run their own clock. */
  n: number;
}

export function useSpeech(o: Options): { said: Said | null; onPoke: () => void } {
  const { offer, landed, online, syncs } = o;

  // The receipt fades by itself in the bar; here its time being up simply
  // ends it (`useLandedLine`'s `onGone`).
  useEffect(() => {
    if (landed?.leaving) landed.onGone?.();
  }, [landed]);

  // The connection going and coming back, said once each time — and only on
  // a device that syncs, the one the connection matters to. Nothing is said
  // about the state the app happened to open in.
  const [link, setLink] = useState<Passing | null>(null);
  const wasOnline = useRef(online);
  const unsentRef = useRef(o.unsent);
  unsentRef.current = o.unsent;
  useEffect(() => {
    if (wasOnline.current === online) return;
    wasOnline.current = online;
    if (!syncs) return;
    let live = true;
    if (!online) {
      setLink((p) => ({ n: (p?.n ?? 0) + 1, said: { key: "", words: OFFLINE_WORDS } }));
    } else {
      void unsentRef.current().then(
        (n) => {
          if (!live) return;
          const words = n > 0 ? `Beep. Back online. Sending ${n} ${n === 1 ? "change" : "changes"}…` : "Beep. Back online";
          setLink((p) => ({ n: (p?.n ?? 0) + 1, said: { key: "", words } }));
        },
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [online, syncs]);
  useEffect(() => {
    if (!link) return;
    const t = window.setTimeout(() => setLink(null), LINK_SAY_MS);
    return () => window.clearTimeout(t);
  }, [link]);

  // A poke is a question — how are things? — and it is answered for a moment.
  // Each poke is its own answer, so a second one restarts the moment. Two in
  // quick succession are a double tap, which syncs now where there is a
  // server to sync to (2026-10-16, owner approved): "Syncing…" while it runs,
  // the creature walking, then "All synced · just now".
  const [poke, setPoke] = useState(0);
  const [asked, setAsked] = useState<number | null>(null);
  const [synced, setSynced] = useState<number | null>(null);
  const [pokeWeather, setPokeWeather] = useState<{ n: number; line: WeatherSaid | null | undefined } | null>(null);
  const pokeAsk = useWeatherOnPoke();
  const weatherPoke = useRef(pokeAsk);
  weatherPoke.current = pokeAsk;
  const pokes = useRef(0);
  const lastPoke = useRef(0);
  const canSync = useRef(false);
  canSync.current = syncs && online && Boolean(o.syncNow);
  const syncNowRef = useRef(o.syncNow);
  syncNowRef.current = o.syncNow;
  const onPoke = useCallback(() => {
    const now = Date.now();
    const double = now - lastPoke.current < DOUBLE_TAP_MS;
    lastPoke.current = double ? 0 : now;
    if (double && canSync.current) {
      setPoke(0);
      setSynced(null);
      setAsked(now);
      syncNowRef.current?.();
      return;
    }
    const n = (pokes.current += 1);
    setPoke(n);
    // The weather now is the answer to a poke; until it comes the creature
    // hums, and where there is none the old answer (how sync stands) is said.
    if (!weatherPoke.current.enabled) return;
    setPokeWeather({ n, line: undefined });
    void weatherPoke.current.ask().then((line) => {
      if (pokes.current === n) setPokeWeather({ n, line });
    });
  }, []);
  useEffect(() => {
    if (poke === 0) return;
    const t = window.setTimeout(() => setPoke(0), POKE_SAY_MS);
    return () => window.clearTimeout(t);
  }, [poke]);
  const failedNow = o.failed !== null;
  useEffect(() => {
    if (asked === null) return;
    if (o.syncedAt !== null && o.syncedAt >= asked) {
      setAsked(null);
      setSynced(o.syncedAt);
      return;
    }
    // A failure says itself (`failed` below); nothing more to wait for.
    if (failedNow) {
      setAsked(null);
      return;
    }
    const t = window.setTimeout(() => setAsked(null), SYNC_ASK_MS);
    return () => window.clearTimeout(t);
  }, [asked, o.syncedAt, failedNow]);
  useEffect(() => {
    if (synced === null) return;
    const t = window.setTimeout(() => setSynced(null), POKE_SAY_MS);
    return () => window.clearTimeout(t);
  }, [synced]);

  const twin = useTwin();
  const moment = useMoment();
  const headsUp = useReminderHeadsUp(o.notes ?? NO_NOTES, o.openNote ?? NOWHERE);
  const weather = useWeatherLine(Boolean(o.quiet));
  // Whichever of the offer and a capture's receipt arrived last is the one
  // said: a capture made while an older offer still stands names where it
  // went. Arriving together — a capture carrying a reminder — the receipt wins,
  // and the reminder's undo stays on Ctrl+Z.
  const order = useRef({ n: 0, offerKey: -1, offerAt: 0, landedKey: "", landedAt: 0, momentKey: "", momentAt: 0 });
  const seen = order.current;
  if (offer && offer.key !== seen.offerKey) {
    seen.offerKey = offer.key;
    seen.offerAt = seen.n += 1;
  }
  if (landed && landed.key !== seen.landedKey) {
    seen.landedKey = landed.key;
    seen.landedAt = seen.n += 1;
  }
  if (moment && moment.key !== seen.momentKey) {
    seen.momentKey = moment.key;
    seen.momentAt = seen.n += 1;
  }
  const receiptFirst = Boolean(landed && !landed.leaving) && seen.landedAt > seen.offerAt;
  // A moment is said over an older notice or receipt, and gives way to a newer
  // one. Never over an offer that can still be undone: that is the one thing
  // here that loses something if it goes unseen.
  const momentFirst =
    moment !== null &&
    !(offer && undoable(offer)) &&
    // A poke is a question asked just now: its answer is said, not a moment.
    poke === 0 &&
    asked === null &&
    synced === null &&
    seen.momentAt > (offer ? seen.offerAt : 0) &&
    seen.momentAt > (landed && !landed.leaving ? seen.landedAt : 0);
  return {
    said: momentFirst ? moment : chosen(o, { poke, asked, synced, link, receiptFirst, twin, headsUp, moment, weather, pokeWeather }),
    onPoke,
  };
}

interface Moment {
  poke: number;
  asked: number | null;
  synced: number | null;
  link: Passing | null;
  receiptFirst: boolean;
  twin: BarLine | null;
  headsUp: Said | null;
  moment: Said | null;
  weather: Said | null;
  /** The weather asked for by the latest poke: undefined while it is coming, null where there is none. */
  pokeWeather: { n: number; line: WeatherSaid | null | undefined } | null;
}

function chosen(o: Options, m: Moment): Said | null {
  const { landed, online, syncs } = o;
  const { poke, link, receiptFirst, twin } = m;
  const offer = receiptFirst ? null : o.offer;

  if (offer) {
    const plain = spokenUndo(offer.message);
    const words = voicedUndo(plain);
    const can = undoable(offer);
    return {
      key: `undo:${offer.key}`,
      words,
      act: can
        ? {
            verb: "Undo",
            label: `Undo: ${plain}${hasKeyboard(false) ? `, ${hotkeyTitle(UNDO_KEY)}` : ""}`,
            run: o.onUndo,
            hint: createElement(Hotkey, { keyName: UNDO_KEY }),
          }
        : undefined,
      clockMs: UNDO_MS,
      ask: can,
    };
  }

  if (landed && !landed.leaving && (receiptFirst || !o.offer)) {
    const words = landed.place ? `Tucked into ${landed.place}` : landed.said;
    return { key: landed.key, words, act: { verb: landed.verb, label: `${landed.verb}: ${words}`, run: landed.act } };
  }

  if (twin) {
    const words = twinWords(twin.said);
    return { key: twin.key, words, act: { verb: twin.verb, label: `${twin.verb}: ${words}`, run: twin.act } };
  }


  const failedSaid: Said | null = o.failed
    ? { key: "failed", words: "Uh-oh. Didn't sync", act: { verb: "Details", label: `Details: ${o.failed.label}`, run: o.failed.open } }
    : null;

  if (m.asked !== null) return { key: `sync:${m.asked}`, words: "Whirr. Syncing…" };
  if (m.synced !== null) return { key: `synced:${m.synced}`, words: "Beep. All synced · just now" };

  if (poke > 0) {
    const key = `poke:${poke}`;
    if (!online) return { key, words: OFFLINE_WORDS };
    if (failedSaid) return { ...failedSaid, key };
    const asked = m.pokeWeather?.n === poke ? m.pokeWeather.line : null;
    // Waiting on the forecast: the dots count, so it reads as busy (2026-10-23).
    if (asked === undefined) return { key, words: "Hm…", busy: true };
    if (asked) return { key, words: asked.words, strong: asked.strong };
    if (!syncs) return { key, words: "Beep. Your notes are kept on this device." };
    if (o.working || o.syncedAt === null) return { key, words: "Whirr. Syncing…" };
    // Poked late at night it answers half asleep (the sleepy face's own clock).
    return { key, words: `${itIsLate() ? "Zzz…" : "Beep."} All synced · ${agoWords(o.syncedAt)}` };
  }

  if (m.moment) return m.moment;
  if (m.headsUp) return m.headsUp;
  if (link) return { ...link.said, key: `link:${link.n}` };
  if (failedSaid) return failedSaid;
  // The weather is the least of it: said only when nothing else is.
  if (m.weather) return m.weather;
  if (o.updateReady) {
    return {
      key: "update",
      words: "Ooh. A new version is ready",
      act: { verb: "Reload", label: "Reload to use the new version", run: o.onUpdate },
    };
  }
  return null;
}
