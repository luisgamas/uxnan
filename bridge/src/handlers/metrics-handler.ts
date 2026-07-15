/**
 * Profile-metrics handlers — `metrics/get`, `metrics/export`, `metrics/import`.
 *
 * The bridge is the source of truth for the mobile profile metrics; the heavy
 * lifting (snapshot aggregation, tamper-proof sealing) lives in
 * `../metrics/metrics-service.ts`. This validates params and delegates.
 *
 * Source: architecture/02a-system-architecture.md §5.8.11.
 */
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { optionalString, requireString } from './params.js';

/** Read an optional passphrase, treating an empty string as "none". */
function optionalPassphrase(params: unknown): string | undefined {
  const value = optionalString(params, 'passphrase');
  return value && value.length > 0 ? value : undefined;
}

export function registerMetricsHandlers(router: HandlerRouter): void {
  router.register('metrics/get', (_p, ctx: BridgeContext) => ctx.metrics.getSnapshot());

  router.register('metrics/export', (p, ctx: BridgeContext) =>
    ctx.metrics.exportBackup(optionalPassphrase(p)),
  );

  router.register('metrics/import', (p, ctx: BridgeContext) =>
    ctx.metrics.importBackup(requireString(p, 'blob'), optionalPassphrase(p)),
  );
}
