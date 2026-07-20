# Desktop — design tokens (sizing & emphasis)

![Source](https://img.shields.io/badge/tokens-src%2Flib%2Fdesign.ts-blue?style=for-the-badge)
![Style](https://img.shields.io/badge/Tailwind-class_strings_by_role-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

A small, reusable scale that keeps the UI visually consistent and lets us tune
density from one place. The tokens are Tailwind class strings grouped by **role**
in [`src/lib/design.ts`](../src/lib/design.ts); apply them with `cn(...)`.

```svelte
<script lang="ts">
  import { icon, iconButton, text } from "$lib/design";
  import { cn } from "$lib/utils";
</script>

<button class={cn(iconButton.action, "rounded hover:bg-accent")}>
  <SearchIcon class={icon.button} />
</button>
<span class={text.meta}>{repo.path}</span>
```

## The scale

### Icons (`icon`)
| Token | Size | Use |
|---|---|---|
| `icon.button` | 16px (`size-4`) | Icons inside a button, control or the search field |
| `icon.action` | 14px (`size-3.5`) | Icon inside a compact toolbar / panel-header action button (pairs with `iconButton.xs`) |
| `icon.nav` | 16px (`size-4`) | A leading icon in a nav / list row |
| `icon.decorative` | 14px (`size-3.5`) | Purely-visual / informational: breadcrumb, leading item icons, status & "running terminals" indicators |
| `icon.empty` | 32px (`size-8`) | Empty-state illustration |

### Icon buttons (`iconButton`)
| Token | Size | Use |
|---|---|---|
| `iconButton.xs` | 24px (`size-6`) | Compact action in a dense row / card |
| `iconButton.sm` | 28px (`size-7`) | Slightly roomier action |
| `iconButton.action` | 28px (`size-7`) | Canonical ghost icon button in toolbars, cards and rows |
| `iconButton.toolbar` | 32px (`size-8`) | Primary toolbar button |

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
| `surface.active` | Selected project / worktree card (strongest selection) |
| `surface.activeNested` | Selected agent row nested under a worktree (lighter, subordinate) |

### Rows (`row`)
Dense, breathable list/nav rows. Compose `*Inactive` / `*Active` state classes
on top of the base.

| Token | Use |
|---|---|
| `row.sidebar` + `row.sidebarInactive` / `row.sidebarActive` | Sidebar nav / project / worktree / settings-nav row (~28px) |
| `row.list` + `row.listInactive` / `row.listActive` | A list row in a content panel (file tree, changes, …) |

### Fields & containers (`field`, `panel`, `focus`)
| Token | Use |
|---|---|
| `field.input` | A text input |
| `field.search` | The compact, field-like search button |
| `panel.settingsBody` | A settings section body band (controls inside; no card-in-card) |
| `panel.sectionHeader` | A settings section header (title + description over a divider) |
| `panel.card` | A standalone content card |
| `panel.sidebarCard` | A selectable sidebar card (project/worktree outer shell) |
| `focus.ring` | The shared focus-visible ring |
| `divider.bottom` / `divider.top` | The subtle hairline section divider (top band of each panel, the status bar) — one reusable softened `border-border/60` hairline so every structural seam reads quiet (never a hard, crisp full-strength line) and they all match |
| `tab.base` + `tab.active` / `tab.inactive` | Active tab = a quiet sidebar-accent fill (like a selected worktree) + a firm foreground underline; shared by the center terminal tabs and the right panel |

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
