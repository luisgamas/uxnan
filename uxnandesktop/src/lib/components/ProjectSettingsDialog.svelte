<script lang="ts">
  // Per-project settings: the card's display name and icon (both display-only —
  // the folder on disk is never touched), plus read-only project info (location,
  // type, git remote, worktree count). Opened from the project card's ⋯ menu.
  // The icon is committed immediately by the shared IconPicker; the name is
  // committed on Save.
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import { repoRemoteOwner, revealPath } from "$lib/api";
  import { clipboardWrite } from "$lib/clipboard";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import type { RepoData } from "$lib/types";
  import EntityIcon from "./EntityIcon.svelte";
  import IconPicker from "./IconPicker.svelte";
  import FolderGitIcon from "@lucide/svelte/icons/folder-git-2";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import FolderOpenIcon from "@lucide/svelte/icons/folder-open";
  import CopyIcon from "@lucide/svelte/icons/copy";

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
    ownerLabel = null;
    if (isGit) {
      repoRemoteOwner(repo.id)
        .then((o) => (ownerLabel = o ? `${o.owner} · ${o.host}` : null))
        .catch(() => (ownerLabel = null));
    }
  });

  const worktreeCount = $derived(projects.worktreeCount(repo.id));
  const dirty = $derived(name.trim() !== repo.name);

  async function saveName() {
    if (busy) return;
    busy = true;
    // An empty name resets the card label to the real folder name (backend).
    await projects.updateProject(repo.id, { name: name.trim() });
    busy = false;
    open = false;
  }
</script>

{#snippet projectGlyph()}
  {#if isGit}
    <FolderGitIcon class="size-6 text-muted-foreground" />
  {:else}
    <FolderIcon class="size-6 text-muted-foreground" />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[500px]">
    <Dialog.Header>
      <Dialog.Title>{i18n.t("projectSettings.title")}</Dialog.Title>
      <Dialog.Description>{i18n.t("projectSettings.desc")}</Dialog.Description>
    </Dialog.Header>

    <!-- min-w-0 so a long path in the info panel truncates instead of widening
         the Dialog.Content grid track (which would push everything past the
         popover background). -->
    <div class="flex min-w-0 flex-col gap-5 py-1">
      <!-- Identity: icon (click to change) + display name (avatar + field). -->
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="group relative flex size-12 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/40 transition-colors hover:border-border hover:bg-muted"
          title={i18n.t("projectSettings.changeIcon")}
          aria-label={i18n.t("projectSettings.changeIcon")}
          onclick={() => (iconPickerOpen = true)}
        >
          <EntityIcon value={repo.icon} class="size-6" fallback={projectGlyph} />
          <span
            class="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs group-hover:text-foreground"
          >
            <PencilIcon class="size-3" />
          </span>
        </button>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <label for="proj-name" class={cn("font-medium", text.body)}>
            {i18n.t("projectSettings.name")}
          </label>
          <Input
            id="proj-name"
            bind:value={name}
            placeholder={i18n.t("projectSettings.namePlaceholder")}
            autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && dirty && saveName()}
          />
          <p class={text.meta}>{i18n.t("projectSettings.nameDesc")}</p>
        </div>
      </div>

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
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:text-foreground"
              title={i18n.t("common.copyPath")}
              aria-label={i18n.t("common.copyPath")}
              onclick={() => clipboardWrite(repo.path)}
            >
              <CopyIcon class="size-3" />
            </button>
            <button
              class="shrink-0 rounded p-0.5 text-muted-foreground/70 hover:text-foreground"
              title={i18n.t("ctx.reveal")}
              aria-label={i18n.t("ctx.reveal")}
              onclick={() => void revealPath(repo.path)}
            >
              <FolderOpenIcon class="size-3" />
            </button>
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
      <Button disabled={busy || !dirty} onclick={saveName}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {i18n.t("common.save")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<IconPicker
  bind:open={iconPickerOpen}
  title={i18n.t("projectSettings.iconTitle")}
  current={repo.icon}
  repoId={isGit ? repo.id : undefined}
  fallback={projectGlyph}
  onselect={(value) => void projects.updateProject(repo.id, { icon: value })}
/>
