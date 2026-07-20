<script lang="ts">
  // Settings + confirmation for the two worktree-native GitHub flows:
  // "Check out to worktree" (a PR) and "Start work" (an issue). Both used to be a
  // single click with a hard-coded branch name and no agent — unlike every other
  // worktree in the app, which is born from NewWorktreeDialog with a name, a
  // folder preview and an agent. This is that dialog's sibling: same shape, same
  // affordances, with the branch name pre-filled to the old generic default so
  // pressing Enter reproduces the previous behavior.
  import * as Dialog from "$lib/components/ui/dialog";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { icon, text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { toast, toastError } from "$lib/toast";
  import { githubPrCheckout, githubIssueDevelop } from "$lib/api";
  import { branchSlug, worktreeFolderFor } from "$lib/branchName";
  import AgentLogo from "./AgentLogo.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import FolderIcon from "@lucide/svelte/icons/folder";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";

  let {
    open = $bindable(false),
    repoId,
    kind,
    number,
    title = "",
    onDone,
  }: {
    open?: boolean;
    repoId: string | null;
    /** Which flow: a PR checkout or an issue's linked branch. */
    kind: "pr" | "issue";
    number: number | null;
    /** The PR/issue title — seeds the suggested slug branch name. */
    title?: string;
    onDone?: () => void;
  } = $props();

  const NONE = "__none__";
  let branch = $state("");
  let agentId = $state<string>(NONE);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const repo = $derived(app.repos.find((r) => r.id === repoId) ?? null);
  const launchable = $derived(app.launchableAgents);
  const agentGroups = $derived<ComboGroup[]>([
    {
      items: [
        { value: NONE, label: i18n.t("newWorktree.agentNone") },
        ...launchable.map((a) => ({ value: a.id, label: a.name.trim() || a.command })),
      ],
    },
  ]);

  /** The generic name these flows always used: `pr-42` / `issue-17`. */
  const defaultBranch = $derived(number === null ? "" : `${kind}-${number}`);
  /** What `gh issue develop` itself would name the branch (`17-fix-the-login`).
   *  Offered as a one-click alternative, never forced — switching the default
   *  would silently change where existing users' worktrees land. */
  const suggested = $derived(
    kind === "issue" && number !== null && title.trim()
      ? `${number}-${branchSlug(title)}`
      : "",
  );

  const previewPath = $derived(
    repo && branch.trim() ? worktreeFolderFor(repo.path, branch.trim()) : "",
  );
  // A worktree already at that path means this PR/issue was checked out before.
  // The issue flow silently reuses it; the PR flow would fail in git. Say so.
  const existing = $derived(
    !!previewPath &&
      projects.worktreesOf(repoId ?? "").some((w) => w.path === previewPath),
  );

  $effect(() => {
    if (!open) return;
    branch = defaultBranch;
    error = null;
    const def = app.defaultAgent();
    agentId = def ? def.id : NONE;
  });

  async function submit() {
    if (!repoId || number === null || !branch.trim() || busy) return;
    busy = true;
    error = null;
    try {
      const entry =
        kind === "pr"
          ? await githubPrCheckout(repoId, String(number), branch.trim())
          : await githubIssueDevelop(repoId, String(number), branch.trim());
      // Same landing as a hand-made worktree: listed, active, agent launched.
      await projects.adoptWorktree(repoId, entry, agentId === NONE ? null : agentId);
      toast.success(
        i18n.t(kind === "pr" ? "github.toast.checkedOut" : "github.toast.branchCreated"),
      );
      open = false;
      onDone?.();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      toastError(e);
    } finally {
      busy = false;
    }
  }
</script>

{#snippet agentPrefix(item: { value: string })}
  {@const a = launchable.find((x) => x.id === item.value)}
  {#if a}
    <AgentLogo logo={agentLogoKey(a.icon, a.command)} class="size-4 shrink-0" />
  {/if}
{/snippet}

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>
        {kind === "pr" ? i18n.t("github.worktree.prTitle") : i18n.t("github.worktree.issueTitle")}
      </Dialog.Title>
      <Dialog.Description>
        {kind === "pr"
          ? i18n.t("github.worktree.prDesc", { n: number ?? 0 })
          : i18n.t("github.worktree.issueDesc", { n: number ?? 0 })}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-1">
      <div class="flex flex-col gap-1.5">
        <label for="gh-wt-branch" class={cn("font-medium", text.body)}>
          {i18n.t("newWorktree.branch")}
        </label>
        <div class="relative">
          <GitBranchIcon
            class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/80"
          />
          <Input
            id="gh-wt-branch"
            class="pl-8"
            bind:value={branch}
            autocomplete="off"
            onkeydown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        {#if suggested && branch.trim() !== suggested}
          <button
            type="button"
            class={cn("self-start text-muted-foreground underline-offset-2 hover:underline", text.meta)}
            onclick={() => (branch = suggested)}
          >
            {i18n.t("github.worktree.useSuggested", { name: suggested })}
          </button>
        {/if}
      </div>

      {#if launchable.length > 0}
        <div class="flex flex-col gap-1.5">
          <span class={cn("font-medium", text.body)}>{i18n.t("newWorktree.agent")}</span>
          <Combobox
            value={agentId}
            groups={agentGroups}
            triggerClass="w-full"
            searchPlaceholder={i18n.t("common.search")}
            itemPrefix={agentPrefix}
            onChange={(v) => (agentId = v)}
          />
          <p class={text.meta}>{i18n.t("newWorktree.agentDesc")}</p>
        </div>
      {/if}

      {#if previewPath}
        <div class="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5">
          <FolderIcon class={cn(icon.decorative, "mt-px shrink-0 text-muted-foreground")} />
          <code class="break-all text-[11px] leading-5 text-muted-foreground">{previewPath}</code>
        </div>
      {/if}

      {#if existing}
        <div class={cn("flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2", text.meta)}>
          <TriangleAlertIcon class="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
          <span>{i18n.t("github.worktree.exists")}</span>
        </div>
      {/if}

      {#if error}
        <p class="text-xs text-destructive">{error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>{i18n.t("common.cancel")}</Button>
      <Button onclick={submit} disabled={!branch.trim() || busy || !repoId}>
        {#if busy}
          <Spinner data-icon="inline-start" aria-label={i18n.t("common.loading")} />
        {/if}
        {busy ? i18n.t("common.creating") : i18n.t("newWorktree.create")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
