// Theming engine — custom, exportable/importable themes covering the whole ADE.
//
// A `Theme` is a single palette with a declared `base` (light/dark — which drives
// the `.dark` class so Tailwind `dark:` status utilities still render correctly).
// Themes are applied by writing CSS variables onto <html>, so switching is
// instant and needs no rebuild. Fonts are referenced by family name (the family
// must be installed on the OS).
//
// FOR-DEV: importing font *files* (.ttf/.otf/.woff2, embedded as @font-face /
// data URLs) is a planned follow-up — today only installed font families (by
// name) are supported. See `uxnandesktop/FOR-DEV.md`.

// --- Types -----------------------------------------------------------------

/** The shadcn token palette every theme defines (CSS color strings: oklch / hex
 *  / rgb — anything valid in CSS). Keys map to `--kebab-case` CSS variables. */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarBorder: string;
}

/** Font families (by name) for the UI. Each is optional and falls back to the
 *  ADE default stack. */
export interface ThemeFonts {
  /** Titles / headings. */
  title?: string;
  /** Body / UI text. */
  body?: string;
  /** Monospace (code editor, diffs). The terminal has its own font setting. */
  mono?: string;
}

/** A complete theme. `id` is stable; built-ins use fixed ids (`light`/`dark`). */
export interface Theme {
  id: string;
  name: string;
  /** Light or dark base — toggles the `.dark` class for status utilities. */
  base: "light" | "dark";
  colors: ThemeColors;
  fonts?: ThemeFonts;
  /** Corner radius, e.g. `0.625rem`. Optional (defaults to the ADE radius). */
  radius?: string;
}

/** Per-terminal overrides (applied on top of the general theme, terminal only).
 *  Every field is optional; unset fields inherit the resolved defaults. */
export interface TerminalTheme {
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: number | string;
  /** Enable programming ligatures (forces the DOM renderer — no WebGL). */
  ligatures?: boolean;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  // Colors (xterm ITheme subset).
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

// --- Tokens ----------------------------------------------------------------

/** Every themeable color token, in editor display order. */
export const THEME_TOKENS: (keyof ThemeColors)[] = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebarForeground",
  "sidebarBorder",
];

