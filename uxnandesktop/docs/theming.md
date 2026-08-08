# Theming & appearance

![Built-in](https://img.shields.io/badge/built--in-System_%7C_Light_%7C_Dark_%7C_Midnight_%7C_Latte-blue?style=for-the-badge)
![Custom](https://img.shields.io/badge/custom-create_%7C_import_%7C_export-2ea44f?style=for-the-badge)
![Terminal](https://img.shields.io/badge/terminal-own_override_layer-0a0a0a?style=for-the-badge)

Uxnan Desktop ships built-in themes (System, Light, Dark, Midnight, Latte) and
lets you create, import and export your own. A theme covers the **whole app** —
every surface color plus the title / body / mono fonts. The terminal has its own
override layer on top.

## Where

Everything lives under **Settings → Appearance** — a single scrolling page with
an **Interface** section on top and a **Terminal** section below. Each holds its
**Fonts** and a **Themes** item, followed by a scrollable **theme name list** and
a **live preview** of the selected theme.

**Interface → Fonts** — a **global font override** (title / body / mono) that
wins over each theme's own fonts, so you can change fonts without switching theme.

**Interface → Themes**

- **Theme list + live preview** — a scrollable list of theme names (System,
  built-ins, custom); clicking a name previews its colors in the side panel (a
  themed card listing each color role), and **Use** applies it live. The active
  theme is checked.
- **New theme** — opens an editable **draft** (previewed live); it is only saved
  when you press **Save** (Cancel / closing discards it).
- **Edit** (custom themes) — a visual editor (per-token color inputs + fonts +
  base) and a **JSON** tab you can edit directly, with Save / Cancel.
- **Duplicate / Delete**, and **Import** (`.json` file or pasted JSON) /
  **Export** (`.json` file or clipboard). Import accepts **multiple files at
  once**, and each file (or the pasted text) may hold a **single theme or a whole
  list** — see [Importing many themes at once](#importing-many-themes-at-once).

**Terminal → Fonts** — a **global terminal typography** override (font family /
size / **bold text** / line-height / letter-spacing / ligatures) that wins over
each terminal theme's font. Leave empty to use the theme's.

**Bold text** is a switch: it raises the weight of terminal output and changes
**nothing else** — same family, same size, same spacing. It writes the same
`fontWeight` override the theme editor exposes as a number, and it reflects the
*effective* weight, so a preset that already sets a bold weight shows it as on.
Text a program marks bold stays heavier than the body weight: `fontWeightBold` is
derived two steps above the regular weight (capped at 900), so emphasis survives
turning the whole terminal bold.

**Terminal → Themes** — saved presets that **override the app theme in the
terminal only**, shown as a scrollable **name list** beside a **live mini-terminal
preview** (a non-interactive sample that recolors to the selected theme so you see
real color usage). Pick **Inherit** to follow the app theme, or a preset; the
surrounding UI stays on the app theme — only the mini terminal recolors.

A **switch** — "separate terminal themes for light / dark app themes":

- **Off** (default) — one list + preview; the chosen terminal theme applies
  regardless of the app being light or dark.
- **On** — two lists, **dark themes** and **light themes**, each with its own
  mini-terminal preview; you pick one in each, and it applies by the resolved
  app-theme base. Presets are grouped by their **base** tag (light/dark), set in
  the editor (default dark).

Each preset is a draft (Save / Cancel) and import/exports as JSON. In the editor
every field set is marked with an **overrides** dot and shows the inherited value
as its placeholder; covers font, size, line-height, letter-spacing, weight,
ligatures, cursor style + blink, and the full color set (background, text,
cursor, selection, and the 16 ANSI colors).

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
the default for the background it resolves to (see
[Terminal legibility](#terminal-legibility)). `fontWeight` accepts a number,
`"normal"` or `"bold"`; all three normalize to a 100–900 step on resolve.

```json
{
  "name": "My terminal theme",
  "fontFamily": "JetBrains Mono",
  "fontSize": 13,
  "fontWeight": 300,
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

## Importing many themes at once

Both grids (Interface and Terminal) import the same two ways — a `.json` file
or pasted JSON — and both accept **batches**:

- **Multiple files** — the file picker allows selecting several `.json` files at
  once; every file is imported in one pass.
- **A list inside one file or paste** — instead of a single theme object, the
  JSON may be an **array** of themes, or an **object wrapping an array** under
  `themes` (interface) / `terminalThemes` (terminal). For example:

  ```json
  [
    { "name": "Ocean", "base": "dark", "colors": { "primary": "oklch(0.6 0.2 250)" } },
    { "name": "Sand",  "base": "light", "colors": { "primary": "oklch(0.8 0.1 90)" } }
  ]
  ```

  ```json
  { "themes": [ { "name": "Ocean", "base": "dark", "colors": {} } ] }
  ```

Each entry is normalized independently (its own fresh `id`, missing colors
backfilled from the built-in base). The **last** valid theme in the batch becomes
active. After importing you get a summary ("Imported N themes"); any malformed
entries are skipped and reported without aborting the rest of the batch.

## How it's applied

`applyTheme` (in `src/lib/theme.ts`) writes each color to its `--token` CSS
variable on `<html>`, sets `--ux-font-{body,title,mono}` and `--radius`, and
toggles the `.dark` class from the theme's `base` (so Tailwind `dark:` status
utilities still render correctly). Switching is instant — no rebuild.

A theme only needs to define the base palette above: the ADE's **semantic
surface layers** — `--ux-shell`, `--ux-sidebar-accent`, `--ux-panel`,
`--ux-panel-muted`, `--ux-editor-surface`, `--ux-elevated` and the hover/border
tints — are derived in `app.css` from those base tokens via `color-mix`, so any
theme (built-in or custom) gets coherent shell, sidebar and panel depth
automatically. Because the mix is over `--foreground`, the same formula darkens
light themes and lightens dark ones.

When no font is set, the UI defaults to **Geist**, which is **bundled** with the
app (`@fontsource-variable/geist`, imported in `app.css`) so it renders regardless
of what's installed on the OS. The default is declared in `DEFAULT_FONTS`
(`theme.ts`) and mirrored by `--ux-font-*` in `app.css`; the body also gets a small
`letter-spacing` + grayscale antialiasing for crisp rendering.

The terminal is resolved by `resolveTerminal`, which produces the xterm font
options + theme from the terminal overrides on top of a set of defaults.

## Terminal legibility

Two rules keep terminal output readable no matter which theme, preset and CLI
meet in a pane.

**Defaults follow the background, not the app theme.** `resolveTerminal` reads the
luminance of the *resolved* background — the preset's if it sets one, the app
base's otherwise — and takes the default text colour, cursor and ANSI palette from
that. This is what keeps a dark terminal preset legible under a light app theme
(and the reverse): every field the preset leaves unset would otherwise inherit the
opposite base's colours and land on top of a background of the same tone. A
background it can't parse (`oklch(...)`, a CSS variable) falls back to the app
theme's base instead of guessing.

**A contrast floor for the colours uxnan doesn't own.** A palette can only fix the
16 ANSI slots; a TUI painting 24-bit grey on grey is beyond it. xterm's
`minimumContrastRatio` lifts any glyph that lands too close to its cell
background:

| Terminal background | Floor | Why |
|---|---|---|
| light | **4.5** (WCAG AA) | bright-white / bright-yellow output is unreadable on white without it |
| dark | **3.0** (AA large text) | rescues near-background text — ANSI black on `#0b0b0c` is 1.07:1 — while leaving the saturated colours a dark palette relies on untouched |

Both constants live in `theme.ts` (`TERMINAL_MIN_CONTRAST_LIGHT` /
`TERMINAL_MIN_CONTRAST_DARK`). Correction only ever *adds* contrast, so a color
already clear of the floor renders exactly as authored. The live terminal
re-applies the value only when it changes — writing it drops xterm's contrast
cache.
