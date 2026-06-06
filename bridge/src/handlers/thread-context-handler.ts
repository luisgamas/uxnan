/**
 * Thread/turn JSON-RPC handlers (conversation with the agent runtime).
 *
 * FOR-DEV: implement thread/turn listing, reading, starting and streaming by
 * bridging to the agent adapters and the JSONL history fallback
 * (src/handlers/thread-context-handler.ts).
 * See architecture/02a-system-architecture.md §5.8.8. Unblocks: mobile chat.
 */
import type { HandlerRouter } from '../handler-router.js';
import { registerStubs } from './not-implemented.js';

export const THREAD_METHODS = [
  'thread/list',
  'thread/read',
  'thread/start',
  'thread/resume',
  'thread/fork',
  'turn/list',
  'turn/read',
  'turn/send',
  'turn/cancel',
] as const;

export function registerThreadHandlers(router: HandlerRouter): void {
  registerStubs(router, THREAD_METHODS);
}
