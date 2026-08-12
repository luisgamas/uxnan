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
//   - controls: 36px standard · 32px compact · 28px dense chrome
//   - rows   : 32px sidebar · 36px content/list rows, 8px horizontal rhythm
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
  /** An agent-state glyph — the Comet Trail matrix or a state icon — in a
   *  sidebar row, a context menu or a terminal tab (12px). Deliberately a notch
   *  under `decorative`: it sits beside 12-13px text and must not outweigh it. */
  status: "size-3",
  /** Optical size for minimize/close glyphs in the custom title bar. */
  windowControl: "size-3.5",
  /** The outlined maximize glyph reads larger, so it gets a smaller optical box. */
  windowMaximize: "size-3",
  /** Empty-state illustration (32px). */
  empty: "size-8",
} as const;

/** Footprint of a ghost icon-button (the clickable square). */
export const iconButton = {
  /** Dense terminal-tab / panel-header action (28px). */
  xs: "size-7",
  /** Compact close affordance inside a terminal tab (24px target). */
  tabClose: "size-6",
  /** Standard icon action (32px). */
  sm: "size-8",
  /** Standard icon action (32px). Canonical alias. */
  action: "size-8",
  /** Standard toolbar button (36px). */
  toolbar: "size-9",
} as const;

/** Density contract for controls and overlay composition. */
export const control = {
  standard: "h-9",
  compact: "h-8",
  dense: "h-7",
  /** Default icon button role when a control is intentionally 36px. */
  iconDefault: "size-9",
  icon: "size-8",
  iconDense: "size-7",
  /** Large entity/avatar picker used by settings identity dialogs. */
  entityPicker: "size-12 shrink-0 rounded-lg",
  /** Paint-only edit badge inside an entity picker. */
  entityPickerBadge:
    "absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs",
} as const;

/** Shared overlay row and container recipes. */
export const overlay = {
  /** Menu rows use the shared 36px target across ContextMenu, DropdownMenu,
   *  Select and Command. Keep this in one token so callers do not invent
   *  equivalent local heights. */
  item: "min-h-9 px-2 py-2 text-[13px]",
  label: "min-h-8 px-2 py-1.5 text-[11px]",
  popover: "rounded-lg",
  popoverPadding: "p-3",
  popoverNoPadding: "p-0",
  menuSurface: "rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
  menuViewport: "uxnan-scroll max-h-[24rem] overflow-x-hidden overflow-y-auto",
  menuSubViewport: "uxnan-scroll max-h-[20rem] overflow-y-auto",
  menuCompactViewport: "uxnan-scroll max-h-72 overflow-y-auto",
  paletteViewport: "max-h-[22rem]",
  menuSeparator: "-mx-1 my-1 h-px bg-border/70",
  infoWidth: "w-72 max-w-[calc(100vw-1rem)]",
  formWidth: "w-80 max-w-[calc(100vw-1rem)]",
  commandWidth: "w-80 max-w-[calc(100vw-1rem)]",
  statusWidth: "w-96 max-w-[calc(100vw-1rem)]",
  /** Menu width roles keep labels and submenu affordances readable. */
  menuSimple: "min-w-44 max-w-[min(20rem,calc(100vw-1rem))]",
  menuStandard: "min-w-52 max-w-[min(20rem,calc(100vw-1rem))]",
  menuWide: "min-w-56 max-w-[min(20rem,calc(100vw-1rem))]",
  dataRow: "grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4",
} as const;

/** Dialog section rhythm and width roles. */
export const dialog = {
  content: "gap-4 px-5 py-0",
  sectioned: "gap-0 p-0",
  header: "pb-4 pt-5 pr-8",
  body: "py-4",
  footer: "-mx-5 rounded-b-xl border-t bg-muted/50 px-5 py-3",
  /** Footer surface shared by sectioned dialogs, including hint-only palettes. */
  footerSurface: "min-h-14 border-t border-border/60 bg-muted/30 px-5 py-3",
  smallWidth: "sm:max-w-sm",
  mediumWidth: "sm:max-w-lg",
  formWidth: "sm:max-w-[560px]",
  paletteWidth: "sm:max-w-[600px]",
  largeWidth: "sm:max-w-[600px]",
  workspaceWidth: "sm:max-w-[900px]",
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
 *  cards) and the panel tabs, so a selection reads the same everywhere.
 *  Selection uses the sidebar-accent fill (a quiet neutral delta), never a
 *  saturated tint. */
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
  active: "bg-[var(--ux-sidebar-accent)] text-sidebar-foreground",
} as const;

