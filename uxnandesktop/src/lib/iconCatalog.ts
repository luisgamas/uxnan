// Built-in icon catalog — the *pure* string layer (no Svelte/lucide imports, so
// it's unit-testable and safe to import anywhere).
//
// A project/branch icon value is one of three things, all stored inline in the
// persisted state (`RepoData.icon` / `RepoData.branchIcons`):
//   - a `builtin:<name>[~<color>]` key → a curated lucide glyph (see the glyph
//     registry + `resolveBuiltinIcon` in `iconRegistry.ts`);
//   - a custom image `data:` URL (a file / URL / avatar rasterized by `logo.ts`);
//   - absent (null) → the caller's default folder/branch glyph.
//
// The built-in set gives a quick, upload-free way to distinguish branches (and
// projects) with a recognizable, on-brand glyph. `<color>` is a hex value stored
// verbatim in the key (e.g. `builtin:rocket~#f59e0b`), so any custom color works;
// the presets in `BUILTIN_COLORS` are just quick picks. No color → the calm
// ambient `currentColor` used everywhere else.

/** The curated built-in glyph names, in display order. The concrete lucide
 *  components are attached in `iconRegistry.ts` (kept out of here so this module
 *  stays free of Svelte imports and unit-testable). */
export const BUILTIN_ICON_NAMES = [
  "rocket",
  "star",
  "flame",
  "zap",
  "sparkles",
  "wand-sparkles",
  "bug",
  "wrench",
  "hammer",
  "cog",
  "git-branch",
  "git-merge",
  "git-fork",
  "git-pull-request",
  "workflow",
  "code",
  "terminal",
  "cpu",
  "database",
  "server",
  "package",
  "box",
  "boxes",
  "layers",
  "component",
  "beaker",
  "atom",
  "brain",
  "shield",
  "lock",
  "key",
  "flag",
  "bookmark",
  "tag",
  "pin",
  "bell",
  "heart",
  "crown",
  "trophy",
  "gem",
  "diamond",
  "target",
  "compass",
  "map",
  "radar",
  "satellite",
  "orbit",
  "globe",
  "cloud",
  "sun",
  "moon",
  "snowflake",
  "leaf",
  "sprout",
  "mountain",
  "feather",
  "ghost",
  "puzzle",
  "lightbulb",
  "music",
  "palette",
  "brush",
  "anchor",
  "ship",
  "gift",
  "eye",
  "hexagon",
] as const;

/** One accent color preset for a built-in glyph — a quick pick alongside the
 *  custom color input. `value` is the concrete hex stored in the icon key. */
export interface BuiltinColor {
  key: string;
  value: string;
}

/** Quick-pick accent palette (readable in light *and* dark themes). The picker
 *  also offers a "default" (no color) and a fully custom color. */
export const BUILTIN_COLORS: BuiltinColor[] = [
  { key: "slate", value: "#64748b" },
  { key: "red", value: "#ef4444" },
  { key: "orange", value: "#f97316" },
  { key: "amber", value: "#f59e0b" },
  { key: "yellow", value: "#eab308" },
  { key: "lime", value: "#84cc16" },
  { key: "emerald", value: "#10b981" },
  { key: "teal", value: "#14b8a6" },
  { key: "sky", value: "#0ea5e9" },
  { key: "blue", value: "#3b82f6" },
  { key: "indigo", value: "#6366f1" },
  { key: "violet", value: "#8b5cf6" },
  { key: "fuchsia", value: "#d946ef" },
  { key: "rose", value: "#f43f5e" },
];

/** Legacy named color keys (the original small palette). Values persisted as
 *  `builtin:name~amber` before colors moved to inline hex still resolve. */
const LEGACY_COLOR_HEX: Record<string, string> = {
  amber: "#f59e0b",
  orange: "#f97316",
  rose: "#f43f5e",
  violet: "#8b5cf6",
  sky: "#0ea5e9",
  emerald: "#10b981",
};

const BUILTIN_PREFIX = "builtin:";

/** Build a built-in icon value from a glyph name + optional color (a hex like
 *  `#f59e0b`, or null/""/"default" for no color). */
export function buildBuiltinIcon(name: string, color?: string | null): string {
  return color && color !== "default"
    ? `${BUILTIN_PREFIX}${name}~${color}`
    : `${BUILTIN_PREFIX}${name}`;
}

/** Whether an icon value is a built-in glyph key (vs a custom image). */
export function isBuiltinIcon(value?: string | null): boolean {
  return !!value && value.startsWith(BUILTIN_PREFIX);
}

/** Parse a `builtin:<name>[~<color>]` value into its glyph name + resolved color
 *  hex (pure — does not validate that `name` is a known glyph; the registry does
 *  that). `color` is a hex string or null. Returns null when the value isn't a
 *  built-in key. */
export function parseBuiltinKey(
  value?: string | null,
): { name: string; color: string | null } | null {
  if (!isBuiltinIcon(value)) return null;
  const body = value!.slice(BUILTIN_PREFIX.length);
  const [name, token = ""] = body.split("~");
  if (!name) return null;
  let color: string | null = null;
  if (token && token !== "default") {
    color = token.startsWith("#") ? token : (LEGACY_COLOR_HEX[token] ?? null);
  }
  return { name, color };
}
