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
  import { github } from "$lib/state/github.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { clipboardWrite } from "$lib/clipboard";
  import { revealPath } from "$lib/api";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { resolveBinding } from "$lib/keybindings";
  import { deferModalOpen } from "$lib/utils/pointerLock";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import KeyChord from "./KeyChord.svelte";
  import AgentLogo from "./AgentLogo.svelte";
  import OpenWith from "./OpenWith.svelte";
  import AgentStatusIndicator from "./AgentStatusIndicator.svelte";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import SunIcon from "@lucide/svelte/icons/sun";
  import BotIcon from "@lucide/svelte/icons/bot";
  import ActivityIcon from "@lucide/svelte/icons/activity";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import ImageIcon from "@lucide/svelte/icons/image";
  import StickyNoteIcon from "@lucide/svelte/icons/sticky-note";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import GitPullRequestIcon from "@lucide/svelte/icons/git-pull-request";
  import CircleDotIcon from "@lucide/svelte/icons/circle-dot";
  import PlayIcon from "@lucide/svelte/icons/play";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import PinIcon from "@lucide/svelte/icons/pin";
  import PinOffIcon from "@lucide/svelte/icons/pin-off";

  let {
    path,
    repoId,
    removeLabel,
    onRemove,
    onChangeIcon,
    onEditNote,
    onTogglePin,
    onSleep,
    pinned = false,
  }: {
    /** The worktree/project folder every action targets. */
    path: string;
    /** The owning project, when known — adds the GitHub submenu, which acts on
     *  the *project* (not this worktree). It matters most in the flattened
     *  "group by status" view, where the project cards (and their ⋯ menu, the
     *  only other way in) aren't rendered at all. */
    repoId?: string;
    /** Label for the destructive item (remove worktree vs remove project). */
    removeLabel?: string;
    /** Destructive action. Omit it to hide the item entirely (e.g. the primary
     *  worktree in the flattened status view, where project removal lives on the
     *  tree's project card instead). */
    onRemove?: () => void;
    /** When provided, adds a "Change branch icon…" item (worktree rows only). */
    onChangeIcon?: () => void;
    /** When provided, adds an "Edit note…" item (worktree rows only). */
    onEditNote?: () => void;
    /** When provided, adds a pin/unpin item (reorderable child worktrees only). */
    onTogglePin?: () => void;
    /** When provided, adds a "Sleep workspace" item while the workspace has
     *  live terminals (the caller owns the working-agent confirm). Waking is
     *  handled here directly — it needs no confirmation. */
    onSleep?: () => void;
    /** Whether the target is currently pinned (drives the item's label/icon). */
    pinned?: boolean;
  } = $props();

  const profiles = $derived(app.terminalProfiles);
  const launchable = $derived(app.launchableAgents);
  // The owning project, for the GitHub submenu: its main-worktree path is what
  // the inline view is scoped to (same value the project card passes). A non-git
  // folder has no GitHub to offer.
  const repo = $derived(repoId ? app.repos.find((r) => r.id === repoId) : undefined);
  const githubPath = $derived(
    repo && repo.isGit !== false
      ? (projects.mainWorktree(repo.id)?.path ?? repo.path)
      : null,
  );
  // Agents currently running in this workspace (for the "Active agents" submenu).
  const activeAgents = $derived(terminals.agentTabs(path));
  // Live-space state for the sleep/wake item.
  const termCount = $derived(terminals.terminalCount(path));
  const asleep = $derived(terminals.isWorkspaceAsleep(path));

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
              <AgentStatusIndicator status={d.status} stale={d.stale} />
            {/if}
            <span class="truncate">{t.agentName ?? t.title}</span>
          </ContextMenu.Item>
        {/each}
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  {/if}

  <ContextMenu.Separator />

  {#if asleep}
    <ContextMenu.Item class={text.menu} onclick={() => terminals.wakeWorkspace(path)}>
      <SunIcon />
      {i18n.t("workspace.wake")}
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {:else if onSleep && termCount > 0}
    <ContextMenu.Item class={text.menu} onclick={onSleep}>
      <MoonIcon />
      {i18n.t("workspace.sleep")}
      <KeyChord chord={resolveBinding("sleepWorkspace")} class="ml-auto pl-2" />
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {/if}

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
    <!-- Defer the dialog open until this context menu has fully closed, so its
         teardown releases the body pointer-lock before the dialog captures it. -->
    <ContextMenu.Item class={text.menu} onclick={() => deferModalOpen(onChangeIcon)}>
      <ImageIcon />
      {i18n.t("worktree.changeIcon")}
    </ContextMenu.Item>
  {/if}
  {#if onEditNote}
    <ContextMenu.Item class={text.menu} onclick={() => deferModalOpen(onEditNote)}>
      <StickyNoteIcon />
      {i18n.t("worktree.editNote")}
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

  {#if githubPath}
    <!-- GitHub for the OWNING PROJECT (not this worktree): the same inline view
         the project card's ⋯ menu opens, reachable from a row too — which is the
         only way in while the sidebar is grouped by status. The heading names the
         project so it's clear what the panes will be scoped to. -->
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class={text.menu}>
        <GitPullRequestIcon />
        {i18n.t("github.title")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent>
        <!-- The heading MUST sit inside a Group: bits-ui resolves it through the
             group context and throws without one, which silently kills the whole
             submenu (it never renders). -->
        <ContextMenu.Group>
          <ContextMenu.GroupHeading class="max-w-56 truncate {text.menuLabel}">
            {repo?.name ?? i18n.t("github.title")}
          </ContextMenu.GroupHeading>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "pulls")}>
            <GitPullRequestIcon />
            {i18n.t("github.nav.pulls")}
          </ContextMenu.Item>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "issues")}>
            <CircleDotIcon />
            {i18n.t("github.nav.issues")}
          </ContextMenu.Item>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "actions")}>
            <PlayIcon />
            {i18n.t("github.nav.actions")}
          </ContextMenu.Item>
        </ContextMenu.Group>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  {/if}

  {#if onRemove}
    <ContextMenu.Separator />

    <ContextMenu.Item variant="destructive" class={text.menu} onclick={() => deferModalOpen(onRemove)}>
      <Trash2Icon />
      {removeLabel}
    </ContextMenu.Item>
  {/if}
</ContextMenu.Content>
