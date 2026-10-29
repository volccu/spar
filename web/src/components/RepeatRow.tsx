import type { ReminderRepeat } from "../types";
import { REMINDER_REPEATS } from "../lib/reminders";

const REPEAT_WORDS: Record<ReminderRepeat, string> = { daily: "Day", weekly: "Week", monthly: "Month" };

/**
 * How often, as one line of answers (owner, 2026-10-29): Never · Day · Week ·
 * Month, the one in force raised, the way Settings draws a choice of a few. It
 * was three rows of switches, a third of the panel for one decision.
 */
export function RepeatRow({
  value,
  onChange,
}: {
  value: ReminderRepeat | null;
  onChange: (repeat: ReminderRepeat | null) => void;
}) {
  const choices: (ReminderRepeat | null)[] = [null, ...REMINDER_REPEATS];
  return (
    <div className="selpanel-row reminder-repeat">
      <span className="selpanel-row-label mono">Repeat</span>
      <div className="settings-seg" role="group" aria-label="Repeat">
        {choices.map((rule) => (
          <button
            key={rule ?? "never"}
            type="button"
            aria-pressed={value === rule}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(rule)}
          >
            {rule ? REPEAT_WORDS[rule] : "Never"}
          </button>
        ))}
      </div>
    </div>
  );
}
