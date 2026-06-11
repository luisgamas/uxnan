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
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import LayersIcon from "@lucide/svelte/icons/layers";

  /** Default profile's shell/args, for region-level + and splits. A blank
   *  command falls back to the backend's platform default shell. */
  function defaultShellArgs() {
    const p = app.defaultProfile();
    const command = p?.command?.trim();
    return { shell: command || undefined, args: command ? p?.args : undefined };
  }

  // The terminal area background follows the app theme (matches xterm's bg).
  const paneBg = $derived(app.terminalPalette().background);

  // --- Workspaces (one terminal set per worktree + a Global space) ---------
  const baseName = (p: string) =>
    p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

  /** Friendly label for the active terminal context (repo / branch). The
   *  context is chosen in the left panel; here it's only displayed. */
  function contextLabel(key: string): { repo?: string; name: string } {
    if (key === GLOBAL_WORKSPACE) return { name: "General" };
    const mainRepo = app.repos.find((r) => r.path === key);
    if (mainRepo) {
      return {
        repo: mainRepo.name,
        name: projects.mainWorktree(mainRepo.id)?.branch ?? "main",
      };
    }
    for (const r of app.repos) {
      const wt = projects.worktreesOf(r.id).find((w) => w.path === key);
      if (wt) return { repo: r.name, name: wt.branch ?? baseName(key) };
    }
    return { name: baseName(key) };
  }
  const ctx = $derived(contextLabel(terminals.activeWorkspace));

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
        label: "Split right",
        action: () => terminals.split(groupId, "row", defaultShellArgs()),
      },
      {
        label: "Split down",
        action: () => terminals.split(groupId, "col", defaultShellArgs()),
      },
    ];
  }
  function regionItems(groupId: string, tabId: string): MenuItem[] {
    return [
      {
        label: "New terminal",
        action: () => terminals.create({ groupId, ...defaultShellArgs() }),
      },
      {
        label: "Close terminal",
        action: () => void terminals.closeTab(groupId, tabId),
        danger: true,
      },
    ];
  }

  function terminalMenu(e: MouseEvent, groupId: string, tabId: string) {
    terminals.setActiveTab(groupId, tabId);
    const ctrl = terminals.controller(tabId);
    openMenu(e, [
      { label: "Copy", action: () => ctrl?.copy(), disabled: !ctrl?.hasSelection() },
      { label: "Paste", action: () => void ctrl?.paste() },
      { separator: true },
      ...splitItems(groupId),
      { separator: true },
      ...regionItems(groupId, tabId),
    ]);
  }
  function tabMenu(e: MouseEvent, groupId: string, tabId: string) {
    openMenu(e, [...splitItems(groupId), { separator: true }, ...regionItems(groupId, tabId)]);
  }

  function toggleRight() {
    app.settings.rightSidebarOpen = !app.settings.rightSidebarOpen;
    void app.persistSettings();
  }
</script>

<svelte:window
  onpointerdown={() => (menu = null)}
  onkeydown={(e) => e.key === "Escape" && (menu = null)}
/>

