import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Hands focus back when a layer closes.
 *
 * Whatever had focus when the layer first rendered is remembered — read on
 * the first render, before the layer has had any chance to take it — and
 * focused again on unmount, if it is still in the document. `preferred`
 * names an element to try first: the drawer's burger, which a tap on a touch
 * screen does not focus on the way in, so the remembered element would be
 * the wrong one (`Shelf`). It is read at unmount, not at setup, because it
 * is the caller's own ref and is filled when that button mounts; and it is
 * only taken while it is still in the document, which is what "the
 * remembered element is the fallback" always meant.
 *
 * Six layers carried this same ref-and-cleanup pair: `Dialog`, `Lightbox`,
 * `NoteView`, `MenuPanel`, `BoardLook`, `Shelf`. Declared as its own effect
 * so the layer's focusing effect can stay keyed on whatever it likes; the
 * restore happens once, on unmount, whatever the layer did in between.
 */
export function useRestoreFocus(preferred?: RefObject<HTMLElement | null>): void {
  const remembered = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useLayoutEffect(() => {
    const fallback = remembered.current;
    return () => {
      // Read late on purpose, and here the linter's rule is right that it can
      // change: this is the caller's own ref at the button that opened the
      // layer, filled when that button mounts. Taken at setup it could be a
      // null, or a node since replaced. The one standing at unmount is the one
      // that can take focus.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const first = preferred?.current;
      const target = first?.isConnected ? first : fallback;
      if (target?.isConnected) target.focus();
    };
  }, [preferred]);
}
