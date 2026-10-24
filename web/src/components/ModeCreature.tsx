import { Mascot } from "./Mascot";
import type { MascotState } from "./mascot-element";
import { Speech, type Said } from "./Speech";

/**
 * The header's creature, standing in a mode's head band with its speech bubble
 * beside it (Tidy up; review 2026-10-24, UX-02). It is a visitor: the header's
 * own is away in a puff of smoke while this one is on screen and comes home
 * when it goes, so there is still one creature (`mascot-element.ts`). What it
 * says is what the board's says for an undo, decided in `lib/useSpeech.ts`
 * and handed down by `App.tsx`.
 */
interface Props {
  said: Said | null;
  mood: MascotState;
  /** Nothing to sync to, as for the header's own. */
  local: boolean;
}

export function ModeCreature({ said, mood, local }: Props) {
  return (
    <>
      <Mascot state={mood} local={local} speaking={said ? (said.ask ? "ask" : "say") : null} />
      <div className="mode-says">
        <Speech said={said} />
      </div>
    </>
  );
}
