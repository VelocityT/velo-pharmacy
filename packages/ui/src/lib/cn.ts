import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind classes with correct precedence.
 *
 * Plain string concatenation breaks when a caller overrides a class
 * the component already sets — `"p-4" + "p-6"` leaves both in the
 * DOM and the winner depends on stylesheet order. twMerge resolves
 * conflicts by keeping the last one, which is what a caller expects.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
