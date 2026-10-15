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
 * A CLI that *moves* while the bridge runs gets its adapter rebuilt at the new
 * path (the availability did not change, so nothing is announced).
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
   *
   * The adapter is rebuilt whenever the command it must spawn differs from the
   * one it was built with — the CLI appeared, or moved elsewhere (npm global →
   * `~/.local/bin`, a launcher → the bare name) — so no adapter keeps spawning
   * a path that is gone. A move alone announces nothing and does not return
   * `true`: the agent list the clients hold (which agents are installed) did
   * not change, only the path behind one of them, and they read that path from
   * {@link located} / `agent/doctor` on their next request. Only an
   * availability flip notifies and returns `true`.
   *
   * Nothing is swapped while the agent has a turn running
   * ({@link AgentManager.hasActiveWork}): the adapter running that turn keeps
   * serving it, and `entry.located` still holds the command that adapter was
   * built with — it is only written once the rebuild happened — so the next
   * refresh sees the same difference again and retries until the turn is done.
   */
  refresh(force = false): boolean {
    const now = this.#now();
    if (!force && now - this.#checkedAt < REFRESH_TTL_MS) return false;
    this.#checkedAt = now;
    let changed = false;
    for (const entry of this.#entries.values()) {
      const located = this.#locate(entry.spec.agentId, entry.spec.configuredPath);
      const was = entry.located;
      const availabilityChanged = located.available !== was.available;
      const moved =
        located.binaryPath !== was.binaryPath ||
        located.prependArgs.join('\0') !== was.prependArgs.join('\0');
      // Nothing to do: still the same availability, and either the same
      // command or a CLI nobody can run anyway.
      if (!availabilityChanged && !(moved && located.available)) continue;
      if (!located.available) {
        // Gone: there is no adapter to build. A running turn keeps its own
        // process, and every client hears that the agent became unavailable.
        this.#manager.setAvailable(entry.spec.agentId, false);
        entry.located = located;
        changed = true;
        continue;
      }
      // Installed or moved: built for where the CLI really is (an npm entry is
      // run through node, not the bare name) — unless a turn is running on the
      // adapter it would replace, in which case nothing is recorded and the
      // next refresh retries.
      if (this.#manager.hasActiveWork(entry.spec.agentId)) continue;
      this.#manager.register(entry.spec.create(located), {
        displayName: entry.spec.displayName,
        available: true,
        ...(entry.spec.defaultModel !== undefined ? { defaultModel: entry.spec.defaultModel } : {}),
      });
      entry.located = located;
      if (availabilityChanged) changed = true;
      entry.spec.whenAvailable?.(located);
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
