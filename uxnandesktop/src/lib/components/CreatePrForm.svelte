<script lang="ts">
  // Reusable "create pull request" form (base ← head, title + body, manual or
  // AI-drafted), shared by the GitHub section and the right-panel GitHub tab.
  // Honors the "Confirm PR actions" setting (GitHub → Settings) via ConfirmDialog.
  //
  // The branch row is always visible, even when it can't be edited: a PR silently
  // opened from whatever branch happened to be checked out is the bug this form
  // exists to prevent. `lockHead` is what differs between the two callers — the
  // right-panel tab IS the active worktree, so its head is that worktree's branch
  // and nothing else; the section acts on a *repo*, so there the head is a choice.
  import { untrack } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { github } from "$lib/state/github.svelte";
  import { i18n } from "$lib/i18n";
  import { cn } from "$lib/utils";
  import { surface, text } from "$lib/design";
  import { toast, toastError } from "$lib/toast";
  import { githubPrCreate, githubAiDraftPr, githubBranches, openExternal } from "$lib/api";
  import type { PrBranches } from "$lib/types";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Switch } from "$lib/components/ui/switch";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import SparklesIcon from "@lucide/svelte/icons/sparkles";
  import LoaderIcon from "@lucide/svelte/icons/loader-circle";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";

  let {
    worktreePath,
    defaultTitle = "",
    compact = false,
    lockHead = false,
    onCreated,
    onCancel,
  }: {
    worktreePath: string | null;
    defaultTitle?: string;
    compact?: boolean;
    /** Pin the head to the worktree's checked-out branch (right-panel tab). */
    lockHead?: boolean;
    onCreated?: () => void;
    onCancel?: () => void;
  } = $props();

  // One-time seed from the branch name; the field is user-editable afterwards.
  let title = $state(untrack(() => defaultTitle));
  let body = $state("");
  let draft = $state(false);
  let busy = $state(false);
  let aiDrafting = $state(false);
  let confirmOpen = $state(false);

  // Branch pickers. `base`/`head` stay "" until loaded; submitting with an empty
  // value would silently fall back to gh's own inference — the old behavior — so
  // the create button waits for them.
  let branches = $state<PrBranches | null>(null);
  let branchesLoading = $state(false);
  let branchesError = $state<string | null>(null);
  let base = $state("");
  let head = $state("");

  // The AI button appears only when the feature is switched on AND an agent is
  // picked — the switch is what lets a configured agent be kept while off.
  const aiAgent = $derived(
    (app.settings.github?.aiEnabled ?? false) ? app.settings.github?.aiAgentId : undefined,
  );

  const baseGroups = $derived<ComboGroup[]>([
    { items: (branches?.remote ?? []).map((b) => ({ value: b, label: b })) },
  ]);
  const headGroups = $derived<ComboGroup[]>([
    { items: (branches?.local ?? []).map((b) => ({ value: b, label: b })) },
  ]);

  // A PR into itself is rejected by GitHub; say so before the round trip.
  const sameBranch = $derived(!!base && !!head && base === head);
  const canSubmit = $derived(
    !!worktreePath && !!title.trim() && !!base && !!head && !sameBranch && !busy,
  );

  // The head may be a local branch that was never pushed. gh runs with prompts
  // disabled, so rather than let it fail with gh's own opaque error, warn first.
  const headUnpushed = $derived(
    !!head && !!branches && !branches.remote.includes(head),
  );

  $effect(() => {
    const path = worktreePath;
    if (!path) return;
    branchesLoading = true;
    branchesError = null;
    githubBranches(path)
      .then((info) => {
        branches = info;
        base = info.defaultBase;
        head = info.current ?? "";
        // Preselect a base that isn't the head, so the form doesn't open in an
        // invalid state on a worktree that branches off the default branch.
        if (base === head) base = info.remote.find((b) => b !== head) ?? base;
      })
      .catch((e) => {
        branches = null;
        branchesError = e instanceof Error ? e.message : String(e);
      })
      .finally(() => (branchesLoading = false));
  });

  function submit() {
    if (!canSubmit) return;
    if (app.settings.github?.confirmPr ?? true) {
      confirmOpen = true;
    } else {
      void doCreate();
    }
  }

  async function doCreate(): Promise<boolean> {
    if (!worktreePath || !title.trim()) return false;
    busy = true;
    try {
      const url = await githubPrCreate(worktreePath, {
        title: title.trim(),
        body,
        base,
        head,
        draft,
      });
      toast.success(i18n.t("github.toast.prCreated"));
      await github.refreshContext();
      if (url) void openExternal(url);
      onCreated?.();
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function draftBody() {
    if (!worktreePath || !aiAgent) return;
    aiDrafting = true;
    try {
      // Draft against the base actually selected, so the body describes the diff
      // this PR carries rather than the one against the repo's default branch.
      body = await githubAiDraftPr(worktreePath, base || null);
    } catch (e) {
      toastError(e);
    } finally {
      aiDrafting = false;
    }
  }
</script>

<div class={cn("space-y-2 rounded-lg p-3", surface.panel)}>
  <!-- base ← head: where this PR goes, and where it comes from. -->
  <div class="flex items-center gap-1.5">
    <GitBranchIcon class="size-3.5 shrink-0 text-muted-foreground" />
    <Combobox
      value={base}
      groups={baseGroups}
      triggerClass="h-7 min-w-0 flex-1"
      placeholder={branchesLoading ? i18n.t("github.loading") : i18n.t("github.pr.baseLabel")}
      searchPlaceholder={i18n.t("common.search")}
      disabled={branchesLoading || !branches}
      onChange={(v) => (base = v)}
    />
    <ArrowLeftIcon class="size-3.5 shrink-0 text-muted-foreground" />
    {#if lockHead}
      <!-- The right-panel tab is bound to the active worktree: its branch IS the
           head. Shown read-only so it's visible without pretending to be a choice. -->
      <span
        class={cn(
          "min-w-0 flex-1 truncate rounded-md border border-border/60 bg-muted/40 px-2 py-1 font-medium",
          text.meta,
        )}
        title={head}
      >
        {head || (branchesLoading ? i18n.t("github.loading") : "—")}
      </span>
    {:else}
      <Combobox
        value={head}
        groups={headGroups}
        triggerClass="h-7 min-w-0 flex-1"
        placeholder={branchesLoading ? i18n.t("github.loading") : i18n.t("github.pr.headLabel")}
        searchPlaceholder={i18n.t("common.search")}
        disabled={branchesLoading || !branches}
        onChange={(v) => (head = v)}
      />
    {/if}
  </div>

  {#if branchesError}
    <p class={cn("text-destructive", text.meta)}>{i18n.t("github.pr.branchesError")}</p>
  {:else if sameBranch}
    <p class={cn("text-destructive", text.meta)}>{i18n.t("github.pr.sameBranch")}</p>
  {:else if headUnpushed}
    <p class={cn("text-amber-600 dark:text-amber-500", text.meta)}>
      {i18n.t("github.pr.headUnpushed", { branch: head })}
    </p>
  {/if}

  <Input placeholder={i18n.t("github.pr.titleLabel")} bind:value={title} />
  <div class="relative">
    <Textarea placeholder={i18n.t("github.pr.bodyLabel")} bind:value={body} rows={compact ? 4 : 5} />
    {#if aiAgent}
      <Button
        variant="ghost"
        size="sm"
        class="absolute right-1 top-1 h-6 gap-1 px-2"
        disabled={aiDrafting}
        onclick={draftBody}
      >
        {#if aiDrafting}
          <LoaderIcon class="size-3 animate-spin" />
        {:else}
          <SparklesIcon class="size-3" />
        {/if}
        {aiDrafting ? i18n.t("github.pr.generating") : i18n.t("github.pr.generateBody")}
      </Button>
    {/if}
  </div>
  <label class="flex items-center gap-2 text-[13px]">
    <Switch checked={draft} onCheckedChange={(v) => (draft = v)} />
    {i18n.t("github.pr.draftLabel")}
  </label>
  <div class="flex justify-end gap-2">
    {#if onCancel}
      <Button variant="ghost" size="sm" onclick={onCancel}>{i18n.t("common.cancel")}</Button>
    {/if}
    <Button size="sm" disabled={!canSubmit} onclick={submit}>{i18n.t("github.pr.create")}</Button>
  </div>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={i18n.t("github.confirm.createTitle")}
  description={i18n.t("github.confirm.createDesc", { base, head })}
  confirmLabel={i18n.t("github.pr.create")}
  onconfirm={doCreate}
/>
