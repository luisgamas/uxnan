/**
 * `agent/usageStats` handler — reads AI-provider usage/quota for the providers
 * the user activated and returns per-provider snapshots (windows, credit, plan,
 * status). The heavy lifting is in `../usage/usage-reader.ts`; this validates
 * params and shapes the result.
 *
 * Source: architecture/02a-system-architecture.md §5.8.10.
 */
import { RpcError } from '@uxnan/shared';
import type { UsageProvider, UsageStatsResult, UsageSummary } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { readUsage } from '../usage/usage-reader.js';
import { optionalNumber, optionalString, requireArray, requireString } from './params.js';
import { redeemCodexReset } from '../usage/cli-usage.js';

const USAGE_PROVIDERS: readonly UsageProvider[] = ['codex', 'claude', 'copilot', 'grok'];

/** Validates `params.providers` into a deduped list of known providers. */
export function validateProviders(params: unknown): UsageProvider[] {
  const raw = requireArray(params, 'providers');
  const providers: UsageProvider[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !USAGE_PROVIDERS.includes(item as UsageProvider)) {
      throw RpcError.invalidParams(`unknown usage provider: ${String(item)}`);
    }
    if (!providers.includes(item as UsageProvider)) providers.push(item as UsageProvider);
  }
  return providers;
}

export function registerUsageHandlers(router: HandlerRouter): void {
  router.register(
    'agent/usageStats',
    async (p, ctx: BridgeContext): Promise<UsageStatsResult> => ({
      usage: await readUsage(validateProviders(p), { now: () => ctx.now() }),
    }),
  );
  router.register('usage/redeemReset', async (p, ctx: BridgeContext) => {
    const provider = requireString(p, 'provider');
    if (provider !== 'codex') {
      throw RpcError.invalidParams(`${provider} has no resets to redeem`);
    }
    const key = requireString(p, 'idempotencyKey');
    await redeemCodexReset(key, optionalString(p, 'creditId'));
    const [usage] = await readUsage(['codex'], { now: () => ctx.now() });
    return usage;
  });
  router.register('usage/summary', (p, ctx: BridgeContext): Promise<UsageSummary> => {
    const days = optionalNumber(p, 'days');
    if (days === undefined || !Number.isInteger(days) || days < 1 || days > 366) {
      throw RpcError.invalidParams('days must be an integer from 1 to 366');
    }
    return ctx.usage.summary(days);
  });
}
