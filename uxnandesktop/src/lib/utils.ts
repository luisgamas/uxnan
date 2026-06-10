import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class lists, de-duplicating conflicting Tailwind utilities.
 *  This is the standard shadcn-svelte helper; generated components expect it. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
