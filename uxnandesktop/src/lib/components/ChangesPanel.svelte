<script lang="ts">
  // Version-control tab: the active worktree's changed files (staged / changes),
  // per-file stage / unstage / discard, a commit composer, push/pull, and a diff
  // viewer. Status updates live via the backend `git:status-changed` event.
  import { Button } from "$lib/components/ui/button";
  import { Switch } from "$lib/components/ui/switch";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Input } from "$lib/components/ui/input";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { app } from "$lib/state/app.svelte";
  import { git, type FileEntry } from "$lib/state/git.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { cn } from "$lib/utils";
  import { icon, iconButton, text } from "$lib/design";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import { i18n } from "$lib/i18n";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import VirtualList from "./VirtualList.svelte";
  import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import MinusIcon from "@lucide/svelte/icons/minus";
  import SearchIcon from "@lucide/svelte/icons/search";
  import Undo2Icon from "@lucide/svelte/icons/undo-2";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import XIcon from "@lucide/svelte/icons/x";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import UsersIcon from "@lucide/svelte/icons/users";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";

  type Area = "staged" | "changes";

  // The active worktree's git status is loaded by the parent (RightPanel), which
  // stays mounted across tab switches; this panel just renders the shared store.
  // Amend can reword the previous commit with nothing staged, so it relaxes the
  // "needs staged changes" requirement.
  const canCommit = $derived(
    (git.staged.length > 0 || git.amend) &&
      git.message.trim().length > 0 &&
      !git.committing,
  );

  // The AI "Generate" button shows only when the feature is enabled AND an agent
  // is selected (Settings → AI commit). It drafts from the staged diff.
  const aiEnabled = $derived(
    !!app.settings.aiCommit?.enabled &&
      (app.settings.aiCommit?.agentId ?? "").trim().length > 0,
  );

  // The optional commit fields (body, co-authors, amend, sign-off) live in a
  // collapsed section. Opened locally; auto-opens when any field already carries
  // a value (e.g. after an error so the user doesn't lose sight of what they set).
  let optionsOpen = $state(false);
  const hasOptions = $derived(
    git.body.trim().length > 0 ||
      git.coAuthors.length > 0 ||
      git.amend ||
      git.signOff,
  );

  function addCoAuthor() {
    git.coAuthors = [...git.coAuthors, ""];
    optionsOpen = true;
  }
  function setCoAuthor(i: number, value: string) {
    git.coAuthors = git.coAuthors.map((c, j) => (j === i ? value : c));
  }
  function removeCoAuthor(i: number) {
    git.coAuthors = git.coAuthors.filter((_, j) => j !== i);
  }
  /** Total distinct changed files (for the header count). */
  const changedCount = $derived(git.files.length);

  // Local filter (toggled from the toolbar), matches file name / path.
  let searching = $state(false);
  let query = $state("");
  function toggleSearch() {
    searching = !searching;
    if (!searching) query = "";
  }
  const fileName = (p: string) => p.split("/").pop() ?? p;
  function matches(f: FileEntry): boolean {
    const q = query.trim().toLowerCase();
    return !q || fileName(f.path).toLowerCase().includes(q) || f.path.toLowerCase().includes(q);
  }

  // Flatten the staged + changes sections into one list (section headers + file
  // rows) so a single virtualized scroll can handle a huge changeset (e.g. an
  // agent that touched hundreds of files) without lag.
  type Row =
    | { kind: "header"; area: Area; count: number }
    | { kind: "file"; area: Area; file: FileEntry };

  const rows = $derived.by<Row[]>(() => {
    const out: Row[] = [];
    const staged = git.staged.filter(matches);
    const changed = git.changed.filter(matches);
    if (staged.length > 0) {
      out.push({ kind: "header", area: "staged", count: staged.length });
      for (const f of staged) out.push({ kind: "file", area: "staged", file: f });
    }
    if (changed.length > 0) {
      out.push({ kind: "header", area: "changes", count: changed.length });
      for (const f of changed) out.push({ kind: "file", area: "changes", file: f });
    }
    return out;
  });

  // Discard confirmation target.
  let discardOpen = $state(false);
  let discardTarget = $state<FileEntry | null>(null);
  function askDiscard(f: FileEntry) {
    discardTarget = f;
    discardOpen = true;
  }

  function badge(f: FileEntry, area: Area): { letter: string; cls: string } {
    if (area === "changes" && f.untracked)
      return { letter: "U", cls: "text-emerald-600 dark:text-emerald-400" };
    const code = area === "staged" ? f.index : f.worktree;
    const cls =
      code === "M"
        ? "text-amber-600 dark:text-amber-400"
        : code === "A"
          ? "text-emerald-600 dark:text-emerald-400"
          : code === "D"
            ? "text-red-600 dark:text-red-400"
            : code === "R" || code === "C"
              ? "text-sky-600 dark:text-sky-400"
              : "text-muted-foreground";
    return { letter: code.trim() || "•", cls };
  }

  const fileDir = (p: string) => {
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
  };
