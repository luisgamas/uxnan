// Terminal area state (Svelte 5 runes) — TabGroup model.
//
// The center area is a recursive tree of regions. A `TabGroup` is one region
// with its own tab strip (each tab = one PTY) and "+ New" button; an
// `AreaSplit` divides the area into two regions with an adjustable ratio.
// "New terminal" adds a tab to a region (only the active tab is shown there);
// "Split" divides a region into two side-by-side/stacked regions, each with its
// own tab strip. Every tab of every region stays mounted, so background and
// hidden terminals keep streaming losslessly, and restructuring the tree never
// remounts xterm or restarts a PTY.

import { invoke } from "@tauri-apps/api/core";
import type { SavedTermNode } from "$lib/types";

export type SplitDir = "row" | "col";

/** One terminal tab inside a region, backed by a single PTY. */
export interface GroupTab {
  /** PTY id (also the event channel suffix: `pty:output:{id}`). */
  id: string;
  title: string;
  cwd?: string;
  /** Shell executable for this tab's PTY (from the chosen terminal profile). */
  shell?: string;
  /** Shell arguments (from the chosen terminal profile). */
  args?: string[];
  exited: boolean;
}

/** A region: a tab strip over one-or-more terminals. */
export interface TabGroup {
  kind: "group";
  id: string;
  tabs: GroupTab[];
  activeTabId: string;
}

/** A split of two regions/sub-splits with an adjustable ratio for child `a`. */
export interface AreaSplit {
  kind: "split";
  dir: SplitDir;
  ratio: number;
  a: AreaNode;
  b: AreaNode;
}

export type AreaNode = TabGroup | AreaSplit;

let termCount = 0;

/** Options for opening a new terminal tab/region. */
export interface NewTabOptions {
  cwd?: string;
  title?: string;
  shell?: string;
  args?: string[];
  groupId?: string;
}

function newTab(opts?: Omit<NewTabOptions, "groupId">): GroupTab {
  termCount += 1;
  return {
    id: crypto.randomUUID(),
    title: opts?.title ?? `Terminal ${termCount}`,
    cwd: opts?.cwd,
    shell: opts?.shell,
    args: opts?.args,
    exited: false,
  };
}

function newGroup(opts?: Omit<NewTabOptions, "groupId">): TabGroup {
  const tab = newTab(opts);
  return { kind: "group", id: crypto.randomUUID(), tabs: [tab], activeTabId: tab.id };
}

function* groups(node: AreaNode): Generator<TabGroup> {
  if (node.kind === "group") {
    yield node;
  } else {
    yield* groups(node.a);
    yield* groups(node.b);
  }
}

function firstGroup(node: AreaNode): TabGroup {
  return groups(node).next().value as TabGroup;
}

function findGroup(node: AreaNode, groupId: string): TabGroup | null {
  for (const group of groups(node)) {
    if (group.id === groupId) return group;
  }
  return null;
}

function groupOfTab(node: AreaNode, tabId: string): TabGroup | null {
  for (const group of groups(node)) {
    if (group.tabs.some((t) => t.id === tabId)) return group;
  }
  return null;
}

/** Replace the group `groupId` with `replacement`, returning a new tree. */
function replaceGroup(
  node: AreaNode,
  groupId: string,
  replacement: AreaNode,
): AreaNode {
  if (node.kind === "group") {
    return node.id === groupId ? replacement : node;
  }
  return {
    ...node,
    a: replaceGroup(node.a, groupId, replacement),
    b: replaceGroup(node.b, groupId, replacement),
  };
}

/** Remove the group `groupId`; returns the new tree, or null if it was the only
 *  region. A split collapses to its surviving sibling. */
