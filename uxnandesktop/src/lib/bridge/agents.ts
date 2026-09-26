// The bridge names its agents by contract id (`AgentId` in `shared/`); the
// desktop's catalog keys its logos by its own ids. This is the one place the
// two spellings meet, so a chat shows the same mark as a terminal tab running
// the same CLI.

import type { AgentId } from '$shared/agents/agent-capabilities';

/** Bridge agent id → desktop catalog logo key (`agentCatalog.ts`). */
const LOGO_BY_AGENT: Record<AgentId, string | null> = {
  'claude-code': 'claudecode',
  codex: 'codex',
  opencode: 'opencode',
  'pi-agent': 'pi',
  'antigravity-cli': 'antigravity',
  zero: 'zero',
  grok: 'grok',
  // The bridge's built-in development echo agent has no mark.
  echo: null,
};

/** The logo key for a bridge agent, or null for one the desktop has no mark for. */
export function bridgeAgentLogo(agentId: string | null | undefined): string | null {
  if (!agentId) return null;
  return (LOGO_BY_AGENT as Record<string, string | null>)[agentId] ?? null;
}

/** Whether a chat can offer this agent: the bridge's development echo agent is
 *  hidden, as the phone hides it. */
export function isUserFacingAgent(agentId: string): boolean {
  return agentId !== 'echo';
}

/** Desktop agent executable (a profile's `command`) → bridge agent id, for the
 *  seven CLIs the bridge drives. Anything else has no chat equivalent. */
const AGENT_BY_COMMAND: Record<string, AgentId> = {
  claude: 'claude-code',
  codex: 'codex',
  opencode: 'opencode',
  pi: 'pi-agent',
  agy: 'antigravity-cli',
  antigravity: 'antigravity-cli',
  zero: 'zero',
  grok: 'grok',
};

/** The bridge agent a desktop agent profile runs, by its executable (a path or
 *  a bare name, with or without a Windows extension). */
export function bridgeAgentForCommand(command: string | null | undefined): AgentId | null {
  if (!command) return null;
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  const name = base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase();
  return AGENT_BY_COMMAND[name] ?? null;
}
