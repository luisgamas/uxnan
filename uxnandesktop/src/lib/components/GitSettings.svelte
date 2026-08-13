<script lang="ts">
  // Settings → Git: where new worktrees are created.
  //
  // Ordinary settings rows (label + control on the right), like every other
  // section — the layout is a one-of-three choice, not a screen of its own. The
  // shape the chosen layout produces is shown as the row's own helper line, so
  // the example is there without a card for each option.
  //
  // Only creation is affected: worktrees already on disk are read from
  // `git worktree list` and keep working where they are, which is why this
  // screen never offers to move anything.
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import * as Select from "$lib/components/ui/select";
  import SettingsSection from "$lib/components/SettingsSection.svelte";
  import SettingsRow from "$lib/components/SettingsRow.svelte";
  import FolderSelectDialog from "$lib/components/FolderSelectDialog.svelte";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Spinner } from "$lib/components/ui/spinner";
  import { app } from "$lib/state/app.svelte";
  import {
    gitIdentity,
    worktreeCleanupRemove,
    worktreeCleanupScan,
    worktreeCleanupSizes,
  } from "$lib/api";
  import { formatBytes } from "$lib/resources/format";
  import { toast, toastError } from "$lib/toast";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { field, text } from "$lib/design";
  import type {
    GitIdentity,
    WorktreeCleanupCandidate,
    WorktreeCleanupKind,
    WorktreeCleanupScope,
    WorktreeLocationMode,
  } from "$lib/types";

  const MODES = ["managed", "sibling", "custom"] as const satisfies readonly WorktreeLocationMode[];

  let browseOpen = $state(false);

  // Who commits are authored as. Read once when the pane opens: it comes from
  // the global git config, which nothing in the app changes.
  let identity = $state<GitIdentity | null>(null);
  $effect(() => {
    void gitIdentity()
      .then((v) => (identity = v))
      .catch(() => (identity = {}));
  });

  const unset = $derived(i18n.t("settings.gitIdentityUnset"));

  const mode = $derived<WorktreeLocationMode>(app.settings.worktrees?.location ?? "managed");
  const root = $derived(app.settings.worktrees?.root ?? "");

  const modeLabel = $derived(i18n.t(`settings.worktreeMode.${mode}`));

  function set(patch: { location?: WorktreeLocationMode; root?: string | null }) {
    app.settings.worktrees = { ...app.settings.worktrees, ...patch };
    void app.persistSettings();
  }

  // --- Cleanup ---------------------------------------------------------------
  //
  // The managed folder collects checkouts out of sight, and what is out of sight
  // never gets pruned. This lists what the backend can PROVE is disposable, and
  // nothing else: it only looks inside the managed roots, and anything with
  // uncommitted work is shown blocked rather than hidden — so "why isn't this
  // offered?" is answered on screen. Nothing is ever removed automatically.

    // Two lists, not one: a worktree and a cloned repository are different things
  // with different risk, and mixing them made "what am I about to delete?"
  // harder to answer than it needs to be. A blocked row joins whichever list it
  // belongs to, which is why the backend says which — inferring it from the
  // reason would break the moment both kinds share one.
  // Blocked comes last in both lists: it is context for what is NOT offered.
  const WORKTREE_BUCKETS: readonly WorktreeCleanupKind[] = [
    "orphaned",
    "finished",
    "unregistered",
    "blocked",
  ];
  const CLONE_BUCKETS: readonly WorktreeCleanupKind[] = ["clone", "blocked"];



  let candidates = $state<WorktreeCleanupCandidate[] | null>(null);
  let sizes = $state<Record<string, number>>({});
  let selected = $state<Set<string>>(new Set());
  let scanning = $state(false);
  let removing = $state(false);

  const bucketOf = (scope: WorktreeCleanupScope, kind: WorktreeCleanupKind) =>
    candidates?.filter((c) => c.scope === scope && c.kind === kind) ?? [];
  const scopeHas = (scope: WorktreeCleanupScope) =>
    (candidates ?? []).some((c) => c.scope === scope);
  /** The rows of a list the safety rules allow removing — never a blocked one,
   *  which is exactly what "select all" must not quietly reach for. */
  const selectableIn = (scope: WorktreeCleanupScope) =>
    (candidates ?? []).filter((c) => c.scope === scope && c.kind !== "blocked");

  function toggleScope(scope: WorktreeCleanupScope, on: boolean) {
    const next = new Set(selected);
    for (const row of selectableIn(scope)) {
      if (on) next.add(row.path);
      else next.delete(row.path);
    }
    selected = next;
  }
  const removable = $derived((candidates ?? []).filter((c) => c.kind !== "blocked"));
  const selectedSize = $derived(
    [...selected].reduce((total, path) => total + (sizes[path] ?? 0), 0),
  );
  /** Sizes are still being measured while any selected row has no figure yet. */
  const sizesPending = $derived(removable.some((c) => sizes[c.path] === undefined));

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const found = await worktreeCleanupScan();
      candidates = found;
      // Orphans are pre-selected: git owns nothing there, so there is nothing to
      // weigh up. Everything else the user picks deliberately.
      selected = new Set(found.filter((c) => c.kind === "orphaned").map((c) => c.path));
      void loadSizes(found.filter((c) => c.kind !== "blocked").map((c) => c.path));
    } catch (e) {
      candidates = [];
      toastError(e);
    } finally {
      scanning = false;
    }
  }

  async function loadSizes(paths: string[]) {
    if (paths.length === 0) return;
    try {
      const measured = await worktreeCleanupSizes(paths);
      const next = { ...sizes };
      paths.forEach((path, i) => (next[path] = measured[i] ?? 0));
      sizes = next;
    } catch {
      // A size that cannot be measured just stays unknown; it is decoration.
    }
  }

  function toggle(path: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(path);
    else next.delete(path);
    selected = next;
  }

  async function removeSelected() {
    if (removing || selected.size === 0) return;
    removing = true;
    try {
      const outcome = await worktreeCleanupRemove([...selected]);
      if (outcome.removed.length > 0) {
        toast.success(
          i18n.plural(
            outcome.removed.length,
            "settings.worktreeCleanupDoneOne",
            "settings.worktreeCleanupDoneOther",
          ),
        );
      }
      // A refusal is surfaced, never swallowed: the backend re-checks every path
      // against a fresh scan, so "it was clean a minute ago" is a real outcome.
      for (const refusal of outcome.refused) {
        toast.error(
          i18n.t("settings.worktreeCleanupRefused", {
            name: refusal.path.split("/").pop() ?? refusal.path,
            reason: refusal.reason,
          }),
        );
      }
      await scan();
    } catch (e) {
      toastError(e);
    } finally {
      removing = false;
    }
  }

  /** The reason, worded. A `switch` rather than a built key so the compiler
   *  checks every reason has a string, and so a counted one never borrows
   *  another's noun — "3 commits on no remote" is not "3 files not committed". */
  function reasonText(candidate: WorktreeCleanupCandidate): string {
    const n = candidate.changedFiles ?? 0;
    const R = "settings.worktreeCleanupReason" as const;
    switch (candidate.reason) {
      case "uncommittedChanges":
        return i18n.plural(n, `${R}.uncommittedChangesOne`, `${R}.uncommittedChangesOther`);
      case "unpushedCommits":
        return i18n.plural(n, `${R}.unpushedCommitsOne`, `${R}.unpushedCommitsOther`);
      case "hasWorktrees":
        return i18n.plural(n, `${R}.hasWorktreesOne`, `${R}.hasWorktreesOther`);
      case "repoGone":
        return i18n.t(`${R}.repoGone`);
      case "notAWorktree":
        return i18n.t(`${R}.notAWorktree`);
      case "merged":
        return i18n.t(`${R}.merged`);
      case "branchGone":
        return i18n.t(`${R}.branchGone`);
      case "projectRemoved":
        return i18n.t(`${R}.projectRemoved`);
      case "cloneFullyPushed":
        return i18n.t(`${R}.cloneFullyPushed`);
      case "hasStashes":
        return i18n.t(`${R}.hasStashes`);
      case "noRemote":
        return i18n.t(`${R}.noRemote`);
    }
  }
