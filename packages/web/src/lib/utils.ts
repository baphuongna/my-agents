import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Themed font-family constants.
 *
 * Adapted from Hermes `lib/utils.ts` — Hermes uses its Mondwest brand font.
 * mya uses standard Tailwind font stacks: `font-mono` for branded/code/tech
 * elements, `font-sans` for body copy. These constants centralise the choice
 * so modals, headers, and chrome stay consistent across theme switches.
 */

/** Monospace accent font — branded/technical text (values, labels, logos). */
export const themedFont = "font-mono";

/** Sans-serif body copy — sentence-case themed text. */
export const themedBody = "font-sans normal-case";

/** Monospace chrome — uppercase section headers and nav labels. */
export const themedChrome = "font-mono uppercase tracking-wider";
