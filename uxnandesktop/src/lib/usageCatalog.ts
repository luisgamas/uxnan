// Catalog of AI providers whose usage statistics we can read (Settings →
// Providers). Mirrors the Agents catalog pattern: the whole list is shown, the
// backend detects which are present on the machine, and the user activates the
// ones they want — only activated providers are ever polled.
//
// Every wired provider reads its quota from the CLI's own stored token (→ the
// provider's official usage API). Logos reuse the bundled agent SVGs (see
// `agentIconSources`), falling back to a product favicon. Posture: never
// cookies, never pasted keys.

import type { UsageProvider, UsageStatusBarPick } from "./types";

export interface UsageCatalogProvider {
  /** Stable id (matches the Rust `UsageProvider` and the wire contract). */
  id: UsageProvider;
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
  /** The provider's CLI is discontinued upstream: it is no longer offered for
   *  activation, but stays fully readable for anyone who already activated it
   *  (see {@link activatableUsageProviders}). Re-enable by dropping the flag. */
  deprecated?: boolean;
}

export const USAGE_CATALOG: UsageCatalogProvider[] = [
  { id: "codex", name: "Codex", logo: "codex", favicon: "openai.com", hasCredit: true, hasResetCredits: true },
  { id: "claude", name: "Claude Code", logo: "claudecode", favicon: "claude.ai", hasCredit: true },
  { id: "copilot", name: "GitHub Copilot", logo: "copilot", favicon: "github.com" },
  // Gemini CLI is discontinued upstream in favour of Antigravity (`agy`), so it
  // is hidden from the picker — the reader stays wired for anyone still on it.
  // FOR-DEV: Antigravity itself is not listed here yet — its quota API is the
  // same Code Assist one, but `agy` keeps its token in the OS keyring instead of
  // on disk. Findings + what unblocks it: FOR-DEV.md → "Providers".
  { id: "gemini", name: "Gemini CLI", logo: "gemini", favicon: "gemini.google.com", deprecated: true },
  { id: "grok", name: "Grok", logo: "grok", favicon: "x.ai", hasCredit: true },
];

export function usageProvider(id: UsageProvider): UsageCatalogProvider | undefined {
  return USAGE_CATALOG.find((p) => p.id === id);
}

/** The providers a user can still activate — the catalog minus the deprecated
 *  ones. Everything that renders an *already activated* provider keeps using
 *  {@link usageProvider}, so a deprecated entry never loses its name or logo. */
export function activatableUsageProviders(): UsageCatalogProvider[] {
  return USAGE_CATALOG.filter((p) => !p.deprecated);
}

/** Status-bar defaults when a provider first activates: surface its primary
 *  %-bar. The `windows: ["*"]` sentinel means "the first window", resolved to a
 *  concrete id once real data arrives. */
export function defaultStatusBarPick(): UsageStatusBarPick {
  return { show: true, windows: ["*"], showPlan: false };
}
