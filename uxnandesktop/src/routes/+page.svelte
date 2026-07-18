<script lang="ts">
  import { untrack } from "svelte";
  import { app } from "$lib/state/app.svelte";
  import { terminals } from "$lib/state/terminals.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { orchestration } from "$lib/state/orchestration.svelte";
  import { orchestrationRun } from "$lib/state/orchestrationRun.svelte";
  import { git } from "$lib/state/git.svelte";
  import { github } from "$lib/state/github.svelte";
  import { openWith } from "$lib/state/openWith.svelte";
  import { fsSetWatch } from "$lib/api";
  import { i18n } from "$lib/i18n";
  import { matchAction } from "$lib/keybindings";
  import { runAppAction } from "$lib/keyactions";
  import { isUntestedPlatform, osLabel } from "$lib/platform";
  import { cn } from "$lib/utils";
  import { divider } from "$lib/design";
  import TriangleAlertIcon from "@lucide/svelte/icons/triangle-alert";
  import WebhookIcon from "@lucide/svelte/icons/webhook";
  import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
  import PanelRightIcon from "@lucide/svelte/icons/panel-right";
  import GlobeIcon from "@lucide/svelte/icons/globe";
  import LayersIcon from "@lucide/svelte/icons/layers";
  import WorkflowIcon from "@lucide/svelte/icons/workflow";
  import { TooltipSimple } from "$lib/components/ui/tooltip";
  import TerminalArea from "$lib/components/TerminalArea.svelte";
  import SaveDiscardDialog from "$lib/components/SaveDiscardDialog.svelte";
  import WindowControls from "$lib/components/WindowControls.svelte";
  import LeftSidebar from "$lib/components/LeftSidebar.svelte";
  import RightPanel from "$lib/components/RightPanel.svelte";
  import { rightPanel, RIGHT_PANEL_MAX } from "$lib/state/rightPanel.svelte";
  import BrowserPanel from "$lib/components/BrowserPanel.svelte";
  import NewWorktreeDialog from "$lib/components/NewWorktreeDialog.svelte";
  import Settings from "$lib/components/Settings.svelte";
  import GitHub from "$lib/components/GitHub.svelte";
  import OrchestrationConsole from "$lib/components/OrchestrationConsole.svelte";
  import WorktreeSearch from "$lib/components/WorktreeSearch.svelte";
  import DirectoryPicker from "$lib/components/DirectoryPicker.svelte";
  import BackendStatus from "$lib/components/BackendStatus.svelte";
  import UsageStatusButton from "$lib/components/UsageStatusButton.svelte";
  import GithubStatusButton from "$lib/components/GithubStatusButton.svelte";
  import { Toaster } from "$lib/components/ui/sonner";
  import { initUpdateToast } from "$lib/updateToast.svelte";
  import type { RepoData } from "$lib/types";

  // Resize bounds for each sidebar (px).
  const LEFT_MIN = 200;
  const LEFT_MAX = 480;
  // The right panel's floor is the measured width of its tab strip
  // (Files/Changes/History/GitHub) so every tab always fits — see
  // `rightPanel.min` (localized labels + the optional GitHub tab shift it). The
  // ceiling is shared with that module.
  const RIGHT_MAX = RIGHT_PANEL_MAX;
  const BROWSER_MIN = 320;
  const BROWSER_MAX = 900;

  /** Fallback width for the browser panel when settings predate it. */
  const browserWidth = () => app.settings.browserPanelWidth ?? 520;

  type Side = "left" | "right" | "browser";

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
        : side === "right"
          ? app.settings.rightSidebarWidth
          : browserWidth();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (dragging === "left") {
      app.settings.leftSidebarWidth = clamp(startWidth + dx, LEFT_MIN, LEFT_MAX);
    } else if (dragging === "right") {
      // Right handle grows the panel as the pointer moves left. The floor is the
      // live tab-strip width, so the panel can't be shrunk to clip the tabs.
      app.settings.rightSidebarWidth = clamp(
        startWidth - dx,
        rightPanel.min,
        RIGHT_MAX,
      );
    } else {
      // Browser panel handle (far right) grows as the pointer moves left.
      app.settings.browserPanelWidth = clamp(startWidth - dx, BROWSER_MIN, BROWSER_MAX);
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

  // Live agents drive the orchestration entry point. Shown once ≥2 agents run
  // (fan-out/routing needs more than one) — or whenever any run exists, so a
  // saved run stays reachable to build, drive or review even with fewer agents.
  const liveAgents = $derived(orchestration.agents);
  const orchestratable = $derived(liveAgents.length >= 2 || orchestrationRun.runs.length > 0);

  // Give the entry point a quiet "attention" cue when it (re)appears, cleared once
  // the user opens the console — so a newly-available orchestration surface is
  // noticeable without being loud, and returns to normal after a click.
  let orchestrationAck = $state(false);
  let prevOrchestratable = false;
  $effect(() => {
    const o = orchestratable;
    untrack(() => {
      if (o && !prevOrchestratable) orchestrationAck = false;
      prevOrchestratable = o;
    });
  });
  const orchestrationAttention = $derived(orchestratable && !orchestrationAck);
  function openOrchestration() {
    orchestrationAck = true;
    app.orchestrationOpen = true;
  }

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

  // Load the active worktree's git status here too — at the always-mounted shell,
  // not inside the right panel. The status feeds the file-tree coloring, the
  // project-card dirty badges AND the Changes tab, so it must follow the active
  // worktree regardless of whether the right panel is open or which tab is shown
  // (previously this lived in RightPanel, so the status only loaded while that
  // panel was mounted). `startListening` subscribes once to the live
  // `git:status-changed` events; the load reacts to every worktree change.
  $effect(() => {
    void git.startListening();
  });
  $effect(() => {
    void git.load(projects.activeWorktreePath);
  });

  // GitHub integration: read sign-in status once the backend is ready, load the
  // active worktree's context (re-running when auth becomes available or the
  // worktree changes), and poll on the configured interval (paused when hidden).
  $effect(() => {
    if (app.backend !== "ready") return;
    void github.refreshStatus();
  });
  $effect(() => {
    void github.available;
    void github.loadContext(projects.activeWorktreePath);
  });
  $effect(() => {
    // Restart the poll when the interval setting changes; cleanup stops it.
    void app.settings.github?.pollSeconds;
    return github.startPolling();
  });

  // Detect installed external editors once, so the "Open with" menus are ready
  // the first time one is opened (idempotent; cheap PATH probe).
  $effect(() => {
    void openWith.ensureLoaded();
  });

  // New-worktree dialog: hold a stable repo reference for as long as the dialog
  // is open, so its bits-ui Dialog root is never *unmounted while open* (the
  // `{#if}` below keys off this latch, not the live `activeRepo`). An abrupt
  // unmount of an open modal can orphan the body pointer-events lock and freeze
  // the whole window; latching on open and releasing only once fully closed keeps
  // the root mounted through a normal close even if the active repo changes.
  let newWorktreeRepo = $state<RepoData | null>(null);
  $effect(() => {
    if (projects.newWorktreeOpen) {
      if (projects.activeRepo) newWorktreeRepo = projects.activeRepo;
    } else {
      newWorktreeRepo = null;
    }
  });

  // Drive the pinned, persistent update toast (replaces the old fixed banner):
  // shown while the updater has something actionable, re-shown on reload when a
  // staged download is restored, dismissed via the store. Native OS
  // notifications are untouched (see notify.ts).
  initUpdateToast();

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
  // The terminal handler (`Terminal.svelte`) owns keys while a terminal is
  // focused (it arbitrates app-shortcut vs TUI per action); here we only run the
  // matched action via the shared dispatcher when a terminal is *not* focused.
  function onKeyDown(e: KeyboardEvent) {
    // Settings / the GitHub section (full-screen) own their own keys.
    if (app.settingsOpen || app.githubOpen) return;
    // Never steal keys while typing in a terminal — the shell owns Ctrl+W/J/etc.
    const el = e.target as HTMLElement | null;
    if (el?.closest(".xterm")) return;
    const action = matchAction(e);
    if (!action) return;
    if (runAppAction(action)) e.preventDefault();
  }
</script>

<svelte:window oncontextmenu={onContextMenu} onkeydown={onKeyDown} />

<!-- Reusable column resize handle. Zero-width in layout so adjacent panels sit
     flush (no visible seam, even behind split terminals). The grab strip is
     offset to the *adjacent panel* side of the seam — never over the center
     pane's right edge, where the terminal scrollbar lives — so dragging the
     divider can't block the scrollbar or read as the panel overlapping the
     center. A hairline centered on the seam only shows on hover. -->
{#snippet resizeHandle(side: Side)}
  <div class="group relative w-0 shrink-0">
    <!-- Grab strip: on the left seam it sits over the left sidebar; on the
         right/browser seams over the panel to the right. Either way it stays off
         the center pane's scrollbar-bearing right edge. -->
    <div
      class={cn(
        "absolute inset-y-0 z-20 w-1.5 cursor-col-resize",
        side === "left" ? "right-0" : "left-0",
      )}
      role="separator"
      aria-orientation="vertical"
      onpointerdown={(e) => onHandleDown(side, e)}
      onpointermove={onHandleMove}
      onpointerup={onHandleUp}
    ></div>
    <!-- Seam hairline (visual only), centered on the boundary; shows on hover. -->
    <div
      class="pointer-events-none absolute inset-y-0 left-1/2 z-20 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-ring/50"
    ></div>
  </div>
{/snippet}

<div class="flex h-screen w-screen flex-col bg-background text-foreground">
  <!-- Non-blocking toasts (errors + successes) -->
  <Toaster position="bottom-right" />

  <!-- Window controls (min/max/close) — fixed top-right overlay. There is no
       title bar: the brand sits atop the left sidebar and these controls atop
       the right panel, while the three panels run to the very top of the window. -->
  <WindowControls />

  <!-- Quick worktree switcher (Ctrl/Cmd+P) -->
  <WorktreeSearch />

  <!-- Add-project directory picker (Ctrl/Cmd+O; also from the sidebar) -->
  <DirectoryPicker bind:open={projects.pickerOpen} />

  <!-- New-worktree dialog (Ctrl/Cmd+Shift+N; also the empty-state button). Lives
       here so the shortcut works regardless of what the center shows. Keyed off
       the `newWorktreeRepo` latch (set in the script) rather than the live
       `activeRepo`, so the Dialog root is never unmounted while open — it mounts
       when the dialog opens and unmounts only after it has fully closed. -->
  {#if newWorktreeRepo}
    <NewWorktreeDialog repo={newWorktreeRepo} bind:open={projects.newWorktreeOpen} />
  {/if}

  <!-- Unsaved-edit prompt (driven by the saveDiscard service on tab close) -->
  <SaveDiscardDialog />

  <!-- Content region below the title bar. The three-panel body stays mounted
       even while Settings is open (Settings overlays it), so terminals/PTYs are
       never torn down — otherwise an agent's launch command would be re-typed on
       return and xterm would lose its screen. -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <!-- Auto-update is surfaced as a pinned sonner toast (see initUpdateToast in
         the script) and inside Settings → Updates, not a top strip. -->

    <div class="flex min-h-0 flex-1">
      {#if app.settings.leftSidebarOpen}
        <!-- Region: Left sidebar (Projects panel) — brand · quick actions · projects. -->
        <aside
          class="flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
          style="width: {app.settings.leftSidebarWidth}px"
        >
          <LeftSidebar />
        </aside>

        {@render resizeHandle("left")}
      {/if}

      <!-- Region: Center workspace (Pane area) — a tree of regions whose tabs are
           terminals, file editors or diffs (TerminalArea). Every tab stays mounted
           (id-keyed) so no PTY/xterm/CodeMirror is torn down on split or tab switch. -->
      <main class="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <TerminalArea />
      </main>

      {#if app.settings.rightSidebarOpen}
        <!-- Region: Right panel — window-controls header · Files/Changes/History. -->
        {@render resizeHandle("right")}

        <aside
          class="flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
          style="width: {clamp(app.settings.rightSidebarWidth, rightPanel.min, RIGHT_MAX)}px"
        >
          <RightPanel />
        </aside>
      {/if}

      {#if app.browserOpen}
        {@render resizeHandle("browser")}

        <!-- 4th panel: the integrated developer browser. The toolbar is here; the
             page is a docked WebviewWindow positioned over the panel's content. -->
        <aside
          class="flex shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
          style="width: {browserWidth()}px"
        >
          <BrowserPanel />
        </aside>
      {/if}
    </div>

    <!-- Status bar: breadcrumb (left) · backend + panel toggles (right) -->
    <!-- Region: Status bar — breadcrumb (left) · backend + panel toggles (right). -->
    <footer
      class={cn("flex h-7 shrink-0 items-center gap-2 px-2 text-xs text-muted-foreground", divider.top)}
    >
      <!-- Active workspace breadcrumb -->
      <TooltipSimple title={i18n.t("terminal.context")}>
        {#snippet children(props)}
          <div {...props} class="inline-flex min-w-0 items-center gap-1">
            <LayersIcon class="size-3 shrink-0" />
            {#if ctx.repo}
              <span class="truncate">{ctx.repo}</span>
              <span class="text-muted-foreground/50">/</span>
            {/if}
            <span class="truncate font-medium text-foreground">{ctx.name}</span>
          </div>
        {/snippet}
      </TooltipSimple>

      <div class="flex-1"></div>

      {#if isUntestedPlatform}
        <TooltipSimple title={i18n.t("status.untestedTooltip", { os: osLabel() })}>
          {#snippet children(props)}
            <span
              {...props}
              class="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
            >
              <TriangleAlertIcon class="size-3.5" />
              {i18n.t("status.untested", { os: osLabel() })}
            </span>
          {/snippet}
        </TooltipSimple>
      {/if}
      {#if app.hooksNeedAttention}
        <TooltipSimple title={i18n.t("status.hooksIssueTooltip")}>
          {#snippet children(props)}
            <button
              {...props}
              class="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500 dark:text-amber-400"
              onclick={() => app.openSettings("hooks")}
            >
              <WebhookIcon class="size-3.5" />
              {i18n.t("status.hooksIssue")}
            </button>
          {/snippet}
        </TooltipSimple>
      {/if}

      <!-- Multi-agent orchestration: route messages across running agents. Shown
           only when ≥2 agents are live (fan-out needs more than one). -->
      {#if orchestratable}
        <TooltipSimple title={i18n.t("orchestration.open")}>
          {#snippet children(props)}
            <button
              {...props}
              class={cn(
                "inline-flex items-center gap-1 rounded px-1 transition-colors",
                orchestrationAttention
                  ? "text-foreground ring-1 ring-primary/40 bg-primary/5"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label={i18n.t("orchestration.open")}
              onclick={openOrchestration}
            >
              <WorkflowIcon class="size-3.5" />
              {liveAgents.length}
              {#if orchestration.pendingTotal > 0}
                <span class="size-1.5 shrink-0 rounded-full bg-primary"></span>
              {/if}
            </button>
          {/snippet}
        </TooltipSimple>
      {/if}

      <!-- GitHub: opens the section; shows notifications + rate limit (hidden when
           disabled / not signed in) -->
      <GithubStatusButton />

      <!-- Provider usage indicator (icon + popover; hidden when nothing pinned) -->
      <UsageStatusButton />

      <!-- Backend status (icon + live popover) -->
      <BackendStatus />

      <!-- Show/hide panels — selected = panel visible (neutral lifted segment) -->
      <TooltipSimple title={i18n.t("titlebar.toggleLeft")}>
        {#snippet children(props)}
          <button
            {...props}
            class={cn(
              "flex size-6 items-center justify-center rounded",
              app.settings.leftSidebarOpen
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            aria-label={i18n.t("titlebar.toggleLeft")}
            aria-pressed={app.settings.leftSidebarOpen}
            onclick={toggleLeftSidebar}
          >
            <PanelLeftIcon class="size-3.5" />
          </button>
        {/snippet}
      </TooltipSimple>
      <TooltipSimple title={i18n.t("terminal.toggleRight")}>
        {#snippet children(props)}
          <button
            {...props}
            class={cn(
              "flex size-6 items-center justify-center rounded",
              app.settings.rightSidebarOpen
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
            aria-label={i18n.t("terminal.toggleRight")}
            aria-pressed={app.settings.rightSidebarOpen}
            onclick={toggleRightSidebar}
          >
            <PanelRightIcon class="size-3.5" />
          </button>
        {/snippet}
      </TooltipSimple>
      {#if app.settings.browser?.enabled ?? true}
        <TooltipSimple title={i18n.t("browser.toggle")}>
          {#snippet children(props)}
            <button
              {...props}
              class={cn(
                "flex size-6 items-center justify-center rounded",
                app.browserOpen
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              aria-label={i18n.t("browser.toggle")}
              aria-pressed={app.browserOpen}
              onclick={() => app.toggleBrowser()}
            >
              <GlobeIcon class="size-3.5" />
            </button>
          {/snippet}
        </TooltipSimple>
      {/if}
    </footer>

    <!-- Settings overlays the still-mounted body (full content region). -->
    {#if app.settingsOpen}
      <div class="absolute inset-0 z-30">
        <Settings />
      </div>
    {/if}

    <!-- The GitHub section overlays the body the same way (its own full screen). -->
    {#if app.githubOpen}
      <div class="absolute inset-0 z-30">
        <GitHub />
      </div>
    {/if}
  </div>
</div>

<!-- Multi-agent orchestration console (modal; binds app.orchestrationOpen). -->
<OrchestrationConsole />
