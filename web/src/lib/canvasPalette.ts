import { BOARD_COLORS } from "./boardLook";

export interface CanvasColour {
  key: string;
  label: string;
  value: string;
}

/**
 * The pencils a canvas offers. The first three are the drawing's original
 * tonal pens; the rest are the same sixteen content tints a user-made board
 * can wear. Keeping the board's key and token means there is still one
 * palette, and a stored stroke follows this device's resolved ramp.
 */
export const CANVAS_COLOURS: readonly CanvasColour[] = [
  { key: "ink", label: "Ink", value: "var(--ink)" },
  { key: "muted", label: "Muted", value: "var(--muted)" },
  { key: "faint", label: "Faint", value: "var(--rule)" },
  ...BOARD_COLORS.map((colour) => ({
    key: colour.key,
    label: colour.name,
    value: `var(${colour.token})`,
  })),
];

export const CANVAS_WIDTHS = [2, 4, 8] as const;

/** The highlighter is wide: it marks over words and pictures, it does not write. */
export const HIGHLIGHT_WIDTHS = [12, 20, 32] as const;
