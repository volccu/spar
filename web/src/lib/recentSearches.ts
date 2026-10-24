/**
 * The recent-search chip list — a small local convenience, not a feature.
 *
 * A plain most-recently-used list, capped and deduped. Re-searching a term
 * moves it back to the front rather than adding a second entry, which is
 * what makes a term you search often keep resurfacing at the top: "most
 * repeated" falls out of "most recent" for free, with no separate count to
 * keep or a settings row to explain it.
 *
 * Deliberately local only — see store/useRecentSearches.ts. It never joins
 * the outbox: what you typed on your phone is not something the laptop
 * needs to know, and syncing it would be a second small conflict rule for
 * a list that exists purely to save a few keystrokes.
 */
export const RECENT_SEARCH_MAX = 8;

export function withRecentSearch(prev: string[], term: string): string[] {
  const trimmed = term.trim();
  if (!trimmed) return prev;
  const next = [trimmed, ...prev.filter((t) => t.toLowerCase() !== trimmed.toLowerCase())];
  return next.slice(0, RECENT_SEARCH_MAX);
}
