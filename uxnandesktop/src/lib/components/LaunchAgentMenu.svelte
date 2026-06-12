<script lang="ts">
  // A Bot icon-button that drops down the registered agents and launches the
  // chosen one into `path`'s worktree. When none are configured it offers a
  // deep-link into Settings → Agents instead. Reused by the project header and
  // each worktree row.
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import BotIcon from "@lucide/svelte/icons/bot";
  import SettingsIcon from "@lucide/svelte/icons/settings";

  let {
    path,
    label,
    triggerClass,
  }: { path: string; label: string; triggerClass?: string } = $props();

  const agents = $derived(app.launchableAgents);
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button
        variant="ghost"
        size="icon"
        class={cn(iconButton.action, triggerClass)}
        title={i18n.t("agent.launchIn", { name: label })}
        onclick={(e: MouseEvent) => e.stopPropagation()}
        {...props}
      >
        <BotIcon class={icon.button} />
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-44">
    {#if agents.length > 0}
      <DropdownMenu.Group>
        <DropdownMenu.GroupHeading class={text.menuLabel}>
          {i18n.t("agent.launch")}
        </DropdownMenu.GroupHeading>
        {#each agents as agent (agent.id)}
          <DropdownMenu.Item
            class={text.menu}
            onclick={() => projects.launchAgentAt(path, agent)}
          >
            <BotIcon class={icon.button} />
            {agent.name.trim() || agent.command}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Group>
      <DropdownMenu.Separator />
    {:else}
      <div class={cn("px-2 py-1.5", text.meta)}>{i18n.t("agent.none")}</div>
      <DropdownMenu.Separator />
    {/if}
    <DropdownMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
      <SettingsIcon class={icon.button} />
      {i18n.t("agent.configure")}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
