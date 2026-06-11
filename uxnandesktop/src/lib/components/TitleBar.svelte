<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { app } from "$lib/state/app.svelte";

  // Window controls degrade gracefully in a plain browser (no Tauri runtime).
  function windowAction(fn: (w: ReturnType<typeof getCurrentWindow>) => void) {
    try {
      fn(getCurrentWindow());
    } catch {
      // Not running inside Tauri (web preview) — ignore.
    }
  }

  function toggleLeft() {
    app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
    void app.persistSettings();
  }
  function toggleRight() {
    app.settings.rightSidebarOpen = !app.settings.rightSidebarOpen;
    void app.persistSettings();
  }
</script>

<!-- Custom title bar (the OS chrome is disabled via `decorations: false`).
     The bar itself is a drag region; interactive children are not. -->
<header
  data-tauri-drag-region
  class="flex h-10 shrink-0 select-none items-center gap-2 border-b border-border bg-card px-2 text-sm"
>
  <button
    class="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    title="Toggle left sidebar"
    aria-label="Toggle left sidebar"
    onclick={toggleLeft}
  >
    ☰
  </button>

  <span data-tauri-drag-region class="font-semibold tracking-tight"
    >Uxnan Desktop</span
  >
  <span data-tauri-drag-region class="text-xs text-muted-foreground">ADE</span>
  <span
    class="rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
    title="Alpha — work in progress"
  >
    Alpha
  </span>

  <!-- Draggable filler -->
  <div data-tauri-drag-region class="h-full flex-1"></div>

  <button
    class="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    title="Toggle right sidebar"
    aria-label="Toggle right sidebar"
    onclick={toggleRight}
  >
    ⇆
  </button>

  <!-- Window controls -->
  <div class="ml-1 flex items-center">
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Minimize"
      aria-label="Minimize"
      onclick={() => windowAction((w) => w.minimize())}
    >
      ﹣
    </button>
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Maximize"
      aria-label="Maximize"
      onclick={() => windowAction((w) => w.toggleMaximize())}
    >
      ▢
    </button>
    <button
      class="flex h-7 w-9 items-center justify-center rounded text-muted-foreground hover:bg-destructive hover:text-white"
      title="Close"
      aria-label="Close"
      onclick={() => windowAction((w) => w.close())}
    >
      ✕
    </button>
  </div>
</header>
