<script lang="ts">
  // Per-project settings: the card's display name and icon (both display-only —
  // the folder on disk is never touched), this project's own worktree folder,
  // plus read-only project info (location, type, git remote, worktree count).
  // Opened from the project card's ⋯ menu. The icon is committed immediately by
  // the shared IconPicker; the name and the worktree folder are committed on Save.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import { repoRemoteOwner, revealPath } from "$lib/api";
  import { toastError } from "$lib/toast";
  import FolderSelectDialog from "./FolderSelectDialog.svelte";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { control, icon, iconButton, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import { Icon } from "$lib/components/ui/icon";
  import FolderGitIcon from "@hugeicons/core-free-icons/FolderGitTwoIcon";
  import FolderIcon from "@hugeicons/core-free-icons/Folder01Icon";
  import PencilIcon from "@hugeicons/core-free-icons/PencilIcon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";
  import CopyIcon from "@hugeicons/core-free-icons/CopyIcon";

  let {
    repo,
    open = $bindable(false),
  }: { repo: RepoData; open?: boolean } = $props();

  const isGit = $derived(repo.isGit !== false);

  let name = $state("");
  let iconPickerOpen = $state(false);
  let busy = $state(false);
  // Resolved git remote owner (for the info panel + avatar option), lazily loaded.
  let ownerLabel = $state<string | null>(null);

  // Seed the editable name + load remote info each time the dialog opens.
  $effect(() => {
    if (!open) return;
    name = repo.name;
    worktreeRoot = repo.worktreeRoot ?? "";
    ownerLabel = null;
    if (isGit) {
      repoRemoteOwner(repo.id)
        .then((o) => (ownerLabel = o ? `${o.owner} · ${o.host}` : null))
        .catch(() => (ownerLabel = null));
    }
  });

  const worktreeCount = $derived(projects.worktreeCount(repo.id));

  // This project's own worktree folder. Blank = follow Settings → Git, which is
  // what almost every project wants; the override exists for the repository that
  // belongs on another volume, or needs a shorter path than the rest.
  let worktreeRoot = $state("");
  let rootBrowseOpen = $state(false);

  const dirty = $derived(
    name.trim() !== repo.name || worktreeRoot.trim() !== (repo.worktreeRoot ?? ""),
  );

  async function save() {
    if (busy) return;
    busy = true;
    try {
      // An empty name resets the card label to the real folder name (backend).
      if (name.trim() !== repo.name) {
        await projects.updateProject(repo.id, { name: name.trim() });
      }
      if (worktreeRoot.trim() !== (repo.worktreeRoot ?? "")) {
        await projects.setWorktreeRoot(repo.id, worktreeRoot.trim() || null);
      }
      open = false;
    } catch (e) {
      // A refused path keeps the dialog open with what they typed, so the fix is
      // one edit away rather than a retype.
      toastError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet projectGlyph()}
  {#if isGit}
    <Icon icon={FolderGitIcon} class="size-6 text-muted-foreground" />
  {:else}
    <Icon icon={FolderIcon} class="size-6 text-muted-foreground" />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content size="medium">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("projectSettings.title")}</Dialog.Title>
      <Dialog.Description>{i18n.t("projectSettings.desc")}</Dialog.Description>
    </Dialog.Header>

    <!-- min-w-0 so a long path in the info panel truncates instead of widening
         the Dialog.Content grid track (which would push everything past the
         popover background). -->
    <div class="flex min-w-0 flex-col gap-5 py-1">
      <!-- Identity: icon (click to change) + display name (avatar + field). -->
      <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <Button
          variant="outline"
          size="icon"
          type="button"
          class={cn(control.entityPicker, "group relative flex items-center justify-center border border-border/60 bg-muted/40 transition-colors hover:border-border hover:bg-muted")}
          title={i18n.t("projectSettings.changeIcon")}
          aria-label={i18n.t("projectSettings.changeIcon")}
          onclick={() => (iconPickerOpen = true)}
        >
          <EntityIcon value={repo.icon} class="size-6" fallback={projectGlyph} />
          <span
            class={cn(control.entityPickerBadge, "group-hover:text-foreground")}
          >
            <Icon icon={PencilIcon} class="size-3" />
          </span>
        </Button>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <label for="proj-name" class={cn("font-medium", text.body)}>
            {i18n.t("projectSettings.name")}
          </label>
          <Input
            id="proj-name"
            bind:value={name}
            placeholder={i18n.t("projectSettings.namePlaceholder")}
            autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && dirty && save()}
          />
          <p class={text.meta}>{i18n.t("projectSettings.nameDesc")}</p>
        </div>
      </div>

      <!-- This project's worktree folder (blank = follow the global setting). -->
      {#if isGit}
        <div class="flex flex-col gap-1.5">
          <label for="proj-worktree-root" class={cn("font-medium", text.body)}>
            {i18n.t("projectSettings.worktreeRoot")}
          </label>
          <div class="flex items-center gap-2">
            <Input
              id="proj-worktree-root"
              class="min-w-0 flex-1 font-mono text-[12px]"
              bind:value={worktreeRoot}
              spellcheck={false}
              autocomplete="off"
              placeholder={i18n.t("projectSettings.worktreeRootPlaceholder")}
              onkeydown={(e) => e.key === "Enter" && dirty && save()}
            />
            <Button variant="outline" size="sm" onclick={() => (rootBrowseOpen = true)}>
              {i18n.t("newWorktree.browse")}
            </Button>
          </div>
          <p class={text.meta}>{i18n.t("projectSettings.worktreeRootDesc")}</p>
        </div>
      {/if}

      <!-- Read-only info. -->
      <div class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/50 px-4 py-3">
        <div class="flex items-center justify-between gap-4">
          <span class={cn("shrink-0", text.meta)}>{i18n.t("projectSettings.location")}</span>
          <span class="flex min-w-0 flex-1 items-center justify-end gap-1">
            <!-- Left-truncate the path: keep the tail (…/parent/repo) visible and
                 collapse the leading folders. `dir="rtl"` puts the ellipsis at the
                 inline-end (the left in RTL); the Latin path stays a single LTR run
                 so it still reads left-to-right. -->
            <code
              dir="rtl"
              class="min-w-0 truncate text-[11px] text-muted-foreground"
              title={repo.path}>{repo.path}</code>
            <Button
              variant="ghost"
              size="icon-xs"
              class={cn(iconButton.xs, "shrink-0 text-muted-foreground/70 hover:text-foreground")}
              title={i18n.t("common.copyPath")}
              aria-label={i18n.t("common.copyPath")}
              onclick={() => clipboardWrite(repo.path)}
            >
              <Icon icon={CopyIcon} class="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              class={cn(iconButton.xs, "shrink-0 text-muted-foreground/70 hover:text-foreground")}
              title={i18n.t("ctx.reveal")}
              aria-label={i18n.t("ctx.reveal")}
              onclick={() => void revealPath(repo.path)}
            >
              <Icon icon={FolderOpenIcon} class="size-3" />
            </Button>
          </span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class={text.meta}>{i18n.t("projectSettings.type")}</span>
          <span class={cn("font-medium", text.body)}>
            {isGit ? i18n.t("projectSettings.typeGit") : i18n.t("projectSettings.typeFolder")}
          </span>
        </div>
        {#if isGit && ownerLabel}
          <div class="flex items-center justify-between gap-4">
            <span class={cn("shrink-0", text.meta)}>{i18n.t("projectSettings.remote")}</span>
            <span class={cn("min-w-0 truncate font-medium", text.body)}>{ownerLabel}</span>
          </div>
        {/if}
        {#if isGit}
          <div class="flex items-center justify-between gap-4">
            <span class={text.meta}>{i18n.t("projectSettings.worktrees")}</span>
            <span class={cn("font-medium", text.body)}>{worktreeCount}</span>
          </div>
        {/if}
      </div>
    </div>

    <Dialog.Footer>
      <Button disabled={busy || !dirty} onclick={save}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {i18n.t("common.save")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<FolderSelectDialog
  bind:open={rootBrowseOpen}
  title={i18n.t("projectSettings.worktreeRoot")}
  description={i18n.t("projectSettings.worktreeRootDesc")}
  onselect={(path) => (worktreeRoot = path)}
/>

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("projectSettings.iconTitle")}
  current={repo.icon}
  repoId={isGit ? repo.id : undefined}
  fallback={projectGlyph}
  onselect={(value) => void projects.updateProject(repo.id, { icon: value })}
/>
