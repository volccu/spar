/**
 * What Tab can land on inside a layer. One string, because three layers had
 * their own copy of it and a fourth would have drifted.
 */
const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The part of a keyboard event a focus trap reads. */
interface TabKey {
  shiftKey: boolean;
  preventDefault(): void;
}

/**
 * Keeps Tab inside a layer: past the last focusable element it wraps to the
 * first, and Shift+Tab past the first wraps to the last. A layer with nothing
 * focusable in it takes focus itself rather than letting the key out. The
 * caller has already decided the key is Tab and that this layer is the one
 * on top — `NoteView` stands down for its own lightbox and its own dialog.
 *
 * Written once here; `Dialog`, `Lightbox` and `NoteView` each carried the
 * same nineteen lines.
 */
export function cycleTab(e: TabKey, container: HTMLElement | null): void {
  const focusable = Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  if (focusable.length === 0) {
    e.preventDefault();
    container?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
