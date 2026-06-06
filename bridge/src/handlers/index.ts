/**
 * Registers all JSON-RPC handlers on a router.
 *
 * Bridge-control methods are implemented; all other domains are registered as
 * clear "not implemented" stubs in this skeleton increment.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerGitHandlers } from './git-handler.js';
import { registerWorkspaceHandlers } from './workspace-handler.js';
import { registerThreadHandlers } from './thread-context-handler.js';
import { registerProjectHandlers } from './project-handler.js';
import { registerAccountHandlers } from './account-handler.js';
import { registerNotificationHandlers } from './notifications-handler.js';
import { registerDesktopHandlers } from './desktop-handler.js';
import { registerBridgeControlHandlers } from './bridge-control-handler.js';

export function registerAllHandlers(router: HandlerRouter): void {
  registerThreadHandlers(router);
  registerGitHandlers(router);
  registerWorkspaceHandlers(router);
  registerProjectHandlers(router);
  registerAccountHandlers(router);
  registerNotificationHandlers(router);
  registerDesktopHandlers(router);
  // Real implementations last so they win over any earlier stub of the same name.
  registerBridgeControlHandlers(router);
}
