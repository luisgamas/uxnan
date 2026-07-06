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
import { listen } from "@tauri-apps/api/event";
import { fsRename } from "$lib/api";
import type { FsChangedEvent, SavedTab, SavedTermNode, SavedTerminalLayout } from "$lib/types";
import { i18n } from "$lib/i18n";
import { saveDiscard } from "$lib/state/confirm.svelte";
import { FileEditorState } from "$lib/state/files.svelte";
import { CommitViewerState, DiffViewerState } from "$lib/state/git.svelte";

export type SplitDir = "row" | "col";

/** The unassigned "Global" workspace key. */
export const GLOBAL_WORKSPACE = "";

/** Fields shared by every kind of tab in a region. */
interface BaseTab {
  /** Universal tab id. For a terminal it's also the PTY id (and the event
   *  channel suffix: `pty:output:{id}`). */
  id: string;
  title: string;
  /** A user-set tab label that overrides the derived title (from "Rename tab").
   *  For terminals it's persisted; for a file tab renaming instead renames the
   *  file on disk, so this stays a label-only override for terminal/diff/commit. */
  customTitle?: string;
}

/** A terminal tab, backed by a single PTY. */
export interface TerminalTab extends BaseTab {
  kind: "terminal";
  cwd?: string;
  /** Shell executable for this tab's PTY (from the chosen terminal profile). */
  shell?: string;
  /** Shell arguments (from the chosen terminal profile). */
  args?: string[];
  /** One-shot command typed into the shell once it starts (agent launch).
   *  Transient — never serialized, so a restored layout doesn't re-run it. */
  runCommand?: string;
  /** Extra environment variables for this tab's PTY (agent env), as `[key,
   *  value]` pairs. Transient — applied at spawn, never serialized. */
  env?: [string, string][];
  /** Agent launched in this tab (set by `launchAgent`); drives idle monitoring
   *  + notifications and the per-agent sidebar rows. Transient. */
  agentName?: string;
  /** Logo key for the agent (catalog id), for the sidebar row. Transient. */
  agentIcon?: string | null;
  /** The launched agent's executable (e.g. `claude`), used to route orchestrated
   *  messages by agent type. Transient. */
  agentCommand?: string;
  /** Activity inference: `true` while the tab is producing output (set by the
   *  agent monitor). Transient. */
  working?: boolean;
  exited: boolean;
}

/** A file-editor tab. Its live state (content/dirty/diff) lives in the store's
 *  per-tab registry, keyed by `id` (see `fileState`). */
export interface FileTab extends BaseTab {
  kind: "file";
  /** Absolute, forward-slash path of the open file. */
  path: string;
  /** Worktree root for git-relative ops + the change gutter (null = none). */
  worktree: string | null;
}

/** A diff-viewer tab. Its live state lives in the per-tab registry (`diffState`).
 *  Self-contained: carries its own `worktree` so it's independent of the right
 *  panel's active worktree. */
export interface DiffTab extends BaseTab {
  kind: "diff";
  worktree: string;
  /** Worktree-relative file path. */
  file: string;
  staged: boolean;
}

/** A commit-viewer tab (read-only): the full diff a commit introduced. Its live
 *  state lives in the per-tab registry (`commitState`). Self-contained: carries
 *  its own `worktree`, independent of the right panel's active worktree. */
export interface CommitTab extends BaseTab {
  kind: "commit";
  worktree: string;
  /** Full commit hash. */
  hash: string;
  /** Commit subject (for the tab title tooltip). */
  subject: string;
  /** When set, the tab shows only this file's slice of the commit diff. */
  file?: string;
}

export type GroupTab = TerminalTab | FileTab | DiffTab | CommitTab;

/** The label shown on a tab (strip + drag ghost): a user-set `customTitle` wins;
 *  otherwise a terminal shows its running agent's name (else its own title), and
 *  every other kind shows its derived title. */
