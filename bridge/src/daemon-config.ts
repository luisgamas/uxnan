/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import {
  DEFAULT_LAN_PORT,
  isRelayId,
  type AgentConfig,
  type AgentId,
  type RelayEndpoint,
} from '@uxnan/shared';

/**
 * Headless permission posture for agents that gate tool use (e.g. Claude Code):
 *  - `default`           → no flag (tools needing approval are auto-denied headless);
 *  - `acceptEdits`       → file edits auto-apply, other tools stay gated;
 *  - `bypassPermissions` → all tools run without approval (full autonomy).
 */
export type AgentPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

/**
 * Where the bridge puts a worktree it places itself. The layout lives in
 * `git/worktree-location.ts`, mirroring the desktop's `worktreeloc.rs`; this is
 * only the choice of it.
 */
export interface WorktreesConfig {
  location: 'managed' | 'sibling' | 'custom';
  /** Absolute root for `custom`; ignored by the other modes. */
  root?: string;
}

/**
 * An explicit model to surface in the phone's model picker, declared in config.
 *
 * Use this to add a model the agent's CLI does not list for the account yet
 * but accepts — Claude Code's picker is otherwise exactly what its
 * `initialize` reports. `id` is passed verbatim to the CLI's `--model`/`-m`
 * flag.
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
   * Extra explicit models to show in the picker, **added after** the ones the
   * agent's CLI reports. An id the CLI already lists keeps the CLI's entry.
   * Entries may be a bare id string or an {@link AgentModelSpec}. Currently
   * consumed by the Claude Code adapter; ignored by the agents whose pickers
   * take nothing but their CLI's list (OpenCode, Codex, pi, Antigravity, Zero
   * and Grok).
   */
  models?: (string | AgentModelSpec)[];
  /**
   * The posture an agent with no access modes to choose from runs in — pi and
   * Antigravity. Every other agent runs in the conversation's access mode.
   */
  permissionMode?: AgentPermissionMode;
}