function removeGroup(node: AreaNode, groupId: string): AreaNode | null {
  if (node.kind === "group") {
    return node.id === groupId ? null : node;
  }
  const a = removeGroup(node.a, groupId);
  const b = removeGroup(node.b, groupId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
}

// --- Layout ---------------------------------------------------------------

/** A rectangle in percentages of the area (0..100). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GroupRect {
  group: TabGroup;
  rect: Rect;
}
export interface AreaDivider {
  node: AreaSplit;
  dir: SplitDir;
  rect: Rect;
}

/** Flatten the area tree into positioned regions + dividers. Rendering regions
 *  from this flat, id-keyed list keeps each region (and its terminals) mounted
 *  across tree changes. */
export function computeAreaLayout(root: AreaNode): {
  groups: GroupRect[];
  dividers: AreaDivider[];
} {
  const groupRects: GroupRect[] = [];
  const dividers: AreaDivider[] = [];

  const walk = (node: AreaNode, rect: Rect) => {
    if (node.kind === "group") {
      groupRects.push({ group: node, rect });
      return;
    }
    if (node.dir === "row") {
      const aw = rect.w * node.ratio;
      walk(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h });
      walk(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h });
    } else {
      const ah = rect.h * node.ratio;
      walk(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah });
      walk(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah });
    }
    dividers.push({ node, dir: node.dir, rect });
  };

  walk(root, { x: 0, y: 0, w: 100, h: 100 });
  return { groups: groupRects, dividers };
}

// --- Persistence (structure only; fresh shells spawn on restore) ----------

/** Serialize the area tree to a structure-only snapshot (no PTY ids/state). */
export function serializeArea(node: AreaNode): SavedTermNode {
  if (node.kind === "group") {
    const activeTab = Math.max(
      0,
      node.tabs.findIndex((t) => t.id === node.activeTabId),
    );
    return {
      type: "group",
      tabs: node.tabs.map((t) => ({
        title: t.title,
        cwd: t.cwd,
        shell: t.shell,
        args: t.args,
      })),
      activeTab,
    };
  }
  return {
    type: "split",
    dir: node.dir,
    ratio: node.ratio,
    a: serializeArea(node.a),
    b: serializeArea(node.b),
  };
}

/** Rebuild an area tree from a saved snapshot, assigning fresh PTY ids. */
function buildFromSaved(saved: SavedTermNode): AreaNode {
  if (saved.type === "group") {
    const tabs: GroupTab[] =
      saved.tabs.length > 0
        ? saved.tabs.map((t) => {
            termCount += 1;
            return {
              id: crypto.randomUUID(),
              title: t.title,
              cwd: t.cwd,
              shell: t.shell,
              args: t.args,
              exited: false,
            };
          })
        : [newTab()];
    const activeIdx = Math.min(Math.max(0, saved.activeTab), tabs.length - 1);
    return {
      kind: "group",
      id: crypto.randomUUID(),
      tabs,
      activeTabId: tabs[activeIdx].id,
    };
  }
  return {
    kind: "split",
    dir: saved.dir,
    ratio: saved.ratio,
    a: buildFromSaved(saved.a),
    b: buildFromSaved(saved.b),
  };
}

// --- Imperative pane handles (copy/paste/focus) ---------------------------

export interface TermController {
  copy: () => void;
  paste: () => Promise<void>;
  hasSelection: () => boolean;
  focus: () => void;
}

class TerminalStore {
  /** The region tree, or `null` when no terminals are open. The app starts with
   *  no terminal by default — the user opens one from the title-bar action, a
   *  project, or a worktree. */
  root = $state<AreaNode | null>(null);
  activeGroupId = $state<string>("");
  /** True once the persisted layout has been restored (or defaulted). The UI
   *  waits for this before mounting terminals, so no shell is spawned and then
   *  discarded by a restore. */
  hydrated = $state(false);
  private controllers = new Map<string, TermController>();

  /** Restore the area tree from a saved snapshot (or stay empty when there is
   *  none), then mark the store hydrated. Always call once at startup. */
  restore(saved: SavedTermNode | null | undefined): void {
    if (saved) {
      try {
        const root = buildFromSaved(saved);
        this.root = root;
        this.activeGroupId = firstGroup(root).id;
      } catch {
        // Corrupt layout — fall back to an empty area.
        this.root = null;
        this.activeGroupId = "";
      }
    } else {
      this.root = null;
      this.activeGroupId = "";
    }
    this.hydrated = true;
  }

