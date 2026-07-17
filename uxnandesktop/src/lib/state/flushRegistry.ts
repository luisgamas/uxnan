// Flush registry — pure TS, no Svelte imports (so the Vitest harness can test it).
//
// Debounced-persist sites (terminal layout, orchestration runs, workspace-recency
// stamps, …) register a flush here so a window close can force every pending write
// to disk before the webview is torn down. Without this, any change made inside a
// debounce window at quit time is silently dropped.

type Flush = () => void | Promise<void>;
const flushes = new Map<string, Flush>();

/** Register a flush under `id`. Re-registering the same id replaces the previous
 *  one, so a re-mounting component never accumulates stale flushes. */
export function registerFlush(id: string, fn: Flush): void {
  flushes.set(id, fn);
}

/** Drop the flush registered under `id` (a no-op when none is registered). */
export function unregisterFlush(id: string): void {
  flushes.delete(id);
}

/** Run every registered flush concurrently; a failing flush never blocks the
 *  others (`Promise.allSettled`), so one bad write can't strand a pending one. */
export async function flushAll(): Promise<void> {
  await Promise.allSettled([...flushes.values()].map(async (fn) => fn()));
}
