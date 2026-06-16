// Terminal area state (Svelte 5 runes) — per-workspace TabGroup model.
//
// Terminals are grouped into **workspaces**: one per worktree (keyed by its
// path) plus a "Global" space (key `""`) for terminals not tied to a worktree.
// Switching the active workspace shows that worktree's terminals and hides the
// others — but every workspace (and every region/tab) stays mounted, so hidden
// terminals keep streaming losslessly and their PTYs keep running.
//
// Within a workspace the layout is a recursive tree of regions. A `TabGroup` is
// one region with its own tab strip (each tab = one PTY) and "+ New" button; an
// `AreaSplit` divides a region into two with an adjustable ratio. Restructuring
// the tree never remounts xterm or restarts a PTY.

import { invoke } from "@tauri-apps/api/core";
import type { SavedTermNode, SavedTerminalLayout } from "$lib/types";

export type SplitDir = "row" | "col";

/** The unassigned "Global" workspace key. */
export const GLOBAL_WORKSPACE = "";

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
  /** One-shot command typed into the shell once it starts (agent launch).
   *  Transient — never serialized, so a restored layout doesn't re-run it. */
  runCommand?: string;
  /** Agent launched in this tab (set by `launchAgent`); drives idle monitoring
   *  + notifications and the per-agent sidebar rows. Transient. */
  agentName?: string;
  /** Logo key for the agent (catalog id), for the sidebar row. Transient. */
  agentIcon?: string | null;
  /** Activity inference: `true` while the tab is producing output (set by the
   *  agent monitor). Transient. */
  working?: boolean;
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
  /** One-shot command to type into the shell once it starts (agent launch). */
  runCommand?: string;
  /** Agent launched in this tab (enables idle monitoring + notifications). */
  agentName?: string;
  /** Logo key for the agent (catalog id), for the sidebar row. */
  agentIcon?: string | null;
  groupId?: string;
  /** Workspace to open in (switches the active workspace first). */
  workspace?: string;
}

function newTab(opts?: Omit<NewTabOptions, "groupId" | "workspace">): GroupTab {
  termCount += 1;
  return {
    id: crypto.randomUUID(),
    title: opts?.title ?? `Terminal ${termCount}`,
    cwd: opts?.cwd,
    shell: opts?.shell,
    args: opts?.args,
    runCommand: opts?.runCommand,
    agentName: opts?.agentName,
    agentIcon: opts?.agentIcon,
    exited: false,
  };
}

