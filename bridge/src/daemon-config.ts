/**
 * Daemon configuration shape and defaults.
 *
 * Source: uxnandesktop/architecture/02e-bridge-integration.md §6.1.
 */
import { DEFAULT_LAN_PORT, DEFAULT_RELAY_URL, type AgentConfig, type AgentId } from '@uxnan/shared';

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
   * Extra explicit models to show in the picker, **added on top of** the
   * project's built-in (seeded) list — the two are UNION-ed by id at load time
   * (see `mergeAgentModels`), so the built-in list always stays current with the
   * app and your entries extend/override it. For Claude Code (which exposes only
   * the moving `opus`/`sonnet`/`haiku` aliases) this is how you pin an extra
   * concrete version; a same-id entry overrides the seed's `displayName`.
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
  /**
   * Opt-in interactive tool approvals (Claude Code and Gemini CLI): inject a
   * pre-tool hook (Claude's `PreToolUse`, Gemini's `BeforeTool`) so every tool
   * round-trips to the bridge and the user approves/rejects it on the phone
   * (`turn/send { approvalResponse }`). Requires `lanEnabled` (the hook calls the
   * bridge's local HTTP endpoint). Default false.
   */
  interactiveApprovals?: boolean;
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
  /**
   * Advertise the bridge on the LAN via mDNS/Bonjour (`_uxnan._tcp`) so the phone
   * can discover it for manual-code pairing without typing the host. **Default
   * `true`**; only effective when {@link lanEnabled}. Best-effort — a failed bind
   * (port 5353 busy) degrades silently.
   */
  mdnsEnabled: boolean;
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
  relayUrl: DEFAULT_RELAY_URL,
  // Relay is optional + self-hosted; off by default (LAN/Tailscale-direct).
  relayEnabled: false,
  lanEnabled: true,
  lanPort: DEFAULT_LAN_PORT,
  mdnsEnabled: true,
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
  projectAgents: [],
  // Seed Claude Code with a few concrete, currently-available versions so the
  // picker shows exact models out of the box, alongside the auto-updating
  // `opus`/`sonnet`/`haiku` aliases. Curate this list as models are released or
  // retired — the aliases always cover "latest" regardless. See docs/agents.md.
  agents: {
    'claude-code': {
      models: [
        { id: 'claude-fable-5', displayName: 'Fable 5' },
        { id: 'claude-opus-4-8', displayName: 'Opus 4.8' },
        { id: 'claude-opus-4-7', displayName: 'Opus 4.7' },
        { id: 'claude-sonnet-5', displayName: 'Sonnet 5' },
        { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' },
        { id: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
      ],
    },
  },
};

/** The id of a `models` entry (bare string or {@link AgentModelSpec}). */
function modelId(entry: string | AgentModelSpec): string {
  return (typeof entry === 'string' ? entry : entry.id).trim();
}

/**
 * Union the built-in (seeded) `models` with the user's, deduped by id.
 *
 * The **built-in list is a live baseline from code** (not frozen on disk): a new
 * app version that adds a model to the seed surfaces it for every install,
 * without the user editing their config. The user's entries are treated as
 * additions/overrides — a new id is appended, and an id that collides with a
 * seed entry replaces it (so a custom `displayName` wins) while keeping the
 * seed's position. Returns `undefined` when neither side has any (so the field
 * stays absent rather than an empty array).
 */
export function mergeAgentModels(
  seed?: (string | AgentModelSpec)[],
  user?: (string | AgentModelSpec)[],
): (string | AgentModelSpec)[] | undefined {
  if (!seed?.length && !user?.length) return undefined;
  const order: string[] = [];
  const byId = new Map<string, string | AgentModelSpec>();
  for (const entry of [...(seed ?? []), ...(user ?? [])]) {
    const id = modelId(entry);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, entry); // later (user) entry wins on a collision
  }
  return order.length > 0 ? order.map((id) => byId.get(id)!) : undefined;
}

/** Merge a partial (e.g. loaded from disk) over the defaults. */
export function resolveDaemonConfig(partial?: Partial<DaemonConfig> | null): DaemonConfig {
  const merged = { ...DEFAULT_DAEMON_CONFIG, ...(partial ?? {}) };
  // Deep-merge per-agent settings so a partial override (e.g. setting just
  // `permissionMode` for one agent) preserves seeded defaults rather than wiping
  // the whole agents map. `models` is special: the seeded list is a live
  // baseline from code, UNION-ed with the user's entries (see
  // `mergeAgentModels`), so new seeded models reach existing installs
  // automatically — a persisted (possibly stale) `models` never shadows them.
  const ids = new Set<string>([
    ...Object.keys(DEFAULT_DAEMON_CONFIG.agents),
    ...Object.keys(partial?.agents ?? {}),
  ]);
  const agents: Partial<Record<AgentId, AgentSettings>> = {};
  for (const id of ids) {
    const key = id as AgentId;
    const settings: AgentSettings = {
      ...DEFAULT_DAEMON_CONFIG.agents[key],
      ...(partial?.agents?.[key] ?? {}),
    };
    const models = mergeAgentModels(
      DEFAULT_DAEMON_CONFIG.agents[key]?.models,
      partial?.agents?.[key]?.models,
    );
    if (models) settings.models = models;
    else delete settings.models;
    agents[key] = settings;
  }
  merged.agents = agents;
  return merged;
}
