import { useRef } from "react";

/**
 * `value`, except that while `hold` is true it keeps answering with what it
 * was when `hold` came on. For things drawn *above* the text being typed into:
 * those may change while the note is read, never under the caret.
 */
export function useHeldWhile<T>(value: T, hold: boolean): T {
  const held = useRef(value);
  if (!hold) held.current = value;
  return hold ? held.current : value;
}
