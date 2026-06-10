/**
 * Resolves the project directories the phone may open. For the MVP the bridge
 * exposes its configured `workspaceRoots` (or its own cwd when none are set) as
 * the list of projects; each project carries the absolute `cwd` that git and
 * agent turns run in.
 *
 * Source: architecture/02a-system-architecture.md §5.8.5 (project resolution).
 */
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { JsonRpcErrorCode, RpcError, type AgentConfig, type Project } from '@uxnan/shared';

/** Stable id derived from the absolute path, so it survives restarts. */
export function projectIdFor(cwd: string): string {
  return `proj_${createHash('sha1').update(resolve(cwd)).digest('hex').slice(0, 12)}`;
}

export class ProjectRegistry {
  readonly #roots: string[];
  /** Per-project agent/model pins, keyed by the resolved project `cwd`. */
  readonly #agentByCwd: Map<string, AgentConfig>;

  constructor(
    roots: string[],
    fallbackCwd: string = process.cwd(),
    projectAgents: AgentConfig[] = [],
  ) {
    const resolved = roots.map((r) => resolve(r)).filter((r) => r.length > 0);
    this.#roots = resolved.length > 0 ? resolved : [resolve(fallbackCwd)];
    this.#agentByCwd = new Map(
      projectAgents
        .filter((config) => typeof config.cwd === 'string' && config.cwd.length > 0)
        .map((config) => [resolve(config.cwd as string), config]),
    );
  }

  list(): Project[] {
    return this.#roots.map((cwd) => this.#toProject(cwd));
  }

  /** Find a project by id or by its absolute cwd. Throws if unknown. */
  byId(projectId: string): Project {
    const match = this.#roots.find((cwd) => projectIdFor(cwd) === projectId);
    if (!match) {
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `unknown project: ${projectId}`);
    }
    return this.#toProject(match);
  }

  /** Resolve the project that owns `cwd` (exact root match), else synthesize one. */
  resolve(cwd: string): Project {
    const target = resolve(cwd);
    const match = this.#roots.find((root) => root === target);
    return this.#toProject(match ?? target);
  }

  /** The pinned agent/model config for the project at `cwd`, if any. */
  agentConfigFor(cwd: string): AgentConfig | undefined {
    return this.#agentByCwd.get(resolve(cwd));
  }

  #toProject(cwd: string): Project {
    const resolved = resolve(cwd);
    const pin = this.#agentByCwd.get(resolved);
    return {
      id: projectIdFor(resolved),
      name: basename(resolved) || resolved,
      cwd: resolved,
      ...(pin?.agentId !== undefined ? { agentId: pin.agentId } : {}),
      ...(pin?.model !== undefined ? { model: pin.model } : {}),
    };
  }
}
