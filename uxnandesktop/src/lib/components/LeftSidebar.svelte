<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import {
    pickDirectory,
    repoAdd,
    repoRemove,
    worktreeCreate,
    worktreeList,
  } from "$lib/api";
  import type { WorktreeEntry } from "$lib/types";

  type Tab = "projects" | "worktrees";
  let tab = $state<Tab>("projects");

  // Worktrees per repo id, loaded on demand.
  let worktreesByRepo = $state<Record<string, WorktreeEntry[]>>({});
  let selectedRepoId = $state<string | null>(null);
  let newBranch = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);

  const msg = (e: unknown) =>
    e && typeof e === "object" && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);

  const baseName = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;

  async function loadWorktrees(repoId: string) {
    try {
      worktreesByRepo = {
        ...worktreesByRepo,
        [repoId]: await worktreeList(repoId),
      };
    } catch (e) {
      error = msg(e);
    }
  }

  async function addProject() {
    error = null;
    try {
      const path = await pickDirectory("Select a git repository");
      if (!path) return;
      const repo = await repoAdd(path);
      if (!app.repos.find((r) => r.id === repo.id)) app.repos.push(repo);
      selectedRepoId ??= repo.id;
      await loadWorktrees(repo.id);
    } catch (e) {
      error = msg(e);
    }
  }

  async function removeProject(id: string) {
    error = null;
    try {
      await repoRemove(id);
      app.repos = app.repos.filter((r) => r.id !== id);
      const { [id]: _removed, ...rest } = worktreesByRepo;
      worktreesByRepo = rest;
      if (selectedRepoId === id) selectedRepoId = app.repos[0]?.id ?? null;
    } catch (e) {
      error = msg(e);
    }
  }

  async function createWorktree() {
    const repoId = selectedRepoId ?? app.repos[0]?.id;
    if (!repoId || !newBranch.trim()) return;
    error = null;
    busy = true;
    try {
      await worktreeCreate(repoId, newBranch.trim());
      newBranch = "";
      await loadWorktrees(repoId);
    } catch (e) {
      error = msg(e);
    } finally {
      busy = false;
    }
  }

  function openTerminalAt(path: string) {
    terminals.create({ cwd: path, title: baseName(path) });
  }

  // When entering the Worktrees tab, make sure each repo's list is loaded.
  $effect(() => {
    if (tab === "worktrees") {
      selectedRepoId ??= app.repos[0]?.id ?? null;
      for (const repo of app.repos) {
        if (!(repo.id in worktreesByRepo)) void loadWorktrees(repo.id);
      }
    }
  });
</script>

<div class="flex h-full flex-col">
  <!-- Tabs -->
  <div
    class="flex shrink-0 items-center gap-1 border-b border-sidebar-border p-1"
  >
    <button
      class="flex-1 rounded px-2 py-1 text-xs font-medium {tab === 'projects'
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent/50'}"
      onclick={() => (tab = "projects")}
    >
      Projects
    </button>
    <button
      class="flex-1 rounded px-2 py-1 text-xs font-medium {tab === 'worktrees'
        ? 'bg-accent text-accent-foreground'
        : 'text-muted-foreground hover:bg-accent/50'}"
      onclick={() => (tab = "worktrees")}
    >
      Worktrees
    </button>
  </div>

  {#if error}
    <p class="border-b border-sidebar-border px-3 py-1.5 text-xs text-destructive">
      {error}
    </p>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if tab === "projects"}
      <div class="p-2">
        <button
          class="mb-2 w-full rounded border border-border px-2 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          onclick={addProject}
        >
          + Add project…
        </button>

        {#if app.repos.length === 0}
          <p class="px-1 text-xs text-muted-foreground">
            No repositories yet. Add a git repository to get started.
          </p>
        {:else}
          <ul class="flex flex-col gap-1">
            {#each app.repos as repo (repo.id)}
              <li
                class="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
              >
                <div class="min-w-0">
                  <div class="truncate text-xs font-medium" title={repo.name}>
                    {repo.name}
                  </div>
                  <div class="truncate text-[11px] text-muted-foreground" title={repo.path}>
                    {repo.path}
                  </div>
                </div>
                <button
                  class="shrink-0 rounded px-1 text-xs text-muted-foreground opacity-0 hover:bg-destructive/20 hover:text-foreground group-hover:opacity-100"
                  title="Remove project"
                  aria-label="Remove project"
                  onclick={() => removeProject(repo.id)}
                >
                  ×
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <div class="p-2">
        {#if app.repos.length === 0}
          <p class="px-1 text-xs text-muted-foreground">
            Add a project in the <button
              class="underline"
              onclick={() => (tab = "projects")}>Projects</button
            > tab first.
          </p>
        {:else}
          <!-- New worktree form -->
          <div class="mb-2 flex flex-col gap-1.5 rounded border border-border p-2">
            {#if app.repos.length > 1}
              <select
                class="rounded border border-border bg-background px-2 py-1 text-xs"
                bind:value={selectedRepoId}
              >
                {#each app.repos as repo (repo.id)}
                  <option value={repo.id}>{repo.name}</option>
                {/each}
              </select>
            {/if}
            <div class="flex gap-1.5">
              <input
                class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
                placeholder="branch name (e.g. feature/x)"
                bind:value={newBranch}
                onkeydown={(e) => e.key === "Enter" && createWorktree()}
              />
              <button
                class="shrink-0 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                disabled={busy || !newBranch.trim()}
                onclick={createWorktree}
              >
                Create
              </button>
            </div>
          </div>

          <!-- Worktree lists -->
          {#each app.repos as repo (repo.id)}
            <div class="mb-2">
              <div
                class="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {repo.name}
              </div>
              <ul class="flex flex-col gap-1">
                {#each worktreesByRepo[repo.id] ?? [] as wt (wt.path)}
                  <li
                    class="group flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-accent/50"
                  >
                    <div class="min-w-0">
                      <div class="flex items-center gap-1">
                        <span class="truncate text-xs font-medium">
                          {wt.branch ?? "(detached)"}
                        </span>
                        {#if wt.isMain}
                          <span
                            class="rounded border border-border px-1 text-[9px] uppercase text-muted-foreground"
                            >main</span
                          >
                        {/if}
                      </div>
                      <div class="truncate text-[11px] text-muted-foreground" title={wt.path}>
                        {wt.path}
                      </div>
                    </div>
                    <button
                      class="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 hover:bg-accent hover:text-accent-foreground group-hover:opacity-100"
                      title="Open a terminal here"
                      onclick={() => openTerminalAt(wt.path)}
                    >
                      Terminal
                    </button>
                  </li>
                {:else}
                  <li class="px-2 text-[11px] text-muted-foreground">No worktrees.</li>
                {/each}
              </ul>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>
