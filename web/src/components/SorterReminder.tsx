import { Suspense, useEffect, useState } from "react";
import type { Note, ReminderRepeat } from "../types";
import { presetReminder, presetWhen, reminderPresets } from "../lib/reminders";
import { Action } from "./shared/Action";
import { IconDate, IconReminder, IconStepOn } from "./Icons";
import { RepeatRow } from "./RepeatRow";
import { loadReminderPick, ReminderPick } from "./reminderPickLazy";

/**
 * Tidy up's Remind panel: the open note's own reminder panel, bar Clear and
 * the ring switch (owner, 2026-10-29). In Tidy up a time is an *answer* — it
 * sets the reminder and moves on — so the repeat is chosen first and goes in
 * with whichever time is pressed. It starts at the rule the note already has.
 * Bottom-right under the thumb, like the capture bar's.
 */
export function SorterReminder({
  note,
  onRemind,
  onClose,
}: {
  note: Note;
  onRemind: (at: string, repeat: ReminderRepeat | null) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [repeat, setRepeat] = useState<ReminderRepeat | null>(note.reminder_repeat ?? null);
  useEffect(() => {
    void loadReminderPick();
  }, []);

  return (
    <>
      <button
        type="button"
        className="menu-dismiss menu-dismiss-over"
        aria-label="Close reminder menu"
        onClick={onClose}
      />
      <div className="selpanel reminder-panel selpanel-right selpanel-over" role="menu" aria-label="Reminder">
        {picking ? (
          <Suspense fallback={null}>
            <ReminderPick initial={null} onBack={() => setPicking(false)} onSet={(at) => onRemind(at, repeat)} />
          </Suspense>
        ) : (
          <>
            {reminderPresets().map((preset) => (
              <Action
                key={preset.key}
                role="menuitem"
                keepFocus
                label={preset.label}
                suffix={
                  <>
                    {" "}
                    <span className="selpanel-n">{presetWhen(preset.key)}</span>
                  </>
                }
                onClick={() => onRemind(presetReminder(preset.key), repeat)}
              >
                <IconReminder tier="inline" />
              </Action>
            ))}
            <Action
              role="menuitem"
              keepFocus
              label="Pick a date"
              suffix={<span className="selpanel-n"><IconStepOn /></span>}
              onClick={() => setPicking(true)}
            >
              <IconDate />
            </Action>
            <RepeatRow value={repeat} onChange={setRepeat} />
          </>
        )}
      </div>
    </>
  );
}
