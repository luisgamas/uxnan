// The catalog agents found on this computer, and turning them on — one owner
// for Settings → Agents ("Add", "Add all installed") and the welcome tour's
// "Turn on your agents" step, so the two can never disagree on what is found,
// what is already set up or what a new agent profile looks like.
//
// Detection is the backend's (`agents_detect`: the shared install-location
// table plus the login-shell PATH), a live filesystem walk, so `detect()` is
// all it takes for an agent installed since the app started to appear.
// "Already set up" matches a profile's command case- and space-insensitively,
// because a profile the user typed may differ from the catalog's spelling.

import { AGENT_CATALOG, type CatalogAgent } from "$lib/agentCatalog";
import { detectAgents } from "$lib/api";
import { app } from "$lib/state/app.svelte";

/** The key two commands are the same agent by. Pure. */
export function profileKey(command: string): string {
  return command.trim().toLowerCase().replace(/\s+/g, "");
}

class CatalogAgents {
  /** Which catalog commands are installed (null = not checked yet). */
  installed = $state<Set<string> | null>(null);
  detecting = $state(false);

  /** Re-check what is on this computer now. Never throws: no backend (the
   *  plain web preview) reads as nothing found. */
  async detect(): Promise<void> {
    this.detecting = true;
    try {
      this.installed = new Set(await detectAgents(AGENT_CATALOG.map((c) => c.command)));
    } catch {
      this.installed = new Set();
    } finally {
      this.detecting = false;
    }
  }

  isInstalled(agent: CatalogAgent): boolean {
    return this.installed?.has(agent.command) ?? false;
  }

  /** An agent profile with this agent's command already exists. */
  isConfigured(agent: CatalogAgent): boolean {
    const key = profileKey(agent.command);
    return app.agentProfiles.some((p) => profileKey(p.command) === key);
  }

  /** Every installed catalog agent, in catalog order. */
  get found(): CatalogAgent[] {
    return AGENT_CATALOG.filter((c) => this.isInstalled(c));
  }

  /** Installed catalog agents not set up yet. */
  get addable(): CatalogAgent[] {
    return AGENT_CATALOG.filter((c) => this.isInstalled(c) && !this.isConfigured(c));
  }

  /** Set up these catalog agents as profiles (skipping any already set up)
   *  and save once. Returns how many were added. */
  add(agents: readonly CatalogAgent[]): number {
    let added = 0;
    for (const c of agents) {
      if (this.isConfigured(c)) continue;
      app.settings.agentProfiles.push({
        id: crypto.randomUUID(),
        name: c.name,
        command: c.command,
        args: [],
        terminalProfileId: null,
        icon: c.logo,
      });
      added += 1;
    }
    if (added > 0) void app.persistSettings();
    return added;
  }

  /** "Add all installed". */
  addAllInstalled(): number {
    return this.add(this.addable);
  }
}

export const catalogAgents = new CatalogAgents();