/** The CSS variable name for a color token (`cardForeground` → `--card-foreground`). */
export function cssVarFor(key: keyof ThemeColors): string {
  return "--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}

/** The 16 ANSI color slots, in editor display order. */
export const ANSI_TOKENS: (keyof TerminalTheme)[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

// --- Default fonts ---------------------------------------------------------

// Kept in sync with the `--ux-font-*` defaults in `app.css`. Geist (a humanist
// variable sans — soft and light at small chrome sizes) is the single UI face
// for both body and titles; the title/body hierarchy comes from size + weight,
// not a second face. DM Sans + the OS UI font stay only as graceful fallbacks.
// The leading variable families are bundled (`@fontsource-variable/*`), so they
// always resolve. Themes may override any family by name via `ThemeFonts`; the
// override is composed in front of these stacks (see `composeFontStack`).
export const DEFAULT_FONTS = {
  body: '"Geist Variable", "Geist", "DM Sans Variable", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, system-ui, sans-serif',
  title: '"Geist Variable", "Geist", "DM Sans Variable", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, system-ui, sans-serif',
  mono: '"SF Mono", SFMono-Regular, ui-monospace, "Cascadia Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", "Symbols Nerd Font Mono", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", monospace',
} as const;

/** The variable faces bundled with the app via `@fontsource-variable/*` (so they
 *  resolve regardless of what's installed). Surfaced at the top of the UI-font
 *  pickers; the source of truth for "which faces ship with the app". */
export const BUNDLED_FONTS = ["Geist Variable", "DM Sans Variable"] as const;

// --- Built-in themes (mirror `app.css`) ------------------------------------

export const BUILTIN_LIGHT: Theme = {
  id: "light",
  name: "Light",
  base: "light",
  radius: "0.625rem",
  colors: {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    cardForeground: "oklch(0.145 0 0)",
    popover: "oklch(1 0 0)",
    popoverForeground: "oklch(0.145 0 0)",
    primary: "oklch(0.205 0 0)",
    primaryForeground: "oklch(0.985 0 0)",
    secondary: "oklch(0.97 0 0)",
    secondaryForeground: "oklch(0.205 0 0)",
    muted: "oklch(0.97 0 0)",
    mutedForeground: "oklch(0.556 0 0)",
    accent: "oklch(0.97 0 0)",
    accentForeground: "oklch(0.205 0 0)",
    destructive: "oklch(0.577 0.245 27.325)",
    border: "oklch(0.922 0 0)",
    input: "oklch(0.922 0 0)",
    ring: "oklch(0.708 0 0)",
    sidebar: "oklch(0.985 0 0)",
    sidebarForeground: "oklch(0.145 0 0)",
    sidebarBorder: "oklch(0.922 0 0)",
  },
};

export const BUILTIN_DARK: Theme = {
  id: "dark",
  name: "Dark",
  base: "dark",
  radius: "0.625rem",
  colors: {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.205 0 0)",
    cardForeground: "oklch(0.985 0 0)",
    popover: "oklch(0.205 0 0)",
    popoverForeground: "oklch(0.985 0 0)",
    primary: "oklch(0.922 0 0)",
    primaryForeground: "oklch(0.205 0 0)",
    secondary: "oklch(0.269 0 0)",
    secondaryForeground: "oklch(0.985 0 0)",
    muted: "oklch(0.269 0 0)",
    mutedForeground: "oklch(0.708 0 0)",
    accent: "oklch(0.269 0 0)",
    accentForeground: "oklch(0.985 0 0)",
    destructive: "oklch(0.704 0.191 22.216)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 15%)",
    ring: "oklch(0.556 0 0)",
    sidebar: "oklch(0.205 0 0)",
    sidebarForeground: "oklch(0.985 0 0)",
    sidebarBorder: "oklch(1 0 0 / 10%)",
  },
};

/** A deep-blue dark preset, to showcase recoloring built-ins. */
export const BUILTIN_MIDNIGHT: Theme = {
  id: "midnight",
  name: "Midnight",
  base: "dark",
  radius: "0.625rem",
  colors: {
    ...BUILTIN_DARK.colors,
    background: "oklch(0.17 0.03 264)",
    card: "oklch(0.22 0.035 264)",
    popover: "oklch(0.22 0.035 264)",
    sidebar: "oklch(0.2 0.035 264)",
    primary: "oklch(0.72 0.15 255)",
    primaryForeground: "oklch(0.18 0.03 264)",
    accent: "oklch(0.3 0.05 264)",
    accentForeground: "oklch(0.985 0 0)",
    ring: "oklch(0.72 0.15 255)",
    secondary: "oklch(0.28 0.04 264)",
    muted: "oklch(0.28 0.04 264)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 15%)",
    sidebarBorder: "oklch(1 0 0 / 10%)",
  },
};

/** A warm light preset. */
export const BUILTIN_LATTE: Theme = {
  id: "latte",
  name: "Latte",
  base: "light",
  radius: "0.625rem",
  colors: {
    ...BUILTIN_LIGHT.colors,
    background: "oklch(0.98 0.012 85)",
    card: "oklch(0.995 0.008 85)",
    popover: "oklch(0.995 0.008 85)",
    sidebar: "oklch(0.96 0.015 85)",
    primary: "oklch(0.55 0.13 45)",
    primaryForeground: "oklch(0.99 0.01 85)",
    accent: "oklch(0.93 0.03 75)",
    accentForeground: "oklch(0.3 0.06 45)",
    ring: "oklch(0.55 0.13 45)",
    secondary: "oklch(0.94 0.02 80)",
    muted: "oklch(0.94 0.02 80)",
    border: "oklch(0.89 0.02 80)",
    input: "oklch(0.89 0.02 80)",
    sidebarBorder: "oklch(0.89 0.02 80)",
  },
};

/** Built-in themes the picker always offers (in addition to "System"). */
export const BUILTIN_THEMES: Theme[] = [
  BUILTIN_LIGHT,
  BUILTIN_DARK,
  BUILTIN_MIDNIGHT,
  BUILTIN_LATTE,
];

/** Ids reserved by built-ins (custom themes can't reuse them). */
export const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((t) => t.id));

// --- Apply (write CSS variables) -------------------------------------------

