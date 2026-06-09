/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import { DEFAULT_LAN_PORT, DEFAULT_RELAY_URL, type AgentId } from '@uxnan/shared';

/**
 * Headless permission posture for agents that gate tool use (e.g. Claude Code):
 *  - `default`           → no flag (tools needing approval are auto-denied headless);
 *  - `acceptEdits`       → file edits auto-apply, other tools stay gated;
 *  - `bypassPermissions` → all tools run without approval (full autonomy).
 */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/**
 * An explicit model to surface in the phone's model picker, declared in config.
 *
 * Use this to pin concrete, versioned models alongside an agent's own
 * auto-updating aliases — e.g. for Claude Code, the `opus`/`sonnet`/`haiku`
 * aliases always track the latest, and pinning `claude-opus-4-7` here adds an
 * older-but-available version to the picker. `id` is passed verbatim to the
 * CLI's `--model`/`-m` flag.
 */
export interface AgentModelSpec {
  /** Exact model id passed to the agent (e.g. `claude-opus-4-8`). */
  id: string;
  /** Human-facing label shown in the picker (defaults to `id`). */
  displayName?: string;
  /** Optional one-line description shown under the label. */
  description?: string;
}

/** Per-agent overrides (binary location + default model + permissions). */
export interface AgentSettings {
  /** Absolute path to the agent CLI/binary; resolved from PATH/standard locations when omitted. */
  binaryPath?: string;
  /** Default model the agent uses (e.g. `provider/model` for OpenCode). */
  model?: string;
  /**
   * Extra explicit models to show in the picker **in addition** to the ones the
   * agent reports itself. For Claude Code (which exposes only the moving
   * `opus`/`sonnet`/`haiku` aliases), this is how you pin concrete versions
   * (e.g. `claude-opus-4-7`) so users can deliberately select an older model.
   * Entries may be a bare id string or an {@link AgentModelSpec}. Currently
   * consumed by the Claude Code adapter; ignored by agents that enumerate their
   * own models (OpenCode, Codex).
   */
  models?: (string | AgentModelSpec)[];
  /**
   * Headless permission posture for agents that support it (Claude Code).
   * Defaults to `acceptEdits` when omitted. Ignored by agents that don't gate tools.
   */
  permissionMode?: AgentPermissionMode;
}

export interface DaemonConfig {
  relayUrl: string;
  /**
   * Use a relay as an off-LAN fallback. **Default `false`** — the bridge is
   * LAN/Tailscale-direct out of the box (no hosting), and the pairing QR
   * advertises only the direct `hosts` (see {@link lanEnabled}). The relay is
   * **optional and self-hosted**: set `true` (and point {@link relayUrl} at your
   * own relay) to also fall back through it for users who don't run a mesh VPN.
   * See `docs/connectivity.md` and `relay/docs/deploy.md`.
   */
  relayEnabled: boolean;
  lanEnabled: boolean;
  lanPort: number;
  pushEnabled: boolean;
  pushOnAgentDone: boolean;
  pushOnAgentError: boolean;
  autoReconnect: boolean;
  maxConcurrentSessions: number;
  sessionTimeoutMinutes: number;
  /** Agent the bridge uses when a thread does not pick one. */
  defaultAgent: AgentId;
  /**
   * Absolute project directories the phone may open. Empty → the bridge's own
   * working directory is exposed as the single project.
   */
  workspaceRoots: string[];
  /**
   * Absolute base directories the phone may BROWSE under via `workspace/browseDirs`
   * (descend into sub-folders, pick any directory as a thread's cwd) without
   * escaping the root. Empty → falls back to {@link workspaceRoots}, then the
   * user's home directory. Set this to e.g. your `Documents` folder.
   */
  browseRoots: string[];
  /** Per-agent settings keyed by {@link AgentId}. */
  agents: Partial<Record<AgentId, AgentSettings>>;
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  relayUrl: DEFAULT_RELAY_URL,
  // Relay is optional + self-hosted; off by default (LAN/Tailscale-direct).
  relayEnabled: false,
  lanEnabled: true,
  lanPort: DEFAULT_LAN_PORT,
  pushEnabled: true,
  pushOnAgentDone: true,
  pushOnAgentError: true,
  autoReconnect: true,
  maxConcurrentSessions: 1,
  sessionTimeoutMinutes: 30,
  defaultAgent: 'opencode',
  workspaceRoots: [],
  browseRoots: [],
  // Seed Claude Code with a few concrete, currently-available versions so the
  // picker shows exact models out of the box, alongside the auto-updating
  // `opus`/`sonnet`/`haiku` aliases. Curate this list as models are released or
  // retired — the aliases always cover "latest" regardless. See docs/agents.md.
  agents: {
    'claude-code': {
      models: [
        { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
        { id: 'claude-opus-4-7', displayName: 'Opus 4.7' },
        { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
      ],
    },
  },
};

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  const merged = { ...DEFAULT_DAEMON_CONFIG, ...(partial ?? {}) };
  // Deep-merge per-agent settings so a partial override (e.g. setting just
  // `permissionMode` for one agent) preserves seeded defaults like Claude
  // Code's `models` rather than wiping the whole agents map. Set an explicit
  // empty value (e.g. `models: []`) to clear a seeded default.
  const ids = new Set<string>([
    ...Object.keys(DEFAULT_DAEMON_CONFIG.agents),
    ...Object.keys(partial?.agents ?? {}),
  ]);
  const agents: Partial<Record<AgentId, AgentSettings>> = {};
  for (const id of ids) {
    const key = id as AgentId;
    agents[key] = {
      ...DEFAULT_DAEMON_CONFIG.agents[key],
      ...(partial?.agents?.[key] ?? {}),
    };
  }
  merged.agents = agents;
  return merged;
}
