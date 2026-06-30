<script lang="ts">
  // One worktree row — used for both the primary (main) worktree and each child.
  // Leading: an aggregate agent-status dot (or the branch icon when idle).
  // Title: the branch name + a "primary" badge for the main worktree + git status.
  // Second line: "main" for the primary, else the worktree folder name.
  // Hover actions: the shared launcher (+) and an overflow menu (copy / remove).
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { unread } from "$lib/state/unread.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, iconButton, surface, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import AgentSpace from "./AgentSpace.svelte";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

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

  const hoverReveal = "opacity-0 group-hover:opacity-100";

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

<!-- The whole worktree block — its row AND its agents — sits inside one surface:
     when the worktree is selected the selection fill/ring wraps everything, so the
     agents read as living in that worktree's space (not floating below it). -->
<div class={cn("flex flex-col rounded-md", active && surface.active)}>
  <div
    class={cn(
      "group flex items-center gap-2 rounded-md py-1 pl-2 pr-1 transition-colors",
      !active && "hover:bg-foreground/[0.05]",
    )}
    role="button"
    tabindex="0"
    title={row.path}
    onclick={() => projects.setActiveWorktree(row.path)}
    onkeydown={(e) =>
      (e.key === "Enter" || e.key === " ") && projects.setActiveWorktree(row.path)}
  >
    <span class="flex size-4 shrink-0 items-center justify-center">
      {#if agentStatus}
        <AgentStatusDot status={agentStatus.status} stale={agentStatus.stale} />
      {:else}
        <GitBranchIcon class={cn(icon.decorative, "text-muted-foreground")} />
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

    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            variant="ghost"
            size="icon"
            class={cn(iconButton.xs, hoverReveal)}
            title={i18n.t("common.more")}
            onclick={(e: MouseEvent) => e.stopPropagation()}
            {...props}
          >
            <MoreVerticalIcon class={icon.action} />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="min-w-44">
        <DropdownMenu.Item class={text.menu} onclick={() => clipboardWrite(row.path)}>
          <CopyIcon class={icon.button} />
          {i18n.t("common.copyPath")}
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        {#if row.isMain}
          <DropdownMenu.Item variant="destructive" class={text.menu} onclick={() => onRemoveProject?.()}>
            <Trash2Icon class={icon.button} />
            {i18n.t("project.removeProject")}
          </DropdownMenu.Item>
        {:else}
          <DropdownMenu.Item variant="destructive" class={text.menu} onclick={openRemove}>
            <Trash2Icon class={icon.button} />
            {i18n.t("worktree.removeWorktree")}
          </DropdownMenu.Item>
        {/if}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
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
