/**
 * Project JSON-RPC handlers.
 *
 * FOR-DEV: implement project listing/resolution from the managed-projects state
 * (src/handlers/project-handler.ts). Unblocks: mobile project picker.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerStubs } from './not-implemented.js';

export const PROJECT_METHODS = ['project/list', 'project/resolve'] as const;

export function registerProjectHandlers(router: HandlerRouter): void {
  registerStubs(router, PROJECT_METHODS);
}
