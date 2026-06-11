<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let { row }: { row: WorktreeRow } = $props();

  const active = $derived(projects.activeWorktreePath === row.path);
  const label = $derived(row.branch ?? "(detached)");
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
  <GitBranchIcon class="size-3 shrink-0 text-muted-foreground" />
  <div class="flex min-w-0 flex-1 items-center gap-1.5">
    <span class="truncate text-xs">{label}</span>
    {#if status && status.dirty > 0}
      <span
        class="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400"
        title="{status.dirty} uncommitted change{status.dirty === 1 ? '' : 's'}"
      >
        <span class="size-1.5 rounded-full bg-amber-500"></span>{status.dirty}
      </span>
    {/if}
    {#if status && status.ahead > 0}
      <span class="shrink-0 text-[10px] text-muted-foreground" title="ahead of upstream">↑{status.ahead}</span>
    {/if}
    {#if status && status.behind > 0}
      <span class="shrink-0 text-[10px] text-muted-foreground" title="behind upstream">↓{status.behind}</span>
    {/if}
    {#if termCount > 0}
      <span
        class="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400"
        title="{termCount} terminal{termCount === 1 ? '' : 's'} running"
      >
        <TerminalIcon class="size-3" />{termCount}
      </span>
    {/if}
  </div>

  <Button
    variant="ghost"
    size="icon-sm"
    class="size-6 opacity-0 group-hover:opacity-100"
    title="Open a terminal here"
    onclick={(e) => {
      e.stopPropagation();
      projects.openTerminalAt(row.path);
    }}
  >
    <TerminalIcon class="size-3" />
  </Button>
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-6 opacity-0 group-hover:opacity-100"
          title="More"
          onclick={(e: MouseEvent) => e.stopPropagation()}
          {...props}
        >
          <MoreVerticalIcon class="size-3" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-44">
      <DropdownMenu.Item class="text-xs" onclick={() => clipboardWrite(row.path)}>
        <CopyIcon class="size-3.5" />
        Copy path
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item
        variant="destructive"
        class="text-xs"
        onclick={openRemove}
      >
        <Trash2Icon class="size-3.5" />
        Remove worktree
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
</div>

<Dialog.Root bind:open={removeOpen}>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>Remove worktree?</Dialog.Title>
      <Dialog.Description>
        Removes the worktree at
        <code class="break-all text-foreground">{row.path}</code>. Its branch
        <span class="font-medium text-foreground">{label}</span> is safe-deleted
        only if fully merged.
      </Dialog.Description>
    </Dialog.Header>

    {#if removeError}
      <div
        class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {removeError}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (removeOpen = false)}>Cancel</Button>
      {#if forceNeeded}
        <Button variant="destructive" disabled={busy} onclick={() => doRemove(true)}>
          {busy ? "Removing…" : "Force remove"}
        </Button>
      {:else}
        <Button variant="destructive" disabled={busy} onclick={() => doRemove(false)}>
          {busy ? "Removing…" : "Remove"}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
