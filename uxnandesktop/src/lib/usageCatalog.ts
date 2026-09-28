// Catalog of AI providers whose plan limits the bridge reads (Settings →
// Providers). Mirrors the Agents catalog pattern: the whole list is shown, the
// bridge's agent list says which are installed, and the user activates the
// ones they want — only activated providers are ever polled.
//
// Claude Code and Codex answer for their own accounts; Copilot and Grok are
// read from the token each CLI stored (→ the provider's official usage API).
// Logos reuse the bundled agent SVGs (see `agentIconSources`), falling back to
// a product favicon. Posture: never cookies, never pasted keys.

import type { UsageProvider, UsageStatusBarPick, UsageWindow } from "./types";

export interface UsageCatalogProvider {
  /** Stable id (the wire contract's `UsageProvider`). */
  id: UsageProvider;
  /** The bridge agent it belongs to, whose availability says it is installed
   *  (none for Copilot: `gh` is not an agent the bridge drives). */
  agentId?: string;
  /** Display name with correct casing. */
  name: string;
  /** Logo key — reuses the bundled agent SVG under `static/agents/<logo>.svg`. */
  logo: string;
  /** Favicon domain fallback when no bundled SVG resolves. */
  favicon?: string;
  /** Whether the provider yields a monetary/credit balance (for the UI hint). */
  hasCredit?: boolean;
  /** Whether the provider grants redeemable rate-limit resets (Codex). */
  hasResetCredits?: boolean;
}

export const USAGE_CATALOG: UsageCatalogProvider[] = [
  { id: "codex", name: "Codex", agentId: "codex", logo: "codex", favicon: "openai.com", hasCredit: true, hasResetCredits: true },
  { id: "claude", name: "Claude Code", agentId: "claude-code", logo: "claudecode", favicon: "claude.ai", hasCredit: true },
  { id: "copilot", name: "GitHub Copilot", logo: "copilot", favicon: "github.com" },
  // FOR-DEV: Antigravity is not listed here yet — `agy` answers no headless
  // usage request and keeps its token in the OS keyring. What unblocks it:
  // bridge/FOR-DEV.md → "Antigravity as a limits provider".
  { id: "grok", name: "Grok", agentId: "grok", logo: "grok", favicon: "x.ai", hasCredit: true },
];

export function usageProvider(id: UsageProvider): UsageCatalogProvider | undefined {
  return USAGE_CATALOG.find((p) => p.id === id);
}

/** The plan a bridge agent's usage counts against, when one is read. */
export function usageProviderForAgent(agentId: string | undefined): UsageCatalogProvider | undefined {
  return agentId ? USAGE_CATALOG.find((p) => p.agentId === agentId) : undefined;
}

/** The providers a user can activate. */
export function activatableUsageProviders(): UsageCatalogProvider[] {
  return USAGE_CATALOG;
}

/** Status-bar defaults when a provider first activates: surface its primary
 *  %-bar. The `windows: ["*"]` sentinel means "the first window", resolved to a
 *  concrete id once real data arrives (see `resolveStatusBarWindows`). */
export function defaultStatusBarPick(): UsageStatusBarPick {
  return { show: true, windows: ["*"], showPlan: false };
}

/** The windows a provider's saved status-bar picks surface, resolved against
 *  the windows its latest snapshot reports, in snapshot order. The one place
 *  picks are interpreted — the status-bar popup (what it shows and the icon's
 *  tint) and Settings → Providers (which checkboxes are ticked) both ask here.
 *
 *  - `"*"` means "the first window"; any other pick is a window id.
 *  - Ids that match a current window are kept; ids that do not are ignored.
 *  - Picks that match **no** current window fall back to the first window, as
 *    if `"*"`. Window ids follow what the provider reports (Codex names them by
 *    length), so they change when the plan or the reader does — a config saved
 *    against the old ids (`primary_window`, …) must not leave the row empty.
 *  - No picks at all is a deliberate "none": nothing is surfaced.
 *  - No snapshot, or one without windows, surfaces nothing. */
export function resolveStatusBarWindows(
  picks: readonly string[] | undefined,
  windows: readonly UsageWindow[] | undefined,
): UsageWindow[] {
  if (!windows || windows.length === 0 || !picks || picks.length === 0) return [];
  const wantsFirst = picks.includes("*");
  const shown = windows.filter((w, i) => (wantsFirst && i === 0) || picks.includes(w.id));
  return shown.length > 0 ? shown : [windows[0]];
}
