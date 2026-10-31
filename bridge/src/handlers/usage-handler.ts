/**
 * `agent/usageStats` handler — reads AI-provider usage/quota for the providers
 * the user activated and returns per-provider snapshots (windows, credit, plan,
 * status). The heavy lifting is in `../usage/usage-reader.ts`; this validates
 * params and shapes the result.
 *
 * Source: architecture/02a-system-architecture.md §5.8.10.
 */
import { RpcError, USAGE_PROVIDERS } from '@uxnan/shared';
import type { ProviderUsage, UsageProvider, UsageStatsResult, UsageSummary } from '@uxnan/shared';
import type { BridgeContext } from '../bridge-context.js';
import type { HandlerRouter } from '../handler-router.js';
import { readUsage } from '../usage/usage-reader.js';
import { optionalNumber, optionalString, requireArray, requireString } from './params.js';
import { redeemCodexReset } from '../usage/cli-usage.js';

/**
 * Validates `params.providers` into a deduped list of known providers. A
 * string this bridge does not know is skipped, not refused: a newer client
 * that asks for a provider added after this bridge still gets the others.
 */
export function validateProviders(params: unknown): UsageProvider[] {
  const raw = requireArray(params, 'providers');
  const providers: UsageProvider[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw RpcError.invalidParams(`usage provider must be a string: ${String(item)}`);
    }
    if (!USAGE_PROVIDERS.includes(item as UsageProvider)) continue;
    if (!providers.includes(item as UsageProvider)) providers.push(item as UsageProvider);
  }
  return providers;
}

/**
 * One read per provider at a time: a provider already being read when another
 * client asks (the phone and the desktop polling together) is answered from
 * that read instead of starting its CLI a second time.
 */
export class CoalescedUsageReads {
  readonly #inFlight = new Map<UsageProvider, Promise<ProviderUsage>>();
  readonly #read: (providers: UsageProvider[]) => Promise<ProviderUsage[]>;

  constructor(read: (providers: UsageProvider[]) => Promise<ProviderUsage[]>) {
    this.#read = read;
  }

  read(providers: UsageProvider[]): Promise<ProviderUsage[]> {
    const fresh = providers.filter((p) => !this.#inFlight.has(p));
    if (fresh.length > 0) {
      const batch = this.#read(fresh);
      fresh.forEach((provider, i) => {
        const one = batch.then((all) => all[i]!);
        this.#inFlight.set(provider, one);
        const forget = () => {
          if (this.#inFlight.get(provider) === one) this.#inFlight.delete(provider);
        };
        one.then(forget, forget);
      });
    }
    return Promise.all(providers.map((p) => this.#inFlight.get(p)!));
  }
}

export function registerUsageHandlers(router: HandlerRouter): void {
  let reads: CoalescedUsageReads | undefined;
  router.register('agent/usageStats', async (p, ctx: BridgeContext): Promise<UsageStatsResult> => {
    const providers = validateProviders(p);
    reads ??= new CoalescedUsageReads((list) => readUsage(list, { now: () => ctx.now() }));
    return { usage: await reads.read(providers) };
  });
  router.register('usage/redeemReset', async (p, ctx: BridgeContext) => {
    const provider = requireString(p, 'provider');
    if (provider === 'claude') {
      // Claude Code spends its limit resets only through an interactive command.
      throw RpcError.invalidParams(
        'Claude Code limit resets are used inside Claude Code: run /limit-reset',
      );
    }
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
