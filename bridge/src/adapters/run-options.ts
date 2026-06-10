/**
 * Helpers for per-model run options (the "knobs" advertised by `agent/models`
 * and chosen on `turn/send`). Shared by the CLI adapters so each can translate
 * the generic `reasoning` knob into its own flag.
 */
import type {
  AgentModel,
  AgentModelOption,
  AgentModelOptionValue,
  SendTurnOptions,
} from '@uxnan/shared';

/** The generic key under which reasoning effort is advertised and sent. */
export const REASONING_KEY = 'reasoning';

/**
 * Resolve the chosen reasoning-effort value for a turn: the generic
 * `options.reasoning` knob first, then the legacy flat `effort` (back-compat).
 * Returns undefined when neither is set.
 */
export function reasoningValue(options: SendTurnOptions): string | undefined {
  const knob = options.options?.[REASONING_KEY];
  if (typeof knob === 'string' && knob.length > 0) return knob;
  return options.effort && options.effort.length > 0 ? options.effort : undefined;
}

/** Build a `reasoning` enum knob from the given selectable values. */
export function reasoningOption(
  values: AgentModelOptionValue[],
  defaultValue?: string,
): AgentModelOption {
  return {
    key: REASONING_KEY,
    kind: 'enum',
    label: 'Reasoning effort',
    values,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

/** Friendly label for a known reasoning-effort level (else Title-cased). */
export function effortLabel(value: string): string {
  const known: Record<string, string> = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
  };
  if (known[value]) return known[value];
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** Build the selectable values for an effort knob from raw level strings. */
export function effortValues(levels: readonly string[]): AgentModelOptionValue[] {
  return levels.map((value) => ({ value, label: effortLabel(value) }));
}

/** Attach `options` to every model (replacing any prior options). */
export function withOptions(models: AgentModel[], options: AgentModelOption[]): AgentModel[] {
  if (options.length === 0) return models;
  return models.map((model) => ({ ...model, options }));
}
