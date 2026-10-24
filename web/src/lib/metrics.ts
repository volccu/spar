/**
 * Measurements of the body face, in one place because two of them disagreed.
 *
 * The average character width was measured twice — `AVG_CHAR_PX = 6.63` in
 * `useCardMetrics.ts` and `CHAR_W = 6.4` in `canvas.ts` (then `folders.ts`) — over the same
 * archive, in the same typeface, at the same size, 3.6% apart. Both decide how
 * much text fits: one how much a card face holds, the other how a canvas lays
 * itself out and therefore what the miniature on an idea card draws.
 * `canvas.ts` states the contract they break — "the first opening of a canvas
 * and the miniature on the card have to agree about this, or the card shows an
 * arrangement the canvas does not have."
 *
 * web/CLAUDE.md also warns that Libre Baskerville cannot be swapped without
 * re-measuring this. With two constants, a re-measure fixes one and misses the
 * other, and the drift is silent — nothing overflows, the cards are just
 * subtly wrong. So there is one, and it keeps the measured name and value.
 *
 * Deliberately its own module rather than an export from `useCardMetrics.ts`:
 * `canvas.ts` is pure and is reached from `store/db.ts`, and importing from a
 * hook would pull React into the store's import graph for the sake of a number.
 */

/** Libre Baskerville at 13px (`--t-text`), averaged over the real archive with measureText. */
export const AVG_CHAR_PX = 6.63;
