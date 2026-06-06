/**
 * Account/auth JSON-RPC handlers.
 *
 * FOR-DEV: implement sanitized auth status + login/logout against the agent CLIs
 * (src/handlers/account-handler.ts). NEVER expose tokens (§5.8.9). Unblocks:
 * mobile account screen.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerStubs } from './not-implemented.js';

export const ACCOUNT_METHODS = ['auth/status', 'auth/login', 'auth/logout'] as const;

export function registerAccountHandlers(router: HandlerRouter): void {
  registerStubs(router, ACCOUNT_METHODS);
}
