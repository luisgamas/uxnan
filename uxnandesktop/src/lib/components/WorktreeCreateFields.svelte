<script lang="ts">
  // Shared worktree-creation form fields, reused by every entry point that
  // creates a worktree (the dedicated NewWorktreeDialog and the project "+"
  // LauncherDialog) so they never drift. Owns the New branch / Existing branch
  // toggle, the auto-name generator, the local/remote existing-branch picker, the
  // base picker and the optional custom location (editable path + in-app folder
  // browse). The parent binds the result fields and reads `effectiveBranch` /
  // `canSubmit` to drive its own submit + agent/what-to-open concerns.
  import * as Collapsible from "$lib/components/ui/collapsible";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { worktreeFolderFor, randomBranchName } from "$lib/branchName";
  import type { RepoData } from "$lib/types";
  import FolderSelectDialog from "./FolderSelectDialog.svelte";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";

  let {
    repo,
    /** Whether the containing surface is live — loads branches + resets fields. */
    active = false,
    /** "new" = create a branch; "existing" = check out an existing one. */
    mode = $bindable<"new" | "existing">("new"),
    newBranch = $bindable(""),
    existingBranch = $bindable(""),
    base = $bindable(""),
    location = $bindable(""),
    locationTouched = $bindable(false),
    /** Out: the branch the worktree ends up on (typed name or picked branch). */
    effectiveBranch = $bindable(""),
    /** Out: whether the worktree fields are valid to submit. */
    canSubmit = $bindable(false),
    /** Out: whether branch discovery is still in flight. */
    loading = $bindable(false),
    /** Enter in the branch field (parent's submit). */
    onEnter,
  }: {
    repo: RepoData;
    active?: boolean;
    mode?: "new" | "existing";
    newBranch?: string;
    existingBranch?: string;
    base?: string;
    location?: string;
    locationTouched?: boolean;
    effectiveBranch?: string;
    canSubmit?: boolean;
    loading?: boolean;
    onEnter?: () => void;
  } = $props();

  let branches = $state<string[]>([]);
  let remoteBranches = $state<string[]>([]);
  let locationOpen = $state(false);
  let browseOpen = $state(false);

  const repoName = $derived(
    repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repo.name,
  );
  const autoPath = $derived(
    effectiveBranch ? worktreeFolderFor(repo.path, effectiveBranch) : "",
  );
  const autoFolderName = $derived(autoPath.split("/").pop() ?? "");

  // Derived outputs, published to the parent's bound props.
  $effect(() => {
    effectiveBranch = (mode === "new" ? newBranch : existingBranch).trim();
  });
  const checkedOut = $derived(
    new Set(
      projects
        .worktreesOf(repo.id)
        .map((w) => w.branch)
        .filter((b): b is string => !!b),
    ),
  );
  $effect(() => {
    canSubmit =
      mode === "new"
        ? !!newBranch.trim()
        : !!existingBranch && !checkedOut.has(existingBranch);
  });

  // Keep the location in sync with the automatic path until the user takes over.
  $effect(() => {
    if (!locationTouched) location = autoPath;
  });

  const baseOptions = $derived(
    base && !branches.includes(base) ? [base, ...branches] : branches,
  );
  const baseGroups = $derived<ComboGroup[]>([
    { items: baseOptions.map((b) => ({ value: b, label: b })) },
  ]);

  // Existing-branch options: local, then remote-only (bare-named). Branches
  // already in a worktree are disabled (git refuses a second checkout).
  const existingGroups = $derived.by<ComboGroup[]>(() => {
    const localSet = new Set(branches);
    const groups: ComboGroup[] = [];
    if (branches.length) {
      groups.push({
        heading: i18n.t("newWorktree.localBranches"),
        items: branches.map((b) => ({
          value: b,
          label: b,
          disabled: checkedOut.has(b),
          meta: checkedOut.has(b) ? i18n.t("newWorktree.inUse") : undefined,
        })),
      });
    }
    const remoteOnly = remoteBranches.filter((b) => !localSet.has(b));
    if (remoteOnly.length) {
      groups.push({
        heading: i18n.t("newWorktree.remoteBranches"),
        items: remoteOnly.map((b) => ({ value: b, label: b, meta: "origin" })),
      });
    }
    return groups;
  });

  // Reset the fields + load branches when the surface becomes active.
  $effect(() => {
    if (!active) return;
    mode = "new";
    newBranch = "";
    existingBranch = "";
    locationTouched = false;
    locationOpen = false;
    loading = true;
    projects.error = null;
    projects
      .branchInfo(repo.id)
      .then((info) => {
        branches = info.branches;
        remoteBranches = info.remoteBranches;
        base = info.defaultBase;
      })
      .catch((e) => {
        projects.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => (loading = false));
  });

  function generateName() {
    newBranch = randomBranchName([...branches, ...remoteBranches]);
  }

  function onBrowse(parent: string) {
    const currentBase = location
      ? location.replace(/[\\/]+$/, "").split(/[\\/]/).pop()
      : "";
    const folderName = currentBase || autoFolderName || `${repoName}--worktree`;
    location = `${parent.replace(/\\/g, "/").replace(/\/+$/, "")}/${folderName}`;
    locationTouched = true;
  }

  function resetLocation() {
    locationTouched = false;
    location = autoPath;
  }
</script>

<div class="flex flex-col gap-4">
  <!-- Mode toggle: create a new branch, or check out an existing one. -->
  <div class="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
    {#each [{ id: "new", label: i18n.t("newWorktree.modeNew") }, { id: "existing", label: i18n.t("newWorktree.modeExisting") }] as opt (opt.id)}
      <button
        type="button"
        class={cn(
          "rounded-md px-2 py-1.5 text-sm transition-colors",
          mode === opt.id
            ? "bg-background font-medium shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onclick={() => (mode = opt.id as "new" | "existing")}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  {#if mode === "new"}
    <!-- Branch name — the focal field, with a branch glyph. The label row carries
         a clear "Generate" affordance that fills a unique auto-name. -->
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-2">
        <label for="wcf-branch" class={cn("font-medium", text.body)}>{i18n.t("newWorktree.branch")}</label>
        <button
          type="button"
          class={cn(
            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            text.meta,
          )}
          onclick={generateName}
        >
          <SparklesIcon class="size-3" />
          {i18n.t("newWorktree.generate")}
        </button>
      </div>
      <div class="relative">
        <GitBranchIcon
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
        />
        <Input
          id="wcf-branch"
          class="pl-8"
          placeholder={i18n.t("newWorktree.branchPlaceholder")}
          bind:value={newBranch}
          autocomplete="off"
          onkeydown={(e) => e.key === "Enter" && onEnter?.()}
        />
      </div>
    </div>

    <!-- Base ref — searchable Combobox. -->
    <div class="flex flex-col gap-1.5">
      <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.base")}</span>
      <Combobox
        value={base}
        groups={baseGroups}
        triggerClass="w-full"
        placeholder={i18n.t("newWorktree.selectBase")}
        searchPlaceholder={i18n.t("common.search")}
        disabled={loading}
        onChange={(v) => (base = v)}
      />
      <p class={text.meta}>{i18n.t("newWorktree.baseDesc")}</p>
    </div>
  {:else}
    <!-- Existing branch — pick any local or remote branch to check out. -->
    <div class="flex flex-col gap-1.5">
      <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.existingBranch")}</span>
      <Combobox
        value={existingBranch}
        groups={existingGroups}
        triggerClass="w-full"
        placeholder={i18n.t("newWorktree.selectExisting")}
        searchPlaceholder={i18n.t("common.search")}
        disabled={loading}
        onChange={(v) => (existingBranch = v)}
      />
      <p class={text.meta}>{i18n.t("newWorktree.existingDesc")}</p>
    </div>
  {/if}

  <!-- Optional custom location — collapsed by default. -->
  <Collapsible.Root bind:open={locationOpen}>
    <Collapsible.Trigger
      class={cn(
        "flex w-full items-center gap-1 rounded-md px-1 py-1 hover:bg-accent/40",
        text.meta,
      )}
    >
      <ChevronDownIcon
        class={cn(icon.button, "transition-transform", locationOpen && "rotate-180")}
      />
      {i18n.t("newWorktree.location")}
      {#if !locationOpen && locationTouched}
        <span class="ml-0.5 size-1.5 rounded-full bg-primary"></span>
      {/if}
    </Collapsible.Trigger>
    <Collapsible.Content class="mt-1.5 flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <Input
          class="font-mono text-xs"
          placeholder={autoPath || i18n.t("newWorktree.locationPlaceholder")}
          bind:value={location}
          spellcheck={false}
          autocomplete="off"
          oninput={() => (locationTouched = true)}
        />
        <TooltipSimple title={i18n.t("newWorktree.browse")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="outline"
              size="icon-sm"
              class="size-9 shrink-0"
              onclick={() => (browseOpen = true)}
            >
              <FolderIcon class={icon.button} />
            </Button>
          {/snippet}
        </TooltipSimple>
      </div>
      <div class="flex items-center justify-between gap-2">
        <p class={text.meta}>{i18n.t("newWorktree.locationDesc")}</p>
        {#if locationTouched}
          <button
            type="button"
            class={cn("shrink-0 underline-offset-2 hover:underline", text.meta)}
            onclick={resetLocation}
          >
            {i18n.t("newWorktree.resetLocation")}
          </button>
        {/if}
      </div>
    </Collapsible.Content>
  </Collapsible.Root>

  <!-- Where it lands — a quiet preview of the folder to be created. -->
  {#if location}
    <div class="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5">
      <FolderIcon class={cn(icon.decorative, "mt-px shrink-0 text-muted-foreground")} />
      <code class="break-all text-[11px] leading-5 text-muted-foreground">{location}</code>
    </div>
  {/if}
</div>

<FolderSelectDialog
  bind:open={browseOpen}
  title={i18n.t("newWorktree.browseTitle")}
  description={i18n.t("newWorktree.browseDesc")}
  onselect={onBrowse}
/>
