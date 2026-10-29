import { lazy } from "react";

/**
 * The date picker is fetched when a reminder panel opens, not with the first
 * paint (its ceiling, `buildInvariants.test.ts`): a panel calls this on
 * opening, so by the time Pick a date is pressed the picker is here.
 */
export const loadReminderPick = () => import("./ReminderPick");

export const ReminderPick = lazy(() => loadReminderPick().then((m) => ({ default: m.ReminderPick })));
