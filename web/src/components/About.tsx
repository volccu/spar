import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import { HELP_KEY, isTypingTarget, useHasKeyboard } from "../lib/hotkeys";
import { chordLabel, chordWords, SHORTCUTS } from "../lib/shortcuts";
import { TRASH_DAYS } from "../lib/trash";
import { useModeLayer } from "../lib/useModeLayer";
import { DEMO } from "../lib/demo";
import { IconClear } from "./Icons";
import { Mascot } from "./Mascot";
import { KeyCaps } from "./Hotkey";
import type { MascotState } from "./mascot-element";

/* --- the colophon ---------------------------------------------------------------
   The page a book keeps at its back: what this is, how it was made, and — here —
   where the notes are. How to take them all away, and every switch the app
   has, are in Settings (2026-10-11, owner approved): DESIGN.md §1 calls this
   page a colophon, and a colophon is the wrong home for a preference.

   Nothing else in the app says what the app *does with* a note. The rules exist
   (the original is kept, the trash waits thirty days, nothing is read by anyone)
   but they lived only in documents a person using the app never sees, and a
   place whose workings you cannot see is a place you have to trust blind. So
   they are said once, plainly, in the app's own voice.

   It is a layer of the Sorter's kind (`useModeLayer`): full size, over
   everything, the capture bar off the screen while it is up, Back and Escape
   close it. Reached from the menu, never the shelf — it is not a place a note
   can be.
   -------------------------------------------------------------------------- */

interface Props {
  /** Whether the notes also go to a server, which changes one sentence. */
  synced: boolean;
  onClose: () => void;
  restoreTo: RefObject<HTMLButtonElement | null>;
  /** Where the page opens: the top, from the menu, or its list of keys, from `?`. */
  at?: "top" | "keys";
  /** The header creature's state, so the one drawn here says the same thing. */
  mood?: MascotState;
}

/** The public repository, for the demo's "Keep using spår". */
const REPO = "https://github.com/volccu/spar";

/** The touches that have no button on the board, for a device with no keyboard: what you do, what it does (review PL-03). */
const TOUCHES = [
  ["Hold a note", "Picks it"],
  ["Hold a note and carry it onto another", "Joins them"],
  ["Hold a note and carry it to a board name", "Files it there"],
  ["Swipe sideways", "Next board"],
  ["Swipe right on the Inbox", "Opens the boards"],
] as const;