/** Compose a user-picked font family in front of a role's bundled fallback
 *  stack, so a missing / misspelled / not-yet-loaded family degrades to the
 *  bundled face (Geist) → DM Sans → the OS UI font instead of the browser's
 *  serif default. This is why a manual font choice "doesn't load" without it:
 *  a bare `--ux-font-* : "Some Font"` with no fallback drops straight to serif
 *  the moment that one name can't resolve.
 *
 *  - empty / whitespace → the fallback stack unchanged;
 *  - a value that already contains a comma is treated as a complete stack and
 *    used as-is (so power users can still paste a full stack);
 *  - a single multi-word family is quoted before the fallback. */
export function composeFontStack(family: string | null | undefined, fallback: string): string {
  const f = (family ?? "").trim();
  if (!f) return fallback;
  if (f.includes(",")) return f;
  const head = /\s/.test(f) && !/["']/.test(f) ? `"${f}"` : f;
  return `${head}, ${fallback}`;
}

/** Apply a theme to the document: write every color token + radius + fonts as
 *  CSS variables on <html>, and toggle the `.dark` class from its base. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of THEME_TOKENS) {
    const value = theme.colors[key];
    if (value) root.style.setProperty(cssVarFor(key), value);
  }
  root.style.setProperty("--radius", theme.radius || BUILTIN_LIGHT.radius!);
  root.style.setProperty("--ux-font-body", composeFontStack(theme.fonts?.body, DEFAULT_FONTS.body));
  root.style.setProperty(
    "--ux-font-title",
    composeFontStack(theme.fonts?.title ?? theme.fonts?.body, DEFAULT_FONTS.title),
  );
  root.style.setProperty("--ux-font-mono", composeFontStack(theme.fonts?.mono, DEFAULT_FONTS.mono));
  root.classList.toggle("dark", theme.base === "dark");
}

// --- Terminal resolution ---------------------------------------------------

/** Default xterm ANSI palette (VS Code dark set; works on light bases too). */
const DEFAULT_ANSI: Record<string, string> = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

/** Resolved terminal options for xterm (font + ITheme), merging the general
 *  theme's base defaults with the user's terminal overrides. */
export interface ResolvedTerminal {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: number | string;
  ligatures: boolean;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  theme: Record<string, string>;
}

/** Build the effective terminal options: start from the active theme's base
 *  (light/dark default bg/fg + standard ANSI), then apply the terminal overrides. */
export function resolveTerminal(base: "light" | "dark", ov: TerminalTheme | null | undefined): ResolvedTerminal {
  const dark = base === "dark";
  const bg = dark ? "#0b0b0c" : "#ffffff";
  const fg = dark ? "#e6e6e6" : "#1f2328";
  const o = ov ?? {};
  const theme: Record<string, string> = {
    background: o.background || bg,
    foreground: o.foreground || fg,
    cursor: o.cursor || o.foreground || fg,
    cursorAccent: o.cursorAccent || o.background || bg,
    selectionBackground: o.selectionBackground || "rgba(128,128,128,0.35)",
  };
  for (const key of ANSI_TOKENS) {
    theme[key] = (o[key] as string) || DEFAULT_ANSI[key];
  }
  return {
    // Compose so a custom terminal family still falls back to the full mono
    // stack (and never to a proportional serif) when it isn't installed.
    fontFamily: composeFontStack(o.fontFamily, DEFAULT_FONTS.mono),
    fontSize: o.fontSize ?? 14,
    lineHeight: o.lineHeight ?? 1.0,
    letterSpacing: o.letterSpacing ?? 0,
    // A lighter default weight reads cleaner for terminal text than a full
    // "normal" (400); the mono faces in the stack carry a 300 axis.
    fontWeight: o.fontWeight ?? 300,
    ligatures: o.ligatures ?? false,
    cursorStyle: o.cursorStyle ?? "block",
    cursorBlink: o.cursorBlink ?? true,
    theme,
  };
}

/** Typography fields of a terminal theme (the global terminal-font override). */
export const TERMINAL_TYPOGRAPHY: (keyof TerminalTheme)[] = [
  "fontFamily",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "fontWeight",
  "ligatures",
];

/** Merge a global terminal-font override (typography only) on top of a terminal
 *  preset — the override wins for the fields it sets. Returns null when neither
 *  contributes anything (so the terminal inherits the app theme). */
export function mergeTerminalTypography(
  preset: TerminalTheme | null,
  fonts: TerminalTheme | null | undefined,
): TerminalTheme | null {
  if (!fonts) return preset;
  const out: TerminalTheme = preset ? { ...preset } : {};
  let any = preset != null;
  for (const key of TERMINAL_TYPOGRAPHY) {
    const v = fonts[key];
    if (v !== undefined && v !== null && v !== "") {
      (out as unknown as Record<string, unknown>)[key] = v;
      any = true;
    }
  }
  return any ? out : null;
}

// --- Import / export -------------------------------------------------------

/** Generate a fresh id for a custom theme. */
export function newThemeId(): string {
  return "custom-" + (crypto?.randomUUID?.() ?? Date.now().toString(36));
}

/** A copy of a theme as an editable custom theme (new id, " copy" name). */
export function duplicateTheme(theme: Theme, name?: string): Theme {
  return {
    ...structuredClone(theme),
    id: newThemeId(),
    name: name ?? `${theme.name} copy`,
  };
}

/** Validate + normalize a parsed theme object (from import). Missing colors are
 *  filled from the matching built-in base; a fresh id is assigned. Returns the
 *  theme or an error message. */
export function normalizeImportedTheme(raw: unknown): { theme?: Theme; error?: string } {
  if (!raw || typeof raw !== "object") return { error: "Not a theme object." };
  const r = raw as Record<string, unknown>;
  const base = r.base === "dark" ? "dark" : r.base === "light" ? "light" : null;
  if (!base) return { error: "Missing or invalid \"base\" (must be \"light\" or \"dark\")." };
  if (typeof r.colors !== "object" || r.colors === null)
    return { error: "Missing \"colors\" object." };
  const fallback = base === "dark" ? BUILTIN_DARK : BUILTIN_LIGHT;
  const rawColors = r.colors as Record<string, unknown>;
  const colors = {} as ThemeColors;
  for (const key of THEME_TOKENS) {
    const v = rawColors[key];
    colors[key] = typeof v === "string" && v.trim() ? v : fallback.colors[key];
  }
  const fonts =
    r.fonts && typeof r.fonts === "object" ? (r.fonts as ThemeFonts) : undefined;
  const name = typeof r.name === "string" && r.name.trim() ? r.name : "Imported theme";
  return {
    theme: {
      id: newThemeId(),
      name,
      base,
      colors,
      fonts,
      radius: typeof r.radius === "string" ? r.radius : "0.625rem",
    },
  };
}

/** Pull a flat list of candidate theme objects out of parsed import JSON, so a
 *  single file or paste may carry one theme or many. Accepts a bare object (one
 *  theme), a bare array (`[{…}, {…}]`), or a wrapper object holding an array
 *  under one of `keys` (e.g. `{ "themes": [ … ] }`). Returns `[]` when the input
 *  is neither an object nor an array. */
function themeCandidates(parsed: unknown, keys: string[]): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const r = parsed as Record<string, unknown>;
    for (const k of keys) if (Array.isArray(r[k])) return r[k] as unknown[];
    return [parsed];
  }
  return [];
}

