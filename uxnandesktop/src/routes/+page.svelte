<script lang="ts">
  import { app } from "$lib/state/app.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { fsSetWatch } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { matchAction } from "$lib/keybindings";
  import { isUntestedPlatform, osLabel } from "$lib/platform";
  import { cn } from "$lib/utils";
  import { surface } from "$lib/design";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import WebhookIcon from "@lucide/svelte/icons/webhook";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import TerminalArea from "$lib/components/TerminalArea.svelte";
  import SaveDiscardDialog from "$lib/components/SaveDiscardDialog.svelte";
  import TitleBar from "$lib/components/TitleBar.svelte";
  import LeftSidebar from "$lib/components/LeftSidebar.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import WorktreeSearch from "$lib/components/WorktreeSearch.svelte";
  import DirectoryPicker from "$lib/components/DirectoryPicker.svelte";
  import BackendStatus from "$lib/components/BackendStatus.svelte";
  import { Toaster } from "$lib/components/ui/sonner";

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

  // Active workspace breadcrumb (repo / branch), shown at the left of the status bar.
  const ctx = $derived(projects.activeContext);

  function toggleLeftSidebar() {
    app.settings.leftSidebarOpen = !app.settings.leftSidebarOpen;
    void app.persistSettings();
  }
  function toggleRightSidebar() {
    app.settings.rightSidebarOpen = !app.settings.rightSidebarOpen;
    void app.persistSettings();
  }

  // Aim the backend filesystem watcher at the active worktree (here, not in the
  // file-tree panel, so it follows the worktree even when the right panel/Files
  // tab is closed — the center file/diff tabs depend on it for external-change
  // detection). Emits `fs:changed`, consumed by the file tree + open tabs.
  $effect(() => {
    void fsSetWatch(projects.activeWorktreePath).catch(() => {});
  });

  // Suppress the webview's built-in context menu (it's most visible in debug
  // builds and exposes dev/inspect entries). Native menus stay on text fields so
  // right-click paste keeps working; our terminal tab/pane menus call
  // stopPropagation, so they never reach this handler.
  function onContextMenu(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest("input, textarea")) return;
    e.preventDefault();
  }

  // Global keyboard shortcuts (configurable in Settings → Keyboard shortcuts).
  function onKeyDown(e: KeyboardEvent) {
    // Settings (full-screen) owns its own keys, including shortcut rebinding.
    if (app.settingsOpen) return;
    // Never steal keys while typing in a terminal — the shell owns Ctrl+W/J/etc.
    const el = e.target as HTMLElement | null;
    if (el?.closest(".xterm")) return;
    const action = matchAction(e);
    if (!action) return;
    switch (action) {
      case "closeCenter":
        // Close the active center tab (terminal / file / diff). Only when one is
        // open; otherwise let the key through.
        if (terminals.root) {
          e.preventDefault();
          terminals.closeActiveTab();
        }
        return;
      case "saveFile":
        return; // handled by the editor's own keymap when focused
      case "worktreePalette":
        e.preventDefault();
        projects.paletteOpen = true;
        return;
      case "addProject":
        e.preventDefault();
        projects.pickerOpen = true;
        return;
      case "openSettings":
        e.preventDefault();
        app.openSettings();
        return;
      case "toggleLeftSidebar":
        e.preventDefault();
        toggleLeftSidebar();
        return;
      case "toggleRightSidebar":
        e.preventDefault();
        toggleRightSidebar();
        return;
    }
  }
</script>

<svelte:window oncontextmenu={onContextMenu} onkeydown={onKeyDown} />

<div class="flex h-screen w-screen flex-col bg-background text-foreground">
  <!-- Non-blocking toasts (errors + successes) -->
  <Toaster position="bottom-right" />

  <!-- Custom title bar (OS chrome disabled) -->
  <TitleBar />

  <!-- Quick worktree switcher (Ctrl/Cmd+P) -->
  <WorktreeSearch />

  <!-- Add-project directory picker (Ctrl/Cmd+O; also from the sidebar) -->
  <DirectoryPicker bind:open={projects.pickerOpen} />

  <!-- Unsaved-edit prompt (driven by the saveDiscard service on tab close) -->
  <SaveDiscardDialog />

  <!-- Content region below the title bar. The three-panel body stays mounted
       even while Settings is open (Settings overlays it), so terminals/PTYs are
       never torn down — otherwise an agent's launch command would be re-typed on
       return and xterm would lose its screen. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
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

      <!-- Center area: a tree of regions whose tabs are terminals, file editors
           or diffs (TerminalArea). Every tab stays mounted (id-keyed) so no
           PTY/xterm/CodeMirror is torn down on split or tab switch. -->
      <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TerminalArea />
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

    <!-- Status bar: breadcrumb (left) · backend + panel toggles (right) -->
    <footer
      class="flex h-7 shrink-0 items-center gap-2 border-t border-border px-2 text-xs text-muted-foreground"
    >
      <!-- Active workspace breadcrumb -->
      <div class="inline-flex min-w-0 items-center gap-1" title={i18n.t("terminal.context")}>
        <LayersIcon class="size-3 shrink-0" />
        {#if ctx.repo}
          <span class="truncate">{ctx.repo}</span>
          <span class="text-muted-foreground/50">/</span>
        {/if}
        <span class="truncate font-medium text-foreground">{ctx.name}</span>
      </div>

      <div class="flex-1"></div>

      {#if isUntestedPlatform}
        <span
          class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
          title={i18n.t("status.untestedTooltip", { os: osLabel() })}
        >
          <TriangleAlertIcon class="size-3.5" />
          {i18n.t("status.untested", { os: osLabel() })}
        </span>
      {/if}
      {#if app.hooksNeedAttention}
        <button
          class="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500 dark:text-amber-400"
          title={i18n.t("status.hooksIssueTooltip")}
          onclick={() => app.openSettings("hooks")}
        >
          <WebhookIcon class="size-3.5" />
          {i18n.t("status.hooksIssue")}
        </button>
      {/if}

      <!-- Backend status (icon + live popover) -->
      <BackendStatus />

      <!-- Show/hide panels — selected = panel visible (primary tint) -->
      <button
        class={cn(
          "flex size-6 items-center justify-center rounded",
          app.settings.leftSidebarOpen
            ? surface.tab
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        title={i18n.t("titlebar.toggleLeft")}
        aria-label={i18n.t("titlebar.toggleLeft")}
        aria-pressed={app.settings.leftSidebarOpen}
        onclick={toggleLeftSidebar}
      >
        <PanelLeftIcon class="size-3.5" />
      </button>
      <button
        class={cn(
          "flex size-6 items-center justify-center rounded",
          app.settings.rightSidebarOpen
            ? surface.tab
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        title={i18n.t("terminal.toggleRight")}
        aria-label={i18n.t("terminal.toggleRight")}
        aria-pressed={app.settings.rightSidebarOpen}
        onclick={toggleRightSidebar}
      >
        <PanelRightIcon class="size-3.5" />
      </button>
    </footer>

    <!-- Settings overlays the still-mounted body (full content region). -->
    {#if app.settingsOpen}
      <div class="absolute inset-0 z-30">
        <Settings />
      </div>
    {/if}
  </div>
</div>
