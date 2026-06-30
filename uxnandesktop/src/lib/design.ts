// Design tokens — the single source of truth for sizing, emphasis & surfaces.
//
// These are Tailwind class strings grouped by *role*, so components stay
// visually consistent and the whole app's density & texture can be tuned from
// one place. Apply them with `cn(...)`, e.g.
// `class={cn(iconButton.action, "text-muted-foreground")}`.
//
// Visual language (clean desktop UI): neutral layered surfaces (see the `--ux-*`
// tokens in `app.css`); selection reads through a quiet sidebar-accent fill,
// never a saturated color field. The scale aims for a comfortable,
// breathable desktop density — medium-sized rows and readable text, not a
// cramped grid:
//   - text  : 11px meta-labels/sections · 12px metadata · 13px body/menus · 14px titles
//   - icons  : 14px decorative · 16px in controls/nav · 32px empty-state
//   - rows   : ~32-36px nav/list rows, 10px horizontal rhythm
//
// See docs/design-tokens.md.

/** Icon sizes by role (width = height via Tailwind `size-*`). */
export const icon = {
  /** Inside a button, control or the search field (16px). */
  button: "size-4",
  /** Inside a compact toolbar / panel-header ghost action button (14px). Pairs
   *  with `iconButton.xs`; deliberately smaller than `icon.button` so dense
   *  headers (the projects header, the right-panel toolbars) stay quiet — use
   *  this for those, not the 16px `icon.button`. */
  action: "size-3.5",
  /** A leading icon in a nav / list row (16px). */
  nav: "size-4",
  /** Purely-visual / informational: breadcrumb, leading item icons,
   *  status & running indicators (14px). */
  decorative: "size-3.5",
  /** Empty-state illustration (32px). */
  empty: "size-8",
} as const;

/** Footprint of a ghost icon-button (the clickable square). */
export const iconButton = {
  /** Compact action in a dense row / card (24px). */
  xs: "size-6",
  /** Slightly roomier action (28px). */
  sm: "size-7",
  /** Toolbar / header / card / row action buttons (28px). Canonical alias. */
  action: "size-7",
  /** Primary toolbar button (32px). */
  toolbar: "size-8",
} as const;

/** Text roles. Informational text stays muted and un-bold on purpose — only
 *  primary/interactive text gets `text-foreground` / `font-medium`. */
export const text = {
  /** Settings / page title (the largest, boldest text). */
  pageTitle: "font-title text-2xl font-semibold leading-tight",
  /** Settings section heading (top of each pane). */
  heading: "font-title text-[15px] font-semibold tracking-tight",
  /** Sub-section heading inside a pane (medium weight, between heading & body). */
  subheading: "text-sm font-medium",
  /** Primary item title (project / worktree name) — a prominent 14px label. */
  title: "font-title text-sm font-medium tracking-tight",
  /** Body & interactive text (buttons, inputs, list items, menu items). */
  body: "text-[13px]",
  /** Body text that needs a touch more weight (active labels). */
  bodyStrong: "text-[13px] font-medium",
  /** Secondary, informational text (paths, descriptions) — muted, not bold. */
  meta: "text-xs leading-4 text-muted-foreground",
  /** Floating-menu item text. */
  menu: "text-[13px]",
  /** Floating-menu section label. */
  menuLabel: "text-[11px] font-medium text-muted-foreground",
  /** Sidebar / panel section header — muted, medium weight (not heavy black). */
  section: "text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground",
  /** Tiny badges, counters and indicators. */
  indicator: "text-[11px]",
} as const;

/** Surfaces & selection — a single *neutral* language for layering and for
 *  "this is the active thing", shared across the left panel (project/worktree
 *  cards), the nested agent rows and the panel tabs, so a selection reads the
 *  same everywhere. Selection uses the sidebar-accent fill (a quiet neutral
 *  delta), never a saturated tint; the nested variant is deliberately lighter
 *  than its parent. */
