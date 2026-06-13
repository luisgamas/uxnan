// Design tokens — the single source of truth for sizing & emphasis.
//
// These are Tailwind class strings grouped by *role*, so components stay
// visually consistent and the whole app's density can be tuned from one place.
// Apply them with `cn(...)`, e.g. `class={cn(icon.button, "text-muted-foreground")}`.
//
// Scale rationale (compact desktop UI):
//   icons   : 12px decorative · 14px in controls · 28px empty-state
//   text    : 10px indicators · 11px meta/labels · 12px body/menus · 13px titles
//   buttons : 24px ghost icon buttons (toolbars, cards, rows)
//
// See docs/design-tokens.md.

/** Icon sizes by role (width = height via Tailwind `size-*`). */
export const icon = {
  /** Inside a button or the search field (14px). */
  button: "size-3.5",
  /** Purely-visual / informational: breadcrumb, leading item icons,
   *  status & running indicators (12px). */
  decorative: "size-3",
  /** Empty-state illustration (28px). */
  empty: "size-7",
} as const;

/** Footprint of a ghost icon-button (the clickable square). */
export const iconButton = {
  /** Toolbar / header / card / row action buttons (24px). */
  action: "size-6",
} as const;

/** Text roles. Informational text stays muted and un-bold on purpose — only
 *  primary/interactive text gets `text-foreground` / `font-medium`. */
export const text = {
  /** Primary item title (project / worktree name). */
  title: "text-[13px] font-medium",
  /** Body & interactive text (buttons, inputs, list items, menu items). */
  body: "text-xs",
  /** Secondary, informational text (paths, descriptions) — muted, not bold. */
  meta: "text-[11px] text-muted-foreground",
  /** Floating-menu item text. */
  menu: "text-xs",
  /** Floating-menu section label. */
  menuLabel: "text-[11px] text-muted-foreground",
  /** Sidebar / panel section header — muted, medium weight (not heavy black). */
  section: "text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
  /** Tiny badges, counters and indicators. */
  indicator: "text-[10px]",
} as const;
