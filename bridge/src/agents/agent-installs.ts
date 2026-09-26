/**
 * Which agent CLIs are installed, kept true while the bridge runs.
 *
 * Every agent is found with the ONE rule shared with Uxnan Desktop
 * (`@uxnan/shared` → `locateAgent`, table `agent-locations.json`), so the phone,
 * the desktop's chat and the desktop's terminals agree on what is installed.
 *
 * Detection is not a startup-only snapshot any more: an agent installed while
 * the bridge runs is picked up the next time a client asks for the agent list
 * (at most every {@link REFRESH_TTL_MS}), its adapter is created then with the
 * path it was actually found at, and every client hears about it
 * (`stream/agents/updated`). An agent that disappears is reported unavailable.
 */
import {
  agentLocation,
  locateAgent,
  type AgentDiagnosis,
  type AgentId,
  type IAgentAdapter,
  type LocatedAgent,
} from '@uxnan/shared';
import type { AgentManager } from './agent-manager.js';

/** How often an agent list request may re-check the disk. */
export const REFRESH_TTL_MS = 10_000;

export interface InstalledAgentSpec {
  agentId: AgentId;
  displayName: string;
  /** A path the user configured (`agents.<id>.binaryPath`); always wins. */
  configuredPath?: string;
  defaultModel?: string;
  /** Build the adapter for the CLI where it was found. */
  create(located: LocatedAgent): IAgentAdapter;
  /** Run once the CLI is found — at registration, or when it appears later. */
  whenAvailable?(located: LocatedAgent): void;
}

interface Entry {
  spec: InstalledAgentSpec;
  located: LocatedAgent;
}

export type Locate = (agentId: AgentId, configured?: string) => LocatedAgent;

const defaultLocate: Locate = (agentId, configured) => {
  const location = agentLocation(agentId);
  if (!location) {
    return { binaryPath: configured ?? agentId, prependArgs: [], available: false, checked: [] };
  }
  return locateAgent(location, configured);
};

export class AgentInstalls {
  readonly #manager: AgentManager;
  readonly #locate: Locate;
  readonly #now: () => number;
  readonly #entries = new Map<AgentId, Entry>();
  readonly #listeners = new Set<() => void>();
  #checkedAt = 0;

  constructor(manager: AgentManager, options: { locate?: Locate; now?: () => number } = {}) {
    this.#manager = manager;
    this.#locate = options.locate ?? defaultLocate;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Called after a refresh changed what is available. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Find the agent, build its adapter and register it. Returns the adapter. */
  register(spec: InstalledAgentSpec): IAgentAdapter {
    const located = this.#locate(spec.agentId, spec.configuredPath);
    const adapter = spec.create(located);
    this.#manager.register(adapter, {
      displayName: spec.displayName,
      available: located.available,
      ...(spec.defaultModel !== undefined ? { defaultModel: spec.defaultModel } : {}),
    });
    this.#entries.set(spec.agentId, { spec, located });
    this.#checkedAt = this.#now();
    if (located.available) spec.whenAvailable?.(located);
    return adapter;
  }

  /**
   * Re-check every agent (at most every {@link REFRESH_TTL_MS} unless
   * [force]). Returns `true` when any availability changed, after telling the
   * {@link onChange} listeners (which announce it to the clients).
   */
  refresh(force = false): boolean {
    const now = this.#now();
    if (!force && now - this.#checkedAt < REFRESH_TTL_MS) return false;
    this.#checkedAt = now;
    let changed = false;
    for (const entry of this.#entries.values()) {
      const located = this.#locate(entry.spec.agentId, entry.spec.configuredPath);
      const was = entry.located;
      entry.located = located;
      if (located.available === was.available) continue;
      changed = true;
      if (located.available && !this.#manager.hasActiveWork(entry.spec.agentId)) {
        // Installed since the adapter was built: build it again where the CLI
        // really is (an npm entry is run through node, not the bare name).
        this.#manager.register(entry.spec.create(located), {
          displayName: entry.spec.displayName,
          available: true,
          ...(entry.spec.defaultModel !== undefined
            ? { defaultModel: entry.spec.defaultModel }
            : {}),
        });
      } else {
        this.#manager.setAvailable(entry.spec.agentId, located.available);
      }
      if (located.available) entry.spec.whenAvailable?.(located);
    }
    if (changed) {
      for (const listener of this.#listeners) {
        try {
          listener();
        } catch {
          /* a listener's failure is its own */
        }
      }
    }
    return changed;
  }

  /** Where [agentId] was found, if it is registered. */
  located(agentId: AgentId): LocatedAgent | undefined {
    return this.#entries.get(agentId)?.located;
  }

  /** Where each agent was looked for and what was found. */
  diagnose(): AgentDiagnosis[] {
    return [...this.#entries.values()].map(({ spec, located }) => ({
      agentId: spec.agentId,
      available: located.available,
      ...(located.available ? { command: [located.binaryPath, ...located.prependArgs] } : {}),
      checked: located.checked,
    }));
  }
}
