<script lang="ts">
  // One "+" button that opens everything you can start in a workspace: a new
  // terminal (default + each profile), an agent (each configured one), and — when
  // the caller allows it — a new worktree. Reused by the project header and every
  // worktree row, so the launch affordance is identical everywhere.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import AgentLogo from "./AgentLogo.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  let {
    path,
    label,
    onNewWorktree,
    triggerClass,
  }: {
    path: string;
    label: string;
    /** When provided, the menu offers "New worktree" (the caller owns the dialog). */
    onNewWorktree?: () => void;
    triggerClass?: string;
  } = $props();

  const agents = $derived(app.launchableAgents);
  const profiles = $derived(app.terminalProfiles);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        variant="ghost"
        size="icon"
        class={cn(iconButton.xs, triggerClass)}
        title={i18n.t("launcher.open", { name: label })}
        onclick={(e: MouseEvent) => e.stopPropagation()}
        {...props}
      >
        <PlusIcon class={icon.action} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-56">
    <DropdownMenu.GroupHeading class={text.menuLabel}>
      {i18n.t("launcher.terminal")}
    </DropdownMenu.GroupHeading>
    <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path)}>
      <TerminalIcon class={icon.button} />
      {i18n.t("terminal.newDefault")}
    </DropdownMenu.Item>
    {#each profiles as p (p.id)}
      <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path, p.id)}>
        <TerminalIcon class={icon.button} />
        {p.name.trim() || i18n.t("terminal.unnamedProfile")}
      </DropdownMenu.Item>
    {/each}

    <DropdownMenu.Separator />
    <DropdownMenu.GroupHeading class={text.menuLabel}>
      {i18n.t("launcher.agents")}
    </DropdownMenu.GroupHeading>
    {#if agents.length > 0}
      {#each agents as agent (agent.id)}
        <DropdownMenu.Item class={text.menu} onclick={() => projects.launchAgentAt(path, agent)}>
          <AgentLogo logo={agentLogoKey(agent.icon, agent.command)} />
          {agent.name.trim() || agent.command}
        </DropdownMenu.Item>
      {/each}
    {:else}
      <div class={cn("px-2 py-1.5", text.meta)}>{i18n.t("agent.none")}</div>
    {/if}

    {#if onNewWorktree}
      <DropdownMenu.Separator />
      <DropdownMenu.Item class={text.menu} onclick={onNewWorktree}>
        <GitBranchPlusIcon class={icon.button} />
        {i18n.t("project.newWorktree")}
      </DropdownMenu.Item>
    {/if}

    <DropdownMenu.Separator />
    <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
      <SettingsIcon class={icon.button} />
      {i18n.t("agent.configure")}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
