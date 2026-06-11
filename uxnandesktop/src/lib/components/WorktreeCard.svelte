<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let { row }: { row: WorktreeRow } = $props();

  const active = $derived(projects.activeWorktreePath === row.path);
  const label = $derived(row.branch ?? "(detached)");

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
    if (ok) {
      removeOpen = false;
    } else {
      // Most commonly: uncommitted changes → offer a forced removal.
      removeError = projects.error;
      forceNeeded = true;
    }
  }
</script>

<Card.Root
  class={cn(
    "cursor-pointer gap-0 rounded-md border border-sidebar-border py-2.5 shadow-none ring-0 transition-colors hover:bg-accent/40",
    active && "border-ring bg-accent/30",
  )}
  onclick={() => projects.setActiveWorktree(row.path)}
>
  <Card.Header class="gap-0 px-2.5 [.border-b]:pb-0">
    <div class="flex min-w-0 items-center gap-1.5">
      <GitBranchIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <Card.Title class="truncate text-[13px]" title={label}>{label}</Card.Title>
      {#if row.isMain}
        <Badge variant="outline" class="px-1 py-0 text-[9px] uppercase">main</Badge>
      {/if}
    </div>
    <Card.Description class="truncate text-[11px]" title={row.path}>
      <span class="text-muted-foreground/80">{row.repoName}</span>
      · {row.path}
    </Card.Description>

    <Card.Action class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Open a terminal here"
        onclick={(e) => {
          e.stopPropagation();
          projects.openTerminalAt(row.path);
        }}
      >
        <TerminalIcon class="size-3.5" />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              variant="ghost"
              size="icon-sm"
              title="More"
              onclick={(e: MouseEvent) => e.stopPropagation()}
              {...props}
            >
              <MoreVerticalIcon class="size-3.5" />
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
            disabled={row.isMain}
            onclick={openRemove}
          >
            <Trash2Icon class="size-3.5" />
            Remove worktree
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Card.Action>
  </Card.Header>
</Card.Root>

<Dialog.Root bind:open={removeOpen}>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>Remove worktree?</Dialog.Title>
      <Dialog.Description>
        Removes the worktree at <code class="break-all text-foreground">{row.path}</code>.
        Its branch <span class="font-medium text-foreground">{label}</span> is
        safe-deleted only if fully merged.
      </Dialog.Description>
    </Dialog.Header>

    {#if removeError}
      <div class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
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
