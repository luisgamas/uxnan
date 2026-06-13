# Desktop — design tokens (sizing & emphasis)

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
| `icon.button` | 14px (`size-3.5`) | Icons inside a button or the search field |
| `icon.decorative` | 12px (`size-3`) | Purely-visual / informational: breadcrumb, leading item icons, status & "running terminals" indicators |
| `icon.empty` | 28px (`size-7`) | Empty-state illustration |

### Icon buttons (`iconButton`)
| Token | Size | Use |
|---|---|---|
| `iconButton.action` | 24px (`size-6`) | Ghost icon buttons in toolbars, cards and rows |

### Text (`text`)
| Token | Size / style | Use |
|---|---|---|
| `text.title` | 13px medium | Primary item title (project / worktree name) |
| `text.body` | 12px | Body & interactive text (buttons, inputs, list items, menu items) |
| `text.meta` | 11px muted | Secondary, informational text (paths, descriptions) — **muted, not bold** |
| `text.menu` | 12px | Floating-menu item text |
| `text.menuLabel` | 11px muted | Floating-menu section label |
| `text.section` | 11px medium uppercase muted | Sidebar / panel section header |
| `text.indicator` | 10px | Tiny badges, counters and indicators |

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

## Adding/changing a token
Edit `src/lib/design.ts` (and this table). Because components reference the
tokens, the change applies everywhere consistently.