export interface DaemonConfig {
  /**
   * The user's own relay — how phones reach this bridge from another network.
   * **Absent by default**: the bridge is LAN/Tailscale-direct out of the box.
   * Set by `relay/setup` (the bridge deploys it into the user's Cloudflare
   * account) or `relay/use`, and shared with every client as
   * `BridgeSettings.relay`. See `docs/connectivity.md`.
   */
  relay?: RelayEndpoint;
  lanEnabled: boolean;
  lanPort: number;
  /**
   * Advertise the bridge on the LAN via mDNS/Bonjour (`_uxnan._tcp`) so the phone
   * can discover it for manual-code pairing without typing the host. **Default
   * `true`**; only effective when {@link lanEnabled}. The advertiser joins and
   * emits on every eligible IPv4 interface so multi-homed hosts do not depend on
   * the OS multicast route. Best-effort — a failed bind/membership degrades to
   * QR or typed-host pairing.
   */
  mdnsEnabled: boolean;
  /**
   * Serve the local control channel (architecture/02a §5.8.15): a WebSocket
   * listener bound to `127.0.0.1` only, on a free port, whose address and
   * token the bridge writes to `~/.uxnan/local-control.json` (owner-only). It
   * is how Uxnan Desktop on the same machine drives the bridge's conversations
   * next to the phone. **Default `true`**; loopback-only and token-gated, and
   * it costs one idle socket. Only `uxnan-bridge start` opens it.
   */
  localControlEnabled: boolean;
  pushEnabled: boolean;
  pushOnAgentDone: boolean;
  pushOnAgentError: boolean;
  autoReconnect: boolean;
  maxConcurrentSessions: number;
  sessionTimeoutMinutes: number;
  /** Agent the bridge uses when a thread does not pick one. */
  defaultAgent: AgentId;
  /**
   * Keep at most N newest workspace checkpoints per project (`cwd`); older ones
   * are pruned (ref + metadata) on the next capture. `0` = unlimited.
   */
  checkpointMaxPerProject: number;
  /** Delete workspace checkpoints older than N days on capture. `0` = no TTL. */
  checkpointTtlDays: number;
  /**
   * Absolute project directories the phone may open. Empty → the bridge's own
   * working directory is exposed as the single project.
   */
  workspaceRoots: string[];
  /**
   * Absolute base directories the phone may BROWSE under via `workspace/browseDirs`
   * (descend into sub-folders, pick any directory as a thread's cwd) without
   * escaping the root. Empty → falls back to {@link workspaceRoots}, then the
   * bridge's launch directory (`process.cwd()`) — so an unconfigured install
   * browses from wherever the bridge was started. Set this to e.g. your
   * `Documents` folder.
   */
  browseRoots: string[];
  /**
   * The bridge's start folder (shared setting `home`, architecture/02a
   * §5.8.17): where exploring for a new project begins and the boundary a phone
   * may register projects under — whatever directory `start` ran in. Absent →
   * the user's home directory. Edited with `uxnan-bridge config set home
   * <path>` or from any client (`settings/set`), which keep it here.
   */
  home?: string;
  /**
   * What every client calls this PC (shared setting `name`, architecture/02a
   * §5.8.17). Absent → the machine's own name. Edited with `uxnan-bridge
   * config set name <name>` or from any client (`settings/set`).
   */
  name?: string;
  /**
   * Where `git/createWorktree` puts a worktree when the client does not name a
   * path. Mirrors the desktop's Settings → Git so one repository's checkouts
   * stay grouped in one place no matter which app created them:
   * - `managed` (default) → `<home>/uxnan/worktrees/<repo>/<branch>`;
   * - `sibling` → `<parent>/<repo>--<branch>` (the pre-managed layout);
   * - `custom` → the managed layout under {@link WorktreesConfig.root}.
   */
  worktrees: WorktreesConfig;
  /** Per-agent settings keyed by {@link AgentId}. */
  agents: Partial<Record<AgentId, AgentSettings>>;
  /**
   * Per-project agent/model pins, identified by each entry's absolute `cwd`
   * (the project directory). When a thread starts in a project (or browsed
   * folder) whose path matches an entry and the phone did NOT pass an explicit
   * `agentId`/`model`, the bridge uses the pinned `agentId` (and `model`, when it
   * matches that agent). Lets a repo always open with e.g. Codex without the
   * phone choosing each time. Reuses the shared {@link AgentConfig}; only
   * `cwd`/`agentId`/`model` are consumed today (binaryPath/extraArgs are not yet
   * wired — see FOR-DEV.md).
   */
  projectAgents: AgentConfig[];
}

export const DEFAULT_DAEMON_CONFIG: DaemonConfig = {
  lanEnabled: true,
  lanPort: DEFAULT_LAN_PORT,
  mdnsEnabled: true,
  localControlEnabled: true,
  pushEnabled: true,
  pushOnAgentDone: true,
  pushOnAgentError: true,
  autoReconnect: true,
  maxConcurrentSessions: 1,
  sessionTimeoutMinutes: 30,
  defaultAgent: 'opencode',
  checkpointMaxPerProject: 25,
  checkpointTtlDays: 0,
  workspaceRoots: [],
  browseRoots: [],
  worktrees: { location: 'managed' },
  projectAgents: [],
  agents: {},
};

/**
 * Every Claude Code model the bridge used to seed into `agents.claude-code.models`
 * from code, exactly as it wrote them. Upgrade-only cleanup: a bridge before
 * 0.0.49 merged that seed into the config it read, so any later `writeConfig`
 * froze it to disk, where it now reads as models the user pinned — duplicating
 * what Claude Code's own `initialize` lists. An entry identical to one of these
 * (same id, same label, nothing else) was written by Uxnan and is dropped; a
 * model the user pinned themselves (a bare id, another label, a description)
 * is kept. Never extended: models come from the CLI now.
 */
