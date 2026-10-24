/**
 * What the header's far corner says, and what the search field says, as words.
 * Moved out of `App.tsx` (2026-10-14, joy review #1) to make room under its
 * line ceiling; the two rules are unchanged.
 *
 * The header speaks for the three things the board row cannot count: a
 * selection, which puts nothing on screen but itself; a search; and the
 * Reminders list. None of those is a place, so none of them has a tab along
 * the strip with a number on it. A board does, right under this line, which is
 * why standing on one says nothing here at all (2026-09-19) — the count was a
 * second copy of the tab's own, and the tab's is the one sitting against the
 * name it counts.
 *
 * On a desktop the search count stands inside the search field, in the slot the
 * Ctrl K hint leaves once a word is typed — the header's far corner is a
 * screen's width from the field being typed into (review 2026-10-01, UI-30).
 * On a phone the corner is a thumb's width away and keeps it.
 */
export function headerWords(s: {
  selecting: boolean;
  selected: number;
  remindersOpen: boolean;
  shown: number;
  gridSearching: boolean;
  isPhone: boolean;
}): { headerCount: string | null; fieldCount: string | null } {
  const found = `${s.shown} found`;
  const headerCount = s.selecting
    ? `${s.selected} selected`
    : s.remindersOpen
      ? `${s.shown} reminder${s.shown === 1 ? "" : "s"}`
      : s.gridSearching && s.isPhone
        ? found
        : null;
  return { headerCount, fieldCount: s.gridSearching && !s.isPhone ? found : null };
}
