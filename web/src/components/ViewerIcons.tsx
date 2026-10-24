import ArrowUturnRightIcon from "@heroicons/react/24/outline/ArrowUturnRightIcon";
import PhotoIcon from "@heroicons/react/24/outline/PhotoIcon";
import { mark } from "./Icons";

/**
 * The full-screen viewer's own two marks, drawn the way every mark in
 * `Icons.tsx` is (`mark`, one Heroicon at a time). Kept beside the viewer, in
 * its lazy chunk, because nothing on the first paint draws them and the first
 * paint has a ceiling (`buildInvariants.test.ts`).
 */

/** A quarter turn clockwise — the full-screen picture, turned to be read. */
export function IconRotate() {
  return mark(ArrowUturnRightIcon, "inline");
}

/** This picture is the card's: put first among the note's files. */
export function IconCover() {
  return mark(PhotoIcon, "inline");
}
