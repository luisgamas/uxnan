/**
 * Registers all JSON-RPC handlers on a router.
 *
 * Git, workspace, thread/turn, project, agent, account (auth/status), usage
 * (`agent/usageStats`), notifications and bridge-control handlers are all
 * implemented. Only the desktop embedded-mode IPC (`desktop/*`) remains a stub
 * (see FOR-DEV.md).
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerGitHandlers } from './git-handler.js';
import { registerWorkspaceHandlers } from './workspace-handler.js';
import { registerThreadHandlers } from './thread-context-handler.js';
import { registerProjectHandlers } from './project-handler.js';
import { registerAgentHandlers } from './agent-handler.js';
import { registerAccountHandlers } from './account-handler.js';
import { registerUsageHandlers } from './usage-handler.js';
import { registerNotificationHandlers } from './notifications-handler.js';
import { registerDesktopHandlers } from './desktop-handler.js';
import { registerBridgeControlHandlers } from './bridge-control-handler.js';

export function registerAllHandlers(router: HandlerRouter): void {
  registerThreadHandlers(router);
  registerGitHandlers(router);
  registerWorkspaceHandlers(router);
  registerProjectHandlers(router);
  registerAgentHandlers(router);
  registerAccountHandlers(router);
  registerUsageHandlers(router);
  registerNotificationHandlers(router);
  registerDesktopHandlers(router);
  // Real implementations last so they win over any earlier stub of the same name.
  registerBridgeControlHandlers(router);
}
