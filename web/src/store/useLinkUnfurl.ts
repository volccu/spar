import { nowIso } from "../lib/when";
import { useCallback, useEffect, useRef } from "react";
import { readSetting } from "../lib/settings";
import type { Note } from "../types";
import { canPreview, isVideo, PREVIEW_THUMB_PX, WALL_THUMB_PX, WALL_THUMB_QUALITY } from "../lib/files";
import {
  dueForRecheck,
  needsUnfurl,
  overlaySaved,
  previewsFor,
  UNFURL_AT_ONCE,
  wallLinkHref,
  withoutBlackPicture,
  type LinkPreviewData,
} from "../lib/links";
import { boundedQueue } from "../lib/queue";
import { syncConfigured } from "./supabase";
import { getBackend, type LinkPreviewFailure } from "./backend";
import { RUNTIME_CONFIG } from "./backend/config";

/** How long a note has to hold still before its links are asked about. */
export const UNFURL_QUIET_MS = 1500;

/**
 * How long after the archive is on screen the re-check of old links starts.
 *
 * Opening the app is when everything else wants the network — the pull, the
 * outbox, a first-time unfurl of whatever the other device saved — and the
 * re-check is the one job here with no reader waiting on it. So it waits for
 * that to be over, and then for the browser to say it is idle.
 */
export const RECHECK_AFTER_MS = 20_000;

/** What the function answers, as far as this hook reads it. */
interface Answer {
  url: string;
  title: string;
  description: string | null;
  image: string | null;
  /** 404 or 410 — the page is not there. Absent from a function deployed before this. */
  gone?: boolean;
  /** What the picture is — absent from a function deployed before this existed. */
  media?: "image" | "video" | null;
  width?: number | null;
  height?: number | null;
  video?: { kind: "file" | "youtube" | "vimeo"; src: string } | null;
}

/** Whether this note is filed on the Inspiration board (`wallId`) right now. */
function isOnWall(note: Note | null | undefined, wallId: string | null): boolean {
  return Boolean(note && wallId !== null && note.board_id === wallId);
}

/**
 * Whether `href` is the link this note's wall tile shows — the only link of a
 * wall note asked about, and stored, at the wall's size (`wallLinkHref`, audit
 * BUG-7). False for every link of a note that is not on the wall.
 */
function isWallLink(note: Note | null | undefined, wallId: string | null, href: string): boolean {
  if (!note || !isOnWall(note, wallId)) return false;
  const showsFile = (note.attachments ?? []).some((a) => canPreview(a) || (isVideo(a) && Boolean(a.thumb)));
  return wallLinkHref(overlaySaved(previewsFor(note.body ?? ""), note.link_previews), showsFile) === href;
}

/**
 * The statuses that are an answer *about the page*, and the only ones that may
 * ever stamp a `fetched_at`.
 *
 * `FunctionsHttpError` was the whole test here, and it means nothing more
 * specific than *non-2xx*. Two failures that have nothing to do with the page
 * arrive wearing it. Supabase's own gateway answers 502 or 504 when the
 * function is cold, mid-deploy or throttled, and the function never runs at
 * all; and the function's own 502s — `The page could not be fetched`, a
 * redirect chain that ran long, its own timeout — are by construction a
 * *momentary* upstream failure, which is exactly the case worth asking about
 * again. Either one marked the link "asked, answered, no picture" for the life
 * of the note, and `needsUnfurl` never asked a second time.
 *
 * So the list is read off `functions/link-preview/index.ts` and holds only what
 * names the page itself: **400** it is not a public http(s) address, **413** it
 * is over the size cap, **415** it is not a web page. Every other status the
 * chain can produce says something about *us* or about the moment — 401 a token
 * the gateway would not take, 404 a function not deployed, 405, 429 throttling,
 * and all of 5xx — and none of them is the page's fault to record. Being wrong
 * in this direction costs one more request on the next open; wrong in the other
 * costs the picture permanently.
 *
 * A page that is **gone** — 404 or 410 from the page itself — is not on this
 * list and never arrives as an error: the function answers it with a 200
 * carrying `gone`, because a 404 *status* here would be indistinguishable from
 * a function that was never deployed.
 */
