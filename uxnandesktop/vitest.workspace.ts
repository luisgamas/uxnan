import { defineWorkspace } from "vitest/config";

/**
 * Two suites, kept apart on purpose.
 *
 * **node** — the pure logic modules and the resource-benchmark harness. No DOM,
 * no Svelte compiler, no browser globals: it stays fast (a couple of seconds for
 * the whole set) and it stays honest, because a module that needs a `document`
 * to be tested is a module that has UI concerns in it.
 *
 * **dom** — Svelte components mounted in jsdom. Slower by construction (a
 * compiler and a fake DOM per file), so it is a separate project rather than a
 * tax on every unit test. Nothing here reaches a real backend: Tauri's own
 * `mockIPC` intercepts the IPC transport, so `src/lib/api.ts` runs for real
 * against a fake, instead of the tests re-implementing the contract and slowly
 * drifting from it.
 *
 * `npm test` runs both. `npm run test:node` / `npm run test:dom` run one.
 */
export default defineWorkspace(["./vitest.config.ts", "./vitest.dom.config.ts"]);
