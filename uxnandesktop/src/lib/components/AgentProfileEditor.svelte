<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import * as Select from "$lib/components/ui/select";
  import { app } from "$lib/state/app.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { fileToLogoDataUrl, isCustomLogo } from "$lib/logo";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { focus, icon, iconButton, row, text } from "$lib/design";
  import type { AgentProfile, EnvVar } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Icon } from "$lib/components/ui/icon";
  import Trash2Icon from "@hugeicons/core-free-icons/Delete02Icon";
  import XIcon from "@hugeicons/core-free-icons/Cancel01Icon";
  import PlusIcon from "@hugeicons/core-free-icons/PlusSignIcon";
  import ChevronDownIcon from "@hugeicons/core-free-icons/ChevronDownIcon";

  let {
    agent,
    onchange,
    onremove,
  }: {
    agent: AgentProfile;
    onchange: () => void;
    onremove: () => void;
  } = $props();

  // Collapsed by default: the row shows the agent (logo · name), and expands to
  // its command / args / shell / env config. It's one row of the agents list, so
  // it carries no border of its own (the list separates rows with a divider).
  let expanded = $state(false);

  // Args are edited as a local space-separated string and committed to the array.
  // Seeded once (rows are keyed by id, so a different agent remounts this).
  let argsText = $state(untrack(() => agent.args.join(" ")));
  function commitArgs() {
    agent.args = argsText.split(/\s+/).filter(Boolean);
    onchange();
  }

  // The shell the agent launches in: "" = the default terminal profile.
  const DEFAULT = "__default__";
  const shellLabel = $derived.by(() => {
    const id = agent.terminalProfileId;
    if (!id) return i18n.t("agentEditor.defaultShell");
    const p = app.terminalProfiles.find((x) => x.id === id);
    return p?.name.trim() || i18n.t("terminal.unnamedProfile");
  });

  // Environment variables: a live list bound to `agent.env`. Rows are mutated in
  // place so deep-reactive persistence fires on every keystroke via `onchange`.
  const envVars = $derived<EnvVar[]>(agent.env ?? []);
  function addEnvVar() {
    if (!agent.env) agent.env = [];
    agent.env.push({ key: "", value: "" });
    onchange();
  }
  function removeEnvVar(index: number) {
    agent.env?.splice(index, 1);
    onchange();
  }

  // Custom logo: pick an image, store it inline (data URL) on `agent.icon`.
  let fileInput = $state<HTMLInputElement>();
  let processingLogo = $state(false);
  const hasCustomLogo = $derived(isCustomLogo(agent.icon));

  async function onPickLogo(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file
    if (!file) return;
    processingLogo = true;
    try {
      agent.icon = await fileToLogoDataUrl(file);
      onchange();
    } catch {
      // Ignore an unreadable/non-image file.
    } finally {
      processingLogo = false;
    }
  }

  function resetLogo() {
    // Drop the custom image; fall back to the catalog logo for the command.
    agent.icon = null;
    onchange();
  }
</script>

