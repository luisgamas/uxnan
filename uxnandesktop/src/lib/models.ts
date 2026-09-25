// How the app presents an agent's models and their run options — pure, so the
// one model picker's grouping and labels (`ModelPicker.svelte`) are tested
// without a DOM. Used for the bridge's models (a chat) and the desktop's own
// (AI commit, PR drafts, orchestration steps) alike.
//
// Many CLIs report `provider/model` ids (OpenCode, pi: hundreds of them) where
// the provider prefix is the least distinguishing part, so the picker groups by
// provider and shows only the model part; ids without a `/` (Claude Code's
// aliases, Codex's ids) form one unnamed group.

import type { AgentModelOption } from '$shared/agents/agent-capabilities';

/** What the picker needs of a model: the bridge's `AgentModel` and the
 *  desktop's own model entries both fit. */
export interface PickerModel {
  id: string;
  displayName: string;
  description?: string;
  isDefault?: boolean;
  options?: AgentModelOption[];
}

export interface ModelGroup<M extends PickerModel = PickerModel> {
  /** The provider prefix, or null for models without one. */
  provider: string | null;
  models: M[];
}

/** The provider part of a `provider/model` id (everything before the last `/`). */
export function modelProvider(id: string): string | null {
  const i = id.lastIndexOf('/');
  return i > 0 ? id.slice(0, i) : null;
}

/** The name to show for a model: its display name without a provider prefix. */
export function modelName(model: Pick<PickerModel, 'id' | 'displayName'>): string {
  const label = model.displayName || model.id;
  const i = label.lastIndexOf('/');
  return i >= 0 ? label.slice(i + 1) : label;
}

/** Groups models by provider, keeping the agent's order inside each group and
 *  putting models without a provider first. */
export function groupModels<M extends PickerModel>(models: readonly M[]): ModelGroup<M>[] {
  const groups = new Map<string | null, M[]>();
  for (const model of models) {
    const provider = modelProvider(model.id);
    const list = groups.get(provider);
    if (list) list.push(model);
    else groups.set(provider, [model]);
  }
  const bare = groups.get(null);
  const named = [...groups.entries()].filter(([p]) => p !== null) as [string, M[]][];
  return [...(bare ? [{ provider: null, models: bare }] : []), ...named.map(([provider, list]) => ({ provider, models: list }))];
}

/** What the picker's trigger shows after the model name: the chosen value of
 *  each enum option ("High", falling back to its default) and the label of each
 *  toggle that is on. */
export function optionSummary(
  options: readonly AgentModelOption[],
  values: Record<string, string | boolean>,
): string[] {
  const parts: string[] = [];
  for (const option of options) {
    const chosen = values[option.key] ?? option.default;
    if (option.kind === 'enum') {
      const label = option.values?.find((v) => v.value === chosen)?.label;
      if (label) parts.push(label);
    } else if (option.kind === 'toggle' && chosen === true) {
      parts.push(option.label);
    }
  }
  return parts;
}
