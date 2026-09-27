<script lang="ts">
  // The app's one run-options picker: a model's knobs (reasoning effort, …)
  // beside the model picker, the same control for every agent and every model
  // that has them, so it is learnt once.
  //
  // Each level-type knob is a pill — rising bars for how hard it makes the
  // model think, and the level's name — opening a menu of the model's own
  // levels, lowest first, with the one it runs at by default marked. Leaving
  // it untouched runs that default: the bridge sends it (`agent/models`
  // `default`), so what the pill shows is what the turn uses. A knob whose
  // agent names no default offers "Model default" first, which sends nothing.
  // On/off knobs gather in one "Options" pill of checkboxes.
  //
  // Built on the menu primitives (`DropdownMenu` radio and checkbox items) and
  // the composer's `chat.pill` trigger — nothing laid out by hand.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
  import Settings02Icon from "@hugeicons/core-free-icons/Settings02Icon";
  import type { AgentModelOption } from "$shared/agents/agent-capabilities";
  import Brain01Icon from "@hugeicons/core-free-icons/Brain01Icon";
  import { i18n } from "$lib/i18n";
  import type { MessageKey } from "$lib/i18n/locales/en";
  import { cn } from "$lib/utils";
  import { chat, icon, text } from "$lib/design";

  let {
    options = [],
    values = $bindable({}),
    disabled = false,
  }: {
    /** The chosen model's knobs (`AgentModel.options`). */
    options?: AgentModelOption[];
    /** The value picked per knob key; an absent key runs the default. */
    values?: Record<string, string | boolean>;
    disabled?: boolean;
  } = $props();

  /** The radio value that stands for "send nothing". */
  const UNSET = "__model_default__";

  /** Level names every agent shares, in the app's language (the bridge's own
   *  English label for anything else). */
  const LEVELS = ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"];

  function levelLabel(value: string, label: string): string {
    return LEVELS.includes(value) ? i18n.t(`runOptions.level.${value}` as MessageKey) : label;
  }

  function knobLabel(option: AgentModelOption): string {
    return option.key === "reasoning" ? i18n.t("runOptions.reasoning") : option.label;
  }

  const levelOptions = $derived(
    options.filter((o) => o.kind === "enum" && (o.values?.length ?? 0) > 0),
  );
  const toggles = $derived(options.filter((o) => o.kind === "toggle"));

  /** The value a knob runs at: the pick, else the advertised default. */
  function effective(option: AgentModelOption): string | undefined {
    const picked = values[option.key];
    if (typeof picked === "string") return picked;
    return typeof option.default === "string" ? option.default : undefined;
  }

  function labelOf(option: AgentModelOption): string {
    const value = effective(option);
    const level = option.values?.find((v) => v.value === value);
    return level ? levelLabel(level.value, level.label) : i18n.t("runOptions.modelDefault");
  }

  function pick(option: AgentModelOption, next: string) {
    const rest = { ...values };
    // Back to the default: forget the pick, so the default keeps applying if
    // the model's default changes.
    if (next === UNSET || next === option.default) delete rest[option.key];
    else rest[option.key] = next;
    values = rest;
  }

  function toggle(option: AgentModelOption, on: boolean) {
    const rest = { ...values };
    if (on === (option.default === true)) delete rest[option.key];
    else rest[option.key] = on;
    values = rest;
  }

  const togglesOn = $derived(
    toggles.filter((o) => (values[o.key] ?? o.default) === true).map((o) => o.label),
  );
</script>

{#each levelOptions as option (option.key)}
  {@const current = effective(option)}
  {@const levels = option.values ?? []}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger {disabled}>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="sm"
          class={cn(chat.pill, "max-w-44")}
          aria-label={`${knobLabel(option)}: ${labelOf(option)}`}
          title={knobLabel(option)}
        >
          <Icon icon={Brain01Icon} class={icon.status} />
          <span class="truncate">{labelOf(option)}</span>
          <Icon icon={ArrowDown01Icon} class={cn(icon.status, "opacity-60")} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content width="simple" align="start" side="top">
      <DropdownMenu.Label class={text.menuLabel}>{knobLabel(option)}</DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        value={typeof values[option.key] === "string"
          ? String(values[option.key])
          : (option.default as string | undefined) ?? UNSET}
        onValueChange={(v) => v && pick(option, v)}
      >
        {#if option.default === undefined}
          <DropdownMenu.RadioItem value={UNSET} class={cn(text.menu, "whitespace-nowrap pr-8")}>
            <span class="flex-1">{i18n.t("runOptions.modelDefault")}</span>
          </DropdownMenu.RadioItem>
        {/if}
        {#each levels as level (level.value)}
          <DropdownMenu.RadioItem value={level.value} class={cn(text.menu, "whitespace-nowrap pr-8")}>
            <span class="flex-1">{levelLabel(level.value, level.label)}</span>
            {#if level.value === option.default}
              <span class={cn(text.meta, "shrink-0")}>{i18n.t("runOptions.default")}</span>
            {/if}
          </DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/each}

{#if toggles.length > 0}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger {disabled}>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="sm"
          class={cn(chat.pill, "max-w-44")}
          aria-label={i18n.t("runOptions.options")}
        >
          <Icon icon={Settings02Icon} class={icon.status} />
          <span class="truncate">
            {togglesOn.length > 0 ? togglesOn.join(" · ") : i18n.t("runOptions.options")}
          </span>
          <Icon icon={ArrowDown01Icon} class={cn(icon.status, "opacity-60")} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content width="simple" align="start" side="top">
      {#each toggles as option (option.key)}
        <DropdownMenu.CheckboxItem
          class={text.menu}
          checked={(values[option.key] ?? option.default) === true}
          onCheckedChange={(on) => toggle(option, on)}
        >
          {option.label}
        </DropdownMenu.CheckboxItem>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
