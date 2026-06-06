/**
 * Git JSON-RPC handlers.
 *
 * FOR-DEV: implement Git operations via `child_process` (execFile/spawn),
 * resolving cwd from the thread/project context (src/handlers/git-handler.ts).
 * See architecture/02a-system-architecture.md §5.8.6. Unblocks: mobile Git panel.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerStubs } from './not-implemented.js';

export const GIT_METHODS = [
  'git/status',
  'git/diff',
  'git/commit',
  'git/push',
  'git/pull',
  'git/checkout',
  'git/createBranch',
  'git/createWorktree',
] as const;

export function registerGitHandlers(router: HandlerRouter): void {
  registerStubs(router, GIT_METHODS);
}
