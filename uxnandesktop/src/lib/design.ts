// Design tokens — the single source of truth for sizing, emphasis & surfaces.
//
// These are Tailwind class strings grouped by *role*, so components stay
// visually consistent and the whole app's density & texture can be tuned from
// one place. Apply them with `cn(...)`, e.g.
// `class={cn(iconButton.action, "text-muted-foreground")}`.
//
// Visual language (clean desktop UI):
//   - Neutral, layered surfaces (see the `--ux-*` tokens in `app.css`); selection
//     reads through a quiet sidebar-accent fill, never a saturated color field.
//   - icons : 12px decorative · 14px in controls · 16px nav · 28px empty-state
//   - text  : 10px indicators · 11px meta/labels · 12px body/menus · 13px titles
//   - rows  : ~28px dense nav rows, 8px horizontal rhythm
//
// See docs/design-tokens.md.

/** Icon sizes by role (width = height via Tailwind `size-*`). */
export const icon = {
  /** Inside a button or the search field (14px). */
  button: "size-3.5",
  /** A leading icon in a nav / list row (16px). */
  nav: "size-4",
  /** Purely-visual / informational: breadcrumb, leading item icons,
   *  status & running indicators (12px). */
  decorative: "size-3",
  /** Empty-state illustration (28px). */
  empty: "size-7",
} as const;

/** Footprint of a ghost icon-button (the clickable square). */
export const iconButton = {
  /** Compact action in a dense row / card (24px). */
  xs: "size-6",
  /** Slightly roomier action (28px). */
  sm: "size-7",
  /** Toolbar / header / card / row action buttons (24px). Canonical alias. */
  action: "size-6",
  /** Primary toolbar button (32px). */
  toolbar: "size-8",
} as const;

/** Text roles. Informational text stays muted and un-bold on purpose — only
 *  primary/interactive text gets `text-foreground` / `font-medium`. */
export const text = {
  /** Settings / page title (the largest, boldest text). */
  pageTitle: "font-title text-2xl font-semibold leading-tight",
  /** Settings section heading (top of each pane). */
  heading: "font-title text-sm font-semibold tracking-tight",
  /** Sub-section heading inside a pane (medium weight, between heading & body). */
  subheading: "text-[13px] font-medium",
  /** Primary item title (project / worktree name). */
  title: "font-title text-[13px] font-medium tracking-tight",
  /** Body & interactive text (buttons, inputs, list items, menu items). */
  body: "text-xs",
  /** Body text that needs a touch more weight (active labels). */
  bodyStrong: "text-xs font-medium",
  /** Secondary, informational text (paths, descriptions) — muted, not bold. */
  meta: "text-[11px] leading-4 text-muted-foreground",
  /** Floating-menu item text. */
  menu: "text-xs",
  /** Floating-menu section label. */
  menuLabel: "text-[11px] font-medium text-muted-foreground",
  /** Sidebar / panel section header — muted, medium weight (not heavy black). */
  section: "text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground",
  /** Tiny badges, counters and indicators. */
  indicator: "text-[10px]",
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
  /** Active state for a panel tab. Plain classes (apply *conditionally* on the
   *  active tab) — bits-ui exposes selection via `data-state="active"`, not
   *  `data-active`, and this project doesn't define a `data-active` variant, so
   *  a component's own `data-active:` classes never render. A lifted neutral
   *  segment (bg + subtle ring + soft shadow) reads as selected on any strip. */
  tab: "bg-background text-foreground shadow-sm ring-1 ring-border/70",
} as const;

/** Row recipes — dense, breathable list/nav rows. `*Inactive` / `*Active` are
 *  the state classes to compose conditionally on top of the base. */
export const row = {
  /** Sidebar nav / project / worktree / settings-nav row base (~28px). */
  sidebar:
    "group flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors",
  sidebarInactive:
    "text-sidebar-foreground/60 hover:bg-foreground/[0.055] hover:text-sidebar-foreground dark:hover:bg-foreground/[0.065]",
  sidebarActive: "bg-[var(--ux-sidebar-accent)] text-sidebar-foreground",
  /** A list row in a content panel (file tree, changes, …). */
  list:
    "group flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
  listInactive: "text-muted-foreground hover:bg-accent hover:text-foreground",
  listActive: "bg-accent text-accent-foreground",
} as const;

/** Field controls — text inputs and the compact, field-like search button. */
export const field = {
  input:
    "h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  search:
    "h-7 rounded-md border border-sidebar-border/70 bg-sidebar-foreground/5 pl-7 pr-2 text-[12px] font-medium text-sidebar-foreground/60 transition-colors hover:border-sidebar-border hover:bg-sidebar-foreground/8",
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