function newGroup(opts?: Omit<NewTabOptions, "groupId" | "workspace">): TabGroup {
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

function* allTabs(node: AreaNode): Generator<GroupTab> {
  for (const group of groups(node)) yield* group.tabs;
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

/** Serialize one area tree to a structure-only snapshot (no PTY ids/state). */
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
  /** Region tree per workspace (worktree path, or `""` for Global). `null` = the
   *  workspace exists but has no terminal open. */
  workspaces = $state<Record<string, AreaNode | null>>({});
  /** Active region id per workspace. */
  activeGroups = $state<Record<string, string>>({});
  /** The currently-shown workspace key. */
  activeWorkspace = $state<string>(GLOBAL_WORKSPACE);
  /** True once the persisted layout has been restored (or defaulted). The UI
   *  waits for this before mounting terminals, so no shell is spawned and then
   *  discarded by a restore. */
  hydrated = $state(false);
  private controllers = new Map<string, TermController>();

  // The active workspace's tree / active region, proxied so all the per-tree
  // methods below operate on the visible workspace without change.
  get root(): AreaNode | null {
    return this.workspaces[this.activeWorkspace] ?? null;
  }
  set root(value: AreaNode | null) {
    this.workspaces = { ...this.workspaces, [this.activeWorkspace]: value };
  }
  get activeGroupId(): string {
    return this.activeGroups[this.activeWorkspace] ?? "";
  }
  set activeGroupId(value: string) {
    this.activeGroups = { ...this.activeGroups, [this.activeWorkspace]: value };
  }

  /** Workspace keys that currently have at least one terminal open. */
  get openWorkspaceKeys(): string[] {
    return Object.keys(this.workspaces).filter((k) => this.workspaces[k] != null);
  }
  /** A specific workspace's tree (for rendering every workspace mounted). */
  workspaceRoot(key: string): AreaNode | null {
    return this.workspaces[key] ?? null;
  }
  /** A specific workspace's active region id. */
  workspaceActiveGroupId(key: string): string {
    return this.activeGroups[key] ?? "";
  }
  /** Number of terminals open in a workspace (for the "running" indicator). */
  terminalCount(key: string): number {
    const tree = this.workspaces[key];
    if (!tree) return 0;
    let count = 0;
    for (const _tab of allTabs(tree)) count += 1;
    return count;
  }

  /** Switch the visible workspace (creating an empty entry if unknown). */
  setWorkspace(key: string): void {
    if (!(key in this.workspaces)) {
      this.workspaces = { ...this.workspaces, [key]: null };
    }
    this.activeWorkspace = key;
  }

  /** Restore per-workspace trees from a saved snapshot, then mark hydrated. */
  restore(saved: SavedTerminalLayout | null | undefined): void {
    const ws: Record<string, AreaNode | null> = {};
    const ag: Record<string, string> = {};
    if (saved?.workspaces) {
      for (const [key, node] of Object.entries(saved.workspaces)) {
        try {
          const tree = buildFromSaved(node);
          ws[key] = tree;
          ag[key] = firstGroup(tree).id;
        } catch {
          // Skip a corrupt workspace entry.
        }
      }
    }
    const active = saved?.active ?? GLOBAL_WORKSPACE;
    if (!(active in ws)) ws[active] = null;
    this.workspaces = ws;
    this.activeGroups = ag;
    this.activeWorkspace = active;
    this.hydrated = true;
  }

  /** Snapshot of every non-empty workspace + the active key (for persistence). */
  serialize(): SavedTerminalLayout {
    const workspaces: Record<string, SavedTermNode> = {};
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (tree) workspaces[key] = serializeArea(tree);
    }
    return { active: this.activeWorkspace, workspaces };
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
  /** PTY id of the active tab of the active region, or null when empty. */
  activePtyId(): string | null {
    if (!this.root) return null;
    const group = findGroup(this.root, this.activeGroupId) ?? firstGroup(this.root);
    return group?.activeTabId ?? null;
  }

  // --- Tabs ----------------------------------------------------------------
  /** Add a tab to a region (defaults to the active region of the active
   *  workspace). `opts.workspace` switches workspace first; an empty workspace
   *  opens its first region. */
  create(opts?: NewTabOptions): string {
    if (opts?.workspace !== undefined) this.setWorkspace(opts.workspace);
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

  // --- Agent activity monitoring (read by the agent monitor + the sidebar) ---

  /** Find a tab by id across all workspaces (for the activity monitor). */
  findTab(tabId: string): GroupTab | undefined {
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      const group = groupOfTab(tree, tabId);
      const tab = group?.tabs.find((t) => t.id === tabId);
      if (tab) return tab;
    }
    return undefined;
  }

  /** The workspace key (worktree path, or "") that holds a given tab, if any. */
  workspaceOfTab(tabId: string): string | undefined {
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (tree && groupOfTab(tree, tabId)) return key;
    }
    return undefined;
  }

  /** Every open tab paired with its workspace key (for the activity monitor). */
  *tabsWithWorkspace(): Generator<{ tab: GroupTab; workspace: string }> {
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      for (const tab of allTabs(tree)) yield { tab, workspace: key };
    }
  }

  /** Whether any terminal in a workspace is currently producing output. */
  workspaceWorking(key: string): boolean {
    const tree = this.workspaces[key];
    if (!tree) return false;
    for (const tab of allTabs(tree)) if (tab.working) return true;
    return false;
  }

  /** The agent terminals open in a workspace (tabs launched as an agent), in
   *  tab order — these get their own clickable rows in the sidebar. */
  agentTabs(key: string): GroupTab[] {
    const tree = this.workspaces[key];
    if (!tree) return [];
    const out: GroupTab[] = [];
    for (const tab of allTabs(tree)) if (tab.agentName) out.push(tab);
    return out;
  }

  /** Reveal a specific terminal: show its workspace and make it the active tab
   *  of its region (so clicking a sidebar agent row jumps to its terminal). */
  revealTab(key: string, tabId: string): void {
    this.setWorkspace(key);
    const tree = this.root;
    if (!tree) return;
    const group = groupOfTab(tree, tabId);
    if (group) this.setActiveTab(group.id, tabId);
  }

  /** Close one tab in the active workspace: kill its PTY; if it was the region's
   *  last tab, collapse the region (or empty the workspace if it was the last). */
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

  /** Close a tab in whichever workspace holds it (even a hidden one): kill its
   *  PTY and remove it, collapsing an emptied region/workspace. Called when a
   *  terminal's process exits (e.g. the user ran `exit`) so the pane doesn't
   *  linger open-but-unwritable — it closes completely. */
  async closeTabAnywhere(tabId: string): Promise<void> {
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      const group = groupOfTab(tree, tabId);
      if (!group) continue;
      try {
        await invoke("pty_close", { id: tabId });
      } catch {
        // Already gone — idempotent.
      }
      if (group.tabs.length > 1) {
        group.tabs = group.tabs.filter((t) => t.id !== tabId);
        if (group.activeTabId === tabId) {
          group.activeTabId = group.tabs[group.tabs.length - 1].id;
        }
      } else {
        // Last tab in the region → drop the region from its workspace.
        const newTree = removeGroup(tree, group.id);
        this.workspaces = { ...this.workspaces, [key]: newTree };
        if (newTree) {
          const ag = this.activeGroups[key];
          if (!ag || !findGroup(newTree, ag)) {
            this.activeGroups = {
              ...this.activeGroups,
              [key]: firstGroup(newTree).id,
            };
          }
        } else {
          const { [key]: _drop, ...rest } = this.activeGroups;
          this.activeGroups = rest;
        }
      }
      return;
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
    // `null` means the last region closed → the workspace becomes empty.
    this.root = newRoot;
    if (newRoot === null) {
      this.activeGroupId = "";
    } else if (!findGroup(newRoot, this.activeGroupId)) {
      this.activeGroupId = firstGroup(newRoot).id;
    }
  }

  /** Drop a workspace entirely: kill all its PTYs and forget it (used when its
   *  worktree is removed). Switches to Global if it was active. */
  dropWorkspace(key: string): void {
    const tree = this.workspaces[key];
    if (tree) {
      for (const tab of allTabs(tree)) {
        invoke("pty_close", { id: tab.id }).catch(() => {});
      }
    }
    const { [key]: _root, ...restWs } = this.workspaces;
    const { [key]: _grp, ...restAg } = this.activeGroups;
    this.workspaces = restWs;
    this.activeGroups = restAg;
    if (this.activeWorkspace === key) this.activeWorkspace = GLOBAL_WORKSPACE;
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
