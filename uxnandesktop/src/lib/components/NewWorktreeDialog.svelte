<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Select from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { projects } from "$lib/state/projects.svelte";
  import type { RepoData } from "$lib/types";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";

  let {
    repo,
    open = $bindable(false),
  }: { repo: RepoData; open?: boolean } = $props();

  let branch = $state("");
  let base = $state("");
  let branches = $state<string[]>([]);
  let loading = $state(false);
  let busy = $state(false);

  // The sibling folder the backend will create: `<repo>--<safe-branch>`
  // (mirrors `git::worktree_path_for`). Shown so the user knows where it lands.
  const sep = $derived(repo.path.includes("\\") ? "\\" : "/");
  const parent = $derived(
    repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).slice(0, -1).join(sep),
  );
  const repoName = $derived(
    repo.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? repo.name,
  );
  const previewPath = $derived(
    branch.trim()
      ? `${parent}${sep}${repoName}--${branch.trim().replace(/[\\/]/g, "-")}`
      : "",
  );

  // The resolved default base may be a remote ref (e.g. `origin/main`) or `HEAD`,
  // which won't be in the local-branch list — surface it as the first option.
  const baseOptions = $derived(
    base && !branches.includes(base) ? [base, ...branches] : branches,
  );
  const baseLabel = $derived(base || "Select base branch…");

  // Load branches + default base each time the dialog opens.
  $effect(() => {
    if (!open) return;
    loading = true;
    branch = "";
    projects.error = null;
    projects
      .branchInfo(repo.id)
      .then((info) => {
        branches = info.branches;
        base = info.defaultBase;
      })
      .catch((e) => {
        projects.error = e instanceof Error ? e.message : String(e);
      })
      .finally(() => (loading = false));
  });

  async function submit() {
    if (!branch.trim() || busy) return;
    busy = true;
    const ok = await projects.createWorktree(
      repo.id,
      branch.trim(),
      base || undefined,
    );
    busy = false;
    if (ok) open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[460px]">
    <Dialog.Header>
      <Dialog.Title>New worktree</Dialog.Title>
      <Dialog.Description>
        Create an isolated working copy of <span class="font-medium text-foreground"
          >{repo.name}</span
        > on a new branch.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-4 py-2">
      <div class="flex flex-col gap-1.5">
        <label for="wt-branch" class="text-xs font-medium">Branch name</label>
        <Input
          id="wt-branch"
          placeholder="feature/my-change"
          bind:value={branch}
          autocomplete="off"
          onkeydown={(e) => e.key === "Enter" && submit()}
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <span class="text-xs font-medium">Base branch</span>
        <Select.Root type="single" bind:value={base} disabled={loading}>
          <Select.Trigger class="w-full">{baseLabel}</Select.Trigger>
          <Select.Content>
            {#each baseOptions as b (b)}
              <Select.Item value={b} label={b}>{b}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
        <p class="text-[11px] text-muted-foreground">
          The new branch starts from here. Defaults to the repo's main branch.
        </p>
      </div>

      {#if previewPath}
        <div class="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
          <GitBranchIcon class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <code class="break-all text-[11px] text-muted-foreground">{previewPath}</code>
        </div>
      {/if}

      {#if projects.error}
        <p class="text-xs text-destructive">{projects.error}</p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
      <Button onclick={submit} disabled={!branch.trim() || busy || loading}>
        {busy ? "Creating…" : "Create worktree"}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
