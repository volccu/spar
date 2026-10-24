import { useEffect, useRef, useState } from "react";

/**
 * The "Add a name" row above the open note's text, and the field it opens into.
 * The field is this row's own; what a name does to the text is the note's,
 * so a committed name is handed up through `onName`.
 */
export function NoteNameRow({
  offer,
  current,
  onName,
}: {
  /** Whether to offer a name at all — not in the trash, not once there is one. */
  offer: boolean;
  /**
   * The name the note has now, if any. The row is held while the text is
   * typed into (`useHeldWhile`), so it can still be on screen after a `# `
   * line was typed by hand; the field then opens on that name rather than
   * empty, or tapping it and stepping away would write "no name" over it.
   */
  current: string | null;
  /** Writes the name into the note, as its first line. */
  onName: (name: string) => void;
}) {
  /**
   * The name field above the text, open. A note is named the way an idea is —
   * a `# ` line at the top of its own text (`lib/name.ts`) — and this is the
   * control that writes it, so a name is one tap and a word rather than
   * knowing to type a hash. `nameCancelled` is Escape's: the field unmounts
   * on it, and a browser that sends a blur on the way out must not save the
   * name Escape was refusing.
   */
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const nameCancelled = useRef(false);
  useEffect(() => {
    if (naming) nameRef.current?.focus();
  }, [naming]);

  // A field removed while it has the focus is never sent a blur — Android's
  // back gesture closes the note exactly that way — so the words still in it
  // are handed up on the way out, as closing the note keeps its text.
  const open = useRef({ naming, nameDraft, onName });
  open.current = { naming, nameDraft, onName };
  useEffect(
    () => () => {
      const { naming: wasNaming, nameDraft: words, onName: hand } = open.current;
      if (wasNaming && !nameCancelled.current) hand(words);
    },
    [],
  );

  /** Closes the field and hands its words up, unless Escape refused them. */
  function commit() {
    setNaming(false);
    if (nameCancelled.current) {
      nameCancelled.current = false;
      return;
    }
    onName(nameDraft);
  }

  if (naming) {
    return (
      <div className="sheet-name">
        <input
          ref={nameRef}
          className="sheet-name-title sheet-name-input"
          value={nameDraft}
          placeholder="Name this note"
          aria-label="Note name"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // The Enter that commits an IME candidate is not the one that
              // commits the name (`keyCode` 229 on older Android WebViews).
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              // Stopped here so the note's own Escape, which closes the
              // note, never hears it: Escape means the top thing.
              e.preventDefault();
              e.stopPropagation();
              nameCancelled.current = true;
              setNaming(false);
            }
          }}
        />
      </div>
    );
  }
  if (!offer) return null;
  return (
    <div className="sheet-name">
      {/* Says what pressing it does. It said "Name", which in small grey
          capitals over the text read as the label of a field rather than an
          offer (review 2026-10-01, UX-23); and the words are its whole
          accessible name now, so what is heard is what is read. */}
      <button
        type="button"
        className="sheet-name-title sheet-name-offer"
        onClick={() => {
          nameCancelled.current = false;
          setNameDraft(current ?? "");
          setNaming(true);
        }}
      >
        Add a name
      </button>
    </div>
  );
}
