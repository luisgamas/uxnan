/**
 * Desktop-integration JSON-RPC handlers (used when the bridge is embedded).
 *
 * FOR-DEV: implement desktop refresh/open/focus IPC when the bridge runs as a
 * Tauri sidecar (src/handlers/desktop-handler.ts).
 * See uxnandesktop/architecture/02e-bridge-integration.md §3.4. Unblocks:
 * embedded-mode desktop ↔ bridge events.
 *
 * Note: these method names are not part of the core registry yet.
 */
import type { HandlerRouter } from '../handler-router.js';

export function registerDesktopHandlers(_router: HandlerRouter): void {
  // FOR-DEV: register desktop/refresh, desktop/open, desktop/focus when the
  // embedded-mode contracts are added to @uxnan/shared.
}