const PAGE_STATUSES = new Set([400, 413, 415]);

/**
 * Whether a failed request is the function's verdict on the page.
 *
 * The backend reads the status off whatever its client failed with
 * (`linkFailure` in `backend/supabaseBackend.ts`, which says how) and reports
 * it only when something actually answered. A status that cannot be read
 * counts as transient. Something upstream of the function changed the shape
 * of the error, and re-asking on the next open is the recoverable half of that.
 */
function namesThePage(error: LinkPreviewFailure | null): boolean {
  return error !== null && error.status !== null && PAGE_STATUSES.has(error.status);
}

/**
 * Whether anything answered at all — the function, or the gateway in front of
 * it — as opposed to the request never arriving (offline, a dropped
 * connection, a relay error). A re-check counts the first as having asked and
 * the second as not; see the error branch in `ask`.
 */
function somethingAnswered(error: LinkPreviewFailure | null): boolean {
  return error?.answered === true;
}

/**
 * Whether there is a backend to ask. A build that reads `/config.json` finds
 * out later, and `signedIn` beside this already says there is one.
 */
function serverConfigured(): boolean {
  return RUNTIME_CONFIG || syncConfigured;
}

/** Runs `job` when the browser next has nothing to do, or soon, where it cannot say. */
function whenIdle(job: () => void): void {
  const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (idle) idle(job);
  else window.setTimeout(job, 0);
}

/**
 * useLinkUnfurl — asks the `link-preview` function about every link the
 * archive holds that has not been asked about yet, and writes what comes back
 * into the note. Once per session it also asks again about a few links whose
 * last answer is a month old, so a page that has died since it was saved is
 * shown as gone (`dueForRecheck`).
 *
 * Pulled out of `App.tsx` on 2026-09-04, where it had sat as one hundred lines
 * of effect between the undo stack and the keyboard listener, touching nothing
 * either side of it. Nothing about the behaviour moved with it; what moved is
 * the reading — this is the whole of what the app does about link previews on
 * the client, and it can now be read and tested on its own.
 *
 * Enrichment, never a gate. A preview renders from the note's own words the
 * moment the note exists; what this fetches is a better title, a description
 * and a small picture, and any of them may never arrive. Nothing here can make
 * a note late.
 *
 * **A preview write does not move the note on its board.** It goes through
 * `update` like any other field, so `updated_at` moves and the row syncs —
 * which is how the other device gets it — but a board is ordered on
 * `editedAt`, which reads only the `body` and `attachments` clocks, and
 * `localPatch` seeds the full clock set on an imported note's first write. A
 * re-check therefore writes nothing a reader can see except the verdict.
 */