<Collapsible.Root bind:open={expanded} class="flex flex-col gap-2 py-3">
  <div class="flex items-center gap-2.5">
    <div class="relative shrink-0">
      <TooltipSimple title={i18n.t("agentEditor.chooseLogo")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon-xs"
            class="border border-border/60 hover:bg-accent/50"
            aria-label={i18n.t("agentEditor.chooseLogo")}
            disabled={processingLogo}
            onclick={() => fileInput?.click()}
          >
            {#if processingLogo}
              <Spinner aria-label={i18n.t("common.loading")} />
            {:else}
              <AgentLogo logo={agentLogoKey(agent.icon, agent.command)} class="size-5" />
            {/if}
          </Button>
        {/snippet}
      </TooltipSimple>
      {#if hasCustomLogo}
        <TooltipSimple title={i18n.t("agentEditor.resetLogo")}>
          {#snippet children(tp)}
            <button
              {...tp}
              type="button"
              class={cn(iconButton.xs, "absolute -right-2 -top-2 rounded-full border border-border bg-background p-0 text-muted-foreground hover:text-foreground")}
              aria-label={i18n.t("agentEditor.resetLogo")}
              onclick={resetLogo}
            >
              <Icon icon={XIcon} class="size-2.5" />
            </button>
          {/snippet}
        </TooltipSimple>
      {/if}
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        class="hidden"
        onchange={onPickLogo}
      />
    </div>
    <button
      type="button"
      class={cn(row.editorDisclosure, focus.ring)}
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <span class={cn("block truncate font-medium text-foreground", text.body)}>
        {agent.name?.trim() || agent.command || i18n.t("agentEditor.namePlaceholder")}
      </span>
      {#if agent.name?.trim() && agent.command}
        <span class="block truncate font-mono text-[11px] leading-4 text-muted-foreground">{agent.command}</span>
      {/if}
    </button>
    <TooltipSimple title={i18n.t(expanded ? "project.collapse" : "project.expand")}>
      {#snippet children(tp)}
        <Collapsible.Trigger
          {...tp}
          class={cn(iconButton.xs, "text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground")}
        >
          <Icon icon={ChevronDownIcon} class={cn(icon.button, "transition-transform", expanded && "rotate-180")} />
        </Collapsible.Trigger>
      {/snippet}
    </TooltipSimple>
    <TooltipSimple title={i18n.t("agentEditor.removeAgent")}>
      {#snippet children(tp)}
        <Button
          {...tp}
          variant="ghost"
          size="icon-sm"
          onclick={onremove}
        >
          <Icon icon={Trash2Icon} class={icon.button} />
        </Button>
      {/snippet}
    </TooltipSimple>
  </div>
  <Collapsible.Content class="flex flex-col gap-2.5 pt-1.5">
  <Input
    density="compact"
    class="text-xs"
    placeholder={i18n.t("agentEditor.namePlaceholder")}
    bind:value={agent.name}
    oninput={onchange}
  />
  <div class="flex flex-col gap-2 sm:flex-row">
    <Input
      density="compact"
      class="flex-1 font-mono text-xs"
      placeholder={i18n.t("agentEditor.commandPlaceholder")}
      bind:value={agent.command}
      oninput={onchange}
    />
    <Input
      density="compact"
      class="flex-1 font-mono text-xs"
      placeholder={i18n.t("agentEditor.argsPlaceholder")}
      bind:value={argsText}
      oninput={commitArgs}
    />
  </div>
  <div class="flex items-center gap-2">
    <span class={cn("shrink-0", text.meta)}>{i18n.t("agentEditor.launchIn")}</span>
    <Select.Root
      type="single"
      value={agent.terminalProfileId ?? DEFAULT}
      onValueChange={(v) => {
        agent.terminalProfileId = v === DEFAULT ? null : v;
        onchange();
      }}
    >
      <Select.Trigger size="compact" class="flex-1 text-xs">{shellLabel}</Select.Trigger>
      <Select.Content>
        <Select.Item value={DEFAULT} label={i18n.t("agentEditor.defaultShell")}>
          {i18n.t("agentEditor.defaultShell")}
        </Select.Item>
        {#each app.terminalProfiles as p (p.id)}
          {@const label = p.name.trim() || i18n.t("terminal.unnamedProfile")}
          <Select.Item value={p.id} {label}>{label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <!-- Environment variables: set on the agent's shell at launch. -->
  <div class="flex flex-col gap-1.5">
    <div class="flex items-center justify-between">
      <span class={cn("shrink-0", text.meta)}>{i18n.t("agentEditor.envTitle")}</span>
      <TooltipSimple title={i18n.t("agentEditor.addEnvVar")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon-sm"
            aria-label={i18n.t("agentEditor.addEnvVar")}
            onclick={addEnvVar}
          >
            <Icon icon={PlusIcon} class={icon.button} />
          </Button>
        {/snippet}
      </TooltipSimple>
    </div>
    {#each envVars as envVar, i (i)}
      <div class="flex items-center gap-1.5">
        <Input
          density="compact"
          class="flex-1 font-mono text-xs"
          placeholder={i18n.t("agentEditor.envKeyPlaceholder")}
          bind:value={envVar.key}
          oninput={onchange}
        />
        <span class={text.meta}>=</span>
        <Input
          density="compact"
          class="flex-1 font-mono text-xs"
          placeholder={i18n.t("agentEditor.envValuePlaceholder")}
          bind:value={envVar.value}
          oninput={onchange}
        />
        <TooltipSimple title={i18n.t("agentEditor.removeEnvVar")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon-sm"
              aria-label={i18n.t("agentEditor.removeEnvVar")}
              onclick={() => removeEnvVar(i)}
            >
              <Icon icon={XIcon} class={icon.button} />
            </Button>
          {/snippet}
        </TooltipSimple>
      </div>
    {/each}
  </div>
  </Collapsible.Content>
</Collapsible.Root>