  // --- Focus / selection ---------------------------------------------------
  setActiveGroup(groupId: string): void {
    this.activeGroupId = groupId;
  }
  setActiveTab(groupId: string, tabId: string): void {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (group) group.activeTabId = tabId;
    this.activeGroupId = groupId;
  }
  /** PTY id of the active tab of the active region, or null when the area is empty. */
  activePtyId(): string | null {
    if (!this.root) return null;
    const group = findGroup(this.root, this.activeGroupId) ?? firstGroup(this.root);
    return group?.activeTabId ?? null;
  }

  // --- Tabs ----------------------------------------------------------------
  /** Add a tab to a region (defaults to the active region). When the area is
   *  empty, this opens the first region. */
  create(opts?: NewTabOptions): string {
    if (!this.root) {
      const group = newGroup(opts);
      this.root = group;
      this.activeGroupId = group.id;
      return group.tabs[0].id;
    }
    const groupId = opts?.groupId ?? this.activeGroupId;
    const group = findGroup(this.root, groupId) ?? firstGroup(this.root);
    const tab = newTab(opts);
    group.tabs.push(tab);
    group.activeTabId = tab.id;
    this.activeGroupId = group.id;
    return tab.id;
  }

  markExited(ptyId: string): void {
    if (!this.root) return;
    const group = groupOfTab(this.root, ptyId);
    const tab = group?.tabs.find((t) => t.id === ptyId);
    if (tab) tab.exited = true;
  }

  /** Close one tab: kill its PTY; if it was the region's last tab, collapse the
   *  region (or reset to a fresh one if it was the only region). */
  async closeTab(groupId: string, tabId: string): Promise<void> {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (!group) return;
    try {
      await invoke("pty_close", { id: tabId });
    } catch {
      // Already gone — idempotent.
    }
    group.tabs = group.tabs.filter((t) => t.id !== tabId);
    if (group.tabs.length === 0) {
      this.collapseGroup(groupId);
    } else if (group.activeTabId === tabId) {
      group.activeTabId = group.tabs[group.tabs.length - 1].id;
    }
  }

  // --- Regions (split / close) --------------------------------------------
  /** Split a region into two, spawning a new region beside/below it. */
  split(
    groupId: string,
    dir: SplitDir,
    opts?: { cwd?: string; shell?: string; args?: string[] },
  ): void {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (!group) return;
    const fresh = newGroup(opts);
    this.root = replaceGroup(this.root, groupId, {
      kind: "split",
      dir,
      ratio: 0.5,
      a: group,
      b: fresh,
    });
    this.activeGroupId = fresh.id;
  }

  /** Close a whole region: kill every tab's PTY and collapse it. */
  async closeGroup(groupId: string): Promise<void> {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (!group) return;
    for (const tab of group.tabs) {
      invoke("pty_close", { id: tab.id }).catch(() => {});
    }
    this.collapseGroup(groupId);
  }

  private collapseGroup(groupId: string): void {
    if (!this.root) return;
    const newRoot = removeGroup(this.root, groupId);
    // `null` means the last region was closed → the area becomes empty (no
    // terminal is auto-spawned to replace it).
    this.root = newRoot;
    if (newRoot === null) {
      this.activeGroupId = "";
    } else if (!findGroup(newRoot, this.activeGroupId)) {
      this.activeGroupId = firstGroup(newRoot).id;
    }
  }

  // --- Controllers ---------------------------------------------------------
  registerController(ptyId: string, controller: TermController): void {
    this.controllers.set(ptyId, controller);
  }
  unregisterController(ptyId: string): void {
    this.controllers.delete(ptyId);
  }
  controller(ptyId: string): TermController | undefined {
    return this.controllers.get(ptyId);
  }
}

/** Singleton terminal store shared across the app. */
export const terminals = new TerminalStore();
