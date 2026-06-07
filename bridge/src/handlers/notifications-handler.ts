/**
 * Push-notification JSON-RPC handlers.
 *
 * FOR-DEV: implement push token registration and preferences, wiring to the
 * relay's /push endpoints (src/handlers/notifications-handler.ts).
 * See architecture/02a-system-architecture.md §5.10. Unblocks: mobile push.
 *
 * Note: these method names are not part of the core registry yet; they will be
 * added to @uxnan/shared when the push module lands.
 */
import type { HandlerRouter } from '../handler-router.js';

export function registerNotificationHandlers(_router: HandlerRouter): void {
  // FOR-DEV: register notifications/register, notifications/update,
  // notifications/unregister once the contracts are added to @uxnan/shared.
}
