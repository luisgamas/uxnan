<script lang="ts">
  // One worktree row — used for both the primary (main) worktree and each child.
  // Leading: an aggregate agent-status dot (or the branch icon when idle).
  // Title: the branch name + git status. Second line: the worktree folder name.
  // Left-click opens (and links) the worktree, spawning a default-profile
  // terminal if the workspace has none yet. Right-click opens a rich context
  // menu (terminals · agents · reveal · configure · remove) — the row no longer
  // carries a persistent overflow button.
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { icon, surface, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import RowActionsMenu from "./RowActionsMenu.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";

  let {
    row,
    onRemoveProject,
  }: {
    row: WorktreeRow;
    /** Main worktree only: "remove" removes the whole project (the card owns it). */
    onRemoveProject?: () => void;
  } = $props();

  const active = $derived(projects.activeWorktreePath === row.path);
  const label = $derived(row.branch ?? i18n.t("worktree.detached"));
  const status = $derived(projects.status(row.path));
  const hasUnread = $derived(unread.has(row.path));
  const dirName = $derived(
    row.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? row.path,
  );
  const meta = $derived(dirName);

  // Aggregate agent status for the leading dot: a working agent wins, else the
  // first one; null when the worktree has no agents (show the branch icon).
  const agentStatus = $derived.by(() => {
    const ds = terminals
      .agentTabs(row.path)
      .map((t) => resolveAgentDisplay(t))
      .filter((d): d is NonNullable<typeof d> => d != null);
    return ds.find((d) => d.status === "working") ?? ds[0] ?? null;
  });

  // Left-click / Enter: select + link the worktree, and open a default-profile
  // terminal only when the workspace has none (so repeated clicks don't stack
  // duplicate terminals).
  function activate() {
    projects.setActiveWorktree(row.path);
    if (terminals.terminalCount(row.path) === 0) projects.openTerminalAt(row.path);
  }

  // The stable per-branch icon key (branch name, or path when detached) + the
  // custom icon stored for it (undefined → the default branch glyph).
  const iconKey = $derived(projects.branchIconKey(row));
  const branchIcon = $derived(projects.branchIcon(row.repoId, iconKey));

  let iconPickerOpen = $state(false);
  let removeOpen = $state(false);
  let forceNeeded = $state(false);
  let removeError = $state<string | null>(null);
  let busy = $state(false);

  function openRemove() {
    forceNeeded = false;
    removeError = null;
    removeOpen = true;
  }
  async function doRemove(force: boolean) {
    busy = true;
    const ok = await projects.removeWorktree(row, force);
    busy = false;
    if (ok) removeOpen = false;
    else {
      removeError = projects.error;
      forceNeeded = true;
    }
  }
</script>

{#snippet branchGlyph()}
  <GitBranchIcon class={cn(icon.decorative, "text-muted-foreground")} />
{/snippet}

<!-- The whole worktree block — its row AND its agents — sits inside one surface:
     when the worktree is selected the selection fill/ring wraps everything, so the
     agents read as living in that worktree's space (not floating below it). -->
<div class={cn("flex flex-col rounded-md", active && surface.active)}>
  <ContextMenu.Root>
    <ContextMenu.Trigger>
      {#snippet child({ props })}
        <div
          {...props}
          class={cn(
            "group flex items-center gap-2 rounded-md py-1 pl-2 pr-2 transition-colors",
            !active && "hover:bg-foreground/[0.05]",
          )}
          role="button"
          tabindex="0"
          title={row.path}
          onclick={activate}
          onkeydown={(e) => (e.key === "Enter" || e.key === " ") && activate()}
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            {#if agentStatus}
              <AgentStatusDot status={agentStatus.status} stale={agentStatus.stale} />
            {:else}
              <EntityIcon value={branchIcon} class={cn(icon.decorative, "rounded-[3px]")} fallback={branchGlyph} />
            {/if}
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class={cn("truncate", text.body, active && "font-medium")}>{label}</span>
              {#if hasUnread}
                <span class="size-1.5 shrink-0 rounded-full bg-red-500" title={i18n.t("monitor.unread")}></span>
              {/if}
              {#if status && status.dirty > 0}
                <span
                  class={cn("inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400", text.indicator)}
                  title={i18n.t("worktree.dirtyTooltip", { n: status.dirty })}
                >
                  <span class="size-1.5 rounded-full bg-amber-500"></span>{status.dirty}
                </span>
              {/if}
              {#if status && status.ahead > 0}
                <span class={cn("shrink-0 text-muted-foreground", text.indicator)} title={i18n.t("worktree.aheadTooltip")}>↑{status.ahead}</span>
              {/if}
              {#if status && status.behind > 0}
                <span class={cn("shrink-0 text-muted-foreground", text.indicator)} title={i18n.t("worktree.behindTooltip")}>↓{status.behind}</span>
              {/if}
            </div>
            <div class={cn("truncate", text.meta)}>{meta}</div>
          </div>
        </div>
      {/snippet}
    </ContextMenu.Trigger>

    <RowActionsMenu
      path={row.path}
      removeLabel={row.isMain ? i18n.t("project.removeProject") : i18n.t("worktree.removeWorktree")}
      onRemove={row.isMain ? () => onRemoveProject?.() : openRemove}
      onChangeIcon={() => (iconPickerOpen = true)}
    />
  </ContextMenu.Root>

  <div class="pl-6 pr-1 pb-1">
    <AgentSpace path={row.path} />
  </div>
</div>

<Dialog.Root bind:open={removeOpen}>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("worktree.removeTitle")}</Dialog.Title>
      <Dialog.Description>
        {i18n.t("worktree.removeDesc", { path: row.path, branch: label })}
      </Dialog.Description>
    </Dialog.Header>

    {#if removeError}
      <div
        class={cn(
          "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive",
          text.body,
        )}
      >
        {removeError}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (removeOpen = false)}>{i18n.t("common.cancel")}</Button>
      {#if forceNeeded}
        <Button variant="destructive" disabled={busy} onclick={() => doRemove(true)}>
          {busy ? i18n.t("common.removing") : i18n.t("worktree.forceRemove")}
        </Button>
      {:else}
        <Button variant="destructive" disabled={busy} onclick={() => doRemove(false)}>
          {busy ? i18n.t("common.removing") : i18n.t("common.remove")}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("worktree.branchIconTitle")}
  current={branchIcon}
  fallback={branchGlyph}
  onselect={(value) => void projects.setBranchIcon(row.repoId, iconKey, value)}
/>