</script>

{#snippet fileRow(f: FileEntry, area: Area)}
  {@const b = badge(f, area)}
  {@const isOpen =
    git.path != null && terminals.isDiffOpen(git.path, f.path, area === "staged")}
  {@const ns = git.numstat[f.path]}
  <TooltipSimple title={i18n.t("rightPanel.viewDiff")}>
    {#snippet children(tp)}
      <div
        {...tp}
        class={cn(
          "group flex h-8 cursor-pointer items-center gap-1.5 rounded-md pl-1.5 pr-1",
          isOpen ? "bg-primary/15 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/40",
        )}
        role="button"
        tabindex="0"
        onclick={() => git.path && terminals.openDiff(git.path, f.path, area === "staged")}
        onkeydown={(e) =>
          (e.key === "Enter" || e.key === " ") &&
          git.path &&
          terminals.openDiff(git.path, f.path, area === "staged")}
      >
    <span class={cn("w-3 shrink-0 text-center font-mono font-semibold", text.indicator, b.cls)}>
      {b.letter}
    </span>
    <span class={cn("min-w-0 flex-1 truncate font-medium", text.body, b.cls)}>
      {fileName(f.path)}
      {#if fileDir(f.path)}
        <span class={cn("ml-1 font-normal", text.meta)}>{fileDir(f.path)}</span>
      {/if}
    </span>
    {#if ns && (ns.added > 0 || ns.deleted > 0)}
      <span class={cn("shrink-0 tabular-nums group-hover:hidden", text.indicator)}>
        <span class="text-emerald-600 dark:text-emerald-400">+{ns.added}</span>
        <span class="ml-0.5 text-red-600 dark:text-red-400">−{ns.deleted}</span>
      </span>
    {/if}
    <div class="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
      <TooltipSimple title={i18n.t("rightPanel.discard")}>
        {#snippet children(tp)}
          <Button
            {...tp}
            variant="ghost"
            size="icon"
            class={iconButton.action}
            disabled={git.busy}
            onclick={(e) => {
              e.stopPropagation();
              askDiscard(f);
            }}
          >
            <Undo2Icon class={icon.button} />
          </Button>
        {/snippet}
      </TooltipSimple>
      {#if area === "staged"}
        <TooltipSimple title={i18n.t("rightPanel.unstage")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon"
              class={iconButton.action}
              disabled={git.busy}
              onclick={(e) => {
                e.stopPropagation();
                void git.unstage(f.path);
              }}
            >
              <MinusIcon class={icon.button} />
            </Button>
          {/snippet}
        </TooltipSimple>
      {:else}
        <TooltipSimple title={i18n.t("rightPanel.stage")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon"
              class={iconButton.action}
              disabled={git.busy}
              onclick={(e) => {
                e.stopPropagation();
                void git.stage(f.path);
              }}
            >
              <PlusIcon class={icon.button} />
            </Button>
          {/snippet}
        </TooltipSimple>
      {/if}
    </div>
  </div>
  {/snippet}
</TooltipSimple>
{/snippet}

{#snippet sectionHeader(area: Area, count: number)}
  <div class="flex h-8 items-center justify-between pl-1.5 pr-0.5">
    <span class={text.section}>
      {area === "staged" ? i18n.t("rightPanel.staged") : i18n.t("rightPanel.changes")}
      <span class="text-muted-foreground/60">({count})</span>
    </span>
    <Button
      variant="outline"
      size="sm"
      class={cn("h-6", text.body)}
      disabled={git.busy}
      onclick={() => void (area === "staged" ? git.unstageAll() : git.stageAll())}
    >
      {area === "staged" ? i18n.t("rightPanel.unstageAll") : i18n.t("rightPanel.stageAll")}
    </Button>
  </div>
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <!-- Header: stage-all (highlighted, first) · changed-file count · search · refresh -->
  <header class="flex h-9 shrink-0 items-center gap-0.5 border-b border-sidebar-border/60 px-2">
    {#if searching}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        autofocus
        type="text"
        placeholder={i18n.t("rightPanel.searchPlaceholder")}
        bind:value={query}
        class={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60",
          text.body,
        )}
        onkeydown={(e) => e.key === "Escape" && toggleSearch()}
      />
      <TooltipSimple title={i18n.t("common.close")}>
        {#snippet children(tp)}
          <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={toggleSearch}>
            <XIcon class={icon.action} />
          </Button>
        {/snippet}
      </TooltipSimple>
    {:else}
      <span class={cn("flex-1 truncate", text.section)}>
        {#if changedCount > 0}
          {i18n.plural(changedCount, "rightPanel.changedOne", "rightPanel.changedOther")}
        {/if}
      </span>
      {#if git.path}
        <TooltipSimple title={i18n.t("rightPanel.search")}>
          {#snippet children(tp)}
            <Button variant="ghost" size="icon" class={iconButton.xs} {...tp} onclick={toggleSearch}>
              <SearchIcon class={icon.action} />
            </Button>
          {/snippet}
        </TooltipSimple>
        <TooltipSimple title={i18n.t("rightPanel.refresh")}>
          {#snippet children(tp)}
            <Button
              {...tp}
              variant="ghost"
              size="icon"
              class={iconButton.xs}
              onclick={() => void git.refresh()}
            >
              <RefreshCwIcon class={cn(icon.action, git.loading && "animate-spin")} />
            </Button>
          {/snippet}
        </TooltipSimple>
      {/if}
    {/if}
  </header>

  {#if !git.path}
    <p class={cn("p-3", text.meta)}>{i18n.t("rightPanel.selectWorktree")}</p>
  {:else}
    {#if rows.length === 0}
      <p class={cn("p-3", text.meta)}>
        {query.trim()
          ? i18n.t("rightPanel.noMatch")
          : git.loading
            ? i18n.t("common.loading")
            : i18n.t("rightPanel.noChanges")}
      </p>
    {:else}
      <VirtualList items={rows} estimateSize={32} class="min-h-0 flex-1 px-2">
        {#snippet row(r)}
          {#if r.kind === "header"}
            {@render sectionHeader(r.area, r.count)}
          {:else}
            {@render fileRow(r.file, r.area)}
          {/if}
        {/snippet}
      </VirtualList>
    {/if}

    <!-- Commit composer + sync -->
    <div class="shrink-0 border-t border-sidebar-border/60 p-2">
      {#if aiEnabled}
        <div class="mb-1.5 flex justify-end">
          <TooltipSimple title={i18n.t("rightPanel.generateAiDesc")}>
            {#snippet children(tp)}
              <Button
                {...tp}
                variant="outline"
                size="sm"
                class={cn("h-6", text.body)}
                disabled={git.aiGenerating || git.committing}
                onclick={() => void git.generateMessage()}
              >
                <SparklesIcon
                  data-icon="inline-start"
                  class={cn(git.aiGenerating && "animate-pulse")}
                />
                {git.aiGenerating ? i18n.t("rightPanel.generating") : i18n.t("rightPanel.generateAi")}
              </Button>
            {/snippet}
          </TooltipSimple>
        </div>
      {/if}
      <Textarea
        class="uxnan-scroll min-h-0 resize-none text-xs"
        rows={2}
        placeholder={i18n.t("rightPanel.summaryPlaceholder")}
        bind:value={git.message}
      />

      <!-- Optional fields (body / co-authors / amend / sign-off), collapsed. -->
      <Collapsible.Root bind:open={optionsOpen} class="mt-1.5">
        <Collapsible.Trigger
          class={cn(
            "flex w-full items-center gap-1 rounded-md px-1 py-1 hover:bg-accent/40",
            text.meta,
          )}
        >
          <ChevronDownIcon
            class={cn(icon.button, "transition-transform", optionsOpen && "rotate-180")}
          />
          {i18n.t("rightPanel.commitOptions")}
          {#if !optionsOpen && hasOptions}
            <span class="ml-0.5 size-1.5 rounded-full bg-primary"></span>
          {/if}
        </Collapsible.Trigger>
        <Collapsible.Content class="mt-1.5 flex flex-col gap-2">
          <!-- Extended description (body). -->
          <Textarea
            class="uxnan-scroll min-h-0 resize-none text-xs"
            rows={3}
            placeholder={i18n.t("rightPanel.descriptionPlaceholder")}
            bind:value={git.body}
          />

          <!-- Co-authors → Co-authored-by trailers. -->
          <div class="flex flex-col gap-1">
            <span class={cn("flex items-center gap-1.5", text.meta)}>
              <UsersIcon class={icon.decorative} />
              {i18n.t("rightPanel.coAuthors")}
            </span>
            {#each git.coAuthors as coAuthor, i (i)}
              <div class="flex items-center gap-1">
                <Input
                  type="text"
                  class="h-7 min-w-0 flex-1 text-xs"
                  placeholder={i18n.t("rightPanel.coAuthorPlaceholder")}
                  value={coAuthor}
                  oninput={(e) => setCoAuthor(i, e.currentTarget.value)}
                />
                <TooltipSimple title={i18n.t("rightPanel.removeCoAuthor")}>
                  {#snippet children(tp)}
                    <Button
                      {...tp}
                      variant="ghost"
                      size="icon"
                      class={iconButton.action}
                      onclick={() => removeCoAuthor(i)}
                    >
                      <Trash2Icon class={icon.button} />
                    </Button>
                  {/snippet}
                </TooltipSimple>
              </div>
            {/each}
            <Button
              variant="outline"
              size="sm"
              class={cn("h-6 self-start", text.body)}
              onclick={addCoAuthor}
            >
              <PlusIcon data-icon="inline-start" />
              {i18n.t("rightPanel.addCoAuthor")}
            </Button>
          </div>

          <!-- Amend / sign-off toggles. -->
          <label class="flex items-center justify-between gap-2">
            <span class="flex flex-col">
              <span class={text.body}>{i18n.t("rightPanel.amend")}</span>
              <span class={text.meta}>{i18n.t("rightPanel.amendDesc")}</span>
            </span>
            <Switch checked={git.amend} onCheckedChange={(v) => (git.amend = v)} />
          </label>
          <label class="flex items-center justify-between gap-2">
            <span class="flex flex-col">
              <span class={text.body}>{i18n.t("rightPanel.signOff")}</span>
              <span class={text.meta}>{i18n.t("rightPanel.signOffDesc")}</span>
            </span>
            <Switch checked={git.signOff} onCheckedChange={(v) => (git.signOff = v)} />
          </label>
        </Collapsible.Content>
      </Collapsible.Root>

      <Button
        class="mt-1.5 w-full"
        size="sm"
        disabled={!canCommit}
        onclick={() => void git.commit()}
      >
        <GitCommitIcon data-icon="inline-start" />
        {git.committing
          ? i18n.t("rightPanel.committing")
          : git.amend
            ? i18n.t("rightPanel.amendCommit")
            : i18n.t("rightPanel.commit")}
      </Button>

      {#if git.ahead > 0 || git.behind > 0}
        <div class="mt-1.5 flex gap-1.5">
          <TooltipSimple title={i18n.t("rightPanel.pull")}>
            {#snippet children(tp)}
              <Button
                {...tp}
                variant="outline"
                size="sm"
                class="flex-1"
                disabled={git.syncing || git.behind === 0}
                onclick={() => void git.pull()}
              >
                <ArrowDownIcon data-icon="inline-start" />
                {i18n.t("rightPanel.pull")}
                {#if git.behind > 0}<span class={text.indicator}>{git.behind}</span>{/if}
              </Button>
            {/snippet}
          </TooltipSimple>
          <TooltipSimple title={i18n.t("rightPanel.push")}>
            {#snippet children(tp)}
              <Button
                {...tp}
                variant="outline"
                size="sm"
                class="flex-1"
                disabled={git.syncing || git.ahead === 0}
                onclick={() => void git.push()}
              >
                <ArrowUpIcon data-icon="inline-start" />
                {i18n.t("rightPanel.push")}
                {#if git.ahead > 0}<span class={text.indicator}>{git.ahead}</span>{/if}
              </Button>
            {/snippet}
          </TooltipSimple>
        </div>
      {/if}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={discardOpen}
  title={i18n.t("rightPanel.discardTitle")}
  description={discardTarget ? i18n.t("rightPanel.discardDesc", { file: discardTarget.path }) : ""}
  confirmLabel={i18n.t("rightPanel.discard")}
  danger
  onconfirm={() => {
    if (discardTarget) return git.discard(discardTarget.path, discardTarget.untracked);
  }}
/>
