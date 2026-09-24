import { tv } from "tailwind-variants";

/** The segmented control: a quiet track with the chosen option lifted out of it
 *  (the desktop "segmented tabs" recipe). One recipe for every mode switch in
 *  the app — a file's views, a diff's layout, the Git surface's views, an
 *  editor's Visual / JSON — so they cannot drift apart again. */
export const segmented = tv({
  slots: {
    root: "inline-flex h-7 shrink-0 items-center gap-0.5 rounded-lg bg-muted/70 p-0.5 text-muted-foreground",
    item: [
      "inline-flex h-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2",
      "text-[12px] font-medium outline-none transition-colors hover:text-foreground",
      "focus-visible:ring-[3px] focus-visible:ring-ring/50",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs",
      "dark:data-[state=on]:bg-foreground/10",
      "[&_svg]:size-3.5 [&_svg]:shrink-0",
    ],
    label: "min-w-0 truncate",
    count: "rounded-full bg-foreground/10 px-1.5 text-[10px] leading-4 tabular-nums",
  },
  variants: {
    /** Share the whole width, one equal part per option. */
    fill: { true: { root: "flex w-full", item: "flex-1" } },
    /** An option drawn as a glyph alone (its tooltip names it). */
    glyph: { true: { item: "w-6 px-0" } },
  },
});
