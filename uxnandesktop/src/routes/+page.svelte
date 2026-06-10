<script lang="ts">
  import { app } from "$lib/state/app.svelte";

  // Resize bounds for each sidebar (px).
  const LEFT_MIN = 200;
  const LEFT_MAX = 480;
  const RIGHT_MIN = 240;
  const RIGHT_MAX = 560;

  type Side = "left" | "right";

  let dragging = $state<Side | null>(null);
  let startX = 0;
  let startWidth = 0;

  const clamp = (v: number, min: number, max: number) =>
    Math.min(max, Math.max(min, v));

  function onHandleDown(side: Side, e: PointerEvent) {
    dragging = side;
    startX = e.clientX;
    startWidth =
      side === "left"
        ? app.settings.leftSidebarWidth
        : app.settings.rightSidebarWidth;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (dragging === "left") {
      app.settings.leftSidebarWidth = clamp(startWidth + dx, LEFT_MIN, LEFT_MAX);
    } else {
      // Right handle grows the panel as the pointer moves left.
      app.settings.rightSidebarWidth = clamp(
        startWidth - dx,
        RIGHT_MIN,
        RIGHT_MAX,
      );
    }
  }

  function onHandleUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    void app.persistSettings();
  }

  function toggleLeft() {
    app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
    void app.persistSettings();
  }

  function toggleRight() {
    app.settings.rightSidebarOpen = !app.settings.rightSidebarOpen;
    void app.persistSettings();
  }

  const backendLabel = $derived(
    app.backend === "ready"
      ? "Backend connected"
      : app.backend === "connecting"
        ? "Connecting…"
        : "Backend unreachable",
  );

  const backendDot = $derived(
    app.backend === "ready"
      ? "bg-green-500"
      : app.backend === "connecting"
        ? "bg-amber-500"
        : "bg-destructive",
  );
</script>

<div class="flex h-screen w-screen flex-col bg-background text-foreground">
  <!-- Title bar -->
  <header
    class="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-sm"
  >
    <button
      class="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Toggle left sidebar"
      onclick={toggleLeft}
    >
      ☰
    </button>
    <span class="font-semibold tracking-tight">Uxnan Desktop</span>
    <span class="text-xs text-muted-foreground">ADE</span>
    <div class="flex-1"></div>
    <button
      class="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Toggle right sidebar"
      onclick={toggleRight}
    >
      ⇆
    </button>
  </header>

  <!-- Three-panel body -->
  <div class="flex min-h-0 flex-1">
    {#if app.settings.leftSidebarOpen}
      <aside
        class="flex shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground"
        style="width: {app.settings.leftSidebarWidth}px"
      >
        <section class="border-b border-sidebar-border p-3">
          <h2
            class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Projects
          </h2>
          <p class="text-xs text-muted-foreground">No repositories yet.</p>
        </section>
        <section class="border-b border-sidebar-border p-3">
          <h2
            class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Worktrees
          </h2>
          <p class="text-xs text-muted-foreground">
            Worktree cards and agent status will appear here.
          </p>
        </section>
      </aside>

      <!-- Left resize handle -->
      <div
        class="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring"
        role="separator"
        aria-orientation="vertical"
        onpointerdown={(e) => onHandleDown("left", e)}
        onpointermove={onHandleMove}
        onpointerup={onHandleUp}
      ></div>
    {/if}

    <!-- Center area -->
    <main class="flex min-w-0 flex-1 flex-col items-center justify-center p-6">
      <div class="max-w-md text-center">
        <h1 class="mb-2 text-lg font-semibold">Terminal area</h1>
        <p class="text-sm text-muted-foreground">
          Multiplexed terminals (xterm.js + PTY) with tabs and splits will live
          here. This is the Phase 0 skeleton — the three panels are wired and
          resizable, and the Rust backend round-trip is connected.
        </p>
      </div>
    </main>

    {#if app.settings.rightSidebarOpen}
      <!-- Right resize handle -->
      <div
        class="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring"
        role="separator"
        aria-orientation="vertical"
        onpointerdown={(e) => onHandleDown("right", e)}
        onpointermove={onHandleMove}
        onpointerup={onHandleUp}
      ></div>

      <aside
        class="flex shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground"
        style="width: {app.settings.rightSidebarWidth}px"
      >
        <section class="border-b border-sidebar-border p-3">
          <h2
            class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Changes
          </h2>
          <p class="text-xs text-muted-foreground">
            Git status, diffs and staging will appear here.
          </p>
        </section>
      </aside>
    {/if}
  </div>

  <!-- Status bar -->
  <footer
    class="flex h-7 shrink-0 items-center gap-2 border-t border-border px-3 text-xs text-muted-foreground"
  >
    <span class="inline-flex items-center gap-1.5">
      <span class="h-2 w-2 rounded-full {backendDot}"></span>
      {backendLabel}
    </span>
    {#if app.errorMessage}
      <span class="text-destructive">· {app.errorMessage}</span>
    {/if}
    <div class="flex-1"></div>
    <span>{app.repos.length} repositories</span>
  </footer>
</div>
