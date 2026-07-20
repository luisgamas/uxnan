<script lang="ts">
  // Remove-worktree confirmation with **opt-in** branch cleanup. Removing a
  // worktree only removes the worktree by default; the user can additionally tick
  // "delete local branch" (with a force option for unmerged work) and, when the
  // branch exists on origin, "delete remote branch". Uncommitted changes escalate
  // the primary action to a forced worktree removal (like the old ConfirmDialog).
  import * as Dialog from "$lib/components/ui/dialog";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects, type WorktreeRow } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

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
  let error = $state<string | null>(null);
  let busy = $state(false);

  const label = $derived(row.branch ?? i18n.t("worktree.detached"));

  // Reset each time the dialog opens; look up whether the branch exists on origin
  // so the remote option is only offered when it can do something.
  $effect(() => {
    if (!open) return;
    deleteLocal = false;
    forceLocal = false;
    deleteRemote = false;
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

  async function confirm() {
    busy = true;
    error = null;
    const ok = await projects.removeWorktree(row, forceNeeded, {
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
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
        <TriangleAlertIcon class={cn(icon.button, "text-destructive")} />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <Dialog.Title class={cn(text.title, "break-words")}>{i18n.t("worktree.removeTitle")}</Dialog.Title>
        <Dialog.Description class={cn(text.body, "break-words")}>
          {i18n.t("worktree.removeDesc", { path: row.path, branch: label })}
        </Dialog.Description>
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
          </span>
        </button>

        {#if deleteLocal}
          <button
            type="button"
            class="ml-6 flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
            onclick={() => (forceLocal = !forceLocal)}
          >
            <Checkbox checked={forceLocal} tabindex={-1} class="pointer-events-none" />
            <span class={cn("min-w-0 flex-1", text.meta)}>
              {i18n.t("worktree.forceDeleteBranch")}
            </span>
          </button>
        {/if}

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
        {forceNeeded ? i18n.t("worktree.forceRemove") : i18n.t("common.remove")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
