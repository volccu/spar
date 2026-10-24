import { useRef } from "react";

/**
 * The field a new board's name is typed into: the strip's, the drawer's and
 * Tidy up's. Each draws its own row around it; the field and its keys are one.
 *
 * **Blur is cancel, never create** (review UI-A-04). It committed once, and
 * blur runs *before* the click that took the focus away — so tapping a board
 * row with a half-typed name in here made a board out of it first and then
 * went to the board you tapped; in Tidy up the create also filed a note. A
 * name is committed by asking for it, with Enter.
 *
 * `committing` is held across the create, because the caller unmounts this
 * field on the way (and may move the focus), and the blur that follows must
 * not undo the name it has just taken.
 */
export function NewBoardName({
  value,
  max,
  className,
  cancelIfEmpty = false,
  onChange,
  onCreate,
  onCancel,
}: {
  value: string;
  max: number;
  /** `field-words` on the strip and in the drawer: rename's field, the reading
   *  face at the reading size (review UI-A-04). Tidy up styles its own. */
  className?: string;
  /** Enter on an empty field closes it (Tidy up) rather than doing nothing. */
  cancelIfEmpty?: boolean;
  onChange: (name: string) => void;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const committing = useRef(false);
  return (
    <input
      autoFocus
      className={className}
      value={value}
      maxLength={max}
      placeholder="Board name"
      aria-label="New board name"
      enterKeyHint="done"
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (!committing.current) onCancel();
      }}
      onKeyDown={(e) => {
        // Enter that picks a word in an input method is not a commit.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (!value.trim()) {
            if (cancelIfEmpty) onCancel();
            return;
          }
          committing.current = true;
          onCreate(value);
          committing.current = false;
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