/** Batch variant of {@link normalizeImportedTheme}: normalizes one theme, an
 *  array of themes, or a `{ themes: [...] }` wrapper. Returns every theme that
 *  validated plus a per-item error list for the ones that didn't. */
export function normalizeImportedThemes(raw: unknown): { themes: Theme[]; errors: string[] } {
  const candidates = themeCandidates(raw, ["themes", "customThemes"]);
  if (!candidates.length) return { themes: [], errors: ["Not a theme object."] };
  const themes: Theme[] = [];
  const errors: string[] = [];
  for (const c of candidates) {
    const { theme, error } = normalizeImportedTheme(c);
    if (theme) themes.push(theme);
    else if (error) errors.push(error);
  }
  return { themes, errors };
}

/** Serialize a theme to pretty JSON (for export / the JSON editor). */
export function themeToJson(theme: Theme): string {
  return JSON.stringify(theme, null, 2);
}

// --- Terminal theme presets (named, exportable/importable) -----------------

/** A saved, named terminal theme (the per-terminal override layer). `base` tags
 *  it as a light or dark theme — used only to group presets when the user opts
 *  into a separate terminal theme per light/dark app theme (default: dark). */
export interface TerminalThemePreset extends TerminalTheme {
  id: string;
  name: string;
  base?: "light" | "dark";
}

/** "Inherit" sentinel id: no terminal override (use the app theme's defaults). */
export const TERMINAL_INHERIT_ID = "inherit";

