/**
 * Disposable application profiles.
 *
 * Every test that runs the real app needs a `<app-data>` of its own — both so
 * the test starts from a known state and so it can never write into the profile
 * the developer is actually using. `UXNAN_DATA_DIR` (see
 * `src-tauri/src/datadir.rs`) is what makes that possible; this module is the
 * ergonomic front for it.
 *
 * It also builds the *old* profiles the migration path has to cope with. A
 * migration is only tested if something has actually persisted the previous
 * shape, and hand-writing that JSON inside each test is how the shapes quietly
 * drift into being fictional. They live here, versioned and named.
 *
 * The seeding vocabulary is shared with the resource benchmarks
 * (`scripts/resources/lib/profile.mjs`) rather than duplicated — see
 * `shared.mjs`.
 */

import fs from "node:fs";
import path from "node:path";

import { layout, settings, terminalGrid, terminalTab, writeProfile } from "./shared.mjs";

export { layout, settings, terminalGrid, terminalTab };

/**
 * A profile directory ready to hand to the app.
 *
 * `root` must already be a temp directory the caller owns; this only ever writes
 * beneath it.
 */
export function makeProfile(root, options = {}) {
  const dir = path.join(root, "data");
  writeProfile(dir, options);
  return { dir, env: { UXNAN_DATA_DIR: dir } };
}

/**
 * Profiles written the way an older build wrote them, for the migration tests.
 *
 * Keyed by what makes them old, not by a version number alone, so a reader can
 * tell at a glance what each one exercises.
 */
export const LEGACY_PROFILES = {
  /** Before `isGit` existed: every registered folder was assumed to be a repo. */
  "repo-without-isGit": {
    version: 1,
    repos: [
      {
        id: "legacy-1",
        name: "legacy",
        path: "C:/tmp/legacy",
        worktrees: [],
      },
    ],
    settings: { theme: "system", leftSidebarWidth: 280, rightSidebarWidth: 350, leftSidebarOpen: true, rightSidebarOpen: true },
  },

  /** Before terminal profiles were seeded by the backend. */
  "settings-without-terminal-profiles": {
    version: 1,
    repos: [],
    settings: {
      theme: "dark",
      leftSidebarWidth: 300,
      rightSidebarWidth: 320,
      leftSidebarOpen: false,
      rightSidebarOpen: true,
    },
  },

  /** A layout saved before tabs carried a `kind`, when every tab was a terminal. */
  "tabs-without-kind": {
    version: 1,
    repos: [],
    settings: { theme: "system", leftSidebarWidth: 280, rightSidebarWidth: 350, leftSidebarOpen: true, rightSidebarOpen: true },
    terminalLayout: {
      active: "",
      workspaces: {
        "": { type: "group", tabs: [{ title: "shell", cwd: "C:/tmp" }], activeTab: 0 },
      },
    },
  },

  /** Not JSON at all — a write interrupted by a power cut or a killed process. */
  truncated: "{\n  \"version\": 1,\n  \"repos\": [",
};

/**
 * Write one of [`LEGACY_PROFILES`] into a fresh profile directory.
 *
 * The app must come up on all of these. What "come up" means differs per case —
 * migrating, defaulting, or falling back to a backup — and each test says which
 * it expects; what none of them may do is fail to start.
 */
export function makeLegacyProfile(root, name) {
  const document = LEGACY_PROFILES[name];
  if (document === undefined) {
    throw new Error(`unknown legacy profile "${name}"; known: ${Object.keys(LEGACY_PROFILES).join(", ")}`);
  }
  const dir = path.join(root, "data");
  fs.mkdirSync(dir, { recursive: true });
  const body = typeof document === "string" ? document : JSON.stringify(document, null, 2);
  fs.writeFileSync(path.join(dir, "state.json"), body, "utf8");
  return { dir, env: { UXNAN_DATA_DIR: dir } };
}

/** The state document a profile currently holds, or `null` if unreadable. */
export function readProfile(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
  } catch {
    return null;
  }
}