export function About({ synced, onClose, restoreTo, at = "top", mood = "idle" }: Props) {
  const { layerRef, close, trapTab } = useModeLayer({ count: 1, origin: null, onClose, restoreTo });
  const keyboard = useHasKeyboard();
  // How many times the list of keys has been asked for: once on arriving by
  // `?`, and once more for every `?` pressed on the page. A count rather
  // than a flag, so each press scrolls back to it however far away it is.
  const [keysAsked, setKeysAsked] = useState(at === "keys" ? 1 : 0);
  const showKeys = keyboard || keysAsked > 0;
  const keysRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Optional-called: jsdom has no scrollIntoView, and a page that cannot
    // scroll to the list has still opened with it on.
    if (keysAsked > 0) keysRef.current?.scrollIntoView?.({ block: "start" });
  }, [keysAsked]);
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      trapTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // The board's `?` stands down under this page, so the page answers it
    // itself — by going to the list, which is what `?` means everywhere.
    if (e.key === HELP_KEY && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      setKeysAsked((n) => n + 1);
    }
  }

  return (
    <div
      ref={layerRef}
      className="about"
      role="dialog"
      aria-modal="true"
      aria-label="About spår"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="about-head">
        {/* The masthead again, mark then name (review UI-20, the owner's
            ask): the same creature the header draws, in the state the header
            would show, visiting while this page covers the header. */}
        <Mascot state={mood} local={!synced} />
        <h1 className="about-mark">spår</h1>
        <button type="button" className="about-close" aria-label="Close" title="Close" onClick={close}>
          <IconClear />
        </button>
      </div>

      <div className="about-body">
        <p>
          {/* Said to the reader, who may be a stranger trying the demo rather
              than the person whose notes these are (review PL-06). */}
          <i>Spår</i> is a notes app. You write first and sort later: a note lands in the Inbox,
          and you file it into a board when you like. The name is Swedish for trace.
        </p>

        <h3 className="about-h">Where the notes are</h3>
        <p>
          {synced
            ? "On this device first, then on your own server, so your other devices have them too."
            : // The public demo has nothing to sign in to. Folded away in every
              // other build (`lib/demo.ts`).
              DEMO
              ? "In this browser only. The demo has no server, so nothing you write is sent anywhere. Clearing this site's data clears the notes."
              : "On this device only. Nothing is sent anywhere until you sign in."}
        </p>
        <p>The first version of every note is kept, however much you edit it.</p>
        <p>
          Delete puts a note in the trash for {TRASH_DAYS} days. Then it is gone for good
          {synced ? ", here and on the server" : ""}. Archive puts a note away for as long as you like, and search
          still finds it.
        </p>
        {DEMO ? (
          <p>
            Nothing reads your notes but you: no AI, no tracking, no feed. With a server of your own,
            a saved link gets its title and picture, and a reminder rings on your phone. The demo has
            no server, so a link shows its address and your words, and a reminder waits in the list
            without ringing.
          </p>
        ) : (
          <p>
            Nothing reads your notes but you: no AI, no tracking, no feed. Your own server looks up a
            saved link&rsquo;s title and picture, and checks about once a month that the page is
            still there. On Inspiration, a site&rsquo;s front page or a page with no picture of its
            own is photographed by Microlink, which gets the page&rsquo;s address and nothing else.
          </p>
        )}

        {/* The demo's privacy page, said where its reader already is. The same
            paragraph is served as /privacy.html beside the demo, for a link from
            outside (`web/demo-site/`). */}
        {DEMO ? (
          <>
            <h3 className="about-h">Privacy</h3>
            <p>
              The address this demo is served from hands out the app and receives nothing back: not
              your notes, not what you type, not which notes you open. There are no analytics and no
              cookies, and the page is not allowed to connect anywhere but the address it came from.
            </p>
            {/* What a visitor can do next (review PL-06). Moving notes back in
                from a download is not something the app does, so nothing here
                says it is: the copy is a copy. */}
            <h3 className="about-h">Keep using spår</h3>
            <p>
              Install it. Your browser&rsquo;s menu offers to install the app, or to add it to the
              home screen on a phone. It then opens like any other app, and the browser is less likely
              to clear the notes. They still stay in this browser only.
            </p>
            <p>
              Run your own copy. One Docker container holds the app and a small server, so your notes
              follow you to every device you use:{" "}
              <a href={`${REPO}#run-it-with-docker`} target="_blank" rel="noopener noreferrer">
                how to run it
              </a>
              , and the{" "}
              <a href={`${REPO}/blob/main/docs/self-hosting.md`} target="_blank" rel="noopener noreferrer">
                self-hosting guide
              </a>
              .
            </p>
          </>
        ) : null}

        {/* Firefox on Android installs the app without either (review PS-01). */}
        <h3 className="about-h">On Android</h3>
        <p>
          Install spår from Chrome. Only then can you share pages and pictures into it, and open a
          new note from its icon.
        </p>

        {/* The way out, said here because this page is where the app says
            what it does with a note; the button itself is in Settings. Said
            once on this page (review WD-04). */}
        <h3 className="about-h">Take everything out</h3>
        <p>
          Download everything, in Settings under Import and export, saves every note as a plain text
          file. Each board becomes a folder, with each file beside its note.
        </p>

        {/* Every key the app answers to, drawn from the one list of them
            (`lib/shortcuts.ts`), and the place `?` opens this page at.
            Only where there is a keyboard to press them on — `hasKeyboard`,
            the app's one definition of that, which is also what decides
            whether a hint is drawn beside search. A phone reading "Ctrl K"
            is the page describing a machine the reader is not holding. The
            exception is arriving by `?`: whoever pressed it has a keyboard,
            whatever the pointer query says about a tablet with one paired. */}
        {!keyboard && (
          <>
            <h3 className="about-h">The touches</h3>
            <p>On a phone these are done by touch.</p>
            <dl className="about-data about-keys about-touches">
              {TOUCHES.map(([does, result]) => (
                <div key={does}>
                  <dt>{does}</dt>
                  <dd>{result}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {showKeys && (
          <>
            <h3 className="about-h" id="about-keys" ref={keysRef}>
              The keys
            </h3>
            <p>
              Every one of these is also a tap somewhere, so none of them has to be learnt. Press{" "}
              <KeyCaps label="?" />
              <span className="offscreen">the question mark</span> on a board to come back here.
            </p>
            {SHORTCUTS.map((group) => (
              <div className="about-keys" key={group.where}>
                <p className="about-keys-where">{group.where}</p>
                <dl className="about-data">
                  {group.shortcuts.map((shortcut) => (
                    <div key={shortcut.does}>
                      <dt>{shortcut.does}</dt>
                      <dd>
                        {shortcut.keys.map((chord, i) => (
                          <Fragment key={chordLabel(chord)}>
                            <KeyCaps label={chordLabel(chord)} />
                            <span className="offscreen">{`${i > 0 ? " or " : ""}${chordWords(chord)}`}</span>
                          </Fragment>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </>
        )}

      </div>
    </div>
  );
}
