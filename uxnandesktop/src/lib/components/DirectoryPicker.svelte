<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Tabs from "$lib/components/ui/tabs";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Spinner } from "$lib/components/ui/spinner";
  import { githubClone } from "$lib/api";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import {
    classifyProjectInput,
    githubCloneDestination,
    parseGitHubRepositoryInput,
  } from "$lib/githubInput";
  import { samePath } from "$lib/pathid";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { isMac } from "$lib/keybindings";
  import Kbd from "./Kbd.svelte";
  import DirectoryBrowser from "./DirectoryBrowser.svelte";
  import AddProjectDialog from "./AddProjectDialog.svelte";
  import type { DirEntry, DirListing } from "$lib/types";
  import { Icon } from "$lib/components/ui/icon";
  import LayersIcon from "@hugeicons/core-free-icons/Layers01Icon";
  import GithubIcon from "@hugeicons/core-free-icons/GithubIcon";
  import SearchIcon from "@hugeicons/core-free-icons/Search01Icon";
  import CornerLeftUpIcon from "@hugeicons/core-free-icons/CornerLeftUpIcon";
  import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
  import FolderOpenIcon from "@hugeicons/core-free-icons/FolderOpenIcon";

  type SourceMode = "auto" | "local" | "github";

  let { open = $bindable(false) }: { open?: boolean } = $props();

  let mode = $state<SourceMode>("auto");
  let sourceInput = $state("");
  let listing = $state<DirListing | null>(null);
  let path = $state("");
  let error = $state<string | null>(null);
  let busyPath = $state<string | null>(null);
  let browserKey = $state<((e: KeyboardEvent) => void) | undefined>(undefined);
  let browserNavigate = $state<((target?: string) => Promise<void>) | undefined>(undefined);
  let selectOpen = $state(false);
  let cloneDestination = $state("");
  let previousSuggestedDestination = $state("");
  let cloneBusy = $state(false);
  let clonePhase = $state<"cloning" | "adding" | null>(null);
  let cloneError = $state<string | null>(null);
  let previousListingPath = $state("");
  let homePath = $state("");

  const detectedKind = $derived(classifyProjectInput(sourceInput));
  const showsGitHub = $derived(mode === "github" || (mode === "auto" && detectedKind === "github"));
  const cloneRepository = $derived(showsGitHub ? parseGitHubRepositoryInput(sourceInput) : null);
  // `<home>/uxnan/repos/<repo>`, beside `<home>/uxnan/worktrees`. Clones used to
  // land directly in `<home>/uxnan`, which made the worktree root just another
  // folder among the projects — a repository literally named `worktrees` would
  // have collided with it, and the folder needed explaining. Two folders with
  // obvious roles explain themselves. Only the suggestion changes: the field is
  // editable, and clones already on disk stay where they are.
  const suggestedDestination = $derived(
    cloneRepository
      ? githubCloneDestination(
          githubCloneDestination(
            githubCloneDestination(homePath || listing?.path || path, "uxnan"),
            "repos",
          ),
          cloneRepository.repo,
        )
      : "",
  );
  const repoChildCount = $derived(listing?.entries.filter((entry) => entry.isRepo).length ?? 0);
  const hasRepoChildren = $derived(repoChildCount > 0);

  const baseName = (value: string) => value.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? value;

  $effect(() => {
    if (!open) {
      mode = "auto";
      sourceInput = "";
      error = null;
      busyPath = null;
      cloneDestination = "";
      previousSuggestedDestination = "";
      cloneBusy = false;
      clonePhase = null;
      cloneError = null;
      previousListingPath = "";
      homePath = "";
    }
  });

  $effect(() => {
    const nextPath = listing?.path ?? "";
    if (!nextPath || nextPath === previousListingPath) return;
    previousListingPath = nextPath;
    if (!homePath) homePath = nextPath;
    if (mode !== "github" && classifyProjectInput(sourceInput) !== "github") sourceInput = nextPath;
  });

  $effect(() => {
    const next = suggestedDestination;
    if (!cloneDestination || cloneDestination === previousSuggestedDestination) cloneDestination = next;
    previousSuggestedDestination = next;
  });

  async function add(target: string): Promise<void> {
    busyPath = target;
    const ok = await projects.addProjectPath(target);
    busyPath = null;
    if (ok) open = false;
    else error = projects.error;
  }

  function addFolder(): void {
    if (!listing) return;
    if (listing.entries.length === 0) void add(listing.path);
    else selectOpen = true;
  }

  async function submitSource(): Promise<void> {
    if (showsGitHub) {
      await cloneAndAdd();
      return;
    }
    const target = sourceInput.trim();
    if (target) await browserNavigate?.(target);
  }

  async function chooseCloneFolder(): Promise<void> {
    if (!cloneRepository || cloneBusy) return;
    const { open: openFolder } = await import("@tauri-apps/plugin-dialog");
    const selected = await openFolder({
      multiple: false,
      directory: true,
      title: i18n.t("picker.githubChooseFolderTitle"),
      defaultPath: homePath || undefined,
    });
    if (typeof selected !== "string") return;
    cloneDestination = githubCloneDestination(selected, cloneRepository.repo);
    previousSuggestedDestination = cloneDestination;
  }

  async function cloneAndAdd(): Promise<void> {
    const repository = cloneRepository;
    const destination = cloneDestination.trim();
    if (!repository || !destination || cloneBusy) return;
    cloneBusy = true;
    clonePhase = "cloning";
    cloneError = null;
    try {
      const clonedPath = await githubClone(repository.nameWithOwner, destination);
      clonePhase = "adding";
      const added = await projects.addProjectPath(clonedPath);
      if (!added) {
        cloneError = projects.error;
        return;
      }
      const repo = app.repos.find((candidate) => samePath(candidate.path, clonedPath));
      if (repo) projects.setActiveWorktree(projects.mainWorktree(repo.id)?.path ?? repo.path);
      open = false;
    } catch (cause) {
      cloneError =
        cause && typeof cause === "object" && "message" in cause
          ? String((cause as { message: unknown }).message)
          : String(cause);
    } finally {
      cloneBusy = false;
      clonePhase = null;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content size="large" composition="sectioned" class="overflow-hidden" onkeydown={browserKey}>
    <div class="flex flex-col gap-1 border-b border-border/60 px-5 pb-4 pt-5 pr-11">
      <Dialog.Title class="text-[15px] font-semibold leading-none">{i18n.t("picker.title")}</Dialog.Title>
      <Dialog.Description class={text.meta}>{i18n.t("picker.desc")}</Dialog.Description>
    </div>

    <div class="flex flex-col gap-3 px-5 pb-3 pt-4">
      <Tabs.Root bind:value={mode} class="gap-3">
        <Tabs.List class="h-9 w-full">
          <Tabs.Trigger value="auto" class={cn("flex-1 rounded-md border-b-0", mode === "auto" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{i18n.t("picker.mode.auto")}</Tabs.Trigger>
          <Tabs.Trigger value="local" class={cn("flex-1 rounded-md border-b-0", mode === "local" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{i18n.t("picker.mode.local")}</Tabs.Trigger>
          <Tabs.Trigger value="github" class={cn("flex-1 rounded-md border-b-0", mode === "github" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{i18n.t("picker.mode.github")}</Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>

      <div class="flex items-center gap-2">
        <div class="relative min-w-0 flex-1">
          <Icon
            icon={showsGitHub ? GithubIcon : SearchIcon}
            class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/75"
          />
          <Input
            class="h-10 pl-9"
            bind:value={sourceInput}
            placeholder={i18n.t(mode === "github" ? "picker.githubPlaceholder" : mode === "local" ? "picker.pathPlaceholder" : "picker.autoPlaceholder")}
            autocomplete="off"
            spellcheck={false}
            disabled={cloneBusy}
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void submitSource();
              }
            }}
          />
        </div>
        {#if !showsGitHub}
          <Button
            variant="outline"
            size="icon-sm"
            class="size-10 shrink-0"
            aria-label={i18n.t("picker.parent")}
            disabled={!listing?.parent}
            onclick={() => listing?.parent && browserNavigate?.(listing.parent)}
          >
            <Icon icon={CornerLeftUpIcon} class={icon.button} />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            class="size-10 shrink-0"
            aria-label={i18n.t("picker.refresh")}
            disabled={!listing}
            onclick={() => listing && browserNavigate?.(listing.path)}
          >
            <Icon icon={RefreshIcon} class={icon.button} />
          </Button>
        {/if}
      </div>
    </div>

    {#if showsGitHub}
      <div class="px-5 pb-4">
        <div class="min-h-48 rounded-lg border border-border/60 bg-background p-1">
          {#if cloneRepository}
            <div class="flex min-h-12 items-center gap-3 rounded-md bg-accent px-3 py-2.5">
              <Icon icon={GithubIcon} class={cn(icon.button, "shrink-0 text-primary")} />
              <div class="min-w-0 flex-1">
                <p class={cn("truncate", text.bodyStrong)}>{cloneRepository.nameWithOwner}</p>
                <p class={cn("truncate", text.meta)}>{i18n.t("picker.githubReady")}</p>
              </div>
            </div>
            <div class="mx-3 mt-3 flex flex-col gap-1.5 border-t border-border/50 pt-3">
              <label for="picker-clone-destination" class={text.meta}>{i18n.t("picker.githubDestination")}</label>
              <div class="flex items-center gap-2">
                <Input class="min-w-0 flex-1" id="picker-clone-destination" bind:value={cloneDestination} autocomplete="off" disabled={cloneBusy} />
                <Button variant="outline" class="shrink-0" disabled={cloneBusy} onclick={chooseCloneFolder}>
                  <Icon icon={FolderOpenIcon} data-icon="inline-start" />
                  {i18n.t("picker.githubChooseFolder")}
                </Button>
              </div>
              <p class={text.meta}>{i18n.t("picker.githubDefaultDestination")}</p>
            </div>
          {:else}
            <div class="flex min-h-44 flex-col items-center justify-center gap-2 px-6 text-center">
              <Icon icon={GithubIcon} class="size-6 text-muted-foreground/40" />
              <p class={text.meta}>
                {sourceInput.trim() ? i18n.t("picker.githubInvalid") : i18n.t("picker.githubEmpty")}
              </p>
            </div>
          {/if}
        </div>
        {#if cloneError}<p class="pt-2 text-xs leading-5 text-destructive">{cloneError}</p>{/if}
      </div>
    {:else}
      <DirectoryBrowser
        active={open}
        bind:listing
        bind:path
        bind:keydownHandler={browserKey}
        bind:navigateHandler={browserNavigate}
        busy={busyPath !== null}
        listClass="h-60"
        showLocationBar={false}
        onPrimary={addFolder}
      >
        {#snippet note()}
          {#if hasRepoChildren}
            <div class="flex items-center gap-3 border-b border-border/60 bg-primary/5 px-5 py-2.5">
              <Icon icon={LayersIcon} class={cn(icon.button, "shrink-0 text-primary")} />
              <p class="min-w-0 flex-1 text-xs text-muted-foreground">
                {i18n.t("picker.bulkHint", { repos: String(repoChildCount) })}
              </p>
            </div>
          {/if}
        {/snippet}
        {#snippet rowAction(entry: DirEntry)}
          <Button
            variant={entry.isRepo ? "secondary" : "ghost"}
            size="sm"
            class="h-7 shrink-0 px-2.5 text-xs opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            disabled={busyPath !== null}
            onclick={() => add(entry.path)}
          >
            {#if busyPath === entry.path}<Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />{/if}
            {busyPath === entry.path ? i18n.t("common.adding") : i18n.t("common.add")}
          </Button>
        {/snippet}
      </DirectoryBrowser>
    {/if}

    {#if error}<div class="border-t border-border/60 bg-destructive/10 px-5 py-2 text-xs text-destructive">{error}</div>{/if}

    <div class="flex min-w-0 items-center justify-between gap-3 border-t border-border/60 bg-muted/30 px-5 py-3">
      <div class="hidden min-w-0 flex-1 items-center gap-4 overflow-hidden text-xs text-muted-foreground sm:flex">
        {#if !showsGitHub}
          <span class="flex shrink-0 items-center gap-1.5"><span class="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd></span>{i18n.t("palette.hintNavigate")}</span>
          <span class="flex shrink-0 items-center gap-1.5"><span class="flex items-center gap-1"><Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd><Kbd>↵</Kbd></span>{i18n.t("picker.hintAdd")}</span>
        {/if}
      </div>
      {#if showsGitHub}
        <Button size="sm" disabled={!cloneRepository || !cloneDestination.trim() || cloneBusy} onclick={cloneAndAdd}>
          {#if cloneBusy}<Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />{/if}
          {clonePhase === "adding" ? i18n.t("picker.githubAdding") : clonePhase === "cloning" ? i18n.t("picker.githubCloning") : i18n.t("picker.githubClone")}
        </Button>
      {:else}
        <Button size="sm" disabled={!listing || busyPath !== null} onclick={addFolder}>
          {#if listing && busyPath === listing.path}<Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />{/if}
          {listing && busyPath === listing.path ? i18n.t("common.adding") : i18n.t("picker.addFolder")}
        </Button>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

{#if listing}
  <AddProjectDialog
    bind:open={selectOpen}
    folderPath={listing.path}
    folderName={baseName(listing.path)}
    entries={listing.entries}
    onadded={() => (open = false)}
  />
{/if}
