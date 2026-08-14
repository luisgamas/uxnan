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
  import { Icon } from "$lib/components/ui/icon";
  import TerminalIcon from "@hugeicons/core-free-icons/TerminalIcon";
  import MoonIcon from "@hugeicons/core-free-icons/MoonIcon";
  import SunIcon from "@hugeicons/core-free-icons/Sun01Icon";
  import BotIcon from "@hugeicons/core-free-icons/BotIcon";
  import ActivityIcon from "@hugeicons/core-free-icons/Activity01Icon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";
  import ImageIcon from "@hugeicons/core-free-icons/Image01Icon";
  import StickyNoteIcon from "@hugeicons/core-free-icons/StickyNote01Icon";
  import SettingsIcon from "@hugeicons/core-free-icons/Settings01Icon";
  import GitPullRequestIcon from "@hugeicons/core-free-icons/GitPullRequestIcon";
  import CircleDotIcon from "@hugeicons/core-free-icons/CircleDotIcon";
  import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
  import Trash2Icon from "@hugeicons/core-free-icons/Delete02Icon";
  import PinIcon from "@hugeicons/core-free-icons/PinIcon";
  import PinOffIcon from "@hugeicons/core-free-icons/PinOffIcon";

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
  /** The workspace key for this row — the pair (machine, path), which is what
   *  terminals are filed under. */
  const wsKey = $derived(projects.workspaceFor(path));
  // Agents currently running in this workspace (for the "Active agents" submenu).
  const activeAgents = $derived(terminals.agentTabs(wsKey));
  // Live-space state for the sleep/wake item.
  const termCount = $derived(terminals.terminalCount(wsKey));
  const asleep = $derived(terminals.isWorkspaceAsleep(wsKey));

  function profileLabel(name: string): string {
    return name.trim() || i18n.t("terminal.unnamedProfile");
  }
</script>

<ContextMenu.Content width="wide">
  <!-- Terminals -->
  <ContextMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path)}>
    <Icon icon={TerminalIcon} />
    {i18n.t("terminal.newDefault")}
    <KeyChord chord={resolveBinding("newTerminal")} class="ml-auto pl-2" />
  </ContextMenu.Item>
  {#if profiles.length}
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger class={text.menu}>
        <Icon icon={TerminalIcon} />
        {i18n.t("ctx.terminalProfiles")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent width="standard">
        {#each profiles as p (p.id)}
          <ContextMenu.Item class={text.menu} onclick={() => projects.openTerminalAt(path, p.id)}>
            <Icon icon={TerminalIcon} />
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
      <Icon icon={BotIcon} />
      {i18n.t("ctx.launchAgent")}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent width="standard">
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
        <Icon icon={ActivityIcon} />
        {i18n.t("ctx.activeAgents")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent width="standard">
        {#each activeAgents as t (t.id)}
          {@const d = resolveAgentDisplay(t)}
          <ContextMenu.Item
            class={text.menu}
            onclick={() => {
              projects.setActiveWorktree(path);
              terminals.revealTab(wsKey, t.id);
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
    <ContextMenu.Item class={text.menu} onclick={() => terminals.wakeWorkspace(wsKey)}>
      <Icon icon={SunIcon} />
      {i18n.t("workspace.wake")}
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {:else if onSleep && termCount > 0}
    <ContextMenu.Item class={text.menu} onclick={onSleep}>
      <Icon icon={MoonIcon} />
      {i18n.t("workspace.sleep")}
      <KeyChord chord={resolveBinding("sleepWorkspace")} class="ml-auto pl-2" />
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {/if}

  {#if onTogglePin}
    <ContextMenu.Item class={text.menu} onclick={onTogglePin}>
      {#if pinned}
        <Icon icon={PinOffIcon} />
        {i18n.t("common.unpin")}
      {:else}
        <Icon icon={PinIcon} />
        {i18n.t("common.pin")}
      {/if}
    </ContextMenu.Item>
    <ContextMenu.Separator />
  {/if}

  <OpenWith menu={ContextMenu} {path} />
  <ContextMenu.Item class={text.menu} onclick={() => void revealPath(path)}>
    <Icon icon={FolderOpenIcon} />
    {i18n.t("ctx.reveal")}
  </ContextMenu.Item>
  <ContextMenu.Item class={text.menu} onclick={() => clipboardWrite(path)}>
    <Icon icon={CopyIcon} />
    {i18n.t("common.copyPath")}
  </ContextMenu.Item>
  {#if onChangeIcon}
    <!-- Defer the dialog open until this context menu has fully closed, so its
         teardown releases the body pointer-lock before the dialog captures it. -->
    <ContextMenu.Item class={text.menu} onclick={() => deferModalOpen(onChangeIcon)}>
      <Icon icon={ImageIcon} />
      {i18n.t("worktree.changeIcon")}
    </ContextMenu.Item>
  {/if}
  {#if onEditNote}
    <ContextMenu.Item class={text.menu} onclick={() => deferModalOpen(onEditNote)}>
      <Icon icon={StickyNoteIcon} />
      {i18n.t("worktree.editNote")}
    </ContextMenu.Item>
  {/if}

  <ContextMenu.Sub>
    <ContextMenu.SubTrigger class={text.menu}>
      <Icon icon={SettingsIcon} />
      {i18n.t("ctx.configure")}
    </ContextMenu.SubTrigger>
    <ContextMenu.SubContent width="standard">
      <ContextMenu.Item class={text.menu} onclick={() => app.openSettings("agents")}>
        <Icon icon={BotIcon} />
        {i18n.t("agent.configure")}
      </ContextMenu.Item>
      <ContextMenu.Item class={text.menu} onclick={() => app.openSettings("terminal")}>
        <Icon icon={TerminalIcon} />
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
        <Icon icon={GitPullRequestIcon} />
        {i18n.t("github.title")}
      </ContextMenu.SubTrigger>
      <ContextMenu.SubContent width="standard">
        <!-- The heading MUST sit inside a Group: bits-ui resolves it through the
             group context and throws without one, which silently kills the whole
             submenu (it never renders). -->
        <ContextMenu.Group>
          <ContextMenu.GroupHeading class="max-w-56 truncate {text.menuLabel}">
            {repo?.name ?? i18n.t("github.title")}
          </ContextMenu.GroupHeading>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "pulls")}>
            <Icon icon={GitPullRequestIcon} />
            {i18n.t("github.nav.pulls")}
          </ContextMenu.Item>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "issues")}>
            <Icon icon={CircleDotIcon} />
            {i18n.t("github.nav.issues")}
          </ContextMenu.Item>
          <ContextMenu.Item class={text.menu} onclick={() => github.openSection(githubPath, "actions")}>
            <Icon icon={PlayIcon} />
            {i18n.t("github.nav.actions")}
          </ContextMenu.Item>
        </ContextMenu.Group>
      </ContextMenu.SubContent>
    </ContextMenu.Sub>
  {/if}

  {#if onRemove}
    <ContextMenu.Separator />

    <ContextMenu.Item variant="destructive" class={text.menu} onclick={() => deferModalOpen(onRemove)}>
      <Icon icon={Trash2Icon} />
      {removeLabel}
    </ContextMenu.Item>
  {/if}
</ContextMenu.Content>