export function useLinkUnfurl({
  notes,
  signedIn,
  update,
  wallBoardId = null,
}: {
  notes: Note[];
  /** No session means no function to call; the scan does not run at all. */
  signedIn: boolean;
  update: (id: string, patch: Partial<Note>) => void;
  /** The Inspiration board's id: notes filed there are unfurled at the wall's size. */
  wallBoardId?: string | null;
}) {
  const wallRef = useRef(wallBoardId);
  wallRef.current = wallBoardId;
  // Notes already scanned *as wall notes* this session. A note filed onto the
  // wall after it was asked about elsewhere is a new question (its picture
  // wants to be bigger), and its unchanged body must not hide that.
  const scannedOnWall = useRef(new Set<string>());
  // The notes as they are at the moment an answer arrives, not as they were
  // when the question was asked. A job sits in the queue for as long as it
  // takes, and the note may have been edited, or its link removed, meanwhile.
  const notesRef = useRef(notes);
  notesRef.current = notes;
  // Every link asked about this session, so a note re-rendering does not ask
  // twice. Session-long on purpose: a transient failure writes nothing to the
  // note, and this is what keeps it from being retried in a loop before the
  // next open.
  const requested = useRef(new Set<string>());
  // The body each note was last scanned for links at. `previewsFor` is a
  // regex walk over the whole body, and this effect used to redo it for every
  // note on every note change anywhere in the app — filing one note away
  // re-swept the other 240 bodies for links that had not moved. A note whose
  // body has not changed since it was last scanned has nothing new to find.
  const scannedBodies = useRef(new Map<string, string>());
  // Unfurls go through one bounded queue for the life of the session, a few
  // on the wire at a time — see `boundedQueue` for the burst this replaces.
  // The re-check shares it, so the two together are still a few at a time.
  const unfurl = useRef(boundedQueue(UNFURL_AT_ONCE));

  /**
   * Asks the function about one link of one note and writes what comes back.
   *
   * Two callers, one job. The first-time scan asks about a link nothing has
   * been learned about yet (`"unfurl"`); the re-check on open asks again about
   * a link whose last answer is a month old (`"recheck"`), and the two write
   * differently because they asked different questions. An unfurl writes the
   * page's title, description and picture; a re-check writes only the verdict
   * — still there, or gone — and when it asked, and leaves the preview the
   * owner has been looking at as it was. The one exception is a link that was
   * gone and has come back: that is the page's first real answer in a while,
   * so it is asked for in full and written the way an unfurl is.
   */
  const ask = useCallback(
    async (noteId: string, local: LinkPreviewData, mode: "unfurl" | "recheck") => {
      // Asked only if the link is still in the note *when the job runs*,
      // not when it was queued. The scan runs on every keystroke, and
      // an address being typed is a new link every character past the
      // fifth — `https://example.com/some/path` queued two dozen of them,
      // each a cold edge-function call fetching a real page, and the
      // check that would have dropped them sat after the request.
      const stillLinked = () => {
        const current = notesRef.current.find((candidate) => candidate.id === noteId);
        return current &&
          current.status !== "trashed" &&
          previewsFor(current.body).some((preview) => preview.href === local.href)
          ? current
          : null;
      };
      const storedIn = (note: Note) =>
        (note.link_previews ?? []).find((preview) => preview.href === local.href);
      // Replaces this link's entry and nothing else: every other entry is
      // spread through untouched, fields this build has never heard of included.
      // Built on the latest copy this hook has written, not the render's: two
      // links in one note answered before the screen redrew each rebuilt the
      // list from the same stale copy, and the second wiped the first's
      // preview (bughunt 2026-10-24). The ref is brought up to date with the
      // write here and replaced by the real notes on the next render.
      const write = (note: Note, entry: LinkPreviewData) => {
        const latest = notesRef.current.find((n) => n.id === noteId) ?? note;
        const link_previews = [
          ...(latest.link_previews ?? []).filter((preview) => preview.href !== local.href),
          entry,
        ];
        notesRef.current = notesRef.current.map((n) => (n.id === noteId ? { ...n, link_previews } : n));
        update(noteId, { link_previews });
      };

      const before = stillLinked();
      if (!before) return;
      // Link previews off in Settings (2026-10-11, owner approved): this
      // device sends no address to the preview service and writes nothing,
      // so the note keeps its own words; turned back on, the next open asks.
      if (readSetting("previews") === "off") return;
      // A live page being re-checked is asked for its verdict only, and the
      // function then skips the picture it would otherwise pull through
      // (`wantsPicture` beside it). Asked without the flag — the first unfurl,
      // or a gone page being asked whether it is back — the answer is whole.
      const verdictOnly = mode === "recheck" && !storedIn(before)?.gone;
      // The backend is fetched inside the job: it arrives by dynamic
      // import (off the first paint), and the queue runs long after the
      // guard above has been and gone.
      const backend = await getBackend();
      if (!backend) return;
      // A wall link says so, and may then be answered with a screenshot of
      // its page; nothing else ever sends its address to that service.
      const { data, error } = await backend.linkPreview<Answer>(
        verdictOnly
          ? { url: local.href, check: true }
          : isWallLink(before, wallRef.current, local.href)
            ? { url: local.href, wall: true }
            : { url: local.href },
      );
      const current = stillLinked();
      if (!current) return;
      const stored = storedIn(current);

      if (error || !data) {
        if (mode === "recheck") {
          // A re-check that got *an* answer — any status from the function or
          // the gateway in front of it — counts as having asked, and says
          // nothing about the page: a 403 is a bot wall, a 502 a bad moment,
          // and neither is evidence that the page is gone or that it is back.
          // So the verdict stands and only the stamp moves. That matters more
          // than it looks: the re-check takes the oldest links first, and a
          // link behind a bot wall that stamped nothing would be the oldest
          // link again on every open, holding one of the five places for ever.
          // Wrong in this direction costs one link a month's wait. A request
          // that never arrived at all — offline, dropped — writes nothing.
          if (stored && somethingAnswered(error)) write(current, { ...stored, checked_at: nowIso() });
          return;
        }
        // An answered "no" is written down; an unanswered question is not.
        // A page that refuses today almost always refuses tomorrow, and
        // recording nothing meant the whole failing set was re-asked in
        // full on every load, forever. So the stored preview (or the local
        // fallback) gets today's `fetched_at`, which is the same "asked,
        // answered, no picture" rule needsUnfurl already applies to a page
        // without an og:image: one request in its life, not one per open.
        // The preview keeps rendering from the note's own words either way
        // — enrichment, never a gate — so all a wrong guess can cost is
        // one picture. Everything else is transient and writes nothing:
        // `requested` already holds it for this session, and the next load
        // may genuinely succeed. Which of the two an error is, is
        // `namesThePage`'s question and nothing else's.
        if (namesThePage(error)) {
          const now = nowIso();
          write(current, {
            // A black-window picture is dropped, not re-stamped as an answer.
            ...withoutBlackPicture(stored ?? local),
            fetched_at: now,
            // The wall's one ask is spent whatever the answer was.
            ...(isWallLink(current, wallRef.current, local.href) ? { wall_asked_at: now } : {}),
          });
        }
        return;
      }

      // The page answered 404 or 410. Written down beside whatever the
      // preview already said — a dead page has no title to give, and the
      // words the owner saved it under are still the best name it has. The
      // card and the open note draw "gone" off this (`goneCount`).
      if (data.gone) {
        const now = nowIso();
        write(
          current,
          mode === "recheck" && stored
            ? { ...withoutBlackPicture(stored), gone: true, checked_at: now }
            : { ...withoutBlackPicture(stored ?? local), fetched_at: now, gone: true },
        );
        return;
      }

      // Still there, and was not gone: the verdict is all a re-check came
      // for. The preview stays exactly as it was; `gone` is taken off in case
      // the other device wrote it in the meantime.
      if (verdictOnly && stored) {
        const kept = { ...stored, checked_at: nowIso() };
        delete kept.gone;
        write(current, kept);
        return;
      }

      // The og:image the function returned is transient enrichment; what
      // actually gets written into the note and synced forever is a
      // shrunk-down thumbnail, the same contract Attachment.thumb uses —
      // **bigger for a note on the Inspiration wall** (`WALL_THUMB_PX`, with its
      // size so a tile can reserve its shape), the small preview size
      // everywhere else. The size is decided here, when the answer lands, from
      // the note as it stands now. A picture that will not shrink is stored as
      // none at all — a preview without a picture is the normal, fine outcome.
      // The wall's size for the one link its tile shows, and only that one.
      const onWall = isWallLink(current, wallRef.current, local.href);
      const px = onWall ? WALL_THUMB_PX : PREVIEW_THUMB_PX;
      // Off the first paint: fetched when there is a picture to shrink.
      const shrinker = data.image ? await import("../lib/shrink") : null;
      const drawn =
        shrinker && data.image
          ? await shrinker.shrunkFromDataUrl(data.image, px, onWall ? WALL_THUMB_QUALITY : 0.6)
          : null;
      // The picture decoded and the canvas drew nothing: the browser failing
      // for a moment, not the page answering. Encoded, it would be a solid
      // black picture stamped as the answer (2026-10-09, the black wall). So
      // nothing is written, as for a 5xx, and the link is asked again later.
      // `DREW_BLANK` (`lib/shrink.ts`) is the literal `false`, spelled here so
      // the type narrows.
      if (drawn === false) return;
      const shrunk = drawn;
      // Read again after the last await: a note can carry several links,
      // and another unfurl of the same note may have written its preview
      // while this one was still shrinking its picture. A list built any
      // earlier would put that write back the way it was.
      const fresh = stillLinked();
      if (!fresh) return;
      const kept = storedIn(fresh);
      // An answer with no picture never takes away one the entry already holds,
      // nor the width, size and kind that describe it.
      // Except a picture from the black-picture window (`BLANK_PICTURES_FROM`),
      // which is known bad: keeping it would keep the black box. Off the wall,
      // a stored picture that still `needsUnfurl` is exactly that one.
      const keepsPicture = !shrunk && Boolean(kept?.image) && !needsUnfurl(kept);
      // Built from the local unfurl with the stored entry spread over it, so a
      // field this build does not own — `hidden` above all, the owner's choice
      // to put the preview away, and whatever a newer build wrote — survives the
      // rebuild; then the answer's own fields on top. `gone` is the one that
      // does not survive: a page that answered is not gone, and `checked_at`
      // stays harmless beside the newer `fetched_at` (`lastAsked` reads the later).
      const entry: LinkPreviewData = {
        ...local,
        ...kept,
        title: data.title || local.title,
        description: data.description,
        image: shrunk?.thumb ?? (keepsPicture ? (kept?.image ?? null) : null),
        fetched_at: nowIso(),
      };
      delete entry.gone;
      if (shrunk) {
        entry.width = shrunk.width;
        entry.height = shrunk.height;
        entry.thumb_px = px;
      } else if (!keepsPicture) {
        delete entry.width;
        delete entry.height;
        delete entry.thumb_px;
      }
      if (!keepsPicture) {
        // The site-aware fields ride in the same jsonb entry. `media` is written
        // only when the function sent the key — an older function never does,
        // and an entry without it is asked again once the new one is deployed
        // (`needsUnfurl`, which the wall's own stamp below stops from looping).
        // `video` is the stream's address or id, never bytes.
        if (data.media !== undefined) entry.media = data.media;
        if (data.video) entry.video = data.video;
        else if (data.media !== undefined) delete entry.video;
      }
      if (onWall) entry.wall_asked_at = entry.fetched_at ?? undefined;
      write(fresh, entry);
    },
    [update],
  );

  /**
   * Asks about every link in the note that has not been asked about yet.
   * The body is recorded as scanned first, so the same body is never walked
   * twice whichever path — the effect or a quiet-period timer — got here.
   */
  const scan = useCallback(
    (note: Note) => {
      scannedBodies.current.set(note.id, note.body);
      const onWall = isOnWall(note, wallRef.current);
      if (onWall) scannedOnWall.current.add(note.id);
      const known = new Map((note.link_previews ?? []).map((preview) => [preview.href, preview]));
      for (const local of previewsFor(note.body)) {
        // Only the link the tile shows wants the wall's size (BUG-7); every
        // other link of a wall note is asked about as it would be anywhere.
        const wallLink = onWall && isWallLink(note, wallRef.current, local.href);
        if (!needsUnfurl(known.get(local.href), wallLink)) continue;
        // Its own key on the wall: a note filed there *after* it was asked about
        // in the Inbox is a new question.
        const requestKey = `${note.id}:${local.href}${wallLink ? ":wall" : ""}`;
        if (requested.current.has(requestKey)) continue;
        requested.current.add(requestKey);
        unfurl.current(() => ask(note.id, local, "unfurl"));
      }
    },
    [ask],
  );

  /**
   * A note whose stamp is seconds old is being written this instant, and an
   * address being typed is a new link every character past the fifth —
   * `https://example.com/some/path` was two dozen of them, each queued and
   * *sent* as a cold edge-function call fetching a page that mostly did not
   * exist. So a moving note waits until its hand has lifted: the scan is
   * put off for `UNFURL_QUIET_MS` past its last edit, and every keystroke
   * puts it off again. A note that has not moved for that long — every
   * imported, pulled or merely re-rendered one — is scanned at once, as
   * before.
   */
  const quietTimers = useRef(new Map<string, number>());
  useEffect(() => {
    const pending = quietTimers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // Nothing new to find in this note: its body is as it was when last scanned,
  // and — for a note on the wall — it has been scanned *as* a wall note.
  const alreadyScanned = useCallback(
    (note: Note) =>
      scannedBodies.current.get(note.id) === note.body &&
      (!isOnWall(note, wallRef.current) || scannedOnWall.current.has(note.id)),
    [],
  );

  useEffect(() => {
    if (!signedIn || !serverConfigured() || (typeof navigator !== "undefined" && !navigator.onLine))
      return;
    for (const note of notes) {
      // A trashed note is out of search and off every board; the one thing an
      // unfurl could still do to it is write a preview, which restamps
      // `updated_at` — and the trash sweep counts its thirty days from that.
      // On the day picture-less previews became eligible again, every link
      // note in the trash was re-dated and pushed. The note stays unscanned,
      // so restoring it asks the question then.
      if (note.status === "trashed") continue;
      if (alreadyScanned(note)) continue;
      const sinceEdit = Date.now() - Date.parse(note.updated_at);
      if (sinceEdit < UNFURL_QUIET_MS) {
        window.clearTimeout(quietTimers.current.get(note.id));
        quietTimers.current.set(
          note.id,
          window.setTimeout(() => {
            quietTimers.current.delete(note.id);
            // The note as it is now, not as it was when the timer was set.
            const current = notesRef.current.find((candidate) => candidate.id === note.id);
            if (!current || current.status === "trashed") return;
            if (alreadyScanned(current)) return;
            scan(current);
          }, UNFURL_QUIET_MS - sinceEdit),
        );
        continue;
      }
      scan(note);
    }
  }, [notes, signedIn, scan, alreadyScanned, wallBoardId]);

  /* --- asking again, once an open -------------------------------------------
     A preview is fetched once, and a page can die the week after it was saved
     — so without this a dead link goes on wearing its title and picture for
     ever, and the owner finds out by tapping it. Once per session, a while
     after the archive is on screen and then only when the browser is idle,
     the few links whose last answer is oldest are asked again
     (`dueForRecheck`: at most `RECHECK_AT_ONCE`, only past `RECHECK_DAYS`).

     Scheduled once, on the first render that has notes to look at, and never
     rescheduled: the effect runs on every note change, and a timer it cleared
     and set again on each one would be put off for as long as anybody typed.
     So the timer is cleared only when the hook goes away, and the candidates
     are read when it fires, off the notes as they are then. */
  const recheckTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (recheckTimer.current !== null) window.clearTimeout(recheckTimer.current);
      // Back to "not scheduled", so a remount — StrictMode does one on
      // purpose — schedules it again rather than finding a dead timer's id.
      recheckTimer.current = null;
    },
    [],
  );

  const hasNotes = notes.length > 0;
  useEffect(() => {
    if (recheckTimer.current !== null || !hasNotes) return;
    if (!signedIn || !serverConfigured()) return;
    recheckTimer.current = window.setTimeout(() => {
      whenIdle(() => {
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        for (const { noteId, href } of dueForRecheck(notesRef.current, Date.now())) {
          const note = notesRef.current.find((candidate) => candidate.id === noteId);
          const local = note && previewsFor(note.body).find((preview) => preview.href === href);
          if (!local) continue;
          const requestKey = `${noteId}:${href}`;
          if (requested.current.has(requestKey)) continue;
          requested.current.add(requestKey);
          unfurl.current(() => ask(noteId, local, "recheck"));
        }
      });
    }, RECHECK_AFTER_MS);
  }, [hasNotes, signedIn, ask]);
}
