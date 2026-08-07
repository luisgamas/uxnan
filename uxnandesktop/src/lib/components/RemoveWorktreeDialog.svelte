<script lang="ts">
  // Remove-worktree confirmation with **opt-in** branch cleanup. Removing a
  // worktree only removes the worktree by default; the user can additionally tick
  // "delete local branch" and, when the branch exists on origin, "delete remote
  // branch". Uncommitted changes escalate the primary action to a forced removal.
  //
  // The dialog arrives **pre-filled** when the space is finished: a branch whose
  // commits demonstrably landed comes with its delete already ticked and a line
  // saying why (`removalDefaults`). That is the whole reason there is no separate
  // "close space" action — there is one thing a user wants to do here, and the
  // difference between closing a finished space and removing a live one is how
  // much this dialog can answer on their behalf, not which dialog they open.
  //
  // Everything that destroys MORE than the default lives under "Advanced",
  // collapsed: forcing an unmerged branch delete, and forcing removal over
  // uncommitted work. They stay one click away — never a default, never hidden.
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { removalDefaults, type RemovalWarning } from "$lib/worktree-removal";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let {
    open = $bindable(false),
    row,
  }: { open?: boolean; row: WorktreeRow } = $props();

  let deleteLocal = $state(false);
  let forceLocal = $state(false);
  let deleteRemote = $state(false);
  /** Whether `origin/<branch>` exists — gates the "delete remote branch" option. */
  let remoteExists = $state(false);
  /** Set after a removal is refused for uncommitted changes; escalates to force. */
  let forceNeeded = $state(false);
  /** Explicit "remove even with uncommitted changes", from Advanced. */
  let forceRemove = $state(false);
  let advancedOpen = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  const label = $derived(row.branch ?? i18n.t("worktree.detached"));
  const status = $derived(projects.status(row.path));
  const defaults = $derived(
    removalDefaults({
      completion: projects.completion(row),
      dirty: status?.dirty ?? 0,
      ahead: status?.ahead ?? 0,
      liveAgents: terminals.agentTabs(row.path).filter((t) => !t.exited).length,
      hasBranch: !!row.branch,
    }),
  );

  // Reset each time the dialog opens; look up whether the branch exists on origin
  // so the remote option is only offered when it can do something.
  $effect(() => {
    if (!open) return;
    // Seeded from the verdict rather than always-false: a landed branch arrives
    // ticked, so the common finished case is one button.
    deleteLocal = defaults.deleteLocal;
    forceLocal = false;
    deleteRemote = false;
    forceRemove = false;
    advancedOpen = false;
    remoteExists = false;
    forceNeeded = false;
    error = null;
    if (!row.branch) return;
    projects
      .branchInfo(row.repoId)
      .then((info) => {
        remoteExists = info.remoteBranches.includes(row.branch as string);
      })
      .catch(() => {
        // A missing remote just means no remote option — never block the removal.
      });
  });

  function toggleLocal() {
    deleteLocal = !deleteLocal;
    if (!deleteLocal) forceLocal = false;
  }

  function warningText(w: RemovalWarning): string {
    switch (w) {
      case "uncommitted":
        return i18n.t("worktree.warnUncommitted", { n: status?.dirty ?? 0 });
      case "unpushed":
        return i18n.t("worktree.warnUnpushed", { n: status?.ahead ?? 0 });
      default:
        return i18n.t("worktree.warnAgents");
    }
  }

  async function confirm() {
    busy = true;
    error = null;
    const ok = await projects.removeWorktree(row, forceNeeded || forceRemove, {
      deleteLocal,
      forceLocal: deleteLocal && forceLocal,
      deleteRemote: deleteRemote && remoteExists,
    });
    busy = false;
    if (ok) {
      open = false;
      return;
    }
    // Refused (uncommitted changes) — surface it and offer a forced removal.
    error = projects.error;
    forceNeeded = true;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex min-w-0 flex-col gap-4 sm:max-w-[460px]" showCloseButton={false}>
    <div class="flex min-w-0 gap-3">
      <div
        class={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          defaults.verdict === "done" ? "bg-sky-500/10" : "bg-destructive/10",
        )}
      >
        {#if defaults.verdict === "done"}
          <CircleCheckIcon class={cn(icon.button, "text-sky-500")} />
        {:else}
          <TriangleAlertIcon class={cn(icon.button, "text-destructive")} />
        {/if}
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <Dialog.Title class={cn(text.title, "break-words")}>{i18n.t("worktree.removeTitle")}</Dialog.Title>
        <!-- The default description promises the branch is kept — which stops
             being true the moment the verdict pre-ticks its delete. -->
        <Dialog.Description class={cn(text.body, "break-words")}>
          {defaults.deleteLocal
            ? i18n.t("worktree.removeDescFinished", { path: row.path })
            : i18n.t("worktree.removeDesc", { path: row.path, branch: label })}
        </Dialog.Description>
        <!-- Why the options below look the way they do. Only stated when the
             space's own state actually decided something. -->
        {#if defaults.verdict}
          <p class={cn("break-words", text.meta)}>
            {defaults.verdict === "done"
              ? i18n.t("close.whyDone")
              : i18n.t("close.whyAbandoned")}
          </p>
        {/if}
      </div>
    </div>

    <!-- Opt-in branch cleanup (only when the worktree is on a branch). -->
    {#if row.branch}
      <div class="flex flex-col gap-1 rounded-lg border border-border/60 p-1.5">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
          onclick={toggleLocal}
        >
          <Checkbox checked={deleteLocal} tabindex={-1} class="pointer-events-none" />
          <span class={cn("min-w-0 flex-1", text.body)}>
            {i18n.t("worktree.deleteLocalBranch")}
            <code class="ml-0.5 break-all text-[11px] text-muted-foreground">{row.branch}</code>
            {#if deleteLocal && defaults.deleteLocal && !forceLocal}
              <span class="block {text.meta}">{i18n.t("close.safeDelete")}</span>
            {/if}
          </span>
        </button>

        {#if remoteExists}
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
            onclick={() => (deleteRemote = !deleteRemote)}
          >
            <Checkbox checked={deleteRemote} tabindex={-1} class="pointer-events-none" />
            <span class={cn("min-w-0 flex-1", text.body)}>
              {i18n.t("worktree.deleteRemoteBranch")}
              <code class="ml-0.5 break-all text-[11px] text-muted-foreground">origin/{row.branch}</code>
            </span>
          </button>
        {/if}
      </div>
    {/if}

    <!-- What you'd want to know before confirming. Said, never enforced: wiping a
         dead end is sometimes exactly the point. -->
    {#if defaults.warnings.length > 0}
      <div class={cn("flex flex-col gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2", text.body)}>
        {#each defaults.warnings as w (w)}
          <p class="break-words text-amber-700 dark:text-amber-300">{warningText(w)}</p>
        {/each}
      </div>
    {/if}

    <!-- Advanced: everything that destroys more than the default. Collapsed, so
         the ordinary path stays two lines, and one click away, so the rare
         legitimate force is right here instead of a shell command. -->
    <Collapsible.Root bind:open={advancedOpen}>
      <Collapsible.Trigger
        class={cn(
          "flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-muted-foreground transition-colors hover:text-foreground",
          text.body,
        )}
      >
        <ChevronRightIcon
          class={cn(icon.decorative, "shrink-0 transition-transform", advancedOpen && "rotate-90")}
        />
        {i18n.t("worktree.advanced")}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <div class="mt-1 flex flex-col gap-1 rounded-lg border border-border/60 p-1.5">
          {#if row.branch}
            <button
              type="button"
              class="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
              onclick={() => {
                forceLocal = !forceLocal;
                if (forceLocal) deleteLocal = true;
              }}
            >
              <Checkbox checked={forceLocal} tabindex={-1} class="pointer-events-none" />
              <span class={cn("min-w-0 flex-1", text.body)}>
                {i18n.t("worktree.forceDeleteBranch")}
                <span class="block {text.meta}">{i18n.t("worktree.forceDeleteBranchWhy")}</span>
              </span>
            </button>
          {/if}
          <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
            onclick={() => (forceRemove = !forceRemove)}
          >
            <Checkbox checked={forceRemove} tabindex={-1} class="pointer-events-none" />
            <span class={cn("min-w-0 flex-1", text.body)}>
              {i18n.t("worktree.forceRemoveOption")}
              <span class="block {text.meta}">{i18n.t("worktree.forceRemoveOptionWhy")}</span>
            </span>
          </button>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>

    {#if error}
      <p
        class={cn(
          "break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive",
          text.body,
        )}
      >
        {error}
      </p>
    {/if}

    <Dialog.Footer class="min-w-0">
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button variant="destructive" disabled={busy} onclick={confirm}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {forceNeeded || forceRemove ? i18n.t("worktree.forceRemove") : i18n.t("common.remove")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