/** Named shell chrome roles. These are deliberately limited to structural
 * surfaces so callers do not grow screen-specific geometry recipes. */
export const shell = {
  root: "bg-[var(--ux-shell)] text-foreground",
  sidebar: "bg-sidebar text-sidebar-foreground",
  /** One 28px status-bar box. Like `appBar`, it paints its hairline as an
   *  overlay instead of a border: a `border-t` is inside the border-box, so it
   *  would leave 27px for a 28px control and every highlight would spill past
   *  the bar. Actions here fill the full height and sit flush, so the bar reads
   *  as one band of controls rather than a row of floating pills. */
  statusBar:
    "relative flex h-7 shrink-0 items-center px-2 text-xs text-muted-foreground before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-px before:bg-border/60",
  /** A square status-bar action — full bar height, no radius (the shape
   *  `appBarAction` gives the top chrome). */
  statusBarAction: "flex h-7 w-7 shrink-0 items-center justify-center rounded-none",
  /** A text-bearing status-bar item (a count, a warning): same height and square
   *  corners, with its own horizontal padding since the bar has no gap. */
  statusBarItem: "flex h-7 shrink-0 items-center gap-1 rounded-none px-1.5",
  /** One 40px appbar box. Its overlay hairline stays visible above full-height actions. */
  appBar:
    "relative h-10 shrink-0 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-px after:bg-border/60",
  /** Overlay height without a second hairline (the underlying appbar owns it). */
  appBarOverlay: "h-10",
  /** A square top-level appbar action; the appbar paints its line above it. */
  appBarAction: "flex size-10 shrink-0 items-center justify-center rounded-none",
  /** Square top-level actions used around the center tab strip. */
  appBarCompactAction: "flex size-10 shrink-0 items-center justify-center rounded-none",
  terminalStrip: "flex items-center bg-sidebar",
  rightPanelHeader: "bg-sidebar",
  rightPanelTabs: "h-8 shrink-0",
  laneHeader: "flex min-h-7 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left",
  laneAction: "min-h-7 shrink-0 rounded px-1.5 py-0.5",
  sidebarBrand: "flex select-none items-center gap-2 px-3",
  /** Full-screen workspace header; its actions use the full appbar height. */
  workspaceHeader: "flex items-center gap-2 px-3",
  /** Keeps native macOS traffic lights clear of left-aligned app chrome. */
  macTrafficLightsInset: "pl-20",
  sidebarSectionHeader: "flex h-8 shrink-0 items-center gap-0.5 px-2.5",
  titlebar: "fixed right-0 top-0 z-50 flex select-none items-center",
  titlebarControl: "flex size-10 items-center justify-center",
  titlebarLauncher: "flex size-10 items-center justify-center",
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
  /** Agent rows nested below a worktree. */
  agent: "relative flex min-h-8 w-full items-start gap-2 rounded-md px-1 py-1 text-left transition-colors",
  /** Project identity header; shared by project cards and future sidebar shells. */
  projectHeader: "group/header flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
  agentModel: "max-w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground/70",
  agentDetail: "ml-[1.375rem] mt-0.5 flex flex-col gap-0.5 border-l border-border/60 pl-2",
  agentSpaceHeader: "flex w-full min-w-0 items-center gap-1 pr-1",
  agentAvatarStrip: "flex min-w-0 flex-1 flex-nowrap items-center gap-0 overflow-hidden py-1",
  agentOverflow: "flex size-7 shrink-0 items-center justify-center text-[10px] tabular-nums text-muted-foreground/70",
  agentLeading: "flex shrink-0 self-center items-center justify-center",
  agentActiveIndicator: "absolute -left-1 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground",
  agentSpaceDetail: "ml-2 flex min-w-0 flex-col pl-1.5",
  projectSummary: "flex w-full items-center gap-2 pb-1.5 pl-8 pr-2 text-left",
  /** Virtualized worktree-switcher result; kept at the exact 52px estimate. */
  searchResult: "flex h-[52px] w-full items-center gap-3 rounded-lg px-2.5 text-left transition-colors",
  /** Settings control row: label/description left, control right on wide panes. */
  settings:
    "grid gap-x-6 gap-y-2 py-3.5 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center",
  /** Settings navigation item. */
  settingsNav:
    "group flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] font-medium tracking-tight transition-colors",
  /** Selectable preview/list row used by settings editors. */
  settingsList:
    "group flex min-h-9 w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors",
  settingsListLabel:
    "min-w-0 flex-1 justify-start truncate text-left text-[13px] text-foreground",
  /** Text-bearing disclosure in a profile/editor row. */
  editorDisclosure: "min-h-8 min-w-0 flex-1 rounded-md px-1 text-left",
  /** A selectable settings choice row with quiet active/hover surfaces. */
  choice:
    "group flex min-h-9 w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors",
  choiceActive: "bg-accent/60",
  choiceInactive: "hover:bg-foreground/[0.04]",
  /** Large descriptive radio choice in settings. */
  settingsChoiceCard:
    "flex min-h-20 flex-col items-start gap-1.5 p-3.5 text-left transition-colors",
} as const;