export const surface = {
  /** App canvas / shell root. */
  shell: "bg-[var(--ux-shell)] text-foreground",
  /** A navigation surface (left/right sidebars). */
  sidebar: "bg-sidebar text-sidebar-foreground",
  /** A content panel. */
  panel: "bg-[var(--ux-panel)] text-foreground",
  /** A subtly distinct panel band (e.g. a toolbar over a panel). */
  panelMuted: "bg-[var(--ux-panel-muted)]",
  /** An elevated overlay (menu / popover body). */
  elevated: "border border-border/70 bg-[var(--ux-elevated)] shadow-md",
  /** A selected project / worktree card (the strongest selection). */
  active: "bg-[var(--ux-sidebar-accent)] text-sidebar-foreground ring-1 ring-inset ring-sidebar-border/80",
  /** A selected agent row nested under a worktree — same neutral language,
   *  lighter, so it always reads as subordinate to its parent card. */
  activeNested: "bg-foreground/[0.055] text-foreground",
} as const;

/** Row recipes — comfortable, breathable list/nav rows. `*Inactive` /
 *  `*Active` are the state classes to compose conditionally on top of the base. */
export const row = {
  /** Sidebar nav / project / worktree / settings-nav row base (~32px). */
  sidebar:
    "group flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors",
  sidebarInactive:
    "text-sidebar-foreground/60 hover:bg-foreground/[0.055] hover:text-sidebar-foreground dark:hover:bg-foreground/[0.065]",
  sidebarActive: "bg-[var(--ux-sidebar-accent)] text-sidebar-foreground",
  /** A list row in a content panel (file tree, changes, …) (~36px). */
  list:
    "group flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
  listInactive: "text-muted-foreground hover:bg-accent hover:text-foreground",
  listActive: "bg-accent text-accent-foreground",
} as const;

/** Field controls — text inputs and the compact, field-like search button. */
export const field = {
  input:
    "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  search:
    "h-8 rounded-md border border-sidebar-border/70 bg-sidebar-foreground/5 pl-8 pr-2.5 text-[13px] font-medium text-sidebar-foreground/60 transition-colors hover:border-sidebar-border hover:bg-sidebar-foreground/8",
} as const;

/** Container surfaces — settings bodies, section headers and cards. */
export const panel = {
  /** A settings section body band (controls live inside; avoid card-in-card). */
  settingsBody: "rounded-xl border border-border/50 bg-card/50 px-7 py-6 shadow-xs",
  /** A settings section header (title + description over a divider). */
  sectionHeader: "flex flex-wrap items-start justify-between gap-4 border-b border-border/60 pb-5",
  /** A standalone content card. */
  card: "rounded-xl border border-border/50 bg-card shadow-xs",
  /** A selectable sidebar card (project/worktree outer shell). */
  sidebarCard: "overflow-hidden rounded-lg border border-sidebar-border/60 bg-sidebar-foreground/[0.025]",
} as const;

/** The shared focus-visible ring (soft but clearly visible). */
export const focus = {
  ring: "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
} as const;

/** Hairline section dividers — the single, subtle separator used for the top
 *  band of each panel and the bottom status bar. Reusable so every divider in
 *  the shell reads the same (theme-aware `--border`). Compose with `cn(...)`. */
export const divider = {
  /** A divider below the element (top-band sections). */
  bottom: "border-b border-border",
  /** A divider above the element (the status bar). */
  top: "border-t border-border",
} as const;

/** Tab recipes — an active tab reads like a selected sidebar item: a quiet
 *  sidebar-accent fill *plus* a firm foreground underline (the worktree-selection
 *  feel + an underline-style active bar). Compose `cn(tab.base, isActive ?
 *  tab.active : tab.inactive)`; `base` reserves the 2px underline so toggling
 *  never shifts content. Shared by the center terminal tabs and the right panel. */
export const tab = {
  base: "border-b-2 border-transparent transition-colors",
  active: "bg-[var(--ux-sidebar-accent)] border-foreground text-foreground",
  inactive: "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
} as const;
