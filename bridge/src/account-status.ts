/**
 * Sanitized account/auth status per agent (architecture/02a §5.8.9).
 *
 * Reports whether an agent's CLI looks logged in on this PC WITHOUT ever reading
 * or exposing tokens/keys: detection is by **existence only** of each agent's
 * well-known auth file (never its contents), and the response carries only the
 * agent id, booleans, the public provider name, the transport mode and the OS
 * platform. There is intentionally no `displayName` — deriving it would mean
 * reading an account/credentials file, which may hold secrets.
 *
 * Heuristic, not authoritative: an installed-but-logged-out CLI whose auth file
 * is absent reports `requiresLogin: true`; an agent we have no auth-file mapping
 * for falls back to its binary availability. FOR-DEV: for an authoritative
 * answer, run the agent CLI's own auth/whoami command (out of MVP scope — it is
 * slower and per-CLI).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import type { AgentId, AuthStatus } from '@uxnan/shared';

/** Public provider name surfaced per agent (never a secret). */
const PROVIDER_BY_AGENT: Partial<Record<AgentId, string>> = {
  codex: 'openai',
  'claude-code': 'anthropic',
  opencode: 'opencode',
  grok: 'xai',
};

/**
 * Auth-presence files per agent, relative to the user's home. EXISTENCE is the
 * only signal read — contents (which hold the token) are never opened. Multiple
 * candidates cover platform/version differences; the first that exists wins.
 */
const AUTH_FILES: Partial<Record<AgentId, string[]>> = {
  codex: ['.codex/auth.json'],
  'claude-code': ['.claude/.credentials.json', '.claude.json'],
  opencode: ['.local/share/opencode/auth.json', '.config/opencode/auth.json'],
  // pi stores per-provider credentials (OAuth/API keys) in one auth file; its
  // existence means at least one provider is logged in. pi is multi-provider, so
  // no single public provider name is surfaced.
  'pi-agent': ['.pi/agent/auth.json'],
  // Grok caches its xAI token at ~/.grok/auth.json (its existence means signed in).
  grok: ['.grok/auth.json'],
};

export interface AccountStatusDeps {
  /** Whether the agent's binary resolved (from the AgentManager). */
  isAvailable(agentId: AgentId): boolean;
  /** Injectable home dir (defaults to the OS home) — for tests. */
  homeDir?: string;
  /** Injectable existence check (defaults to fs `access`) — for tests. */
  fileExists?: (path: string) => Promise<boolean>;
  /** Injectable platform (defaults to `process.platform`) — for tests. */
  platform?: NodeJS.Platform | string;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Build the sanitized {@link AuthStatus} for one agent. */
export async function getAuthStatus(
  agentId: AgentId,
  deps: AccountStatusDeps,
): Promise<AuthStatus> {
  const available = deps.isAvailable(agentId);
  const provider = PROVIDER_BY_AGENT[agentId];
  const authFiles = AUTH_FILES[agentId] ?? [];

  let authenticated = false;
  if (available && authFiles.length > 0) {
    const home = deps.homeDir ?? homedir();
    const exists = deps.fileExists ?? defaultExists;
    for (const relative of authFiles) {
      if (await exists(join(home, relative))) {
        authenticated = true;
        break;
      }
    }
  }

  // No binary → must be set up on the PC. Binary present with an auth-file
  // mapping → trust the existence check. Binary present without a mapping →
  // assume usable (we can't cheaply tell, and blocking would be wrong).
  const requiresLogin = available ? (authFiles.length > 0 ? !authenticated : false) : true;

  return {
    agentId,
    requiresLogin,
    loginInProgress: false,
    ...(provider !== undefined && authenticated ? { authenticatedProvider: provider } : {}),
    transportMode: 'local',
    platform: deps.platform ?? process.platform,
  };
}
