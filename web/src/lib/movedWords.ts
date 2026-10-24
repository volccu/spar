import { INSPIRATION_NAME, homeBoard } from "./boards";
import type { Board, Note, UserBoard } from "../types";

/**
 * What a move says: "Moved 2 to Kitchen". The undo offer used to say how many
 * and never where, so a note filed by mistake was found only by looking. A
 * name that is not known (a board gone while the offer stood) leaves the bare
 * "Moved 2". The bubble clamps the end of a long name; the count stays.
 */
export function movedWords(count: number, place: string | undefined): string {
  return place ? `Moved ${count} to ${place}` : `Moved ${count}`;
}

/** A board's name as the user reads it: `null` is the Inbox. */
export function nameOfBoard(stored: readonly UserBoard[], id: string | null): string | undefined {
  if (id === null) return "Inbox";
  const found = stored.find((b) => b.id === id);
  if (!found) return undefined;
  return found.kind === "inspiration" ? INSPIRATION_NAME : found.name;
}

/**
 * What Put back says: "Put back 2 to Inbox" when every note lands in the same
 * place (`homeBoard`, as if active), the bare "Put back 2" when they scatter.
 */
export function putBackWords(notes: readonly Note[], boards: readonly Board[]): string {
  const homes = new Set(notes.map((n) => homeBoard({ ...n, status: "active" }, boards)?.name));
  const [only] = homes;
  return homes.size === 1 && only ? `Put back ${notes.length} to ${only}` : `Put back ${notes.length}`;
}