</script>

{#snippet value(v: string | null | undefined, missing = unset)}
  <span class={cn(v ? "font-medium text-foreground" : "text-muted-foreground", text.body)}>
    {v || missing}
  </span>
{/snippet}

<div class="flex flex-col gap-10">
  <!-- Who commits are authored as. Read-only: this is git's own global config,
       which the app reads but never writes. -->
  <SettingsSection
    title={i18n.t("settings.gitIdentity")}
    description={i18n.t("settings.gitIdentityDesc")}
  >
    <div class="divide-y divide-border/60">
      <SettingsRow label={i18n.t("settings.gitIdentityName")}>
        {#snippet control()}{@render value(identity?.name)}{/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("settings.gitIdentityEmail")}>
        {#snippet control()}{@render value(identity?.email)}{/snippet}
      </SettingsRow>
      <SettingsRow
        label={i18n.t("settings.gitDefaultBranch")}
        description={i18n.t("settings.gitDefaultBranchDesc")}
      >
        {#snippet control()}{@render value(identity?.defaultBranch, "master")}{/snippet}
      </SettingsRow>
      <SettingsRow label={i18n.t("settings.gitVersion")}>
        {#snippet control()}
          {@render value(identity?.version, i18n.t("settings.gitMissing"))}
        {/snippet}
      </SettingsRow>
      {#if identity && !identity.name && !identity.email}
        <SettingsRow description={i18n.t("settings.gitIdentityHint")} />
      {/if}
    </div>
  </SettingsSection>

  <SettingsSection
    title={i18n.t("settings.worktreeLocation")}
    description={i18n.t("settings.worktreeLocationDesc")}
  >
    <div class="divide-y divide-border/60">
      <SettingsRow
        label={i18n.t("settings.worktreeLayout")}
        description={i18n.t(`settings.worktreeMode.${mode}Example`)}
      >
        {#snippet control()}
          <Select.Root
            type="single"
            value={mode}
            onValueChange={(v) => set({ location: v as WorktreeLocationMode })}
          >
            <Select.Trigger
              class={field.selectStandard}
              aria-label={i18n.t("settings.worktreeLayout")}
            >
              {modeLabel}
            </Select.Trigger>
            <Select.Content>
              {#each MODES as m (m)}
                <Select.Item value={m} label={i18n.t(`settings.worktreeMode.${m}`)}>
                  {i18n.t(`settings.worktreeMode.${m}`)}
                </Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </SettingsRow>

      {#if mode === "custom"}
        <SettingsRow
          label={i18n.t("settings.worktreeRoot")}
          description={i18n.t("settings.worktreeRootDesc")}
          for="worktree-root"
        >
          {#snippet control()}
            <div class="flex items-center gap-2">
              <Input
                id="worktree-root"
                class={cn(field.selectStandard, "font-mono text-[12px]")}
                value={root}
                spellcheck={false}
                autocomplete="off"
                placeholder={i18n.t("settings.worktreeRootPlaceholder")}
                oninput={(e) => set({ root: e.currentTarget.value })}
              />
              <Button variant="outline" size="sm" onclick={() => (browseOpen = true)}>
                {i18n.t("newWorktree.browse")}
              </Button>
            </div>
          {/snippet}
        </SettingsRow>
      {/if}
    </div>
  </SettingsSection>

  <!-- Cleanup: only inside the managed folder, only what is provably
       disposable, and never on its own. -->
  <SettingsSection
    title={i18n.t("settings.worktreeCleanup")}
    description={i18n.t("settings.worktreeCleanupDesc")}
    headerAction={cleanupAction}
  >
    {#if candidates === null}
      <p class={text.meta}>{i18n.t("settings.worktreeCleanupIdle")}</p>
    {:else if candidates.length === 0}
      <p class={text.meta}>{i18n.t("settings.worktreeCleanupEmpty")}</p>
    {:else}
      <div class="space-y-7">
        {@render scopeList("worktree", WORKTREE_BUCKETS)}
        {@render scopeList("clone", CLONE_BUCKETS)}

        {#if removable.length > 0}
          <div class="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
            <span class={text.meta}>
              {i18n.t("settings.worktreeCleanupSelected", {
                count: selected.size,
                size: sizesPending ? "…" : formatBytes(selectedSize),
              })}
            </span>
            <Button
              variant="destructive"
              disabled={selected.size === 0 || removing}
              onclick={() => void removeSelected()}
            >
              {#if removing}
                <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
              {/if}
              {i18n.t("settings.worktreeCleanupRemove")}
            </Button>
          </div>
        {/if}
      </div>
    {/if}
  </SettingsSection>
</div>

{#snippet scopeList(
  scope: WorktreeCleanupScope,
  buckets: readonly WorktreeCleanupKind[],
)}
  {@const selectable = selectableIn(scope)}
  {@const chosen = selectable.filter((c) => selected.has(c.path)).length}
  {#if scopeHas(scope)}
    <div class="space-y-4">
      <div class="flex items-center gap-3">
        {#if selectable.length > 0}
          <Checkbox
            checked={chosen === selectable.length}
            indeterminate={chosen > 0 && chosen < selectable.length}
            disabled={removing}
            aria-label={i18n.t(`settings.worktreeCleanupSelectAll.${scope}`)}
            onCheckedChange={(v) => toggleScope(scope, v === true)}
          />
        {/if}
        <span class={cn("px-0.5", text.section)}>
          {i18n.t(`settings.worktreeCleanupScope.${scope}`)}
        </span>
      </div>
      {#each buckets as bucket (bucket)}
        {@const rows = bucketOf(scope, bucket)}
        {#if rows.length > 0}
          <div class="space-y-1.5">
            <span class={cn("px-0.5 text-[11px] uppercase tracking-wide", text.meta)}>
              {i18n.t(`settings.worktreeCleanupBucket.${bucket}`)}
            </span>
            <div class="divide-y divide-border/60">
              {#each rows as row (row.path)}
                <div class="flex items-center gap-3 py-2">
                  <Checkbox
                    checked={selected.has(row.path)}
                    disabled={row.kind === "blocked" || removing}
                    aria-label={`${row.group} / ${row.name}`}
                    onCheckedChange={(v) => toggle(row.path, v === true)}
                  />
                  <div class="min-w-0 flex-1">
                    <div class={cn("truncate", text.body)}>
                      {#if row.scope === "worktree"}
                        <span class="text-muted-foreground">{row.group}</span>
                        <span class="text-muted-foreground/50"> / </span>
                      {/if}
                      <span class="font-medium">{row.name}</span>
                    </div>
                    <div class={cn("truncate", text.meta)}>{reasonText(row)}</div>
                  </div>
                  <span class={cn("shrink-0 tabular-nums", text.meta)}>
                    {sizes[row.path] === undefined ? "—" : formatBytes(sizes[row.path])}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet cleanupAction()}
  <Button variant="outline" size="sm" disabled={scanning} onclick={() => void scan()}>
    {#if scanning}
      <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
    {/if}
    {i18n.t("settings.worktreeCleanupScan")}
  </Button>
{/snippet}

<FolderSelectDialog
  bind:open={browseOpen}
  title={i18n.t("settings.worktreeRoot")}
  description={i18n.t("settings.worktreeRootDesc")}
  onselect={(path) => set({ root: path })}
/>