/** Every terminal override field (for import normalization + the editor). */
export const TERMINAL_FIELDS: (keyof TerminalTheme)[] = [
  "fontFamily",
  "fontSize",
  "lineHeight",
  "letterSpacing",
  "fontWeight",
  "ligatures",
  "cursorStyle",
  "cursorBlink",
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  ...ANSI_TOKENS,
];

export function newTerminalThemeId(): string {
  return "term-" + (crypto?.randomUUID?.() ?? Date.now().toString(36));
}

/** A copy of a terminal preset as a new editable preset. */
export function duplicateTerminalTheme(preset: TerminalThemePreset, name?: string): TerminalThemePreset {
  return {
    ...structuredClone(preset),
    id: newTerminalThemeId(),
    name: name ?? `${preset.name} copy`,
  };
}

/** Validate + normalize a parsed terminal theme (from import): keep known fields,
 *  assign a fresh id + a name. */
export function normalizeImportedTerminalTheme(raw: unknown): {
  preset?: TerminalThemePreset;
  error?: string;
} {
  if (!raw || typeof raw !== "object") return { error: "Not a terminal theme object." };
  const r = raw as Record<string, unknown>;
  const preset: TerminalThemePreset = {
    id: newTerminalThemeId(),
    name: typeof r.name === "string" && r.name.trim() ? r.name : "Imported terminal theme",
    base: r.base === "light" ? "light" : "dark",
  };
  for (const key of TERMINAL_FIELDS) {
    const v = r[key];
    if (v !== undefined && v !== null && v !== "") {
      (preset as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return { preset };
}

/** Batch variant of {@link normalizeImportedTerminalTheme}: normalizes one
 *  preset, an array of presets, or a `{ terminalThemes: [...] }` wrapper.
 *  Returns every preset that validated plus a per-item error list. */
export function normalizeImportedTerminalThemes(raw: unknown): {
  presets: TerminalThemePreset[];
  errors: string[];
} {
  const candidates = themeCandidates(raw, ["terminalThemes", "presets", "themes"]);
  if (!candidates.length) return { presets: [], errors: ["Not a terminal theme object."] };
  const presets: TerminalThemePreset[] = [];
  const errors: string[] = [];
  for (const c of candidates) {
    const { preset, error } = normalizeImportedTerminalTheme(c);
    if (preset) presets.push(preset);
    else if (error) errors.push(error);
  }
  return { presets, errors };
}

export function terminalThemeToJson(preset: TerminalThemePreset): string {
  return JSON.stringify(preset, null, 2);
}

/** Coherent dark terminal starter: dark bg + light fg + VS Code–style ANSI. */
export const TERMINAL_TEMPLATE: TerminalThemePreset = {
  id: "example",
  name: "My terminal theme",
  base: "dark",
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  lineHeight: 1.0,
  letterSpacing: 0,
  fontWeight: "normal",
  ligatures: true,
  cursorStyle: "block",
  cursorBlink: true,
  background: "#0b0b0c",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  cursorAccent: "#0b0b0c",
  selectionBackground: "rgba(128,128,128,0.35)",
  ...DEFAULT_ANSI,
};

/** Coherent light terminal starter: white bg + dark fg + Primer–inspired ANSI. */
export const TERMINAL_TEMPLATE_LIGHT: TerminalThemePreset = {
  id: "example",
  name: "My terminal theme",
  base: "light",
  fontFamily: "JetBrains Mono",
  fontSize: 13,
  lineHeight: 1.0,
  letterSpacing: 0,
  fontWeight: "normal",
  ligatures: true,
  cursorStyle: "block",
  cursorBlink: true,
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#1f2328",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(128,128,128,0.35)",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#4d2d00",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#218bff",
  brightMagenta: "#a475f1",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

/** Pick the coherent terminal starter for a given base (dark | light). */
export function terminalTemplateFor(base: "light" | "dark"): TerminalThemePreset {
  return base === "light" ? structuredClone(TERMINAL_TEMPLATE_LIGHT) : structuredClone(TERMINAL_TEMPLATE);
}

/** A ready-to-edit example theme used as the "new theme" template + docs sample. */
export const THEME_TEMPLATE: Theme = {
  id: "example",
  name: "My theme",
  base: "dark",
  radius: "0.625rem",
  colors: { ...BUILTIN_DARK.colors },
  fonts: {
    title: "Inter",
    body: "Inter",
    mono: "JetBrains Mono",
  },
};