/** Field controls — text inputs and the compact, field-like search button. */
export const field = {
  input:
    "h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
  search:
    "flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-foreground/5 px-2.5 text-left text-[13px] font-medium text-sidebar-foreground/60 transition-colors hover:border-sidebar-border hover:bg-sidebar-foreground/8",
  searchIcon: "size-4 shrink-0",
  searchLabel: "min-w-0 flex-1 truncate text-left",
  searchShortcut: "shrink-0",
  /** Compact editor value field; pair with Input density="compact". */
  editor: "min-w-0 font-mono text-[11px]",
  /** Repeated narrow numeric editor field. */
  editorNumber: "w-24 text-right tabular-nums",
  /** A select filling its editor grid cell without forcing overflow. */
  editorSelect: "w-full min-w-0",
  /** Stable labels in repeated color/value editor rows. */
  editorLabel: "w-28 min-w-0 shrink-0 truncate",
  editorLabelShort: "w-24 min-w-0 shrink-0 truncate",
  /** Native clock input: wide enough for localized 12-hour suffixes and its picker glyph. */
  time: "w-44 max-w-full shrink-0 tabular-nums",
  /** Repeated settings-select widths; every role clamps at the pane width. */
  selectCompact: "w-36 max-w-full",
  selectNarrow: "w-44 max-w-full",
  selectStandard: "w-56 max-w-full",
  selectComfortable: "w-64 max-w-full",
  selectWide: "w-72 max-w-full",
} as const;

/** Container surfaces — settings bodies, section headers and cards. */
export const panel = {
  /** A settings section body band (controls live inside; avoid card-in-card). */
  settingsBody: "rounded-xl border border-border/50 bg-card/50 px-7 py-6 shadow-xs",
  /** Equal-height list/preview surface used by settings pickers. */
  settingsPreview: "h-60 min-h-0 overflow-hidden rounded-lg border border-border/50",
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
 *  the shell reads the same (theme-aware `--border`, softened to /60 so the
 *  structural seams stay quiet against the content instead of reading as hard,
 *  crisp lines). Compose with `cn(...)`. */
export const divider = {
  /** A divider below the element (top-band sections). */
  bottom: "border-b border-border/60",
  /** A divider above the element (the status bar). */
  top: "border-t border-border/60",
} as const;

/** Tab recipes — an active tab reads like a selected sidebar item: a quiet
 *  sidebar-accent fill *plus* a firm foreground underline (the worktree-selection
 *  feel + an underline-style active bar). Compose `cn(tab.base, isActive ?
 *  tab.active : tab.inactive)`; `base` reserves the 2px underline so toggling
 *  never shifts content. Shared by the center terminal tabs and the right panel. */
export const tab = {
  base: "border-b-2 border-transparent transition-colors",
  panelTrigger: "shrink-0 whitespace-nowrap px-3 text-[13px]",
  terminalTrigger: "flex h-full shrink-0 cursor-pointer items-center gap-1.5 px-3 text-[13px]",
  /** Truncating title inside a draggable terminal/file/commit tab. */
  terminalLabel: "max-w-[120px] truncate",
  /** Filled tabs (center terminal strip): quiet fill + firm underline. */
  active: "bg-[var(--ux-sidebar-accent)] border-foreground text-foreground",
  inactive: "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground",
  /** Line tabs (right panel): just the firm underline, no fill — reads cleaner
   *  on small view tabs. */
  activeLine: "border-foreground text-foreground",
  inactiveLine: "text-muted-foreground hover:text-foreground",
  /** Small accessible Visual/JSON editor switcher. */
  segmentedList:
    "inline-flex min-h-8 shrink-0 self-start overflow-hidden rounded-md border border-border bg-muted/30",
  segmentedTrigger: "min-h-7 rounded-none px-2 text-[11px]",
} as const;
