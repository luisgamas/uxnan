<script lang="ts">
  // The chat's input. Enter sends, Shift+Enter breaks the line (and an IME
  // composition is never cut short). While the agent works the button stops
  // it; typing meanwhile sends a follow-up the bridge queues behind the running
  // turn — or hands to it directly, on agents that take input mid-turn — which
  // is exactly what the phone does with the same message.
  //
  // FOR-DEV: image attachments (`turn/send { attachments }`, when the agent
  // advertises `images`), the `/` command palette (`agent/commands` +
  // `turn/send { command }`) and `@` file mentions, which the phone's composer
  // has. Deferred to keep the first chat release reviewable; see FOR-DEV.md →
  // Phase 6 → Chat tabs.
  import { Button } from "$lib/components/ui/button";
  import { Icon } from "$lib/components/ui/icon";
  import * as Select from "$lib/components/ui/select";
  import ArrowUp02Icon from "@hugeicons/core-free-icons/ArrowUp02Icon";
  import StopIcon from "@hugeicons/core-free-icons/StopIcon";
  import type { Snippet } from "svelte";
  import type { AgentModelOption } from "$shared/agents/agent-capabilities";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";

  let {
    running = false,
    disabled = false,
    placeholder,
    runOptions = [],
    optionValues = $bindable({}),
    autofocus = false,
    onsend,
    onstop,
    leading,
  }: {
    running?: boolean;
    disabled?: boolean;
    placeholder?: string;
    /** Per-model run-option knobs to offer (reasoning effort, …). */
    runOptions?: AgentModelOption[];
    /** The chosen value per knob key. */
    optionValues?: Record<string, string | boolean>;
    autofocus?: boolean;
    onsend: (text: string) => void | Promise<void>;
    onstop?: () => void;
    /** Controls shown at the start of the toolbar (model picker, …). */
    leading?: Snippet;
  } = $props();

  let value = $state("");
  let ref = $state<HTMLTextAreaElement | null>(null);
  const empty = $derived(value.trim().length === 0);
  const enumOptions = $derived(runOptions.filter((o) => o.kind === "enum" && o.values?.length));
  const toggleOptions = $derived(runOptions.filter((o) => o.kind === "toggle"));

  $effect(() => {
    if (autofocus && ref && !disabled) ref.focus();
  });

  async function submit() {
    if (empty || disabled) return;
    const text = value;
    value = "";
    await onsend(text);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    void submit();
  }

  function optionLabel(option: AgentModelOption): string {
    const current = optionValues[option.key] ?? option.default;
    return option.values?.find((v) => v.value === current)?.label ?? option.label;
  }
</script>

<div
  class={cn(
    "flex flex-col gap-1.5 rounded-xl border border-border/70 bg-card px-3 pb-2 pt-2.5 shadow-xs transition-colors focus-within:border-ring/60",
    disabled && "opacity-60",
  )}
>
  <textarea
    bind:this={ref}
    bind:value
    {onkeydown}
    {disabled}
    rows="1"
    placeholder={placeholder ?? i18n.t("chat.composerPlaceholder")}
    aria-label={i18n.t("chat.composerLabel")}
    class="field-sizing-content max-h-60 min-h-6 w-full resize-none bg-transparent text-[13px] leading-5 outline-none placeholder:text-muted-foreground/70"
  ></textarea>
  <div class="flex min-w-0 items-center gap-1">
    {#if leading}{@render leading()}{/if}
    {#each enumOptions as option (option.key)}
      <Select.Root
        type="single"
        value={String(optionValues[option.key] ?? option.default ?? "")}
        onValueChange={(v) => (optionValues = { ...optionValues, [option.key]: v })}
      >
        <Select.Trigger
          size="sm"
          class="h-7 w-auto gap-1 border-none bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:text-foreground"
          aria-label={option.label}
        >
          {optionLabel(option)}
        </Select.Trigger>
        <Select.Content>
          {#each option.values ?? [] as v (v.value)}
            <Select.Item value={v.value} label={v.label}>{v.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/each}
    {#each toggleOptions as option (option.key)}
      {@const on = (optionValues[option.key] ?? option.default) === true}
      <Button
        variant="ghost"
        size="xs"
        class={cn("font-normal", on ? "text-foreground" : "text-muted-foreground")}
        aria-pressed={on}
        onclick={() => (optionValues = { ...optionValues, [option.key]: !on })}
      >
        {option.label}
      </Button>
    {/each}
    <span class="flex-1"></span>
    {#if running && empty && onstop}
      <Button
        size="icon-sm"
        variant="secondary"
        class="rounded-full"
        aria-label={i18n.t("chat.stop")}
        title={i18n.t("chat.stop")}
        onclick={onstop}
      >
        <Icon icon={StopIcon} class={icon.action} />
      </Button>
    {:else}
      <Button
        size="icon-sm"
        class="rounded-full"
        disabled={empty || disabled}
        aria-label={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
        title={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
        onclick={() => void submit()}
      >
        <Icon icon={ArrowUp02Icon} class={icon.action} />
      </Button>
    {/if}
  </div>
  {#if running && !empty}
    <p class={cn(text.meta, "text-[11px]")}>{i18n.t("chat.queueHint")}</p>
  {/if}
</div>
