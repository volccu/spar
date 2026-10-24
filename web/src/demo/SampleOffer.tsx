import { useState } from "react";
import { loadSamples } from "../lib/demo";
import { IconSamples } from "../components/Icons";

/**
 * What the empty Inbox says in the public demo, and the one offer only the
 * demo makes (`EmptyBoard.tsx`, under `DEMO`).
 *
 * The board's own words come first and are unchanged: one sentence (review
 * GD-10). On the Inbox of an archive with nothing active in it — the screen a
 * stranger lands on — they gain a way to see the app full without writing
 * forty notes first. Where the notes live is said once, under the offers, in
 * the machine's voice (`EmptyBoard`'s stamp). It is drawn as the Keep import's
 * offer is drawn beneath it — the words' own face, a mark from the icon set,
 * a thumb tall, under the words rather than instead of them — and is the
 * first of the two (`.empty-offer-first`): its edge and its words one step up
 * the ramp, because for a stranger looking round the demo this is the first
 * step and the import is the second. Gone while anything is active, and back
 * when nothing is (a first "test" note deleted); the menu carries the same
 * offer until the samples are in (review UX-A-03).
 *
 * In the owner's build this file is never reached: `DEMO` is literally false
 * there and the branch that renders it is folded away.
 */
export function DemoEmptyWords({ hint, fresh }: { hint: string; fresh: boolean }) {
  const [adding, setAdding] = useState(false);
  if (!fresh) return <>{hint}</>;
  return (
    <>
      {hint}
      <button
        type="button"
        className="empty-offer empty-offer-first"
        disabled={adding}
        onClick={() => {
          setAdding(true);
          // On success the archive is no longer empty and this unmounts; on a
          // failure the button comes back to be pressed again.
          loadSamples().then(
            (made) => {
              if (made === 0) setAdding(false);
            },
            (error: unknown) => {
              console.error("the sample notes could not be written", error);
              setAdding(false);
            },
          );
        }}
      >
        <IconSamples />
        Try it with sample notes
      </button>
    </>
  );
}
