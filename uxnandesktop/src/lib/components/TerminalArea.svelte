<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { app } from "$lib/state/app.svelte";
  import { projects } from "$lib/state/projects.svelte";
  import { setTerminalLayout } from "$lib/api";
  import {
    terminals,
    computeAreaLayout,
    GLOBAL_WORKSPACE,
    type AreaDivider,
    type AreaSplit,
    type Rect,
    type SplitDir,
  } from "$lib/state/terminals.svelte";
  import Terminal from "./Terminal.svelte";
  import FileEditor from "./FileEditor.svelte";
  import DiffPane from "./DiffPane.svelte";
  import CommitPane from "./CommitPane.svelte";
  import { resolveAgentDisplay } from "$lib/state/agentDisplay";
  import AgentStatusDot from "./AgentStatusDot.svelte";
  import { icon, text } from "$lib/design";
  import { cn } from "$lib/utils";
  import { i18n } from "$lib/i18n";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import Columns2Icon from "@lucide/svelte/icons/columns-2";
  import Rows2Icon from "@lucide/svelte/icons/rows-2";
  import GitBranchIcon from "@lucide/svelte/icons/git-branch";
  import FileIcon from "@lucide/svelte/icons/file";
  import FileDiffIcon from "@lucide/svelte/icons/file-diff";
  import GitCommitIcon from "@lucide/svelte/icons/git-commit-horizontal";
  import NewWorktreeDialog from "./NewWorktreeDialog.svelte";

  /** Default profile's shell/args, for region-level + and splits. A blank
   *  command falls back to the backend's platform default shell. */
  function defaultShellArgs() {
    const p = app.defaultProfile();
    const command = p?.command?.trim();
    return { shell: command || undefined, args: command ? p?.args : undefined };
  }

  // The terminal area background follows the resolved terminal theme (matches
  // xterm's background).
  const paneBg = $derived(app.resolveTerminal().theme.background);

  // --- Workspaces (one terminal set per worktree + a Global space) ---------
  // Active workspace breadcrumb (repo / branch). Rendered in the status bar
  // (`+page.svelte`); here it's only used for the empty-state copy.
  const ctx = $derived(projects.activeContext);

  /** The repo the active workspace belongs to (if any). The empty-state
   *  "New worktree" button is only enabled when this resolves to a repo —
   *  worktrees must branch from a registered git repo, not from the Global
   *  terminal space. Returns `null` for the Global workspace and when the
   *  active key doesn't match any known repo or worktree. */
  const activeRepo = $derived.by(() => {
    const key = terminals.activeWorkspace;
    if (key === GLOBAL_WORKSPACE) return null;
    const mainRepo = app.repos.find((r) => r.path === key);
    if (mainRepo) return mainRepo;
    for (const r of app.repos) {
      if (projects.worktreesOf(r.id).some((w) => w.path === key)) return r;
    }
    return null;
  });

  // --- Empty-state "New worktree" dialog state -----------------------------
  let newWorktreeOpen = $state(false);

  let unlistenDrop: (() => void) | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(async () => {
    // Native file drag-and-drop: insert the dropped paths into the terminal the
    // cursor is over (falls back to the active terminal).
    try {
      unlistenDrop = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          handleFileDrop(event.payload.paths, event.payload.position);
        }
      });
    } catch {
      // Not running inside Tauri (web preview) — no native file drop.
    }
  });
  onDestroy(() => {
    unlistenDrop?.();
    clearTimeout(saveTimer);
  });

  // Persist every workspace's layout (debounced) once the store has hydrated.
  // Reading the snapshot here makes it reactive to any workspace change.
  $effect(() => {
    const snapshot = terminals.serialize();
    if (!terminals.hydrated) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void setTerminalLayout(snapshot);
    }, 500);
  });

  function quotePath(p: string): string {
    return /\s/.test(p) ? `"${p}"` : p;
  }
  function handleFileDrop(paths: string[], position: { x: number; y: number }) {
    if (!paths.length) return;
    const dpr = window.devicePixelRatio || 1;
    const el = document.elementFromPoint(position.x / dpr, position.y / dpr);
    const paneEl = el?.closest("[data-pty-id]") as HTMLElement | null;
    const ptyId = paneEl?.dataset.ptyId ?? terminals.activePtyId();
    if (!ptyId) return;
    const text = paths.map(quotePath).join(" ") + " ";
    invoke("pty_write", { id: ptyId, data: text }).catch(() => {});
  }

  // --- Divider drag --------------------------------------------------------
  let drag = $state<{
    node: AreaSplit;
    dir: SplitDir;
    rect: Rect;
    container: HTMLElement;
  } | null>(null);

  function dividerStyle(d: AreaDivider): string {
    const boundary =
      d.dir === "row"
        ? d.rect.x + d.rect.w * d.node.ratio
        : d.rect.y + d.rect.h * d.node.ratio;
    return d.dir === "row"
      ? `left:calc(${boundary}% - 3px); top:${d.rect.y}%; width:6px; height:${d.rect.h}%;`
      : `left:${d.rect.x}%; top:calc(${boundary}% - 3px); width:${d.rect.w}%; height:6px;`;
  }
  function dividerDown(e: PointerEvent, d: AreaDivider) {
    const container = (e.currentTarget as HTMLElement).closest(
      "[data-pane-container]",
    ) as HTMLElement | null;
    if (!container) return;
    drag = { node: d.node, dir: d.dir, rect: d.rect, container };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function dividerMove(e: PointerEvent) {
    if (!drag) return;
    const r = drag.container.getBoundingClientRect();
    const local =
      drag.dir === "row"
        ? (((e.clientX - r.left) / r.width) * 100 - drag.rect.x) / drag.rect.w
        : (((e.clientY - r.top) / r.height) * 100 - drag.rect.y) / drag.rect.h;
    drag.node.ratio = Math.min(0.85, Math.max(0.15, local));
  }
  function dividerUp(e: PointerEvent) {
    drag = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  // --- Context menus -------------------------------------------------------
  type MenuItem =
    | { separator: true }
    | { label: string; action: () => void; danger?: boolean; disabled?: boolean };
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, items: MenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    menu = { x: e.clientX, y: e.clientY, items };
  }

  function splitItems(groupId: string): MenuItem[] {
    return [
      {
        label: i18n.t("terminal.splitRight"),
        action: () => terminals.split(groupId, "row", defaultShellArgs()),
      },
      {
        label: i18n.t("terminal.splitDown"),
        action: () => terminals.split(groupId, "col", defaultShellArgs()),
      },
    ];
  }
  function regionItems(groupId: string, tabId: string): MenuItem[] {
    return [
      {
        label: i18n.t("terminal.newTerminal"),
        action: () => terminals.create({ groupId, ...defaultShellArgs() }),
      },
      {
        label: i18n.t("terminal.closeTerminal"),
        action: () => void terminals.closeTab(groupId, tabId),
        danger: true,
      },
    ];
  }

  function terminalMenu(e: MouseEvent, groupId: string, tabId: string) {
    terminals.setActiveTab(groupId, tabId);
    const ctrl = terminals.controller(tabId);
    openMenu(e, [
      { label: i18n.t("terminal.copy"), action: () => ctrl?.copy(), disabled: !ctrl?.hasSelection() },
      { label: i18n.t("terminal.paste"), action: () => void ctrl?.paste() },
      { separator: true },
      ...splitItems(groupId),
      { separator: true },
      ...regionItems(groupId, tabId),
    ]);
  }
  function tabMenu(e: MouseEvent, groupId: string, tabId: string) {
    openMenu(e, [...splitItems(groupId), { separator: true }, ...regionItems(groupId, tabId)]);
  }

  // --- Tab drag (reorder within a region + move across regions) ------------
  // Implemented with pointer events, not HTML5 drag-and-drop: Tauri's native
  // OS drag-drop (used for dropping files into a terminal) suppresses HTML5
  // dnd inside the WebView, so a tab couldn't be dragged at all. Pointer events
  // mirror how the split dividers already work.
  //
  // `tabDrag` tracks the gesture (a click promotes to a drag only past a small
  // threshold, so taps still select). `dropSlot` is the live target (region +
  // insertion index), resolved by hit-testing the element under the pointer; it
  // drives both the insertion marker and the floating drag label.
  let tabDrag = $state<{
    tabId: string;
    title: string;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    dragging: boolean;
  } | null>(null);
  let dropSlot = $state<{ groupId: string; index: number } | null>(null);

  const DRAG_THRESHOLD_PX = 5;

  function onChipPointerDown(e: PointerEvent, tabId: string, title: string) {
    if (e.button !== 0) return; // left button only
    if ((e.target as HTMLElement).closest("[data-tab-close]")) return; // the × button
    tabDrag = {
      tabId,
      title,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      dragging: false,
    };
  }
  function onChipPointerMove(e: PointerEvent) {
    if (!tabDrag || e.pointerId !== tabDrag.pointerId) return;
    tabDrag.x = e.clientX;
    tabDrag.y = e.clientY;
    if (!tabDrag.dragging) {
      const moved = Math.hypot(e.clientX - tabDrag.startX, e.clientY - tabDrag.startY);
      if (moved < DRAG_THRESHOLD_PX) return;
      tabDrag.dragging = true;
      (e.currentTarget as HTMLElement).setPointerCapture(tabDrag.pointerId);
    }
    resolveDropSlot(e.clientX, e.clientY);
  }
  function onChipPointerUp(e: PointerEvent) {
    if (!tabDrag || e.pointerId !== tabDrag.pointerId) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(tabDrag.pointerId);
    const wasDragging = tabDrag.dragging;
    const tabId = tabDrag.tabId;
    const slot = dropSlot;
    tabDrag = null;
    dropSlot = null;
    if (wasDragging && slot) terminals.moveTab(tabId, slot.groupId, slot.index);
  }
  /** Resolve the drop slot from the element under the pointer: over a chip, the
   *  slot is before/after it by pointer side; over a strip's empty area, append;
   *  otherwise clear it. */
  function resolveDropSlot(x: number, y: number) {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const chip = el?.closest("[data-tab-id]") as HTMLElement | null;
    if (chip) {
      const r = chip.getBoundingClientRect();
      const after = x > r.left + r.width / 2;
      dropSlot = {
        groupId: chip.dataset.groupId ?? "",
        index: Number(chip.dataset.tabIndex) + (after ? 1 : 0),
      };
      return;
    }
    const strip = el?.closest("[data-tab-strip]") as HTMLElement | null;
    if (strip) {
      dropSlot = { groupId: strip.dataset.groupId ?? "", index: Number(strip.dataset.tabCount) };
      return;
    }
    dropSlot = null;
  }
  /** Whether the insertion marker sits at slot `index` of `groupId`. */
  function isDropAt(groupId: string, index: number): boolean {
    return !!tabDrag?.dragging && dropSlot?.groupId === groupId && dropSlot.index === index;
  }

</script>

<svelte:window
  onpointerdown={() => (menu = null)}
  onkeydown={(e) => e.key === "Escape" && (menu = null)}
/>

<div class="flex h-full flex-col">
  <!-- Region: Center workspace — the per-region tab strips sit at the very top
       now. The "new terminal" launcher (default + profiles) moved to the left
       sidebar's Projects header. Each workspace's region tree is rendered (and
       stays mounted) but only the active workspace is shown, so background
       worktrees keep streaming. -->
  <div class="relative min-h-0 flex-1 overflow-hidden" style:background-color={paneBg}>
    {#if terminals.hydrated}
      {#each terminals.openWorkspaceKeys as wsKey (wsKey)}
        {@const wsRoot = terminals.workspaceRoot(wsKey)}
        <div
          data-pane-container
          class="absolute inset-0 overflow-hidden"
          style:display={wsKey === terminals.activeWorkspace ? "block" : "none"}
        >
          {#if wsRoot}
            {@const wsLayout = computeAreaLayout(wsRoot)}
            {@const wsActiveGroup = terminals.workspaceActiveGroupId(wsKey)}
            {@const isActiveWs = wsKey === terminals.activeWorkspace}
            <div class="relative h-full w-full">
              {#each wsLayout.groups as g (g.group.id)}
                {@const activeRegion = isActiveWs && wsActiveGroup === g.group.id}
                <div
                  class="absolute flex flex-col overflow-hidden rounded-sm border {activeRegion
                    ? 'border-ring'
                    : 'border-transparent'}"
                  style="left:{g.rect.x}%; top:{g.rect.y}%; width:{g.rect.w}%; height:{g
                    .rect.h}%"
                  role="group"
                  onpointerdown={() => terminals.setActiveGroup(g.group.id)}
                >
                  <!-- Region tab strip (pointer-driven tab drag target) -->
                  <div
                    class="uxnan-scroll flex h-8 shrink-0 items-center gap-1 overflow-x-auto bg-card px-1"
                    data-tab-strip
                    data-group-id={g.group.id}
                    data-tab-count={g.group.tabs.length}
                  >
                    {#each g.group.tabs as t, ti (t.id)}
                      {@const activeChip = g.group.activeTabId === t.id}
                      <!-- Insertion marker before this tab -->
                      <div
                        class="h-5 w-0.5 shrink-0 rounded-full {isDropAt(g.group.id, ti)
                          ? 'bg-ring'
                          : 'bg-transparent'}"
                        aria-hidden="true"
                      ></div>
                      <div
                        class="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs {activeChip
                          ? 'bg-background text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'} {tabDrag?.dragging &&
                        tabDrag.tabId === t.id
                          ? 'opacity-40'
                          : ''}"
                        role="group"
                        data-tab-id={t.id}
                        data-group-id={g.group.id}
                        data-tab-index={ti}
                        onpointerdown={(e) =>
                          onChipPointerDown(e, t.id, t.kind === "terminal" ? (t.agentName ?? t.title) : t.title)}
                        onpointermove={onChipPointerMove}
                        onpointerup={onChipPointerUp}
                        oncontextmenu={t.kind === "terminal"
                          ? (e) => tabMenu(e, g.group.id, t.id)
                          : undefined}
                      >
                        {#if t.kind === "terminal"}
                          {@const display = resolveAgentDisplay(t)}
                          {#if display}
                            <AgentStatusDot status={display.status} stale={display.stale} />
                          {/if}
                          <button
                            class="max-w-[120px] truncate {t.exited ? 'line-through' : ''}"
                            onclick={() => terminals.setActiveTab(g.group.id, t.id)}
                            title={t.agentName ?? t.title}
                          >
                            {t.agentName ?? t.title}
                          </button>
                        {:else if t.kind === "file"}
                          <FileIcon class={cn(icon.decorative, "shrink-0")} />
                          <button
                            class="max-w-[120px] truncate"
                            onclick={() => terminals.setActiveTab(g.group.id, t.id)}
                            title={t.path}
                          >
                            {t.title}
                          </button>
                          {#if terminals.fileState(t.id)?.dirty}
                            <span
                              class="text-amber-600 dark:text-amber-400"
                              title={i18n.t("editor.unsaved")}>●</span
                            >
                          {/if}
                        {:else if t.kind === "diff"}
                          <FileDiffIcon class={cn(icon.decorative, "shrink-0")} />
                          <button
                            class="max-w-[120px] truncate"
                            onclick={() => terminals.setActiveTab(g.group.id, t.id)}
                            title={t.file}
                          >
                            {t.title}
                          </button>
                        {:else}
                          <GitCommitIcon class={cn(icon.decorative, "shrink-0")} />
                          <button
                            class="max-w-[120px] truncate font-mono"
                            onclick={() => terminals.setActiveTab(g.group.id, t.id)}
                            title={t.subject}
                          >
                            {t.title}
                          </button>
                        {/if}
                        <button
                          class="rounded px-0.5 text-muted-foreground opacity-60 hover:bg-destructive/20 hover:text-foreground hover:opacity-100"
                          title={i18n.t("terminal.closeTab")}
                          aria-label={i18n.t("terminal.closeTab")}
                          data-tab-close
                          onclick={() => terminals.closeTab(g.group.id, t.id)}
                        >
                          ×
                        </button>
                      </div>
                    {/each}
                    <!-- Insertion marker after the last tab (append slot) -->
                    <div
                      class="h-5 w-0.5 shrink-0 rounded-full {isDropAt(
                        g.group.id,
                        g.group.tabs.length,
                      )
                        ? 'bg-ring'
                        : 'bg-transparent'}"
                      aria-hidden="true"
                    ></div>
                    <button
                      class="ml-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title={i18n.t("terminal.newInRegion")}
                      aria-label={i18n.t("terminal.newTerminal")}
                      onclick={() =>
                        terminals.create({ groupId: g.group.id, ...defaultShellArgs() })}
                    >
                      +
                    </button>
                    <div class="flex-1"></div>
                    <button
                      class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title={i18n.t("terminal.splitRight")}
                      aria-label={i18n.t("terminal.splitRight")}
                      onclick={() => terminals.split(g.group.id, "row", defaultShellArgs())}
                    >
                      <Columns2Icon class={icon.button} />
                    </button>
                    <button
                      class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title={i18n.t("terminal.splitDown")}
                      aria-label={i18n.t("terminal.splitDown")}
                      onclick={() => terminals.split(g.group.id, "col", defaultShellArgs())}
                    >
                      <Rows2Icon class={icon.button} />
                    </button>
                  </div>

                  <!-- Pane stack for this region (active tab shown). One pane per
                       tab, branched by kind; every pane stays mounted (id-keyed)
                       so xterm/CodeMirror never remount on split/reorder. -->
                  <div class="relative min-h-0 flex-1">
                    {#each g.group.tabs as t (t.id)}
                      {@const paneActive = g.group.activeTabId === t.id}
                      <div
                        class="absolute inset-0 overflow-hidden"
                        style:display={paneActive ? "block" : "none"}
                        role="group"
                        data-pty-id={t.kind === "terminal" ? t.id : undefined}
                        onpointerdown={() => terminals.setActiveTab(g.group.id, t.id)}
                        oncontextmenu={t.kind === "terminal"
                          ? (e) => terminalMenu(e, g.group.id, t.id)
                          : undefined}
                      >
                        {#if t.kind === "terminal"}
                          {#if t.exited}
                            <span
                              class="absolute left-1 top-1 z-10 rounded bg-card/80 px-1 text-[10px] text-muted-foreground"
                              >{i18n.t("terminal.exited")}</span
                            >
                          {/if}
                          <Terminal
                            id={t.id}
                            cwd={t.cwd}
                            shell={t.shell}
                            args={t.args}
                            runCommand={t.runCommand}
                            env={t.env}
                            focused={activeRegion && paneActive}
                            onexit={() => void terminals.closeTabAnywhere(t.id)}
                          />
                        {:else if t.kind === "file"}
                          {@const st = terminals.fileState(t.id)}
                          {#if st}
                            <FileEditor fileState={st} active={activeRegion && paneActive} />
                          {/if}
                        {:else if t.kind === "diff"}
                          {@const st = terminals.diffState(t.id)}
                          {#if st}
                            <DiffPane state={st} />
                          {/if}
                        {:else}
                          {@const st = terminals.commitState(t.id)}
                          {#if st}
                            <CommitPane state={st} />
                          {/if}
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}

              {#each wsLayout.dividers as d (d.node)}
                <div
                  class="absolute z-20 flex {d.dir === 'row'
                    ? 'cursor-col-resize'
                    : 'cursor-row-resize'}"
                  style={dividerStyle(d)}
                  role="separator"
                  aria-orientation={d.dir === "row" ? "vertical" : "horizontal"}
                  onpointerdown={(e) => dividerDown(e, d)}
                  onpointermove={dividerMove}
                  onpointerup={dividerUp}
                >
                  <div
                    class="bg-border/60 transition-colors hover:bg-ring/70 {d.dir === 'row'
                      ? 'mx-auto h-full w-px'
                      : 'my-auto h-px w-full'}"
                  ></div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if !terminals.root}
        <!-- Active workspace has no terminal open. Centered brand mark +
             two actions. The "New worktree" action only makes sense inside
             a registered repo's context, so it's disabled (with a tooltip)
             in the Global workspace where there's nothing to branch from. -->
        <div class="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <img
            src="/logo_nb.svg"
            alt=""
            aria-hidden="true"
            class="block size-24 opacity-90 dark:hidden"
          />
          <img
            src="/logo_wnb.svg"
            alt=""
            aria-hidden="true"
            class="hidden size-24 opacity-90 dark:block"
          />
          <div class={cn("text-muted-foreground", text.body)}>
            {i18n.t("terminal.noTerminalsIn", {
              context: ctx.repo ? `${ctx.repo} / ${ctx.name}` : ctx.name,
            })}
          </div>
          <div class="flex flex-wrap items-center justify-center gap-2">
            <button
              class={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-accent hover:text-accent-foreground",
                text.body,
              )}
              onclick={() => app.openTerminal()}
            >
              <PlusIcon class={icon.button} />
              {i18n.t("terminal.newTerminal")}
            </button>
            {#if activeRepo}
              <button
                class={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-accent hover:text-accent-foreground",
                  text.body,
                )}
                onclick={() => (newWorktreeOpen = true)}
              >
                <GitBranchIcon class={icon.button} />
                {i18n.t("newWorktree.title")}
              </button>
            {:else}
              <button
                class={cn(
                  "inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 font-medium text-muted-foreground/70",
                  text.body,
                )}
                disabled
                title={i18n.t("terminal.worktreeNeedsRepo")}
              >
                <GitBranchIcon class={icon.button} />
                {i18n.t("newWorktree.title")}
              </button>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<!-- Dialog is mounted once at the bottom of the component tree. We pass the
     active repo (resolved above); the bindable `open` is only flipped when the
     user clicks the empty-state's "New worktree" button. -->
{#if activeRepo}
  <NewWorktreeDialog repo={activeRepo} bind:open={newWorktreeOpen} />
{/if}

<!-- Floating label that follows the pointer while dragging a tab. -->
{#if tabDrag?.dragging}
  <div
    class="pointer-events-none fixed z-50 max-w-[160px] truncate rounded border border-border bg-popover px-2 py-0.5 text-xs text-popover-foreground shadow-md"
    style="left:{tabDrag.x + 12}px; top:{tabDrag.y + 12}px"
  >
    {tabDrag.title}
  </div>
{/if}

<!-- Floating context menu -->
{#if menu}
  <div
    class="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md"
    style="left:{menu.x}px; top:{menu.y}px"
    role="menu"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
  >
    {#each menu.items as item, i (i)}
      {#if "separator" in item}
        <div class="my-1 h-px bg-border"></div>
      {:else}
        <button
          class="flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent {item.danger
            ? 'text-destructive'
            : ''}"
          disabled={item.disabled}
          onclick={() => {
            item.action();
            menu = null;
          }}
        >
          {item.label}
        </button>
      {/if}
    {/each}
  </div>
{/if}
