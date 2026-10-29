import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  atMinutes,
  clockWords,
  monthDays,
  parseClock,
  reminderWhen,
} from "../lib/reminders";
import { shortMonth, shortWeekday } from "../lib/when";
import { hasKeyboard } from "../lib/hotkeys";
import { Action } from "./shared/Action";
import { IconBack, IconCheck, IconMinus, IconPlus, IconStepBack, IconStepOn } from "./Icons";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
/** What − and + move the time by: a quarter of an hour, the grain people set. */
const STEP = 15;
/** Where a fresh pick starts: the same 09:00 Tomorrow and Next week ring at. */
const MORNING = 9 * 60;

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * The reminder panel's own date and time picker, standing in the panel's place
 * (owner, 2026-10-29). It replaced the browser's `datetime-local`, whose
 * calendar is the browser's — blue, with red weekends, which DARKROOM does not
 * have — and which set a reminder the moment its pieces looked whole. Here a
 * day is picked on a month that is always six weeks tall, the time is stepped
 * or typed, and nothing is set until **Set for …** is pressed, which says the
 * exact time it will set.
 */
export function ReminderPick({
  initial,
  onSet,
  onBack,
}: {
  /** The reminder already set, so the month opens on its day and time. */
  initial: string | null;
  onSet: (iso: string) => void;
  onBack: () => void;
}) {
  const now = new Date();
  const start = initial && Date.parse(initial) > now.getTime() ? new Date(initial) : null;
  const [shown, setShown] = useState(() => {
    const d = start ?? now;
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [day, setDay] = useState<Date | null>(() => (start ? midnight(start) : null));
  const [minutes, setMinutes] = useState(() =>
    start ? start.getHours() * 60 + start.getMinutes() : MORNING,
  );
  const [typed, setTyped] = useState(() => clockWords(minutes));
  const grid = useRef<HTMLDivElement | null>(null);

  // With a keyboard the focus comes in on the picked day, else on today.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el || !hasKeyboard(false)) return;
    const first = ['[aria-pressed="true"]', "[data-today]", "button:not(:disabled)"]
      .map((s) => el.querySelector<HTMLElement>(s))
      .find(Boolean);
    first?.focus({ preventScroll: true });
  }, []);

  const today = midnight(now);
  const at = day ? atMinutes(day, minutes) : null;
  const passed = at !== null && at.getTime() <= now.getTime();
  const atFirstMonth =
    shown.year < now.getFullYear() ||
    (shown.year === now.getFullYear() && shown.month <= now.getMonth());

  function page(by: number) {
    setShown(({ year, month }) => {
      const d = new Date(year, month + by, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function pickDay(d: Date) {
    setDay(d);
    // Today at a time already gone would only be refused, so it moves on to
    // the next whole hour instead.
    if (atMinutes(d, minutes).getTime() <= Date.now()) {
      const next = Math.min(23 * 60 + 45, (new Date().getHours() + 1) * 60);
      setMinutes(next);
      setTyped(clockWords(next));
    }
  }

  function setTime(next: number) {
    const wrapped = (next + 24 * 60) % (24 * 60);
    setMinutes(wrapped);
    setTyped(clockWords(wrapped));
  }

  /** The typed time, read when the field is left: kept if it is one, else put back. */
  function commitTyped() {
    const read = parseClock(typed);
    if (read === null) setTyped(clockWords(minutes));
    else setTime(read);
  }

  // Arrows walk the days, a week up and down, the way every calendar does.
  function walk(e: KeyboardEvent<HTMLDivElement>) {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!by || !grid.current) return;
    const days = [...grid.current.querySelectorAll<HTMLButtonElement>("button")];
    const i = days.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    days[Math.max(0, Math.min(days.length - 1, i + by))].focus();
  }

  return (
    <>
      <div className="pick-head">
        <button type="button" className="pick-icon" aria-label="Back to reminder times" onClick={onBack}>
          <IconBack tier="inline" />
        </button>
        <button
          type="button"
          className="pick-icon"
          aria-label="Previous month"
          disabled={atFirstMonth}
          onClick={() => page(-1)}
        >
          <IconStepBack />
        </button>
        <span className="pick-month" aria-live="polite">
          {MONTHS[shown.month]} {shown.year}
        </span>
        <button type="button" className="pick-icon" aria-label="Next month" onClick={() => page(1)}>
          <IconStepOn />
        </button>
      </div>
      <div className="pick-grid" aria-hidden="true">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="pick-weekday mono">
            {w}
          </span>
        ))}
      </div>
      <div ref={grid} className="pick-grid" role="group" aria-label="Day" onKeyDown={walk}>
        {monthDays(shown.year, shown.month).map((d, i) =>
          d ? (
            <button
              key={i}
              type="button"
              className="pick-day mono"
              aria-label={`${shortWeekday(d)} ${d.getDate()} ${shortMonth(d)}`}
              aria-pressed={day?.getTime() === d.getTime()}
              data-today={d.getTime() === today.getTime() || undefined}
              disabled={d < today}
              onClick={() => pickDay(d)}
            >
              {d.getDate()}
            </button>
          ) : (
            <span key={i} className="pick-day" aria-hidden="true" />
          ),
        )}
      </div>
      <div className="selpanel-row pick-time">
        <span className="selpanel-row-label mono">Time</span>
        <button type="button" className="pick-step" aria-label="Earlier" onClick={() => setTime(Math.ceil(minutes / STEP) * STEP - STEP)}>
          <IconMinus />
        </button>
        <input
          className="field-words pick-clock"
          aria-label="Reminder time"
          inputMode="numeric"
          enterKeyHint="done"
          value={typed}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => setTyped(e.currentTarget.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            // Enter reads the time; inside the capture bar it would save the note.
            if (e.key !== "Enter") return;
            e.preventDefault();
            commitTyped();
          }}
        />
        <button type="button" className="pick-step" aria-label="Later" onClick={() => setTime(Math.floor(minutes / STEP) * STEP + STEP)}>
          <IconPlus tier="inline" />
        </button>
      </div>
      {/* Nearest the thumb, and it says exactly what it will set. */}
      <Action
        role="menuitem"
        keepFocus
        className="pick-set"
        disabled={!at || passed}
        label={!at ? "Pick a day" : passed ? "That time has passed" : `Set for ${reminderWhen(at.toISOString())}`}
        onClick={() => at && !passed && onSet(at.toISOString())}
      >
        <IconCheck />
      </Action>
    </>
  );
}
