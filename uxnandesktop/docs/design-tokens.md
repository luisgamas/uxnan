# Desktop — design tokens (sizing & emphasis)

![Source](https://img.shields.io/badge/tokens-src%2Flib%2Fdesign.ts-blue?style=for-the-badge)
![Style](https://img.shields.io/badge/Tailwind-class_strings_by_role-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

A small, reusable scale that keeps the UI visually consistent and lets us tune
density from one place. The tokens are Tailwind class strings grouped by **role**
in [`src/lib/design.ts`](../src/lib/design.ts); apply them with `cn(...)`.

```svelte
<script lang="ts">
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import { icon, iconButton, text } from "$lib/design";
  import { Icon } from "$lib/components/ui/icon";
  import { cn } from "$lib/utils";
</script>

<button class={cn(iconButton.action, "rounded hover:bg-accent")}>
  <Icon icon={SearchIcon} class={icon.button} />
</button>
<span class={text.meta}>{repo.path}</span>
```

## The icon set

Icons come from **[Hugeicons](https://hugeicons.com) free** (MIT), as the data
package [`@hugeicons/core-free-icons`](https://www.npmjs.com/package/@hugeicons/core-free-icons)
— glyph *data*, not components. One glyph per subpath import, so a screen only
ever bundles what it draws:

```ts
import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon"; // ✅ tree-shakes
import { Folder01Icon } from "@hugeicons/core-free-icons";        // ❌ pulls the barrel
```

Render every glyph through the local [`Icon`](../src/lib/components/ui/icon/icon.svelte)
primitive, which turns the data into SVG declaratively. We do **not** use the
upstream `@hugeicons/svelte` component: it paints via `innerHTML` inside
`onMount`, so the `<svg>` is empty until hydration and — the reason that settles
it — it never repaints when the `icon` prop changes, which several call sites
here rely on (agent state, view mode, settings rows).

Sizing is the caller's job through the `icon.*` tokens above; `Icon` only sets a
24px fallback, which any `size-*` class overrides. Color is inherited: the glyph
data draws with `currentColor`, so `text-muted-foreground` tints it and the light
and dark themes need no per-icon work.

Hugeicons strokes at **1.5** where lucide stroked at 2 — deliberately lighter at
the 12-16px sizes this UI uses. `strokeWidth` on `Icon` overrides it when a glyph
needs to hold its own against heavier neighbours.

## The density contract

Density is role-based and applies to every primitive, not a screen-specific
preference:

| Role | Contract | Examples |
|---|---:|---|
| Standard control | 36px (`h-9`) | Button, Input, Select trigger |
| Compact control | 32px (`h-8`) | compact Input (`density="compact"`), Select `size="compact"` |
| Dense chrome | 28px (`h-7`) | terminal tabs and constrained panel-header actions only |
| Appbar / top-level appbar action | 40px (`h-10` / `size-10`) | shell appbars, window controls, workspace back, tab carousel, launch action |
| Sidebar row | min 32px (`min-h-8`) | navigation and project/worktree rows |
| Content/list row | min 36px (`min-h-9`) | file and status lists |
| Standard icon button | 32px (`size-8`) | icon-only toolbar and row action |
| Dense icon button | 28px (`size-7`) | terminal-tab and panel-header action |

Generic 24px interactive targets are not part of the contract. The single named
exception is `iconButton.tabClose`: a visually subordinate 24px close action
nested inside a full-height 40px terminal tab. It must not be reused for
top-level appbar actions. A platform-native exception must retain an effective
hit area of at least 28px and be documented at its call site. Paint-only
controls such as checkboxes may render smaller when their effective target
remains at least 32px.

Use the role tokens from `src/lib/design.ts` and let a local class override a
token only when the component has a named, constrained role. Do not resize
arbitrary markup globally.

Settings and editors follow the same rule. `SettingsSection` owns the header and
canonical `panel.settingsBody` band, `SettingsRow` consumes `row.settings`, and
editor/list callers compose the named `row.*`, `field.*`, `tab.*`, and `control.*`
roles. A pixel-equivalent local class is not a substitute for the shared role.

```svelte
<Button size="default">Run</Button>       <!-- 36px standard -->
<Button size="sm">Filter</Button>         <!-- 32px compact -->
<Button size="icon-xs" aria-label="Close">…</Button> <!-- 28px dense chrome -->
<Input density="compact" aria-label="Search" />
<Select.Trigger size="compact">Compact</Select.Trigger>
```

## Overlay and dialog roles

Menus, selects, and command items use a minimum 36px row, 8px horizontal
padding, and readable 13px text. Popovers use 12px default padding; composed
command/list bodies may intentionally own their internal sections and use the
semantic `padding="none"` prop. Width is chosen by information structure and is
viewport-clamped:

| Role | Width | Use |
|---|---:|---|
| Informational popover | about 288px (`overlay.infoWidth`) | short status or help |
| Form/command popover | about 320px (`overlay.formWidth`) | fields and command lists |
| Command popover | about 320px (`overlay.commandWidth`) | command palette/list body |
| Data-rich status popover | 352–384px (`overlay.statusWidth`) | multi-column status details |

Dropdown and context menus use the semantic `simple`, `standard`, and `wide` width roles;
call sites should select the role rather than repeat `min-w-*` classes. Data-rich
label/value surfaces use `overlay.dataRow` (`minmax(0,1fr) auto`, a deliberate
column gap, and stable non-wrapping values) so long labels do not squeeze
numeric status values. Width follows information structure, not padding alone.

Context-menu content defaults to `standard` (about 208px). Short menus with
only a few brief actions may opt into `simple`; long labels, nested actions, and
data-rich groups should use `wide`. Submenus declare a role as well so they do
not regress to a narrower local width.

`MenuSurface` is the shared programmatic surface for terminal pane/tab menus. It
retains explicit pointer coordinates because xterm panes and tab chips are
dynamic, overlapping targets: Bits UI's `ContextMenu.Trigger` must own the
native `contextmenu` event and computes its virtual point internally, so it
cannot faithfully accept the already-captured pane/tab target without changing
tab activation and pointer-coordinate behavior. The shared surface therefore
uses the same menu tokens and overlay registration contract, and supplies
roving Arrow/Home/End focus, Escape/Tab close, outside-pointer dismissal, and
viewport-clamped width roles. This is an interaction primitive, not a styling-
only wrapper.

Dialogs use named `small`, `medium`, `form`, `palette`, `large`, and `workspace`
width roles. `form` is 560px; both the worktree `palette` and data-rich `large`
roles are 600px. Their content shell has 20px horizontal padding and no forced
vertical padding. `Dialog.Header` uses 20px above / 16px below, with right-side
clearance for the 32px close target; `Dialog.Body` keeps a 16px vertical rhythm.
`Dialog.Footer` deliberately extends through the content inset and restores
20px internal padding, producing one full-width muted action band. Sectioned
dialogs use `dialog.footerSurface`; hint-only bars have a 56px minimum so they
do not collapse below action footers. Every action footer uses the one
`dialog.footer` band — a confirmation is not a second footer role. A dialog
whose header carries its whole content (`ConfirmDialog`) drops the header's
16px bottom padding and its 32px close-button inset instead, because the
content grid's own 16px gap already separates that header from the footer.
Outside-pointer dismissal must preserve
the pointer sequence for the newly targeted underlying control; keyboard close
may restore the trigger, while navigation must not restore stale chrome.
Tooltip coordination is provider-owned by Bits UI: one tooltip is open per root
provider, trigger clicks close it, unrelated pointer/focus and Escape dismiss it,
and keyboard focus remains supported without global document listeners.

## The scale

### Icons (`icon`)
| Token | Size | Use |
|---|---|---|
| `icon.button` | 16px (`size-4`) | Icons inside a button, control or the search field |
| `icon.action` | 14px (`size-3.5`) | Icon inside a compact toolbar / panel-header action button (pairs with `iconButton.xs`) |
| `icon.nav` | 16px (`size-4`) | A leading icon in a nav / list row |
| `icon.decorative` | 14px (`size-3.5`) | Purely-visual / informational: breadcrumb, leading item icons, "running terminals" indicators |
| `icon.brand` | 16px (`size-4`) | An agent's brand logo leading an agent / worktree row. Deliberately a notch above the 14px state glyph beside it: the mark answers *who is running* and the glyph answers *how it is doing*, so identity reads first |
| `icon.status` | 12px (`size-3`) | A count-adjacent indicator in a sidebar row (running terminals, per-row counters). A notch under `decorative`: it sits beside 12-13px text and must not outweigh it. The agent-state glyph itself (`AgentStatusIndicator`) sits at `decorative`, one notch under its brand mark |
| `icon.empty` | 32px (`size-8`) | Empty-state illustration |

### Icon buttons (`iconButton`)
| Token | Size | Use |
|---|---|---|
| `iconButton.xs` | 28px (`size-7`) | Dense terminal-tab / panel-header action |
| `iconButton.tabClose` | 24px (`size-6`) | Sole nested exception: terminal-tab close |
| `iconButton.sm` | 32px (`size-8`) | Standard icon action |
| `iconButton.action` | 32px (`size-8`) | Canonical ghost icon button in toolbars, cards and rows |
| `iconButton.toolbar` | 36px (`size-9`) | Standard toolbar button |

`control.icon` / `iconButton.sm` are the standard 32px icon target; the explicit
`control.iconDefault` / `iconButton.toolbar` roles are 36px only where a default
button-sized icon control is desired.

### Text (`text`)
| Token | Size / style | Use |
|---|---|---|
| `text.pageTitle` | 24px semibold | Settings / page title (largest, boldest) |
| `text.heading` | 15px semibold | Settings section heading |
| `text.subheading` | 14px medium | Sub-section heading inside a pane |
| `text.title` | 14px medium | Primary item title (project / worktree name) |
| `text.body` | 13px | Body & interactive text (buttons, inputs, list items, menu items) |
| `text.bodyStrong` | 13px medium | Body text that needs a touch more weight (active labels) |
| `text.meta` | 12px muted | Secondary, informational text (paths, descriptions) — **muted, not bold** |
| `text.menu` | 13px | Floating-menu item text |
| `text.menuLabel` | 11px medium muted | Floating-menu section label |
| `text.section` | 11px medium uppercase muted | Sidebar / panel section header |
| `text.indicator` | 11px | Tiny badges, counters and indicators |

### Surfaces & selection (`surface`)
Neutral, layered surfaces. Selection reads through a quiet **sidebar-accent**
fill (`--ux-sidebar-accent`), never a saturated color field. The surface
variables themselves (`--ux-shell`, `--ux-panel`, …) live in `app.css`, derived
from the theme palette so they follow every theme — see
[theming](theming.md#how-its-applied).

| Token | Use |
|---|---|
| `surface.shell` | App canvas / shell root |
| `surface.sidebar` | A navigation surface (left/right sidebars) |
| `surface.panel` | A content panel |
| `surface.panelMuted` | A subtly distinct panel band (e.g. a toolbar over a panel) |
| `surface.elevated` | An elevated overlay (menu / popover body) |
| `surface.active` | Selected project / worktree card (strongest background/text selection, without an outline ring) |

### Shell chrome (`shell`)

Structural shell bands use named roles so navigation, terminal and status chrome
share geometry without making work-surface components depend on one another.
`shell.appBar` owns the 40px height and paints its bottom hairline above hover
fills. Top-level icon controls use the square `shell.appBarAction` or
`shell.appBarCompactAction`; both are 40×40px. The fixed window-control overlay
uses `shell.appBarOverlay`, which intentionally has no second hairline because
the longer appbar below it owns that line. `WorkspaceAppBar` reuses this anatomy
for Settings and Automations. `shell.root`, `shell.sidebar`, `shell.statusBar`,
`shell.terminalStrip`, `shell.rightPanelHeader`, `shell.laneHeader`,
`shell.laneAction`, and `shell.titlebar` remain the region-specific roles; they
do not replace `surface.*` on content surfaces. On macOS, the platform Tauri
config supplies native overlay traffic lights and `shell.macTrafficLightsInset`
keeps left-aligned content clear of them.

### Rows (`row`)
Dense, breathable list/nav rows. Compose `*Inactive` / `*Active` state classes
on top of the base.

| Token | Use |
|---|---|
| `row.sidebar` + `row.sidebarInactive` / `row.sidebarActive` | Sidebar nav / project / worktree / settings-nav row (min 32px) |
| `row.list` + `row.listInactive` / `row.listActive` | A list row in a content panel (file tree, changes, …) |
| `row.agent` | Nested agent row (min 32px) |
| `row.projectHeader` | Project identity header (min 36px) |
| `row.searchResult` | Worktree palette result (exact 52px virtual-list row) |
| `row.agentModel` / `row.agentSpaceHeader` / `row.agentAvatarStrip` / `row.agentOverflow` / `row.agentLeading` / `row.agentActiveIndicator` / `row.agentDetail` / `row.agentSpaceDetail` | Agent model truncation, responsive single-line agent-space strip with measured avatar capacity and stable +N footprint, centered leading glyphs, active-agent marker, subagent relationship rail, and borderless expanded-agent inset |
| `row.projectSummary` | Collapsed project summary insets |
| `row.settings` / `row.settingsNav` | Responsive settings control row and settings navigation item |
| `row.settingsList` / `row.settingsListLabel` | Settings selection row and its left-aligned, truncating primary action |
| `row.editorDisclosure` | Text-bearing disclosure in a profile/editor row |
| `row.choice` + `row.choiceActive` / `row.choiceInactive` | Selectable preview/list row with quiet state treatment |
| `row.settingsChoiceCard` | Large descriptive radio-style choice in settings |

`row.searchResult` is the one intentional list-row exception to the 36px content
row contract: the worktree switcher presents branch and path on two lines, so
its `h-[52px]` is coupled to `VirtualList estimateSize={52}` and must remain
pixel-exact for virtualization and keyboard highlighting.

The shell also names repeated chrome geometry: `shell.sidebarBrand` and
`shell.sidebarSectionHeader`; `overlay.paletteViewport` owns the palette's
viewport cap; `tab.panelTrigger` owns the right-panel trigger padding/type; and
`tab.terminalTrigger` owns terminal tab trigger geometry.

### Fields & containers (`field`, `panel`, `focus`)
| Token | Use |
|---|---|
| `field.input` | A standard 36px text input |
| `field.search` / `field.searchIcon` / `field.searchLabel` / `field.searchShortcut` | The compact search trigger and its stable leading icon, truncating label and trailing keycaps |
| `field.editor` / `field.editorNumber` / `field.editorSelect` | Compact editor values, repeated numeric fields, and selects that cannot force overflow |
| `field.editorLabel` / `field.editorLabelShort` | Stable, truncating labels in repeated editor grids |
| `field.selectCompact` / `field.selectNarrow` / `field.selectStandard` / `field.selectComfortable` / `field.selectWide` | Named, pane-clamped widths for repeated settings selectors |
| `panel.settingsBody` | A settings section body band (controls inside; no card-in-card) |
| `panel.settingsPreview` | Equal-height, overflow-safe list/preview surface for settings pickers |
| `panel.sectionHeader` | A settings section header (title + description over a divider) |
| `panel.card` | A standalone content card |
| `panel.sidebarCard` | A selectable sidebar card (project/worktree outer shell) |
| `focus.ring` | The shared focus-visible ring |
| `divider.bottom` / `divider.top` | The subtle hairline section divider (top band of each panel, the status bar) — one reusable softened `border-border/60` hairline so every structural seam reads quiet (never a hard, crisp full-strength line) and they all match |
| `tab.base` + `tab.active` / `tab.inactive` | Active tab = a quiet sidebar-accent fill (like a selected worktree) + a firm foreground underline; shared by the center terminal tabs and the right panel |
| `tab.segmentedList` / `tab.segmentedTrigger` | Compact Bits UI-backed mode switch used by settings editors |

## Principles
- **Emphasis is earned.** Informational text (paths, counts, hints) stays
  `text-muted-foreground` and un-bold. Reserve `text-foreground` / `font-medium`
  for primary or interactive content.
- **One size per role.** Don't hand-pick `text-sm` / `size-4` ad-hoc; pick the
  role token. If a role is missing, add it here (and update this doc) rather than
  inventing a one-off size.
- **Decorative icons are smaller than control icons.** A breadcrumb icon
  (`icon.decorative`) is lighter than an icon inside a clickable button
  (`icon.button`).

## Asynchronous action feedback

Actions that wait for filesystem, Git, GitHub, agent, or other backend I/O use
the shared shadcn-svelte `Spinner` inside the control that started the work:

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { i18n } from "$lib/i18n";
</script>

<Button disabled={saving} onclick={save}>
  {#if saving}
    <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
  {/if}
  {saving ? i18n.t("editor.saving") : i18n.t("editor.save")}
</Button>
```

- Disable the initiating control while its promise is pending and keep the
  existing localized action/progress label visible; motion alone is not enough.
- Track an operation id when several actions share one busy gate, so only the
  initiating control shows the spinner (`push` vs. `pull`, a specific file, or a
  specific install/uninstall action).
- Use `data-icon="inline-start"` in text buttons. In icon-only controls, replace
  the action glyph with `Spinner` so dimensions stay stable.
- Keep immediate UI-only actions (selection, navigation, opening a dialog) free
  of spinners. Loading feedback is for work whose completion the user waits for.

## Adding/changing a token
Edit `src/lib/design.ts` (and this table). Because components reference the
tokens, the change applies everywhere consistently.
