import { useLayoutEffect, useRef, useState } from "react";
import type { Note, ReminderRepeat } from "../types";
import {
  nextOccurrenceIso,
  presetReminder,
  presetWhen,
  localInputMin,
  reminderOverdue,
  reminderPresets,
  reminderWhen,
  repeatWords,
  REMINDER_REPEATS,
  type ReminderPreset,
} from "../lib/reminders";
import { useFullDate, useTimeWords, useTimeUntilWords } from "../lib/clock";
import type { PushState } from "../store/push";
import { DEMO } from "../lib/demo";
import { hasKeyboard, isTypingTarget } from "../lib/hotkeys";
import { hangUnder, keepInside, type UnderAnchor } from "../lib/pointerAnchor";
import { Action } from "./shared/Action";
import { IconCheck, IconClear, IconReminder, IconRepeat } from "./Icons";

/**
 * Which preset a reminder already set at `at` is, if any — so a panel opened on
 * a note set "Tomorrow" earlier today ticks that row. A time typed into Custom,
 * or a preset picked on another day, matches none and only the top line says it.
 */
function presetFor(at: string | null): ReminderPreset | null {
  if (!at) return null;
  const now = new Date();
  return reminderPresets(now).find((p) => presetReminder(p.key, now) === at)?.key ?? null;
}

/**
 * What the timestamp row says, and what it means when it is tapped.
 *
 * Once a reminder is set it takes the row over completely — the same row,
 * not a second one (SPEC): reuse what is already there rather than add a
 * fifth mark to the bar above. It reverts to the plain edit-time framing
 * the moment the reminder is cleared. Both halves stay live on the shared
 * clock (lib/clock.ts) the same way NoteView's `when` does, rather than being
 * computed once and going stale while the sheet sits open; `useTimeWords`
 * already answers "how long ago" for the overdue half, and
 * `useTimeUntilWords` is its forward-looking twin. There is no third,
 * "fired" state to build here — see the comment beside the picker below.
 *
 * The one addition is a device that cannot ring. A reminder still sets, still
 * syncs, and still arrives on any other device that *can* — but saying
 * "reminds in 3 hours" on a browser that will never make a sound is the
 * whole fault this feature was built to end, so it says so. Words, not a
 * mark: `offline` and `failed` are words for the same reason (DESIGN).
 */
export function useReminderLine(note: Note, pushStatus: PushState) {
  const ringsHere = pushStatus === "on";
  const reminderAt = note.reminder_at;
  /*
   * The instant the row counts down to is the occurrence that is **coming**,
   * not the anchor the series was set from (lib/reminders.ts). For a reminder
   * that rings once the two are the same value and nothing here changed; for
   * one that repeats, the anchor may be months old and counting from it would
   * have the row say "due 9 months ago" about a note that rang this morning
   * and rings again tomorrow.
   */
  const occurrence = nextOccurrenceIso(note);
  const repeat = repeatWords(note.reminder_repeat);
  const overdue = Boolean(reminderAt) && reminderOverdue(note);
  const untilReminder = useTimeUntilWords(occurrence ?? "");
  const sinceReminder = useTimeWords(occurrence ?? "");
  // The exact day, for the two places the count has run out. Read off the
  // shared clock like the rest of the row, so it too drops its year while the
  // reminder is in the year being read.
  const reminderDate = useFullDate(occurrence ?? "");
  const reminderMain = reminderAt
    ? overdue
      ? `due ${sinceReminder ?? reminderDate}`
      : `reminds ${untilReminder ?? reminderDate}` +
        // The rule after the time, because the time is the answer and the rule
        // is what makes it come back. One clause, in the same breath: "reminds
        // in 3 hours · every day".
        (repeat ? ` · ${repeat}` : "")
    : null;
  // Why it will not ring, said after the time. The server rings only for an
  // active note (`due_reminders` requires `status = 'active'`), so an archived
  // or trashed one rings nowhere — and that outranks "not on this device",
  // which would suggest another device might. Unarchiving it is what brings
  // the ring back. It is a word of advice rather than a fact the machine
  // reports, so the note sets it apart in the reading face (review CD-05).
  const reminderCaveat =
    reminderAt && !overdue
      ? note.status === "archived"
        ? "not while archived"
        : note.status === "trashed"
          ? "not in the trash"
          : ringsHere
            ? null
            : // The demo has no server, so "not on this device" would suggest
              // another device might ring (review CD-03).
              DEMO
              ? "rings nowhere in the demo"
              : "not on this device"
      : null;
  const reminderLine =
    reminderMain && (reminderCaveat ? `${reminderMain} · ${reminderCaveat}` : reminderMain);
  return { reminderAt, overdue, reminderLine, reminderMain, reminderCaveat };
}

