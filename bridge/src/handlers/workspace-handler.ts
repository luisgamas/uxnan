/**
 * Workspace JSON-RPC handlers.
 *
 * FOR-DEV: implement file/image reads (with path-traversal validation), listing,
 * checkpoints and patch application (src/handlers/workspace-handler.ts).
 * See architecture/02a-system-architecture.md §5.8.7. Unblocks: mobile file view.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerStubs } from './not-implemented.js';

export const WORKSPACE_METHODS = [
  'workspace/readFile',
  'workspace/readImage',
  'workspace/list',
  'workspace/checkpoint',
  'workspace/diffCheckpoint',
  'workspace/applyCheckpoint',
  'workspace/applyPatch',
] as const;

export function registerWorkspaceHandlers(router: HandlerRouter): void {
  registerStubs(router, WORKSPACE_METHODS);
}
