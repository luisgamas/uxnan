<script lang="ts">
  import { untrack } from "svelte";
  import { Input } from "$lib/components/ui/input";
  import { Button } from "$lib/components/ui/button";
  import * as Select from "$lib/components/ui/select";
  import { app } from "$lib/state/app.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import type { AgentProfile } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let {
    agent,
    onchange,
    onremove,
  }: {
    agent: AgentProfile;
    onchange: () => void;
    onremove: () => void;
  } = $props();

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
    if (!id) return i18n.t("agentEditor.defaultTerminal");
    const p = app.terminalProfiles.find((x) => x.id === id);
    return p?.name.trim() || i18n.t("terminal.unnamedProfile");
  });
</script>

<div class="flex flex-col gap-2 rounded-md border border-border p-2.5">
  <div class="flex items-center gap-2">
    <AgentLogo logo={agentLogoKey(agent.icon, agent.command)} />
    <Input
      class="h-8 text-xs"
      placeholder={i18n.t("agentEditor.namePlaceholder")}
      bind:value={agent.name}
      oninput={onchange}
    />
    <Button
      variant="ghost"
      size="icon-sm"
      title={i18n.t("agentEditor.removeAgent")}
      onclick={onremove}
    >
      <Trash2Icon class={icon.button} />
    </Button>
  </div>
  <div class="flex flex-col gap-1.5 sm:flex-row">
    <Input
      class="h-8 flex-1 font-mono text-xs"
      placeholder={i18n.t("agentEditor.commandPlaceholder")}
      bind:value={agent.command}
      oninput={onchange}
    />
    <Input
      class="h-8 flex-1 font-mono text-xs"
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
      <Select.Trigger class="h-8 flex-1 text-xs">{shellLabel}</Select.Trigger>
      <Select.Content>
        <Select.Item value={DEFAULT} label={i18n.t("agentEditor.defaultTerminal")}>
          {i18n.t("agentEditor.defaultTerminal")}
        </Select.Item>
        {#each app.terminalProfiles as p (p.id)}
          {@const label = p.name.trim() || i18n.t("terminal.unnamedProfile")}
          <Select.Item value={p.id} {label}>{label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
</div>
