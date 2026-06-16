<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { git } from "$lib/state/git.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { i18n } from "$lib/i18n";
  import TerminalArea from "$lib/components/TerminalArea.svelte";
  import DiffPanel from "$lib/components/DiffPanel.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import LeftSidebar from "$lib/components/LeftSidebar.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import WorktreeSearch from "$lib/components/WorktreeSearch.svelte";

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

  const backendLabel = $derived(
    app.backend === "ready"
      ? i18n.t("status.connected")
      : app.backend === "connecting"
        ? i18n.t("status.connecting")
        : i18n.t("status.unreachable"),
  );

  const backendDot = $derived(
    app.backend === "ready"
      ? "bg-green-500"
      : app.backend === "connecting"
        ? "bg-amber-500"
        : "bg-destructive",
  );

  // Suppress the webview's built-in context menu (it's most visible in debug
  // builds and exposes dev/inspect entries). Native menus stay on text fields so
  // right-click paste keeps working; our terminal tab/pane menus call
  // stopPropagation, so they never reach this handler.
  function onContextMenu(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea")) return;
    e.preventDefault();
  }

  // Ctrl/Cmd+P opens the quick worktree switcher.
  function onKeyDown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      projects.paletteOpen = true;
    }
  }
</script>

<svelte:window oncontextmenu={onContextMenu} onkeydown={onKeyDown} />

<div class="flex h-screen w-screen flex-col bg-background text-foreground">
  <!-- Custom title bar (OS chrome disabled) -->
  <TitleBar />

  <!-- Settings dialog (controlled by app.settingsOpen) -->
  <Settings />

  <!-- Quick worktree switcher (Ctrl/Cmd+P) -->
  <WorktreeSearch />

  <!-- Three-panel body -->
  <div class="flex min-h-0 flex-1">
    {#if app.settings.leftSidebarOpen}
      <aside
        class="flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
        style="width: {app.settings.leftSidebarWidth}px"
      >
        <LeftSidebar />
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

    <!-- Center area: multiplexed terminals (xterm.js + PTY). When a diff is open
         it overlays the terminals full-size — they stay mounted underneath, so
         no PTY/xterm is torn down while reviewing. -->
    <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <TerminalArea />
      {#if git.selected}
        <div class="absolute inset-0 z-20">
          <DiffPanel />
        </div>
      {/if}
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
        class="flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
        style="width: {app.settings.rightSidebarWidth}px"
      >
        <RightPanel />
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
    <span>{i18n.plural(app.repos.length, "status.reposOne", "status.reposOther")}</span>
  </footer>
</div>
