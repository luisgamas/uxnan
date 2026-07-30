/**
 * Disposable app-data profiles: how a scenario becomes reproducible.
 *
 * A benchmark that starts from whatever the developer's real profile happens to
 * contain measures the developer, not the app. So every scenario is handed a
 * freshly-built `state.json` in a throwaway directory and the app is launched
 * with `UXNAN_DATA_DIR` pointing at it (see `src-tauri/src/datadir.rs`). Two
 * consequences, both intended:
 *
 * - the same scenario measures the same thing on any machine, and
 * - the harness never reads or writes the real profile, so nothing it does can
 *   cost the operator their session.
 *
 * The seeded document is the app's own persisted shape (`AppData` in
 * `src-tauri/src/model.rs`, `SavedTerminalLayout` in `src/lib/types.ts`). Only
 * the fields those types require are written; everything else is left to the
 * app's defaults, which is what keeps this file from drifting every time a
 * setting is added.
 */

import fs from "node:fs";
import path from "node:path";

/** Mirrors `SCHEMA_VERSION` in `src-tauri/src/model.rs`. */
export const STATE_SCHEMA_VERSION = 1;

/** The workspace key the app uses for terminals not bound to a worktree. */
export const GLOBAL_WORKSPACE = "";

/** A cheap, always-present shell, so the *shell* is not what varies between
 *  platforms in a terminal scenario. */
export function defaultShell() {
  if (process.platform === "win32") {
    return { shell: process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe", args: [] };
  }
  return { shell: "/bin/sh", args: [] };
}

/**
 * A terminal that starts a shell and runs `command` inside it, the way the app
 * itself launches an agent: the user's terminal profile is the shell, and the
 * CLI is what runs *in* it.
 *
 * That nesting is not cosmetic — it is what makes the cost attributable. The
 * benchmark calls anything under a shell `external`, so a program launched *as*
 * the shell would be counted as uxnan's own doing (see `tree.mjs`). Running the
 * fixture agent the realistic way is therefore also the only way the scenario
 * can separate the agent's cost from the app's.
 *
 * The shell stays alive after the command exits (`/k`, `exec sh`), so the tab
 * still holds a terminal for the rest of the measurement window.
 */
export function shellRunning(argv) {
  if (process.platform === "win32") {
    return {
      shell: process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe",
      args: ["/k", ...argv],
    };
  }
  const quoted = argv.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  return { shell: "/bin/sh", args: ["-c", `${quoted}; exec /bin/sh`] };
}

/** The five settings the Rust `AppSettings` requires, plus any overrides. */
export function settings(overrides = {}) {
  return {
    theme: "system",
    leftSidebarWidth: 280,
    rightSidebarWidth: 350,
    leftSidebarOpen: true,
    rightSidebarOpen: true,
    // Off by default in every scenario that isn't explicitly measuring them, so
    // "the app at rest" means the app, not the app plus an updater check and a
    // provider poll over the network.
    updater: { autoCheck: false, channel: "stable", autoDownload: false, installPolicy: "ask" },
    usageProviders: [],
    usageStatusBarEnabled: false,
    pets: { enabled: false },
    // Installing hook configs would write into the operator's real `~/.claude`
    // and friends — outside the scenario's temp dir, which the harness never
    // does.
    autoInstallHooks: false,
    agentNotifications: false,
    ...overrides,
  };
}

/** One terminal tab descriptor (`SavedTab`, kind `terminal`). */
export function terminalTab({ title = "shell", cwd, asleep = false, shell, args, sid } = {}) {
  const d = defaultShell();
  return {
    kind: "terminal",
    title,
    ...(cwd ? { cwd } : {}),
    shell: shell ?? d.shell,
    args: args ?? d.args,
    ...(sid ? { sid } : {}),
    ...(asleep ? { asleep: true } : {}),
  };
}

/** A region holding one or more tabs (only the active one hosts a live PTY). */
export function group(tabs, activeTab = 0) {
  return { type: "group", tabs, activeTab };
}

/** A split of two regions. Every region in the tree hosts its own live PTY,
 *  which is why "four terminals" is four regions and not four tabs. */
export function split(dir, a, b, ratio = 0.5) {
  return { type: "split", dir, ratio, a, b };
}

/**
 * Build a balanced tree of `count` single-tab regions — the shape "N terminals"
 * means in the app: alternating row/column splits, so four regions form a 2×2
 * grid rather than four thin columns.
 */
export function terminalGrid(count, tabFactory, dir = "row") {
  if (count <= 1) return group([tabFactory(0)]);
  const half = Math.ceil(count / 2);
  const next = dir === "row" ? "col" : "row";
  const left = terminalGrid(half, tabFactory, next);
  const right = terminalGrid(count - half, (i) => tabFactory(half + i), next);
  return split(dir, left, right);
}

/** A project entry (`RepoData`), plus the single worktree the app shows for a
 *  plain checkout. */
export function project({ id, name, dir, isGit = true }) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    name,
    path: dir,
    isGit,
    worktrees: [
      {
        id: `${id}-main`,
        repoId: id,
        name,
        branch: "main",
        path: dir,
        createdByAde: false,
        createdAt: now,
        lastActivity: now,
      },
    ],
  };
}

/**
 * Write a profile directory and return its path.
 *
 * `dir` must already be inside the run's temp root — this function creates it
 * but never removes anything, so a mistyped path can't delete a real profile.
 */
export function writeProfile(dir, { repos = [], settingsOverrides = {}, layout = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const state = {
    version: STATE_SCHEMA_VERSION,
    repos,
    settings: settings(settingsOverrides),
    agentCache: [],
    terminalLayout: layout,
    quickCommands: [],
    orchestrationRuns: null,
  };
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
  return dir;
}

/** A layout document: which workspace is active, and each workspace's tree. */
export function layout(active, workspaces) {
  return { active, workspaces };
}

/**
 * How many live shells a layout should produce at boot.
 *
 * Only the **active** workspace mounts at boot, and within a region only the
 * **active tab** hosts a PTY — so this is one per region whose active tab is an
 * awake terminal. The harness asserts against this number, which is what turns
 * "the session silently failed to restore" from an unexplained small memory
 * figure into a failed run.
 */
export function liveTerminalCount(doc) {
  const tree = doc?.workspaces?.[doc.active];
  if (!tree) return 0;
  const walk = (node) => {
    if (!node) return 0;
    if (node.type === "group") {
      const tab = node.tabs?.[node.activeTab ?? 0];
      if (!tab) return 0;
      const isTerminal = tab.kind === undefined || tab.kind === "terminal";
      return isTerminal && !tab.asleep ? 1 : 0;
    }
    return walk(node.a) + walk(node.b);
  };
  return walk(tree);
}
