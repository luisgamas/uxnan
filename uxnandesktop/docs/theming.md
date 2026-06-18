# Theming & appearance

Uxnan Desktop ships built-in themes (System, Light, Dark, Midnight, Latte) and
lets you create, import and export your own. A theme covers the **whole app** —
every surface color plus the title / body / mono fonts. The terminal has its own
override layer on top.

## Where

Everything lives under **Settings → Appearance**, split into two sub-tabs:

**Interface tab**

- **Theme grid** — pick System, a built-in, or a custom theme (applies live).
- **New theme** — opens an editable **draft** (previewed live); it is only saved
  when you press **Save** (Cancel / closing discards it).
- **Edit** (custom themes) — a visual editor (per-token color inputs + fonts +
  base) and a **JSON** tab you can edit directly, with Save / Cancel.
- **Duplicate / Delete**, and **Import** (`.json` file or pasted JSON) /
  **Export** (`.json` file or clipboard).
- **Fonts** — a **global font override** (title / body / mono) that wins over
  each theme's own fonts, so you can change fonts without switching theme.

**Terminal tab**

Terminal themes are saved presets that **override the app theme in the terminal
only**. Pick **Inherit** to follow the app theme, or a preset. Each preset is
created/edited as a draft (Save / Cancel), and import/exports as JSON just like
app themes. In the editor, every field set is marked with an **overrides** dot
and shows the inherited value as its placeholder; covers font family / size /
line-height / letter-spacing / weight, ligatures, cursor style + blink, and the
full color set (background, text, cursor, selection, and the 16 ANSI colors).

## Theme JSON (template)

A theme is a single palette with a declared `base` (`light` or `dark`). Colors
accept any CSS color (`oklch(...)`, `#rrggbb`, `rgb(...)`). Fonts are family
names that must be **installed on the machine** (importing font *files* is a
planned follow-up — see `FOR-DEV.md`).

```json
{
  "name": "My theme",
  "base": "dark",
  "radius": "0.625rem",
  "fonts": {
    "title": "Inter",
    "body": "Inter",
    "mono": "JetBrains Mono"
  },
  "colors": {
    "background": "oklch(0.145 0 0)",
    "foreground": "oklch(0.985 0 0)",
    "card": "oklch(0.205 0 0)",
    "cardForeground": "oklch(0.985 0 0)",
    "popover": "oklch(0.205 0 0)",
    "popoverForeground": "oklch(0.985 0 0)",
    "primary": "oklch(0.922 0 0)",
    "primaryForeground": "oklch(0.205 0 0)",
    "secondary": "oklch(0.269 0 0)",
    "secondaryForeground": "oklch(0.985 0 0)",
    "muted": "oklch(0.269 0 0)",
    "mutedForeground": "oklch(0.708 0 0)",
    "accent": "oklch(0.269 0 0)",
    "accentForeground": "oklch(0.985 0 0)",
    "destructive": "oklch(0.704 0.191 22.216)",
    "border": "oklch(1 0 0 / 10%)",
    "input": "oklch(1 0 0 / 15%)",
    "ring": "oklch(0.556 0 0)",
    "sidebar": "oklch(0.205 0 0)",
    "sidebarForeground": "oklch(0.985 0 0)",
    "sidebarBorder": "oklch(1 0 0 / 10%)"
  }
}
```

On import, an `id` is assigned automatically and any missing color falls back to
the matching built-in base, so a partial theme still imports cleanly.

## Terminal theme JSON (template)

A terminal theme is a flat set of optional overrides — anything you omit inherits
the app theme's terminal value.

```json
{
  "name": "My terminal theme",
  "fontFamily": "JetBrains Mono",
  "fontSize": 13,
  "lineHeight": 1.0,
  "ligatures": true,
  "cursorStyle": "block",
  "cursorBlink": true,
  "background": "#0b0b0c",
  "foreground": "#e6e6e6",
  "black": "#000000",
  "red": "#cd3131",
  "green": "#0dbc79",
  "yellow": "#e5e510",
  "blue": "#2472c8",
  "magenta": "#bc3fbc",
  "cyan": "#11a8cd",
  "white": "#e5e5e5",
  "brightBlack": "#666666",
  "brightRed": "#f14c4c",
  "brightGreen": "#23d18b",
  "brightYellow": "#f5f543",
  "brightBlue": "#3b8eea",
  "brightMagenta": "#d670d6",
  "brightCyan": "#29b8db",
  "brightWhite": "#ffffff"
}
```

## How it's applied

`applyTheme` (in `src/lib/theme.ts`) writes each color to its `--token` CSS
variable on `<html>`, sets `--ux-font-{body,title,mono}` and `--radius`, and
toggles the `.dark` class from the theme's `base` (so Tailwind `dark:` status
utilities still render correctly). Switching is instant — no rebuild.

The terminal is resolved by `resolveTerminal`, which starts from the active
theme's base defaults (background/foreground + a standard ANSI palette) and
overlays the per-terminal overrides, producing the xterm font options + theme.
