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
  //
  // Built on the shared `InputGroup` (the same primitive the command palette's
  // search uses): a `Textarea` over a `block-end` action bar.
  import * as InputGroup from "$lib/components/ui/input-group";
  import * as Select from "$lib/components/ui/select";
  import { Icon } from "$lib/components/ui/icon";
  import { Switch } from "$lib/components/ui/switch";
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
    /** Controls shown at the start of the action bar (the model picker). */
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
    const message = value;
    value = "";
    await onsend(message);
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

<div class="flex flex-col gap-1">
  <!-- The group dims only when the INPUT is disabled, not whenever any of its
       buttons is (the send button is disabled on an empty draft, and the
       primitive's `has-disabled` would fade the whole composer for it). -->
  <InputGroup.Root
    class="rounded-xl bg-card shadow-xs has-disabled:bg-card has-disabled:opacity-100 has-[textarea:disabled]:opacity-50"
  >
    <InputGroup.Textarea
      bind:ref
      bind:value
      {onkeydown}
      {disabled}
      rows={1}
      placeholder={placeholder ?? i18n.t("chat.composerPlaceholder")}
      aria-label={i18n.t("chat.composerLabel")}
      class={cn("max-h-60 min-h-11 px-3 leading-5", text.body)}
    />
    <InputGroup.Addon align="block-end" class="gap-1">
      {#if leading}{@render leading()}{/if}
      {#each enumOptions as option (option.key)}
        <Select.Root
          type="single"
          value={String(optionValues[option.key] ?? option.default ?? "")}
          onValueChange={(v) => (optionValues = { ...optionValues, [option.key]: v })}
        >
          <Select.Trigger size="compact" aria-label={option.label}>
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
        <label class={cn("flex items-center gap-1.5 px-1", text.meta)}>
          <Switch
            checked={(optionValues[option.key] ?? option.default) === true}
            onCheckedChange={(on) => (optionValues = { ...optionValues, [option.key]: on })}
          />
          {option.label}
        </label>
      {/each}
      <span class="flex-1"></span>
      {#if running && empty && onstop}
        <InputGroup.Button
          size="icon-sm"
          variant="secondary"
          class="rounded-full"
          aria-label={i18n.t("chat.stop")}
          title={i18n.t("chat.stop")}
          onclick={onstop}
        >
          <Icon icon={StopIcon} class={icon.action} />
        </InputGroup.Button>
      {:else}
        <InputGroup.Button
          size="icon-sm"
          variant="default"
          class="rounded-full"
          disabled={empty || disabled}
          aria-label={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          title={running ? i18n.t("chat.queue") : i18n.t("chat.send")}
          onclick={() => void submit()}
        >
          <Icon icon={ArrowUp02Icon} class={icon.action} />
        </InputGroup.Button>
      {/if}
    </InputGroup.Addon>
  </InputGroup.Root>
  {#if running && !empty}
    <p class={cn(text.meta, "px-1")}>{i18n.t("chat.queueHint")}</p>
  {/if}
</div>
