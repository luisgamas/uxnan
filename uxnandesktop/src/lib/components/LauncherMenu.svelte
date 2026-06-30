<script lang="ts">
  // The project's "+" — one place to start anything, in any of the project's
  // worktrees. Each worktree is a group (heading = its branch/folder) listing the
  // things you can open there: a terminal (default + each profile) and each
  // configured agent. Below: open the browser, create a worktree, agent settings.
  // Lives only on the project header (rows don't repeat it).
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import AgentLogo from "./AgentLogo.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  let {
    repo,
    onNewWorktree,
    triggerClass,
    target = null,
    align = "end",
    title,
  }: {
    repo: RepoData;
    /** When provided, the menu offers "New worktree" (the card owns the dialog). */
    onNewWorktree?: () => void;
    triggerClass?: string;
    /** When set, render ONE type-grouped menu (Terminals / Agents / Browser /
     *  Worktree) for this single worktree — used by the center tab strip's "+".
     *  Without it, the menu groups by worktree (the project-card behavior). */
    target?: { path: string; branch: string | null } | null;
    /** DropdownMenu content alignment relative to the trigger. */
    align?: "start" | "center" | "end";
    /** Trigger tooltip; defaults to the project-wide "open in {name}" copy. */
    title?: string;
  } = $props();

  const agents = $derived(app.launchableAgents);
  const profiles = $derived(app.terminalProfiles);
  const browserEnabled = $derived(app.settings.browser?.enabled ?? true);

  // Targets to launch into: the project's worktrees (primary first). A non-git
  // folder has none, so it's its own single target.
  const targets = $derived.by(() => {
    const list = projects.worktreesOf(repo.id);
    if (list.length === 0) return [{ path: repo.path, branch: null as string | null, isMain: true }];
    return [...list].sort((a, b) => (b.isMain ? 1 : 0) - (a.isMain ? 1 : 0));
  });

  function targetLabel(t: { path: string; branch: string | null }): string {
    return (
      t.branch ??
      t.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ??
      repo.name
    );
  }
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        variant="ghost"
        size="icon"
        class={cn(iconButton.xs, triggerClass)}
        title={title ?? i18n.t("launcher.open", { name: repo.name })}
        onclick={(e: MouseEvent) => e.stopPropagation()}
        {...props}
      >
        <PlusIcon class={icon.action} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content {align} class="min-w-56">
    {#if target}
      {@const t = target}
      <!-- Single-worktree mode (center "+"): sections by type. -->
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading class={text.menuLabel}>
          {i18n.t("launcher.sectionTerminals")}
        </DropdownMenu.GroupHeading>
        <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(t.path)}>
          <TerminalIcon class={icon.button} />
          {i18n.t("terminal.newDefault")}
        </DropdownMenu.Item>
        {#each profiles as p (p.id)}
          <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(t.path, p.id)}>
            <TerminalIcon class={icon.button} />
            {p.name.trim() || i18n.t("terminal.unnamedProfile")}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>

      {#if agents.length}
        <DropdownMenu.Separator />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={text.menuLabel}>
            {i18n.t("launcher.sectionAgents")}
          </DropdownMenu.GroupHeading>
          {#each agents as agent (agent.id)}
            <DropdownMenu.Item class={text.menu} onclick={() => projects.launchAgentAt(t.path, agent)}>
              <AgentLogo logo={agentLogoKey(agent.icon, agent.command)} />
              {agent.name.trim() || agent.command}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      {/if}

      {#if browserEnabled}
        <DropdownMenu.Separator />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={text.menuLabel}>
            {i18n.t("launcher.sectionBrowser")}
          </DropdownMenu.GroupHeading>
          <DropdownMenu.Item class={text.menu} onclick={() => app.openBrowser()}>
            <GlobeIcon class={icon.button} />
            {i18n.t("launcher.browser")}
          </DropdownMenu.Item>
        </DropdownMenu.Group>
      {/if}

      {#if onNewWorktree}
        <DropdownMenu.Separator />
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading class={text.menuLabel}>
            {i18n.t("launcher.sectionWorktree")}
          </DropdownMenu.GroupHeading>
          <DropdownMenu.Item class={text.menu} onclick={onNewWorktree}>
            <GitBranchPlusIcon class={icon.button} />
            {i18n.t("project.newWorktree")}
          </DropdownMenu.Item>
        </DropdownMenu.Group>
      {/if}

      <DropdownMenu.Separator />
      <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
        <SettingsIcon class={icon.button} />
        {i18n.t("agent.configure")}
      </DropdownMenu.Item>
    {:else}
    {#each targets as t (t.path)}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading class={text.menuLabel}>
          {targetLabel(t)}
        </DropdownMenu.GroupHeading>
        <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(t.path)}>
          <TerminalIcon class={icon.button} />
          {i18n.t("terminal.newDefault")}
        </DropdownMenu.Item>
        {#each profiles as p (p.id)}
          <DropdownMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(t.path, p.id)}>
            <TerminalIcon class={icon.button} />
            {p.name.trim() || i18n.t("terminal.unnamedProfile")}
          </DropdownMenu.Item>
        {/each}
        {#each agents as agent (agent.id)}
          <DropdownMenu.Item class={text.menu} onclick={() => projects.launchAgentAt(t.path, agent)}>
            <AgentLogo logo={agentLogoKey(agent.icon, agent.command)} />
            {agent.name.trim() || agent.command}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
    {/each}

    {#if browserEnabled}
      <DropdownMenu.Item class={text.menu} onclick={() => app.openBrowser()}>
        <GlobeIcon class={icon.button} />
        {i18n.t("launcher.browser")}
      </DropdownMenu.Item>
    {/if}
    {#if onNewWorktree}
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
    {/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