/**
 * The open note's reminder panel: the presets, a custom time, the repeat rule
 * once there is a time to repeat, Clear, and this device's ring switch last.
 * Whether it is open is the note's (`reminderPicking`), because Escape,
 * Ctrl+Enter and Back all have to ask; `onClose` is how the panel shuts itself.
 */
export function ReminderPanel({
  note,
  anchor,
  pushStatus,
  onSetReminder,
  onSetRepeat,
  onEnableRing,
  onDisableRing,
  onClose,
}: {
  note: Note;
  /** With a mouse, the foot of the stamp line it hangs under (review
   *  UI-A-03); otherwise it stands in the bottom-right corner. */
  anchor?: UnderAnchor;
  pushStatus: PushState;
  onSetReminder?: (id: string, at: string | null) => void;
  onSetRepeat?: (id: string, repeat: ReminderRepeat | null) => void;
  onEnableRing?: () => void;
  onDisableRing?: () => void;
  onClose: () => void;
}) {
  const ringsHere = pushStatus === "on";
  const reminderAt = note.reminder_at;
  /**
   * The row that set the time, ticked. Picking a preset shuts the panel
   * (dogfooding 2026-10-18): its backdrop swallowed the next tap on Back,
   * two extra taps every time. A panel opened on a note that has a reminder
   * ticks the matching preset, spells the time out at the top and offers the
   * repeat rows and Clear. A custom time stays open: it is typed in pieces.
   */
  const [picked, setPicked] = useState<ReminderPreset | "custom" | null>(() =>
    presetFor(reminderAt),
  );
  // A custom time typed by hand that has already passed: refused, and said.
  const [late, setLate] = useState(false);
  const occurrence = reminderAt ? nextOccurrenceIso(note) : null;
  const panelRef = useRef<HTMLDivElement | null>(null);

  // The focus comes in with the panel (review UX-B-05): the stamp pressed from
  // the keyboard left it on the stamp, with the panel 650px away. With a
  // keyboard it lands on the first row; on a touch screen on the panel itself,
  // which draws no ring (a ring on a row nobody pressed reads as a choice
  // made). Not when the editor holds it — a tap on the stamp keeps the caret,
  // and on a phone the keyboard with it. The note hands it back to the stamp.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (anchor) keepInside(el, anchor);
    if (isTypingTarget(document.activeElement)) return;
    const first = hasKeyboard(false) ? el.querySelector<HTMLElement>("button:not(:disabled)") : el;
    first?.focus({ preventScroll: true });
    // Once, on opening: the anchor is read when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        type="button"
        className="menu-dismiss menu-dismiss-over"
        aria-label="Close reminder menu"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={
          anchor ? "selpanel selpanel-under selpanel-over" : "selpanel selpanel-right selpanel-over"
        }
        style={anchor ? hangUnder(anchor) : undefined}
        role="menu"
        aria-label="Reminder"
        tabIndex={-1}
      >
        {/* The time that is set, as a clock reads it. The note's own row
            counts towards it in words ("reminds in 11 hours") and this is the
            one place the exact time is written, so a panel opened on a set
            reminder says what it is set to before offering to change it. */}
        {occurrence && (
          <div className="selpanel-hint selpanel-set mono">Set for {reminderWhen(occurrence)}</div>
        )}
        {reminderPresets().map((preset) => (
          <Action
            key={preset.key}
            role="menuitemradio"
            checked={picked === preset.key}
            keepFocus
            label={preset.label}
            // The time it will actually ring, so every row is seen to mean
            // what it will do before it is pressed.
            suffix={<>{" "}<span className="selpanel-n">{presetWhen(preset.key)}</span></>}
            onClick={() => {
              /*
               * Still only writes `reminder_at`, and deliberately so. The
               * delivery half now exists (store/push.ts, migration 0015,
               * the send-reminders sweep), but none of it is scheduled from
               * here: the server finds what is due by reading the note. So
               * this call site stays one local write, the reminder survives
               * being set offline, and moving it later needs no cancelling
               * of anything. `onSetReminder` in App.tsx is where the device
               * registers itself to be woken, once, on the first reminder.
               */
              onSetReminder?.(note.id, presetReminder(preset.key));
              onClose();
            }}
          >
            {picked === preset.key ? <IconCheck /> : <IconReminder tier="inline" />}
          </Action>
        ))}
        {/* Said in the panel's own label voice and stood in the rows' label
            column (review UI-A-07): a bare span here inherited the browser's
            16px Baskerville and sat a mark's width left of every other label.
            The field is set like every field you type into — the reading face
            at reading size — not 10.5px tracked capitals a thumb has to hit. */}
        <div className="selpanel-row selpanel-row-custom">
          <span className="selpanel-row-label mono">Custom</span>
          <input
            type="datetime-local"
            className="field-words"
            aria-label="Custom reminder time"
            // The picker offers nothing earlier than now. There is
            // deliberately no starting value: the field sets the reminder
            // the moment it holds a whole time, so a prefilled one would
            // save on the first segment changed. The panel stays open
            // after it, because the time is typed in pieces.
            min={localInputMin()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const value = e.currentTarget.value;
              if (!value) {
                setLate(false);
                return;
              }
              const at = new Date(value);
              if (Number.isNaN(at.getTime())) return;
              // A `datetime-local` reports a value as soon as it *looks*
              // complete, and a year typed digit by digit passes through
              // `0002-…` on its way to 2026 — so the first keystroke set a
              // reminder for the year 2 and shut the panel on the reader.
              // Any year outside a range a person could mean is a year
              // still being typed.
              const year = at.getFullYear();
              if (year < 1970 || year > 2200) return;
              // `min` only shapes the picker; a time typed by hand can
              // still be in the past. It is refused the same way — the
              // panel stays open and the field shows itself invalid —
              // rather than set as a reminder that is already overdue.
              // The minute's grace is the field's own resolution. No style
              // marks a field invalid, so the refusal is said in a line.
              if (at.getTime() < Date.now() - 60_000) {
                setLate(true);
                return;
              }
              setLate(false);
              onSetReminder?.(note.id, at.toISOString());
              setPicked("custom");
            }}
          />
        </div>
        {late && (
          <p className="selpanel-hint advice" role="status">
            That time has passed. Pick a later one.
          </p>
        )}
        {/* How often, under when — and only once there is a when. A rule
            with no anchor is not a reminder, so offering "every week" on a
            note with no time set would be offering to repeat nothing.

            Each row is a switch, not a choice in a list: pressing the one
            that is already on turns it off, which is the only way back to
            a reminder that rings once and is the same grammar the Todo
            mark and the ring switch already use. The panel stays open —
            the rule is usually the second half of a decision whose first
            half was made on the row above, so they are there when the
            panel is opened again on a note that has a time. */}
        {reminderAt &&
          REMINDER_REPEATS.map((rule) => {
            const on = note.reminder_repeat === rule;
            return (
              <Action
                key={rule}
                role="menuitemcheckbox"
                checked={on}
                keepFocus
                label={repeatWords(rule) ?? rule}
                onClick={() => onSetRepeat?.(note.id, on ? null : rule)}
              >
                <IconRepeat tier="inline" on={on} />
              </Action>
            );
          })}
        {reminderAt && (
          <Action
            role="menuitem"
            keepFocus
            label="Clear reminder"
            onClick={() => {
              onSetReminder?.(note.id, null);
              onClose();
            }}
          >
            <IconClear tier="inline" />
          </Action>
        )}
        {/* Last, and quiet: a device-level switch, after the thing the
            panel is for. It used to be the first row, above Tonight, and
            read as the first choice to make (2026-09-04 audit, F11). This
            device cannot always ring, and this is where somebody thinking
            about reminders already is — so it is where the app says so.
            Only "askable" is offered as an action: once a browser has been
            told no it stops asking, and a control that cannot work is
            worse than a sentence explaining why — which is a hint under
            the times, not a row among them. */}
        {/* Ringing here is a switch, so it turns off as well as on. The
            app could only ever be told yes, which left the one device
            somebody wanted to stop ringing — the phone on a bedside
            table — with nothing to say it to. Same row, same place. */}
        {ringsHere && (
          <Action
            role="menuitem"
            keepFocus
            className="selpanel-quiet"
            label="Stop notifying on this device"
            onClick={() => onDisableRing?.()}
          >
            <IconReminder tier="inline" />
          </Action>
        )}
        {!ringsHere && (
          pushStatus === "askable" ? (
            <Action
              role="menuitem"
              keepFocus
              className="selpanel-quiet"
              label="Notify on this device"
              onClick={() => onEnableRing?.()}
            >
              <IconReminder tier="inline" />
            </Action>
          ) : (
            // A sentence of advice, so it is set in the reading face rather
            // than the machine's tracked capitals (review CD-05).
            <p className="selpanel-hint advice">
              {pushStatus === "denied"
                ? "Notifications are blocked for this site. Allow them in the browser's site settings."
                : // In the public demo the browser may well be able to; what
                  // is missing is a server to send the push (`lib/demo.ts`).
                  DEMO
                  ? "Ringing needs a server, and the demo has none."
                  : "This browser cannot notify."}
            </p>
          )
        )}
      </div>
    </>
  );
}
