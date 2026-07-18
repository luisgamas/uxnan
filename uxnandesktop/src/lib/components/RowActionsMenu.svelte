<script lang="ts">
  // The shared right-click menu body for a project/worktree context (a `path`).
  // Rendered inside a `<ContextMenu.Root>` (the caller owns the trigger), so the
  // project-card header and each worktree row expose the exact same actions —
  // terminals · agents · reveal · copy · configure · remove — without repeating
  // the markup. The destructive action is caller-supplied (remove worktree vs
  // remove project).
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { clipboardWrite } from "$lib/clipboard";
  import { revealPath } from "$lib/api";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { resolveBinding } from "$lib/keybindings";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import KeyChord from "./KeyChord.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import OpenWith from "./OpenWith.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import BotIcon from "@lucide/svelte/icons/bot";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import ImageIcon from "@lucide/svelte/icons/image";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";

  let {
    path,
    removeLabel,
    onRemove,
    onChangeIcon,
    onTogglePin,
    pinned = false,
  }: {
    /** The worktree/project folder every action targets. */
    path: string;
    /** Label for the destructive item (remove worktree vs remove project). */
    removeLabel?: string;
    /** Destructive action. Omit it to hide the item entirely (e.g. the primary
     *  worktree in the flattened status view, where project removal lives on the
     *  tree's project card instead). */
    onRemove?: () => void;
    /** When provided, adds a "Change branch icon…" item (worktree rows only). */
    onChangeIcon?: () => void;
    /** When provided, adds a pin/unpin item (reorderable child worktrees only). */
    onTogglePin?: () => void;
    /** Whether the target is currently pinned (drives the item's label/icon). */
    pinned?: boolean;
  } = $props();

  const profiles = $derived(app.terminalProfiles);
  const launchable = $derived(app.launchableAgents);
  // Agents currently running in this workspace (for the "Active agents" submenu).
  const activeAgents = $derived(terminals.agentTabs(path));

  function profileLabel(name: string): string {
    return name.trim() || i18n.t("terminal.unnamedProfile");
  }
</script>

<ContextMenu.Content>
  <!-- Terminals -->
  <ContextMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path)}>
    <TerminalIcon />
    {i18n.t("terminal.newDefault")}
    <KeyChord chord={resolveBinding("newTerminal")} class="ml-auto pl-2" />
  </ContextMenu.Item>
  {#if profiles.length}
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class={text.menu}>
        <TerminalIcon />
        {i18n.t("ctx.terminalProfiles")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        {#each profiles as p (p.id)}
          <ContextMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path, p.id)}>
            <TerminalIcon />
            {profileLabel(p.name)}
          </ContextMenu.Item>
        {/each}
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  {/if}

  <ContextMenu.Separator />

  <!-- Agents (both submenus scroll when long) -->
  <ContextMenu.Sub>
    <ContextMenu.SubTrigger class={text.menu}>
      <BotIcon />
      {i18n.t("ctx.launchAgent")}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent>
      {#if launchable.length}
        {#each launchable as a (a.id)}
          <ContextMenu.Item class={text.menu} onclick={() => projects.launchAgentAt(path, a)}>
            <AgentLogo logo={agentLogoKey(a.icon, a.command)} class="size-4 shrink-0" />
            {a.name.trim() || a.command}
          </ContextMenu.Item>
        {/each}
      {:else}
        <ContextMenu.Item class={text.menu} disabled>{i18n.t("launcher.noAgents")}</ContextMenu.Item>
      {/if}
    </ContextMenu.SubContent>
  </ContextMenu.Sub>
  {#if activeAgents.length}
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class={text.menu}>
        <ActivityIcon />
        {i18n.t("ctx.activeAgents")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        {#each activeAgents as t (t.id)}
          {@const d = resolveAgentDisplay(t)}
          <ContextMenu.Item
            class={text.menu}
            onclick={() => {
              projects.setActiveWorktree(path);
              terminals.revealTab(path, t.id);
            }}
          >
            {#if d}
              <AgentStatusDot status={d.status} stale={d.stale} />
            {/if}
            <span class="truncate">{t.agentName ?? t.title}</span>
          </ContextMenu.Item>
        {/each}
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  {/if}

  <ContextMenu.Separator />

  {#if onTogglePin}
    <ContextMenu.Item class={text.menu} onclick={onTogglePin}>
      {#if pinned}
        <PinOffIcon />
        {i18n.t("common.unpin")}
      {:else}
        <PinIcon />
        {i18n.t("common.pin")}
      {/if}
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {/if}

  <OpenWith menu={ContextMenu} {path} />
  <ContextMenu.Item class={text.menu} onclick={() => void revealPath(path)}>
    <FolderOpenIcon />
    {i18n.t("ctx.reveal")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={() => clipboardWrite(path)}>
    <CopyIcon />
    {i18n.t("common.copyPath")}
  </ContextMenu.Item>
  {#if onChangeIcon}
    <ContextMenu.Item class={text.menu} onclick={onChangeIcon}>
      <ImageIcon />
      {i18n.t("worktree.changeIcon")}
    </ContextMenu.Item>
  {/if}

  <ContextMenu.Sub>
    <ContextMenu.SubTrigger class={text.menu}>
      <SettingsIcon />
      {i18n.t("ctx.configure")}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent>
      <ContextMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
        <BotIcon />
        {i18n.t("agent.configure")}
      </ContextMenu.Item>
      <ContextMenu.Item class={text.menu} onclick={() => app.openSettings("terminal")}>
        <TerminalIcon />
        {i18n.t("ctx.configureTerminals")}
      </ContextMenu.Item>
    </ContextMenu.SubContent>
  </ContextMenu.Sub>

  {#if onRemove}
    <ContextMenu.Separator />

    <ContextMenu.Item variant="destructive" class={text.menu} onclick={onRemove}>
      <Trash2Icon />
      {removeLabel}
    </ContextMenu.Item>
  {/if}
</ContextMenu.Content>