export function tabDisplayTitle(t: GroupTab): string {
  if (t.customTitle) return t.customTitle;
  if (t.kind === "terminal") return t.agentName ?? t.title;
  return t.title;
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

/** A `Ctrl+Tab` cycle settles this long after the last press: the landed tab is
 *  then promoted to the front of the MRU list. (No key-up tracking — robust
 *  across focus changes between xterm and the window.) */
const CYCLE_COMMIT_MS = 1500;

/** Options for opening a new terminal tab/region. */
export interface NewTabOptions {
  cwd?: string;
  title?: string;
  shell?: string;
  args?: string[];
  /** One-shot command to type into the shell once it starts (agent launch). */
  runCommand?: string;
  /** Extra environment variables for this tab's PTY (agent env). */
  env?: [string, string][];
  /** Agent launched in this tab (enables idle monitoring + notifications). */
  agentName?: string;
  /** Logo key for the agent (catalog id), for the sidebar row. */
  agentIcon?: string | null;
  /** The launched agent's executable (e.g. `claude`), for orchestration routing. */
  agentCommand?: string;
  groupId?: string;
  /** Workspace to open in (switches the active workspace first). */
  workspace?: string;
}

function newTab(opts?: Omit<NewTabOptions, "groupId" | "workspace">): TerminalTab {
  termCount += 1;
  return {
    kind: "terminal",
    id: crypto.randomUUID(),
    title: opts?.title ?? `Terminal ${termCount}`,
    cwd: opts?.cwd,
    shell: opts?.shell,
    args: opts?.args,
    runCommand: opts?.runCommand,
    env: opts?.env,
    agentName: opts?.agentName,
    agentIcon: opts?.agentIcon,
    agentCommand: opts?.agentCommand,
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

/** Drop **diff** and **commit** tabs from a cloned tree (both transient — never
 *  persisted) and collapse any region/split left empty, so serialization only
 *  ever sees terminal + file tabs in non-empty groups. Returns null when nothing
 *  remains. */
function pruneDiffs(node: AreaNode): AreaNode | null {
  if (node.kind === "group") {
    const tabs = node.tabs.filter((t) => t.kind !== "diff" && t.kind !== "commit");
    if (tabs.length === 0) return null;
    const activeTabId = tabs.some((t) => t.id === node.activeTabId)
      ? node.activeTabId
      : tabs[tabs.length - 1].id;
    return { kind: "group", id: node.id, tabs, activeTabId };
  }
  const a = pruneDiffs(node.a);
  const b = pruneDiffs(node.b);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

/** Serialize one tab to its persisted descriptor. Diff tabs are pruned before
 *  this runs (the diff arm is an unreachable safety net). */
function serializeTab(t: GroupTab): SavedTab {
  if (t.kind === "file") {
    return { kind: "file", title: t.title, path: t.path, worktree: t.worktree ?? undefined };
  }
  if (t.kind === "terminal") {
    return {
      kind: "terminal",
      title: t.title,
      customTitle: t.customTitle,
      cwd: t.cwd,
      shell: t.shell,
      args: t.args,
    };
  }
  return { kind: "terminal", title: t.title };
}

/** Serialize one area tree to a structure-only snapshot (no PTY ids / live
 *  state). Run on a `pruneDiffs`'d tree so no diff tabs or empty groups appear. */
export function serializeArea(node: AreaNode): SavedTermNode {
  if (node.kind === "group") {
    const activeTab = Math.max(
      0,
      node.tabs.findIndex((t) => t.id === node.activeTabId),
    );
    return {
      type: "group",
      tabs: node.tabs.map(serializeTab),
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

/** Rebuild one tab from its saved descriptor, assigning a fresh id. Terminals
 *  spawn a new PTY; file tabs reopen by path (a missing file surfaces an error
 *  in its editor pane). A descriptor with no `kind` is a legacy terminal. */
function buildTab(t: SavedTab): GroupTab {
  if (t.kind === "file") {
    return {
      kind: "file",
      id: crypto.randomUUID(),
      title: t.title,
      path: t.path,
      worktree: t.worktree ?? null,
    };
  }
  termCount += 1;
  return {
    kind: "terminal",
    id: crypto.randomUUID(),
    title: t.title,
    customTitle: t.customTitle,
    cwd: t.cwd,
    shell: t.shell,
    args: t.args,
    exited: false,
  };
}

/** Rebuild an area tree from a saved snapshot, assigning fresh ids. */
function buildFromSaved(saved: SavedTermNode): AreaNode {
  if (saved.type === "group") {
    const tabs: GroupTab[] = saved.tabs.length > 0 ? saved.tabs.map(buildTab) : [newTab()];
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
  /** Per-tab live state for `file` tabs, keyed by tab id (kept out of the
   *  serialized tree so typing never churns the persisted layout). */
  private fileStates = new Map<string, FileEditorState>();
  /** Per-tab live state for `diff` tabs, keyed by tab id. */
  private diffStates = new Map<string, DiffViewerState>();
  /** Per-tab live state for `commit` tabs, keyed by tab id. */
  private commitStates = new Map<string, CommitViewerState>();
  private fsListening = false;

  /** Most-recently-used tab ids, most-recent first (across all workspaces). Plain
   *  (non-reactive) — it only orders the `Ctrl+Tab` quick-switch, never renders. */
  private mru: string[] = [];
  /** Frozen MRU order for an in-progress `Ctrl+Tab` cycle (null = not cycling).
   *  Freezing keeps repeated presses walking a stable list instead of reshuffling
   *  under their own feet; the landed tab is promoted to MRU-front when the cycle
   *  settles (`CYCLE_COMMIT_MS` after the last press). */
  private cycleOrder: string[] | null = null;
  private cycleIndex = 0;
  private cycleTimer: ReturnType<typeof setTimeout> | undefined;

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
    this.registerFileStates();
    void this.startFsListening();
  }

  /** Create the per-tab editor state for every restored `file` tab (the tree
   *  carries only the path; the live content loads lazily). */
  private registerFileStates(): void {
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      for (const tab of allTabs(tree)) {
        if (tab.kind === "file" && !this.fileStates.has(tab.id)) {
          this.fileStates.set(tab.id, new FileEditorState(tab.path, tab.worktree));
        }
      }
    }
  }

  /** Snapshot of every non-empty workspace + the active key (for persistence).
   *  Diff tabs are pruned (transient); empty regions are collapsed. */
  serialize(): SavedTerminalLayout {
    const workspaces: Record<string, SavedTermNode> = {};
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      const pruned = pruneDiffs(tree);
      if (pruned) workspaces[key] = serializeArea(pruned);
    }
    return { active: this.activeWorkspace, workspaces };
  }

  // --- Filesystem external-change wiring ------------------------------------

  /** Subscribe to `fs:changed` (once) so open file/diff tabs react to on-disk
   *  edits: a clean file reloads silently, a dirty one shows a reload-vs-keep
   *  banner, a diff reloads. The file tree handles its own subscription. */
  async startFsListening(): Promise<void> {
    if (this.fsListening) return;
    this.fsListening = true;
    try {
      await listen<FsChangedEvent>("fs:changed", (e) =>
        this.applyExternalChange(e.payload.paths),
      );
    } catch {
      this.fsListening = false; // no Tauri event bus (web preview)
    }
  }

  private applyExternalChange(paths: string[]): void {
    const set = new Set(paths);
    for (const st of this.fileStates.values()) {
      if (set.has(st.path)) st.noteExternalChange();
    }
    for (const st of this.diffStates.values()) {
      const root = st.worktree.replace(/\\/g, "/").replace(/\/+$/, "");
      if (set.has(`${root}/${st.file}`)) st.noteExternalChange();
    }
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
    this.endCycle();
    this.noteActivation(tabId);
  }
  /** PTY id of the active tab of the active region — only when that tab is a
   *  terminal (a file/diff active tab yields null, so file-drop and the agent
   *  "are you viewing it" check behave correctly). */
  activePtyId(): string | null {
    if (!this.root) return null;
    const group = findGroup(this.root, this.activeGroupId) ?? firstGroup(this.root);
    if (!group) return null;
    const tab = group.tabs.find((t) => t.id === group.activeTabId);
    return tab?.kind === "terminal" ? tab.id : null;
  }

  // --- Tabs ----------------------------------------------------------------
  /** The folder a new terminal should open in: an explicit `cwd` wins; otherwise
   *  the target workspace's folder (its worktree path), so a terminal opened in a
   *  project lands in that project rather than the PC home. The Global scratch
   *  space (`""`) has no folder, so it falls back to the backend default (home). */
  private cwdFor(explicit: string | undefined, workspace: string): string | undefined {
    if (explicit) return explicit;
    return workspace && workspace !== GLOBAL_WORKSPACE ? workspace : undefined;
  }

  /** Add a tab to a region (defaults to the active region of the active
   *  workspace). `opts.workspace` switches workspace first; an empty workspace
   *  opens its first region. A terminal with no explicit `cwd` inherits the
   *  target workspace's folder (see [`cwdFor`]). */
  create(opts?: NewTabOptions): string {
    if (opts?.workspace !== undefined) this.setWorkspace(opts.workspace);
    const cwd = this.cwdFor(opts?.cwd, opts?.workspace ?? this.activeWorkspace);
    const tab = newTab({ ...opts, cwd });
    this.insertTab(tab, opts?.groupId);
    return tab.id;
  }

  /** Insert an already-built tab into a region (the target region, the active
   *  region, or — when the workspace is empty — a fresh first region), make it
   *  active, and focus its region. Shared by terminal / file / diff opens. */
  private insertTab(tab: GroupTab, groupId?: string): void {
    if (!this.root) {
      const group: TabGroup = {
        kind: "group",
        id: crypto.randomUUID(),
        tabs: [tab],
        activeTabId: tab.id,
      };
      this.root = group;
      this.activeGroupId = group.id;
      this.noteActivation(tab.id);
      return;
    }
    const group = findGroup(this.root, groupId ?? this.activeGroupId) ?? firstGroup(this.root);
    group.tabs.push(tab);
    group.activeTabId = tab.id;
    this.activeGroupId = group.id;
    this.noteActivation(tab.id);
  }

  /** Open `absPath` as a file-editor tab (or focus it if already open). The file
   *  loads into its own per-tab state; `worktree` drives the git change gutter. */
  openFile(
    absPath: string,
    worktree: string | null,
    opts?: { workspace?: string; groupId?: string },
  ): string {
    const existing = this.findFileTab(absPath);
    if (existing) {
      this.revealTab(existing.workspace, existing.tab.id);
      return existing.tab.id;
    }
    if (opts?.workspace !== undefined) this.setWorkspace(opts.workspace);
    const id = crypto.randomUUID();
    const tab: FileTab = {
      kind: "file",
      id,
      title: absPath.split("/").pop() ?? absPath,
      path: absPath,
      worktree,
    };
    this.fileStates.set(id, new FileEditorState(absPath, worktree));
    this.insertTab(tab, opts?.groupId);
    return id;
  }

  /** Open a diff-viewer tab for `file` in `worktree` (or focus it if already
   *  open). The diff carries its own worktree, independent of the right panel. */
  openDiff(
    worktree: string,
    file: string,
    staged: boolean,
    opts?: { workspace?: string; groupId?: string },
  ): string {
    const existing = this.findDiffTab(worktree, file, staged);
    if (existing) {
      this.revealTab(existing.workspace, existing.tab.id);
      return existing.tab.id;
    }
    if (opts?.workspace !== undefined) this.setWorkspace(opts.workspace);
    const id = crypto.randomUUID();
    const tab: DiffTab = {
      kind: "diff",
      id,
      title: file.split("/").pop() ?? file,
      worktree,
      file,
      staged,
    };
    this.diffStates.set(
      id,
      new DiffViewerState(worktree, file, staged, () => void this.closeTabById(id)),
    );
    this.insertTab(tab, opts?.groupId);
    return id;
  }

  /** Open a read-only commit-viewer tab for `hash` in `worktree` (or focus it if
   *  already open). Carries its own worktree, independent of the right panel. */
  openCommit(
    worktree: string,
    hash: string,
    subject: string,
    opts?: { workspace?: string; groupId?: string; file?: string },
  ): string {
    const file = opts?.file;
    const existing = this.findCommitTab(worktree, hash, file);
    if (existing) {
      this.revealTab(existing.workspace, existing.tab.id);
      return existing.tab.id;
    }
    if (opts?.workspace !== undefined) this.setWorkspace(opts.workspace);
    const id = crypto.randomUUID();
    const tab: CommitTab = {
      kind: "commit",
      id,
      title: file ? (file.split("/").pop() ?? file) : hash.slice(0, 7),
      worktree,
      hash,
      subject,
      file,
    };
    this.commitStates.set(id, new CommitViewerState(worktree, hash, subject, file));
    this.insertTab(tab, opts?.groupId);
    return id;
  }

  /** The live editor state for a file tab (undefined for other kinds). */
  fileState(id: string): FileEditorState | undefined {
    return this.fileStates.get(id);
  }
  /** The live diff state for a diff tab (undefined for other kinds). */
  diffState(id: string): DiffViewerState | undefined {
    return this.diffStates.get(id);
  }
  /** The live commit-viewer state for a commit tab (undefined for other kinds). */
  commitState(id: string): CommitViewerState | undefined {
    return this.commitStates.get(id);
  }
  /** Drop the per-tab registry entry for a tab leaving the tree (no-op for a
   *  terminal). Called from every close path so editor/diff/commit state can't
   *  leak. */
  private disposeTab(id: string): void {
    this.fileStates.delete(id);
    this.diffStates.delete(id);
    this.commitStates.delete(id);
    this.removeFromMru(id);
  }

  private findFileTab(path: string): { tab: FileTab; workspace: string } | undefined {
    for (const { tab, workspace } of this.tabsWithWorkspace()) {
      if (tab.kind === "file" && tab.path === path) return { tab, workspace };
    }
    return undefined;
  }
  private findDiffTab(
    worktree: string,
    file: string,
    staged: boolean,
  ): { tab: DiffTab; workspace: string } | undefined {
    for (const { tab, workspace } of this.tabsWithWorkspace()) {
      if (tab.kind === "diff" && tab.worktree === worktree && tab.file === file && tab.staged === staged)
        return { tab, workspace };
    }
    return undefined;
  }
  private findCommitTab(
    worktree: string,
    hash: string,
    file?: string,
  ): { tab: CommitTab; workspace: string } | undefined {
    for (const { tab, workspace } of this.tabsWithWorkspace()) {
      if (
        tab.kind === "commit" &&
        tab.worktree === worktree &&
        tab.hash === hash &&
        tab.file === file
      )
        return { tab, workspace };
    }
    return undefined;
  }
  /** Whether a file is already open in some tab (for the tree's open-row mark). */
  isFileOpen(path: string): boolean {
    return this.findFileTab(path) !== undefined;
  }
  /** Whether a diff is already open in some tab (for the changes-list mark). */
  isDiffOpen(worktree: string, file: string, staged: boolean): boolean {
    return this.findDiffTab(worktree, file, staged) !== undefined;
  }
  /** Whether a commit (optionally a specific file's slice) is already open in some
   *  tab (for the history-list open mark). */
  isCommitOpen(worktree: string, hash: string, file?: string): boolean {
    return this.findCommitTab(worktree, hash, file) !== undefined;
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
    for (const tab of allTabs(tree)) if (tab.kind === "terminal" && tab.working) return true;
    return false;
  }

  /** The agent terminals open in a workspace (tabs launched as an agent), in
   *  tab order — these get their own clickable rows in the sidebar. */
  agentTabs(key: string): TerminalTab[] {
    const tree = this.workspaces[key];
    if (!tree) return [];
    const out: TerminalTab[] = [];
    for (const tab of allTabs(tree)) {
      if (tab.kind === "terminal" && tab.agentName) out.push(tab);
    }
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

  /** If `tab` is a file tab with unsaved edits, prompt save/discard/cancel and
   *  return whether the close may proceed (false = the user cancelled). "Save"
   *  persists the live document first; a failed save also aborts so edits aren't
   *  lost. Non-file (and clean file) tabs proceed without a prompt. */
  private async confirmDirty(tab: GroupTab): Promise<boolean> {
    if (tab.kind !== "file") return true;
    const st = this.fileStates.get(tab.id);
    if (!st || !st.dirty) return true;
    const choice = await saveDiscard.request({
      title: i18n.t("editor.unsavedTitle"),
      description: i18n.t("editor.unsavedDesc", { file: st.rel || st.name }),
      saveLabel: i18n.t("editor.saveAndClose"),
      discardLabel: i18n.t("editor.discardClose"),
    });
    if (choice === "cancel") return false;
    if (choice === "save") {
      try {
        await st.save(st.content);
      } catch {
        return false; // save failed → keep the tab open so edits survive
      }
    }
    return true;
  }

  /** Close one tab in the active workspace: guard unsaved file edits, kill its
   *  PTY (terminals only), drop its per-tab state; if it was the region's last
   *  tab, collapse the region (or empty the workspace if it was the last). */
  async closeTab(groupId: string, tabId: string): Promise<void> {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (!group) return;
    const tab = group.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (!(await this.confirmDirty(tab))) return;
    if (tab.kind === "terminal") {
      try {
        await invoke("pty_close", { id: tabId });
      } catch {
        // Already gone — idempotent.
      }
    }
    this.disposeTab(tabId);
    group.tabs = group.tabs.filter((t) => t.id !== tabId);
    if (group.tabs.length === 0) {
      this.collapseGroup(groupId);
    } else if (group.activeTabId === tabId) {
      group.activeTabId = group.tabs[group.tabs.length - 1].id;
    }
  }

  /** Close the active tab of the active region (the `closeCenter` shortcut). */
  closeActiveTab(): void {
    if (!this.root) return;
    const group = findGroup(this.root, this.activeGroupId) ?? firstGroup(this.root);
    if (group) void this.closeTab(group.id, group.activeTabId);
  }

  /** Close a tab by id wherever it lives (used by a diff tab closing itself). */
  closeTabById(tabId: string): Promise<void> {
    return this.closeTabAnywhere(tabId);
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
      const tab = group.tabs.find((t) => t.id === tabId);
      if (tab && !(await this.confirmDirty(tab))) return;
      if (tab?.kind === "terminal") {
        try {
          await invoke("pty_close", { id: tabId });
        } catch {
          // Already gone — idempotent.
        }
      }
      this.disposeTab(tabId);
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

  // --- MRU quick-switch + tab move (reorder / cross-region drag) -----------

  /** Promote a tab to the front of the MRU list (most-recently-used). */
  private noteActivation(tabId: string): void {
    const i = this.mru.indexOf(tabId);
    if (i !== -1) this.mru.splice(i, 1);
    this.mru.unshift(tabId);
  }
  /** Forget a tab that's leaving the tree (called from every close path via
   *  `disposeTab`), and drop it from any in-progress cycle. */
  private removeFromMru(tabId: string): void {
    const i = this.mru.indexOf(tabId);
    if (i !== -1) this.mru.splice(i, 1);
    const j = this.cycleOrder?.indexOf(tabId) ?? -1;
    if (j !== -1) this.cycleOrder!.splice(j, 1);
  }
  /** End an in-progress `Ctrl+Tab` cycle (the next activation reseeds it). */
  private endCycle(): void {
    clearTimeout(this.cycleTimer);
    this.cycleTimer = undefined;
    this.cycleOrder = null;
  }

  /** Cycle the active region's tabs in MRU order: `Ctrl+Tab` (forward = toward
   *  less-recently-used), `Ctrl+Shift+Tab` (backward). Repeated presses walk a
   *  frozen order; the landed tab becomes most-recently-used once the cycle
   *  settles (`CYCLE_COMMIT_MS`). No-op for a region with fewer than two tabs. */
  cycleTab(forward: boolean): void {
    if (!this.root) return;
    const group = findGroup(this.root, this.activeGroupId) ?? firstGroup(this.root);
    if (!group || group.tabs.length < 2) return;
    if (!this.cycleOrder) {
      // Freeze the order from MRU, appending any region tabs not yet seen (e.g.
      // freshly restored) in tab order; start the cursor at the active tab.
      const ids = new Set(group.tabs.map((t) => t.id));
      const order = this.mru.filter((id) => ids.has(id));
      for (const t of group.tabs) if (!order.includes(t.id)) order.push(t.id);
      this.cycleOrder = order;
      this.cycleIndex = Math.max(0, order.indexOf(group.activeTabId));
    }
    const n = this.cycleOrder.length;
    if (n < 2) return;
    this.cycleIndex = (this.cycleIndex + (forward ? 1 : -1) + n) % n;
    const target = this.cycleOrder[this.cycleIndex];
    // Activate without reshuffling MRU so the frozen order stays stable.
    group.activeTabId = target;
    this.activeGroupId = group.id;
    this.controller(target)?.focus();
    clearTimeout(this.cycleTimer);
    this.cycleTimer = setTimeout(() => {
      this.cycleOrder = null;
      this.cycleTimer = undefined;
      this.noteActivation(target);
    }, CYCLE_COMMIT_MS);
  }

  /** Move keyboard focus to the next/previous split region of the active
   *  workspace (in visual layout order), focusing that region's active terminal.
   *  No-op when there's one region or none. */
  focusSplit(dir: 1 | -1): void {
    if (!this.root) return;
    const ids = computeAreaLayout(this.root).groups.map((g) => g.group.id);
    if (ids.length < 2) return;
    const cur = Math.max(0, ids.indexOf(this.activeGroupId));
    const next = ids[(cur + dir + ids.length) % ids.length];
    this.activeGroupId = next;
    const group = findGroup(this.root, next);
    const tab = group?.tabs.find((t) => t.id === group.activeTabId);
    if (tab) {
      this.noteActivation(tab.id);
      if (tab.kind === "terminal") this.controller(tab.id)?.focus();
    }
  }

  /** Move a tab to a position in a (possibly different) region — the tab-strip
   *  drag & drop. `toIndex` is the insertion slot in the target region (clamped;
   *  omitted = append). Within a region this just reorders (no remount). Across
   *  regions the tab's component remounts, transparently restoring from the
   *  backend snapshot (terminals) or reopening by path (files); a region left
   *  empty by the move collapses. */
  moveTab(tabId: string, toGroupId: string, toIndex?: number): void {
    if (!this.root) return;
    const fromGroup = groupOfTab(this.root, tabId);
    const toGroup = findGroup(this.root, toGroupId);
    if (!fromGroup || !toGroup) return;
    const from = fromGroup.tabs.findIndex((t) => t.id === tabId);
    if (from === -1) return;
    let insertAt = toIndex ?? toGroup.tabs.length;
    // Removing an earlier slot in the same region shifts later indices left.
    if (fromGroup === toGroup && from < insertAt) insertAt -= 1;
    const [tab] = fromGroup.tabs.splice(from, 1);
    insertAt = Math.max(0, Math.min(insertAt, toGroup.tabs.length));
    toGroup.tabs.splice(insertAt, 0, tab);
    toGroup.activeTabId = tab.id;
    this.activeGroupId = toGroup.id;
    this.noteActivation(tab.id);
    if (fromGroup !== toGroup && fromGroup.tabs.length === 0) {
      // Cross-region move took the region's last tab → drop the empty region.
      this.collapseGroup(fromGroup.id);
    } else if (fromGroup !== toGroup && fromGroup.activeTabId === tabId) {
      fromGroup.activeTabId = fromGroup.tabs[fromGroup.tabs.length - 1].id;
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
    // The new pane inherits the active workspace's folder when no cwd is given,
    // so a split in a project opens in that project (not the PC home).
    const cwd = this.cwdFor(opts?.cwd, this.activeWorkspace);
    const fresh = newGroup({ ...opts, cwd });
    this.root = replaceGroup(this.root, groupId, {
      kind: "split",
      dir,
      ratio: 0.5,
      a: group,
      b: fresh,
    });
    this.activeGroupId = fresh.id;
  }

  /** Close a whole region: guard unsaved file edits (a single aggregated prompt
   *  when several files are dirty), kill every terminal's PTY, drop per-tab
   *  state, and collapse it. */
  async closeGroup(groupId: string): Promise<void> {
    if (!this.root) return;
    const group = findGroup(this.root, groupId);
    if (!group) return;
    const dirty = group.tabs.filter(
      (t) => t.kind === "file" && this.fileStates.get(t.id)?.dirty,
    );
    if (dirty.length > 0) {
      const choice = await saveDiscard.request({
        title: i18n.t("editor.unsavedTitle"),
        description: i18n.t("editor.unsavedManyDesc", { n: dirty.length }),
        saveLabel: i18n.t("editor.saveAllClose"),
        discardLabel: i18n.t("editor.discardAllClose"),
      });
      if (choice === "cancel") return;
      if (choice === "save") {
        for (const t of dirty) {
          const st = this.fileStates.get(t.id);
          if (!st) continue;
          try {
            await st.save(st.content);
          } catch {
            return; // a save failed → abort the close so edits survive
          }
        }
      }
    }
    for (const tab of group.tabs) {
      if (tab.kind === "terminal") invoke("pty_close", { id: tab.id }).catch(() => {});
      this.disposeTab(tab.id);
    }
    this.collapseGroup(groupId);
  }

  /** Rename a terminal/diff/commit tab to a free-form label (an empty value
   *  clears it back to the derived title). File tabs rename the file on disk
   *  instead — see `renameFileTab`. */
  renameTab(tabId: string, title: string): void {
    const trimmed = title.trim();
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      const tab = groupOfTab(tree, tabId)?.tabs.find((x) => x.id === tabId);
      if (tab) {
        tab.customTitle = trimmed || undefined;
        return;
      }
    }
  }

  /** Rename a file tab's underlying file on disk (kept in the same folder) and
   *  re-point the open editor at the new path — the bytes and any unsaved edits
   *  are preserved. Throws (with the backend message) on failure so the caller
   *  can surface it. Returns the new absolute path. */
  async renameFileTab(tabId: string, newName: string): Promise<string> {
    let target: FileTab | undefined;
    for (const key of Object.keys(this.workspaces)) {
      const tree = this.workspaces[key];
      if (!tree) continue;
      const tab = groupOfTab(tree, tabId)?.tabs.find((x) => x.id === tabId);
      if (tab?.kind === "file") {
        target = tab;
        break;
      }
    }
    if (!target) throw new Error("file tab not found");
    const newPath = await fsRename(target.path, newName);
    await this.fileStates.get(tabId)?.repoint(newPath);
    target.path = newPath;
    target.title = newPath.split("/").pop() ?? newPath;
    return newPath;
  }

  /** Close every tab in the active workspace (the "Close all tabs" tab action):
   *  one aggregated save/discard prompt for any unsaved files, then kill all the
   *  PTYs, drop per-tab state and empty the workspace. A no-op when nothing is
   *  open. */
  async closeAllTabs(): Promise<void> {
    const tree = this.root;
    if (!tree) return;
    const tabs = [...allTabs(tree)];
    const dirty = tabs.filter(
      (t) => t.kind === "file" && this.fileStates.get(t.id)?.dirty,
    );
    if (dirty.length > 0) {
      const choice = await saveDiscard.request({
        title: i18n.t("editor.unsavedTitle"),
        description: i18n.t("editor.unsavedManyDesc", { n: dirty.length }),
        saveLabel: i18n.t("editor.saveAllClose"),
        discardLabel: i18n.t("editor.discardAllClose"),
      });
      if (choice === "cancel") return;
      if (choice === "save") {
        for (const t of dirty) {
          const st = this.fileStates.get(t.id);
          if (!st) continue;
          try {
            await st.save(st.content);
          } catch {
            return; // a save failed → abort so edits survive
          }
        }
      }
    }
    for (const tab of tabs) {
      if (tab.kind === "terminal") invoke("pty_close", { id: tab.id }).catch(() => {});
      this.disposeTab(tab.id);
    }
    // Empty the active workspace's region tree (shows the empty-state canvas).
    this.root = null;
    this.activeGroupId = "";
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
        if (tab.kind === "terminal") invoke("pty_close", { id: tab.id }).catch(() => {});
        this.disposeTab(tab.id);
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
