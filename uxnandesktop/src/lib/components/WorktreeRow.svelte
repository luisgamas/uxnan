<script lang="ts">
  // One worktree row — used for both the primary (main) worktree and each child.
  // Leading: an aggregate agent-status dot (or the branch icon when idle).
  // Title: the branch name + git status. Second line: the worktree folder name.
  // Left-click opens (and links) the worktree, spawning a default-profile
  // terminal if the workspace has none yet. Right-click opens a rich context
  // menu (terminals · agents · reveal · configure · remove) — the row no longer
  // carries a persistent overflow button.
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { cn } from "$lib/utils";
  import { icon, surface, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import RowActionsMenu from "./RowActionsMenu.svelte";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
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

  function openRemove() {
    forceNeeded = false;
    removeError = null;
    removeOpen = true;
  }
  async function doRemove(force: boolean) {
    const ok = await projects.removeWorktree(row, force);
    if (ok) return true;
    removeError = projects.error;
    forceNeeded = true;
    return false;
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
        <TooltipSimple title={row.path}>
          {#snippet children(tp)}
            <div
              {...tp}
              {...props}
              class={cn(
                "group flex items-center gap-2 rounded-md py-1 pl-2 pr-2 transition-colors",
                !active && "hover:bg-foreground/[0.05]",
              )}
              role="button"
              tabindex="0"
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
                    <TooltipSimple title={i18n.t("monitor.unread")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class="size-1.5 shrink-0 rounded-full bg-red-500"></span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.dirty > 0}
                    <TooltipSimple title={i18n.t("worktree.dirtyTooltip", { n: status.dirty })}>
                      {#snippet children(tp2)}
                        <span
                          {...tp2}
                          class={cn("inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400", text.indicator)}
                        >
                          <span class="size-1.5 rounded-full bg-amber-500"></span>{status.dirty}
                        </span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.ahead > 0}
                    <TooltipSimple title={i18n.t("worktree.aheadTooltip")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class={cn("shrink-0 text-muted-foreground", text.indicator)}>↑{status.ahead}</span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
                  {#if status && status.behind > 0}
                    <TooltipSimple title={i18n.t("worktree.behindTooltip")}>
                      {#snippet children(tp2)}
                        <span {...tp2} class={cn("shrink-0 text-muted-foreground", text.indicator)}>↓{status.behind}</span>
                      {/snippet}
                    </TooltipSimple>
                  {/if}
            </div>
            <div class={cn("truncate", text.meta)}>{meta}</div>
          </div>
        </div>
      {/snippet}
    </TooltipSimple>
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

<ConfirmDialog
  bind:open={removeOpen}
  danger
  title={i18n.t("worktree.removeTitle")}
  description={i18n.t("worktree.removeDesc", { path: row.path, branch: label })}
  confirmLabel={forceNeeded ? i18n.t("worktree.forceRemove") : i18n.t("common.remove")}
  error={removeError}
  onconfirm={() => doRemove(forceNeeded)}
/>

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("worktree.branchIconTitle")}
  current={branchIcon}
  fallback={branchGlyph}
  onselect={(value) => void projects.setBranchIcon(row.repoId, iconKey, value)}
/>
