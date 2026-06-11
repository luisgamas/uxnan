<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { app } from "$lib/state/app.svelte";
  import { setTerminalLayout } from "$lib/api";
  import {
    terminals,
    computeAreaLayout,
    serializeArea,
    type AreaDivider,
    type AreaSplit,
    type Rect,
    type SplitDir,
  } from "$lib/state/terminals.svelte";
  import Terminal from "./Terminal.svelte";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import TerminalIcon from "@lucide/svelte/icons/terminal";

  const layout = $derived(
    terminals.root
      ? computeAreaLayout(terminals.root)
      : { groups: [], dividers: [] },
  );

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

  // Persist the region/tab layout (debounced) whenever it changes, once the
  // store has hydrated from disk. Reading the tree here makes it reactive.
  $effect(() => {
    const snapshot = terminals.root ? serializeArea(terminals.root) : null;
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
      { label: "Split right", action: () => terminals.split(groupId, "row") },
      { label: "Split down", action: () => terminals.split(groupId, "col") },
    ];
  }
  function regionItems(groupId: string, tabId: string): MenuItem[] {
    return [
      { label: "New terminal", action: () => terminals.create({ groupId }) },
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
  <!-- Slim strip: global new-terminal action + right-panel toggle (stays visible
       when the right panel is hidden) -->
  <div class="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-card px-2">
    <button
      class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      title="New terminal"
      onclick={() => terminals.create()}
    >
      <PlusIcon class="size-3.5" />
      Terminal
    </button>
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

  <!-- Regions: each is a TabGroup (own tab strip + “+ New”). Every region and
       tab stays mounted (id-keyed) and is positioned from the computed layout,
       so splitting / closing never remounts xterm or restarts a PTY. -->
  <div
    data-pane-container
    class="relative min-h-0 flex-1 overflow-hidden bg-[#0b0b0c]"
  >
    {#if terminals.hydrated && layout.groups.length === 0}
      <!-- Empty area: the app starts with no terminal; open one here or from a
           project / worktree in the left panel. -->
      <div class="flex h-full flex-col items-center justify-center gap-3 text-center">
        <TerminalIcon class="size-8 text-muted-foreground/60" />
        <div class="text-sm text-muted-foreground">No terminals open</div>
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground"
          onclick={() => terminals.create()}
        >
          <PlusIcon class="size-3.5" />
          New terminal
        </button>
      </div>
    {/if}

    {#if terminals.hydrated}
      {#each layout.groups as g (g.group.id)}
      {@const activeRegion = terminals.activeGroupId === g.group.id}
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
            onclick={() => terminals.create({ groupId: g.group.id })}
          >
            +
          </button>
        </div>

        <!-- Terminal stack for this region (active tab shown; others hidden) -->
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
                focused={activeRegion && g.group.activeTabId === t.id}
                onexit={() => terminals.markExited(t.id)}
              />
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#each layout.dividers as d (d.node)}
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
