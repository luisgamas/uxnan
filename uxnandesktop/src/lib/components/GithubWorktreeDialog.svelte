<script lang="ts">
  // Settings + confirmation for the two worktree-native GitHub flows:
  // "Check out to worktree" (a PR) and "Start work" (an issue). Both used to be a
  // single click with a hard-coded branch name and no agent — unlike every other
  // worktree in the app. Naming is automatic from the selected GitHub item; the
  // only remaining choice is what agent, if any, should start there.
  import * as Dialog from "$lib/components/ui/dialog";
  import Combobox, { type ComboGroup } from "./Combobox.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Spinner } from "$lib/components/ui/spinner";
  import { projects } from "$lib/state/projects.svelte";
  import { app } from "$lib/state/app.svelte";
  import { cn } from "$lib/utils";
  import { text } from "$lib/design";
  import { i18n } from "$lib/i18n";
  import { toast, toastError } from "$lib/toast";
  import { worktreeFolderFor } from "$lib/branchName";
  import { githubWorkItemBranch } from "$lib/githubInput";
  import AgentLogo from "./AgentLogo.svelte";
  import { agentLogoKey } from "$lib/agentCatalog";
  import { Icon } from "$lib/components/ui/icon";
  import TriangleAlertIcon from "@hugeicons/core-free-icons/Alert01Icon";

  let {
    open = $bindable(false),
    repoId,
    kind,
    number,
    title = "",
    headRefName = null,
    onDone,
  }: {
    open?: boolean;
    repoId: string | null;
    /** Which flow: a PR checkout or an issue's linked branch. */
    kind: "pr" | "issue";
    number: number | null;
    /** The PR/issue title — seeds the suggested slug branch name. */
    title?: string;
    /** The PR's real head branch; issues derive one from their number/title. */
    headRefName?: string | null;
    onDone?: () => void;
  } = $props();

  const NONE = "__none__";
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

  const branch = $derived(
    number === null ? "" : githubWorkItemBranch(kind, number, title, headRefName),
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
    error = null;
    const def = app.defaultAgent();
    agentId = def ? def.id : NONE;
  });

  async function submit() {
    if (!repoId || number === null || !branch.trim() || busy) return;
    busy = true;
    error = null;
    try {
      const path = await projects.createGitHubWorktree(
        repoId,
        kind,
        number,
        branch.trim(),
        agentId === NONE ? null : agentId,
      );
      if (!path) {
        error = projects.error;
        return;
      }
      if (title.trim()) projects.setNote(path, title.trim());
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

      {#if existing}
        <div class={cn("flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2", text.meta)}>
          <Icon icon={TriangleAlertIcon} class="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
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
