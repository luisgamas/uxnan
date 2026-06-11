<script lang="ts">
  import * as Card from "$lib/components/ui/card";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { projects } from "$lib/state/projects.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import NewWorktreeDialog from "./NewWorktreeDialog.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import type { RepoData } from "$lib/types";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import GitBranchPlusIcon from "@lucide/svelte/icons/git-branch-plus";
  import MoreVerticalIcon from "@lucide/svelte/icons/ellipsis-vertical";
  import CopyIcon from "@lucide/svelte/icons/copy";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  let { repo }: { repo: RepoData } = $props();

  let newWorktreeOpen = $state(false);
  let confirmRemoveOpen = $state(false);

  const count = $derived(projects.worktreeCount(repo.id));
</script>

<Card.Root class="gap-0 rounded-md border border-sidebar-border py-2.5 shadow-none ring-0">
  <Card.Header class="gap-0 px-2.5 [.border-b]:pb-0">
    <div class="flex min-w-0 items-center gap-1.5">
      <FolderGitIcon class="size-3.5 shrink-0 text-muted-foreground" />
      <Card.Title class="truncate text-[13px]" title={repo.name}>{repo.name}</Card.Title>
    </div>
    <Card.Description class="truncate text-[11px]" title={repo.path}>
      {repo.path}
    </Card.Description>

    <Card.Action class="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Open a terminal in this project"
        onclick={() => projects.openTerminalAt(repo.path)}
      >
        <TerminalIcon class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title="New worktree…"
        onclick={() => (newWorktreeOpen = true)}
      >
        <GitBranchPlusIcon class="size-3.5" />
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button variant="ghost" size="icon-sm" title="More" {...props}>
              <MoreVerticalIcon class="size-3.5" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-44">
          <DropdownMenu.Item class="text-xs" onclick={() => clipboardWrite(repo.path)}>
            <CopyIcon class="size-3.5" />
            Copy path
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item
            variant="destructive"
            class="text-xs"
            onclick={() => (confirmRemoveOpen = true)}
          >
            <Trash2Icon class="size-3.5" />
            Remove project
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </Card.Action>
  </Card.Header>

  {#if count > 0}
    <Card.Content class="px-2.5 pt-1.5">
      <Badge variant="secondary" class="text-[10px] font-normal">
        {count}
        {count === 1 ? "worktree" : "worktrees"}
      </Badge>
    </Card.Content>
  {/if}
</Card.Root>

<NewWorktreeDialog {repo} bind:open={newWorktreeOpen} />
<ConfirmDialog
  bind:open={confirmRemoveOpen}
  title="Remove project?"
  description={`"${repo.name}" will be removed from the ADE. The repository on disk is not touched.`}
  confirmLabel="Remove"
  danger
  onconfirm={() => projects.removeProject(repo.id)}
/>
