import { useId, useLayoutEffect, useRef } from "react";
import { cycleTab } from "../lib/focusTrap";
import { useRestoreFocus } from "../lib/useRestoreFocus";
import { IconClear, IconDelete } from "./Icons";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * What the ✕ and Escape mean, when that is not the same as the Cancel button.
   *
   * For a confirmation they are the same thing and this stays unset. It exists
   * for the one dialog whose two buttons are both *answers* rather than yes and
   * no: there, walking away has to be able to mean "neither yet".
   */
  onDismiss?: () => void;
}

/** A small, blocking decision surface in the app's own visual language. */
export function Dialog({
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  onDismiss,
}: Props) {
  const dismiss = onDismiss ?? onCancel;
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useRestoreFocus();

  useLayoutEffect(() => {
    (destructive ? cancelRef.current : confirmRef.current)?.focus();
  }, [destructive]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      /**
       * Escape is Cancel here too, and a destructive question is no exception.
       *
       * It used to be one: the key was swallowed — `preventDefault` and
       * `stopPropagation`, so React's root listener never let it reach the
       * app's own — and then nothing was done with it, which is the worst of
       * the three possible answers. A dialog that eats a key answers it; it
       * simply answers "nothing happened", with no way for the reader to tell
       * that from a keyboard that is not working.
       *
       * The idea being protected was that walking away from a destructive
       * question must not destroy anything, and that is right and is already
       * true: walking away is **Cancel**, which destroys nothing. Cancel is
       * also the button this dialog puts the focus on when it is destructive
       * (see the effect above), so Escape, Enter and the ✕ all say the one
       * thing, and the only way to the consequence is to reach for it.
       */
      dismiss();
      return;
    }
    if (e.key !== "Tab") return;

    cycleTab(e, dialogRef.current);
  }

  return (
    // A press on the backdrop keeps the focus in the question, so Escape
    // still answers it afterwards (bughunt 2026-10-15).
    <div
      className="dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role={destructive ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="dialog-head">
          <span className="dialog-mark" aria-hidden>
            {destructive && <IconDelete tier="inline" />}
          </span>
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close"
            title="Close"
            onClick={dismiss}
          >
            <IconClear />
          </button>
        </div>
        <p id={messageId} className="dialog-message">
          {message}
        </p>
        <div className="dialog-actions">
          {cancelLabel && (
            <button ref={cancelRef} type="button" className="btn mono" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            className="btn mono dialog-confirm"
            data-destructive={destructive}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