<div class="flex h-full flex-col">
  <!-- Slim strip: new-terminal action, workspace switcher, right-panel toggle -->
  <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
    <div class="flex items-center">
      <button
        class="inline-flex items-center gap-1 rounded-l px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        title="New terminal (default profile)"
        onclick={() => app.openTerminal()}
      >
        <PlusIcon class="size-3.5" />
        Terminal
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              class="rounded-r px-0.5 py-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              title="Choose a terminal profile"
              aria-label="Choose a terminal profile"
              {...props}
            >
              <ChevronDownIcon class="size-3.5" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-44">
          <DropdownMenu.Label class="text-[11px]">New terminal</DropdownMenu.Label>
          {#each app.terminalProfiles as p (p.id)}
            <DropdownMenu.Item
              class="text-xs"
              onclick={() => app.openTerminal({ profileId: p.id })}
            >
              <TerminalIcon class="size-3.5" />
              {p.name.trim() || "Unnamed profile"}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <!-- Active terminal context (read-only; selected in the left panel) -->
    <div
      class="ml-1 inline-flex max-w-[240px] items-center gap-1 px-1 text-xs text-muted-foreground"
      title="Active terminal context — choose a project or worktree in the left panel"
    >
      <LayersIcon class="size-3.5 shrink-0" />
      {#if ctx.repo}
        <span class="truncate">{ctx.repo}</span>
        <span class="text-muted-foreground/50">/</span>
      {/if}
      <span class="truncate font-medium text-foreground">{ctx.name}</span>
    </div>

    <div class="flex-1"></div>
    <button
      class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="Toggle right panel"
      aria-label="Toggle right panel"
      onclick={toggleRight}
    >
      ⇆
    </button>
  </div>

  <!-- Each workspace's region tree is rendered (and stays mounted) but only the
       active workspace is shown, so background worktrees keep streaming. -->
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
                  <!-- Region tab strip -->
                  <div
                    class="uxnan-scroll flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-1"
                  >
                    {#each g.group.tabs as t (t.id)}
                      <div
                        class="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs {g
                          .group.activeTabId === t.id
                          ? 'bg-background text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
                        role="group"
                        oncontextmenu={(e) => tabMenu(e, g.group.id, t.id)}
                      >
                        <button
                          class="max-w-[120px] truncate {t.exited ? 'line-through' : ''}"
                          onclick={() => terminals.setActiveTab(g.group.id, t.id)}
                          title="{t.title} — right-click for options"
                        >
                          {t.title}
                        </button>
                        <button
                          class="rounded px-0.5 text-muted-foreground opacity-60 hover:bg-destructive/20 hover:text-foreground hover:opacity-100"
                          title="Close terminal"
                          aria-label="Close terminal"
                          onclick={() => terminals.closeTab(g.group.id, t.id)}
                        >
                          ×
                        </button>
                      </div>
                    {/each}
                    <button
                      class="ml-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      title="New terminal in this region"
                      aria-label="New terminal"
                      onclick={() =>
                        terminals.create({ groupId: g.group.id, ...defaultShellArgs() })}
                    >
                      +
                    </button>
                  </div>

                  <!-- Terminal stack for this region (active tab shown) -->
                  <div class="relative min-h-0 flex-1">
                    {#each g.group.tabs as t (t.id)}
                      <div
                        class="absolute inset-0 overflow-hidden"
                        style:display={g.group.activeTabId === t.id ? "block" : "none"}
                        role="group"
                        data-pty-id={t.id}
                        onpointerdown={() => terminals.setActiveTab(g.group.id, t.id)}
                        oncontextmenu={(e) => terminalMenu(e, g.group.id, t.id)}
                      >
                        {#if t.exited}
                          <span
                            class="absolute left-1 top-1 z-10 rounded bg-card/80 px-1 text-[10px] text-muted-foreground"
                            >exited</span
                          >
                        {/if}
                        <Terminal
                          id={t.id}
                          cwd={t.cwd}
                          shell={t.shell}
                          args={t.args}
                          focused={activeRegion && g.group.activeTabId === t.id}
                          onexit={() => terminals.markExited(t.id)}
                        />
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
                    class="bg-border transition-colors hover:bg-ring {d.dir === 'row'
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
        <!-- Active workspace has no terminal open. -->
        <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
          <TerminalIcon class="size-8 text-muted-foreground/60" />
          <div class="text-sm text-muted-foreground">
            No terminals in <span class="font-medium text-foreground"
              >{ctx.repo ? `${ctx.repo} / ${ctx.name}` : ctx.name}</span
            >
          </div>
          <button
            class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
            onclick={() => app.openTerminal()}
          >
            <PlusIcon class="size-3.5" />
            New terminal
          </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

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
