// Catalog of AI providers whose plan limits the bridge reads (Settings →
// Providers). Mirrors the Agents catalog pattern: the whole list is shown, the
// bridge's agent list says which are installed, and the user activates the
// ones they want — only activated providers are ever polled.
//
// Claude Code and Codex answer for their own accounts; Copilot and Grok are
// read from the token each CLI stored (→ the provider's official usage API).
// Logos reuse the bundled agent SVGs (see `agentIconSources`), falling back to
// a product favicon. Posture: never cookies, never pasted keys.

import type { UsageProvider, UsageStatusBarPick } from "./types";

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
  // FOR-DEV: Antigravity itself is not listed here yet — its quota API is the
  // same Code Assist one, but `agy` keeps its token in the OS keyring instead of
  // on disk. Findings + what unblocks it: FOR-DEV.md → "Providers".
  { id: "grok", name: "Grok", agentId: "grok", logo: "grok", favicon: "x.ai", hasCredit: true },
];

export function usageProvider(id: UsageProvider): UsageCatalogProvider | undefined {
  return USAGE_CATALOG.find((p) => p.id === id);
}

/** The providers a user can activate. */
export function activatableUsageProviders(): UsageCatalogProvider[] {
  return USAGE_CATALOG;
}

/** Status-bar defaults when a provider first activates: surface its primary
 *  %-bar. The `windows: ["*"]` sentinel means "the first window", resolved to a
 *  concrete id once real data arrives. */
export function defaultStatusBarPick(): UsageStatusBarPick {
  return { show: true, windows: ["*"], showPlan: false };
}
