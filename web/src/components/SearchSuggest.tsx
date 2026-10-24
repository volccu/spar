import { IconFolder } from "./Icons";

interface Props {
  /** The search row is open. Nothing is offered otherwise. */
  open: boolean;
  /** A query is running. */
  searching: boolean;
  /** Terms searched for before, most recent first. */
  recentSearches: string[];
  /** The name of a folder the query spells exactly, or null. */
  matchedBoard: string | null;
  /** A recent term tapped: it becomes the query. */
  onPick: (term: string) => void;
  /** The folder offered, chosen: stand on it. */
  onJump: (name: string) => void;
}

/**
 * What the search row offers under itself — the words searched for before
 * while nothing is typed, and the folder the query names once it names one.
 *
 * An overlay riding on the grid, never a row that pushes it down and back up
 * as it comes and goes (`web/CLAUDE.md`, "Search is revealed, not resident").
 */
export function SearchSuggest({
  open,
  searching,
  recentSearches,
  matchedBoard,
  onPick,
  onJump,
}: Props) {
  if (!(open && ((!searching && recentSearches.length > 0) || (searching && matchedBoard)))) {
    return null;
  }
  return (
    <div className="search-dropdown">
      {/* Nothing typed yet: offer the words already searched for
          before, most recent (and so most repeated) first. Tapping one
          runs it. */}
      {!searching && recentSearches.length > 0 && (
        <div className="search-chips">
          {recentSearches.map((term) => (
            <button
              key={term}
              type="button"
              className="search-chip mono"
              onClick={() => onPick(term)}
            >
              {term}
            </button>
          ))}
        </div>
      )}

      {/* The query is the name of a folder already made — the fastest
          answer is to just stand on it, not to read it back as a
          result. */}
      {searching && matchedBoard && (
        <button
          type="button"
          className="search-suggest"
          onClick={() => onJump(matchedBoard)}
        >
          <IconFolder />
          <span>Jump to the {matchedBoard} board</span>
        </button>
      )}
    </div>
  );
}
