<script lang="ts">
  import { onMount } from "svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import Terminal from "./Terminal.svelte";

  // Start with one terminal so the user lands on a usable shell.
  onMount(() => {
    if (terminals.tabs.length === 0) terminals.create();
  });
</script>

<div class="flex h-full flex-col">
  <!-- Tab bar -->
  <div
    class="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-2"
  >
    {#each terminals.tabs as tab (tab.id)}
      <div
        class="group flex items-center gap-1 rounded-t px-2 py-1 text-xs {terminals.activeId ===
        tab.id
          ? 'bg-background text-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
      >
        <button
          class="max-w-[140px] truncate"
          class:line-through={tab.exited}
          onclick={() => terminals.setActive(tab.id)}
          title={tab.title}
        >
          {tab.title}{tab.exited ? " (exited)" : ""}
        </button>
        <button
          class="rounded px-1 text-muted-foreground opacity-60 hover:bg-destructive/20 hover:text-foreground hover:opacity-100"
          title="Close terminal"
          aria-label="Close terminal"
          onclick={() => terminals.close(tab.id)}
        >
          ×
        </button>
      </div>
    {/each}
    <button
      class="ml-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="New terminal"
      onclick={() => terminals.create()}
    >
      + New
    </button>
  </div>

  <!-- Terminal stack: all tabs stay mounted; only the active one is shown so
       background terminals keep streaming output. `overflow-hidden` clips the
       xterm canvas so it can never paint over the adjacent panels. -->
  <div class="relative min-h-0 flex-1 overflow-hidden bg-[#0b0b0c]">
    {#each terminals.tabs as tab (tab.id)}
      <div
        class="absolute inset-0 overflow-hidden p-1"
        style:display={terminals.activeId === tab.id ? "block" : "none"}
      >
        <Terminal
          id={tab.id}
          cwd={tab.cwd}
          active={terminals.activeId === tab.id}
          onexit={() => terminals.markExited(tab.id)}
        />
      </div>
    {/each}

    {#if terminals.tabs.length === 0}
      <div
        class="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        No terminals open. Click “+ New”.
      </div>
    {/if}
  </div>
</div>
