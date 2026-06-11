<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let { row }: { row: WorktreeRow } = $props();

  const active = $derived(projects.activeWorktreePath === row.path);
  const label = $derived(row.branch ?? i18n.t("worktree.detached"));
  const status = $derived(projects.status(row.path));
  const termCount = $derived(terminals.terminalCount(row.path));

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

<div
  class={cn(
    "group flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1 hover:bg-accent/40",
    active && "bg-accent/60",
  )}
  role="button"
  tabindex="0"
  title={row.path}
  onclick={() => projects.setActiveWorktree(row.path)}
  onkeydown={(e) =>
    (e.key === "Enter" || e.key === " ") && projects.setActiveWorktree(row.path)}
>
  <span
    class={cn(
      "h-4 w-0.5 shrink-0 rounded-full",
      active ? "bg-ring" : "bg-transparent",
    )}
  ></span>
  <GitBranchIcon class={cn(icon.decorative, "shrink-0 text-muted-foreground")} />
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <span class={cn("truncate", text.body)}>{label}</span>
    {#if status && status.dirty > 0}
      <span
        class={cn(
          "inline-flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400",
          text.indicator,
        )}
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
    {#if termCount > 0}
      <span
        class={cn(
          "inline-flex shrink-0 items-center gap-0.5 text-emerald-600 dark:text-emerald-400",
          text.indicator,
        )}
        title={i18n.t("worktree.runningTooltip", { n: termCount })}
      >
        <TerminalIcon class={icon.decorative} />{termCount}
      </span>
    {/if}
  </div>

  <Button
    variant="ghost"
    size="icon"
    class={cn(iconButton.action, "opacity-0 group-hover:opacity-100")}
    title={i18n.t("worktree.openTerminal")}
    onclick={(e) => {
      e.stopPropagation();
      projects.openTerminalAt(row.path);
    }}
  >
    <TerminalIcon class={icon.button} />
  </Button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          variant="ghost"
          size="icon"
          class={cn(iconButton.action, "opacity-0 group-hover:opacity-100")}
          title={i18n.t("common.more")}
          onclick={(e: MouseEvent) => e.stopPropagation()}
          {...props}
        >
          <MoreVerticalIcon class={icon.button} />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-44">
      <DropdownMenu.Item class={text.menu} onclick={() => clipboardWrite(row.path)}>
        <CopyIcon class={icon.button} />
        {i18n.t("common.copyPath")}
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item variant="destructive" class={text.menu} onclick={openRemove}>
        <Trash2Icon class={icon.button} />
        {i18n.t("worktree.removeWorktree")}
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
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