const RETIRED_CLAUDE_SEED: ReadonlyMap<string, string> = new Map([
  ['claude-fable-5-1', 'Fable 5.1'],
  ['claude-fable-5', 'Fable 5'],
  ['claude-opus-5-5', 'Opus 5.5'],
  ['claude-opus-5', 'Opus 5'],
  ['claude-opus-4-8', 'Opus 4.8'],
  ['claude-opus-4-7', 'Opus 4.7'],
  ['claude-opus-4-6', 'Opus 4.6'],
  ['claude-opus-4-5', 'Opus 4.5'],
  ['claude-sonnet-5-5', 'Sonnet 5.5'],
  ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-sonnet-4-6', 'Sonnet 4.6'],
  ['claude-sonnet-4-5', 'Sonnet 4.5'],
  ['claude-haiku-5-5', 'Haiku 5.5'],
  ['claude-haiku-4-5', 'Haiku 4.5'],
]);

/** Whether a `models` entry is a frozen copy of the retired seed (see above). */
function isRetiredSeedEntry(entry: string | AgentModelSpec): boolean {
  if (typeof entry === 'string') return false;
  const fields = Object.entries(entry).filter(([, value]) => value !== undefined);
  return (
    fields.every(([key]) => key === 'id' || key === 'displayName') &&
    RETIRED_CLAUDE_SEED.get(entry.id) === entry.displayName
  );
}

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  // Treat persisted configuration as untrusted input: older releases could
  // store the retired `gemini-cli` id even though it is no longer part of the
  // shared AgentId contract. Normalize only that known tombstone and preserve
  // every active/custom setting verbatim.
  const raw = (partial ?? {}) as Omit<
    Partial<DaemonConfig>,
    'defaultAgent' | 'agents' | 'projectAgents'
  > & {
    defaultAgent?: AgentId | 'gemini-cli';
    agents?: Record<string, AgentSettings>;
    projectAgents?: Array<Omit<AgentConfig, 'agentId'> & { agentId: AgentId | 'gemini-cli' }>;
  };
  const merged = { ...DEFAULT_DAEMON_CONFIG, ...raw } as DaemonConfig;
  // The relay used to be a bare URL plus a switch. Both are retired (there is
  // no shared relay to point at); a relay is now an endpoint the bridge set up.
  const retired = merged as DaemonConfig & { relayUrl?: unknown; relayEnabled?: unknown };
  delete retired.relayUrl;
  delete retired.relayEnabled;
  if (merged.relay !== undefined && !isRelayEndpoint(merged.relay)) delete merged.relay;
  if ((raw.defaultAgent as string | undefined) === 'gemini-cli') {
    merged.defaultAgent = DEFAULT_DAEMON_CONFIG.defaultAgent;
  }
  merged.projectAgents = (raw.projectAgents ?? DEFAULT_DAEMON_CONFIG.projectAgents).filter(
    (entry): entry is AgentConfig => (entry.agentId as string) !== 'gemini-cli',
  );
  // Deep-merge per-agent settings so a partial override (e.g. setting just
  // `permissionMode` for one agent) preserves any defaults rather than wiping
  // the whole agents map.
  const ids = new Set<string>([
    ...Object.keys(DEFAULT_DAEMON_CONFIG.agents),
    ...Object.keys(raw.agents ?? {}).filter((id) => id !== 'gemini-cli'),
  ]);
  const agents: Partial<Record<AgentId, AgentSettings>> = {};
  for (const id of ids) {
    const key = id as AgentId;
    const settings: AgentSettings = {
      ...DEFAULT_DAEMON_CONFIG.agents[key],
      ...(raw.agents?.[key] ?? {}),
    };
    if (key === 'claude-code' && settings.models) {
      const kept = settings.models.filter((entry) => !isRetiredSeedEntry(entry));
      if (kept.length > 0) settings.models = kept;
      else delete settings.models;
    }
    agents[key] = settings;
  }
  merged.agents = agents;
  return merged;
}

function isRelayEndpoint(value: unknown): value is RelayEndpoint {
  if (typeof value !== 'object' || value === null) return false;
  const relay = value as Record<string, unknown>;
  return (
    typeof relay['url'] === 'string' &&
    /^wss?:\/\/[^/\s]+$/.test(relay['url']) &&
    isRelayId(relay['routingId']) &&
    typeof relay['enabled'] === 'boolean'
  );
}
