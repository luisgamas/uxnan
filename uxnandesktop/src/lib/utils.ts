import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class lists, de-duplicating conflicting Tailwind utilities.
 *  This is the standard shadcn-svelte helper; generated components expect it. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// --- shadcn-svelte type helpers --------------------------------------------
// The generated `ui/` components import these from `$lib/utils`. They are the
// canonical shadcn-svelte definitions (kept here because our `utils.ts` predated
// the components, so the CLI did not regenerate this file).

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: unknown }
  ? Omit<T, "children">
  : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};
