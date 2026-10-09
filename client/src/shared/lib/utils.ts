export { cn } from "cn"

/**
 * The className for a numeric table cell and its header. Right-aligned and
 * monospace so digits line up down the column, and tabular figures so a value
 * updating in place does not shift the ones beside it.
 *
 * Shared because four tables use it: a second copy would drift, and an
 * alignment that differs between screens reads as a bug.
 */
export const numericCell = "text-right font-mono tabular-nums"
