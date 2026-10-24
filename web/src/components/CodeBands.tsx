import { Fragment, memo, useDeferredValue, useMemo } from "react";
import { parseBlocks } from "../lib/blocks";

/**
 * The code panels, drawn behind the editor while a note is being written.
 *
 * A textarea can draw no panel of its own, so this lays the same text out a
 * second time underneath it — same face, size, leading and measure, the
 * letters themselves transparent — and lets each code block's `.codeblock`
 * draw its panel there. Reading and editing stay one picture: tapping into a
 * note moves no character and takes no panel away (styles.css, "one line
 * grid"; 2026-10-16, owner asked for code blocks that show).
 *
 * Parsed from a deferred copy of the text, so a keystroke never waits on the
 * code detector; the panel catches up a frame later at most.
 */
export const CodeBands = memo(function CodeBands({ text }: { text: string }) {
  const later = useDeferredValue(text);
  const blocks = useMemo(() => parseBlocks(later), [later]);
  if (!blocks.some((b) => b.kind === "code")) return null;
  return (
    <div className="editor-bands" aria-hidden>
      {blocks.map((block, i) =>
        block.kind === "code" ? (
          // The reader's own split: the newline above outside the panel, the
          // one below inside it (see CodeView in NoteReader.tsx).
          <Fragment key={i}>
            {block.lead}
            <div className="codeblock">{block.text.slice(block.lead.length)}</div>
          </Fragment>
        ) : (
          <Fragment key={i}>{block.text}</Fragment>
        ),
      )}
    </div>
  );
});
