// Catalog of AI providers whose plan limits the bridge reads (Settings →
// Providers). Mirrors the Agents catalog pattern: the whole list is shown, the
// bridge's agent list says which are installed, and the user activates the
// ones they want — only activated providers are ever polled.
//
// Every provider is asked of its own CLI, which answers for the account it is
// signed in to — Copilot through GitHub's CLI (`gh`) — so neither the bridge
// nor this app reads a credential. Logos reuse the bundled agent marks (see
// `agentIconSources`), falling back to a product favicon. Posture: never
// cookies, never pasted keys, never a stored token.

import type { UsageProvider, UsageStatusBarPick, UsageWindow } from "./types";

export interface UsageCatalogProvider {
  /** Stable id (the wire contract's `UsageProvider`). */
  id: UsageProvider;
  /** The bridge agent it belongs to, whose availability says it is installed
   *  (none for Copilot: `gh` is not an agent the bridge drives). */
  agentId?: string;
  /** Display name with correct casing. */
  name: string;
  /** The CLI the bridge asks for this provider's limits (Settings names it). */
  cli: string;
  /** The agent routes through many providers, so its chats do not run on
   *  this plan by default (OpenCode: only its Go models count against Go). */
  multiProvider?: boolean;
  /** Logo key — reuses the bundled agent SVG under `static/agents/<logo>.svg`. */
  logo: string;
  /** Favicon domain fallback when no bundled SVG resolves. */
  favicon?: string;
}

export const USAGE_CATALOG: UsageCatalogProvider[] = [
  { id: "codex", name: "Codex", cli: "Codex", agentId: "codex", logo: "codex", favicon: "openai.com" },
  { id: "claude", name: "Claude Code", cli: "Claude Code", agentId: "claude-code", logo: "claudecode", favicon: "claude.ai" },
  { id: "copilot", name: "GitHub Copilot", cli: "GitHub CLI (gh)", logo: "copilot", favicon: "github.com" },
  { id: "grok", name: "Grok", cli: "Grok", agentId: "grok", logo: "grok", favicon: "x.ai" },
  { id: "antigravity", name: "Antigravity", cli: "Antigravity (agy)", agentId: "antigravity-cli", logo: "antigravity", favicon: "antigravity.google" },
  { id: "opencode", name: "OpenCode", cli: "OpenCode", agentId: "opencode", logo: "opencode", favicon: "opencode.ai", multiProvider: true },
];

export function usageProvider(id: UsageProvider): UsageCatalogProvider | undefined {
  return USAGE_CATALOG.find((p) => p.id === id);
}

/** The plan a bridge agent's usage counts against, when one is read. */
export function usageProviderForAgent(agentId: string | undefined): UsageCatalogProvider | undefined {
  return agentId ? USAGE_CATALOG.find((p) => p.agentId === agentId && !p.multiProvider) : undefined;
}

/** The providers a user can activate. */
export function activatableUsageProviders(): UsageCatalogProvider[] {
  return USAGE_CATALOG;
}

/** Status-bar defaults when a provider first activates: surface its primary
 *  %-bar. The `windows: ["*"]` sentinel means "the first window", resolved to a
 *  concrete id once real data arrives (see `resolveStatusBarWindows`). */
export function defaultStatusBarPick(): UsageStatusBarPick {
  return { show: true, windows: ["*"] };
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
