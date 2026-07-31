/**
 * The state each journey starts from.
 *
 * Driving the UI to *set up* a journey is how E2E suites become slow and
 * brittle: twenty clicks to reach the thing you actually wanted to assert, any
 * one of which can break for an unrelated reason. So setup is done by seeding
 * the app's own persisted profile — the same technique the resource benchmarks
 * use — and the journey then asserts through the real UI, over real IPC, against
 * a real backend.
 *
 * A spec's profile is written *before* its session starts (`beforeSession` in
 * `wdio.conf.mjs`), keyed by the spec's file name, so every journey gets a fresh
 * app in a known state.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { makeRepo } from "../fixtures/shared.mjs";
import {
  group,
  layout,
  project,
  settings,
  shellRunning,
  split,
  terminalTab,
  writeProfile,
} from "../fixtures/shared.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(HERE, ".fixtures");
const RESOURCE_FIXTURES = path.resolve(HERE, "..", "..", "scripts", "resources", "fixtures");

/** Where the github-fake journey writes the fake gh's canned answers. The
 *  driver env points `UXNAN_FIXTURE_GH_RESPONSES` here (a fixed path: env is
 *  set at driver spawn, before any journey has run). */
export const FAKE_GH_RESPONSES = path.join(FIXTURE_ROOT, "github-fake-responses.json");

/** Give a fixture repo a github.com origin (idempotent). */
function ensureGithubOrigin(dir) {
  const url = "https://github.com/fixture-org/fixture-repo.git";
  const probe = spawnSync("git", ["-C", dir, "remote", "get-url", "origin"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (probe.status === 0) {
    spawnSync("git", ["-C", dir, "remote", "set-url", "origin", url], { windowsHide: true });
  } else {
    spawnSync("git", ["-C", dir, "remote", "add", "origin", url], { windowsHide: true });
  }
}

/** A small deterministic git repository, generated once and reused. */
function repo() {
  return makeRepo({ dir: path.join(FIXTURE_ROOT, "repo"), files: 12, dirs: 3, lines: 6 });
}

/** A shell that stays open and prints something we can look for. */
function shellTab(cwd, title, extra = {}) {
  return terminalTab({ title, cwd, sid: `e2e-${title.replace(/\W+/g, "-")}`, ...extra });
}

/**
 * Journeys, keyed by spec base name. Each returns the arguments `writeProfile`
 * takes, plus anything the spec needs to know about what was seeded.
 */
export const JOURNEYS = {
  /** Nothing at all: the app must come up on an empty profile. */
  launch: () => ({ profile: {}, facts: {} }),

  /** A project and a live terminal, saved as a previous session would leave it. */
  restore: () => {
    const r = repo();
    return {
      profile: {
        repos: [project({ id: "e2e-repo", name: "fixture-repo", dir: r.dir })],
        layout: layout(r.dir, { [r.dir]: group([shellTab(r.dir, "shell 1")]) }),
      },
      facts: { repoDir: r.dir, projectName: "fixture-repo" },
    };
  },

  /** Two terminals in a split, to assert both come back and both are live. */
  terminal: () => {
    const r = repo();
    return {
      profile: {
        repos: [project({ id: "e2e-repo", name: "fixture-repo", dir: r.dir })],
        layout: layout(r.dir, {
          [r.dir]: split("row", group([shellTab(r.dir, "left")]), group([shellTab(r.dir, "right")])),
        }),
      },
      facts: { repoDir: r.dir, projectName: "fixture-repo" },
    };
  },

  /** The same two terminals, but asleep: the PTYs must not exist until woken. */
  "sleep-wake": () => {
    const r = repo();
    return {
      profile: {
        repos: [project({ id: "e2e-repo", name: "fixture-repo", dir: r.dir })],
        layout: layout(r.dir, {
          [r.dir]: split(
            "row",
            group([shellTab(r.dir, "left", { asleep: true })]),
            group([shellTab(r.dir, "right", { asleep: true })]),
          ),
        }),
      },
      facts: { repoDir: r.dir, projectName: "fixture-repo" },
    };
  },

  /** A real git repository as a project, for the git surface. */
  worktree: () => {
    const r = makeRepo({ dir: path.join(FIXTURE_ROOT, "repo-dirty"), files: 12, dirs: 3, lines: 6, dirty: 3 });
    return {
      profile: {
        repos: [project({ id: "e2e-git", name: "git-fixture", dir: r.dir })],
        layout: layout(r.dir, { [r.dir]: group([]) }),
      },
      facts: { repoDir: r.dir, projectName: "git-fixture" },
    };
  },

  /** The offline stand-in agent, launched inside a shell as the app does. */
  agent: () => {
    const r = repo();
    const tab = terminalTab({
      title: "fixture agent",
      cwd: r.dir,
      sid: "e2e-agent",
      ...shellRunning([
        "node",
        path.join(RESOURCE_FIXTURES, "agent-fixture.mjs"),
        "--rate",
        "8",
        "--work",
        "600",
        "--hooks",
      ]),
    });
    return {
      profile: {
        repos: [project({ id: "e2e-repo", name: "fixture-repo", dir: r.dir })],
        layout: layout(r.dir, { [r.dir]: group([tab]) }),
      },
      facts: { repoDir: r.dir, projectName: "fixture-repo" },
    };
  },

  /** A saved orchestration run, so the console has something to show. */
  orchestration: () => {
    const r = repo();
    return {
      profile: {
        repos: [project({ id: "e2e-repo", name: "fixture-repo", dir: r.dir })],
        layout: layout(r.dir, { [r.dir]: group([shellTab(r.dir, "shell 1")]) }),
      },
      facts: { repoDir: r.dir, projectName: "fixture-repo" },
    };
  },

  /** Nothing special; the spec opens the browser itself. */
  browser: () => ({ profile: {}, facts: {} }),

  /**
   * OPT-IN GitHub journey: a git project whose `origin` points at github.com,
   * with every `gh` call answered by the fake (the driver's PATH is re-routed
   * by `wdio.conf.mjs` when `UXNAN_E2E_FAKE_GH=1`; the spec self-skips
   * otherwise). The canned answers are the **captured real payloads** from
   * `tests/fixtures/github/`, so what the app parses end to end here is what
   * GitHub actually sent once — no network, no account, and the remote is
   * never contacted (gh is the only thing that would, and gh is the fake).
   */
  "github-fake": () => {
    const r = repo();
    // A GitHub-shaped origin so the repo-context probe engages. Never fetched:
    // only `gh` would reach it, and `gh` is the fixture.
    ensureGithubOrigin(r.dir);
    const prList = JSON.parse(
      fs.readFileSync(path.join(HERE, "..", "fixtures", "github", "pr-list.json"), "utf8"),
    ).payload;
    const rateLimit = JSON.parse(
      fs.readFileSync(path.join(HERE, "..", "fixtures", "github", "rate-limit.json"), "utf8"),
    ).payload;
    fs.mkdirSync(path.dirname(FAKE_GH_RESPONSES), { recursive: true });
    fs.writeFileSync(
      FAKE_GH_RESPONSES,
      JSON.stringify({ "pr list": prList, "api rate_limit": rateLimit, "issue list": [] }),
      "utf8",
    );
    return {
      profile: {
        repos: [project({ id: "e2e-gh-repo", name: "fixture-repo", dir: r.dir })],
      },
      facts: {
        repoDir: r.dir,
        login: "fixture-user",
        firstPr: { number: prList[0].number, title: prList[0].title },
        prCount: prList.length,
        rateLimit: rateLimit.resources.core.limit,
      },
    };
  },

  /**
   * A profile written the way an older build wrote it. The app has to migrate
   * it and come up, rather than refusing to start or losing the projects.
   */
  migration: () => {
    const r = repo();
    return {
      raw: {
        version: 1,
        // No `isGit`, no terminal profiles, a tab with no `kind` — all three
        // shapes an older build persisted.
        repos: [{ id: "legacy", name: "legacy-project", path: r.dir, worktrees: [] }],
        settings: {
          theme: "dark",
          leftSidebarWidth: 300,
          rightSidebarWidth: 320,
          leftSidebarOpen: true,
          rightSidebarOpen: true,
        },
        terminalLayout: {
          active: "",
          workspaces: { "": { type: "group", tabs: [{ title: "shell", cwd: r.dir }], activeTab: 0 } },
        },
      },
      facts: { repoDir: r.dir, projectName: "legacy-project" },
    };
  },
};

/** Write the profile a spec needs, and return what it seeded. */
export function seedFor(specPath, dataDir) {
  const name = path.basename(String(specPath)).replace(/\.e2e\.mjs$/, "");
  const journey = JOURNEYS[name];
  if (!journey) {
    // An unknown spec gets an empty profile rather than a stale one from
    // whichever journey ran last.
    writeProfile(dataDir, {});
    return { facts: {}, name };
  }
  const { profile, raw, facts } = journey();
  if (raw) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "state.json"), JSON.stringify(raw, null, 2), "utf8");
  } else {
    writeProfile(dataDir, { ...profile, settingsOverrides: profile.settingsOverrides });
  }
  fs.writeFileSync(path.join(dataDir, "_facts.json"), JSON.stringify(facts, null, 2), "utf8");
  return { facts, name };
}

/** What the currently-running spec was seeded with. */
export function factsFor(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "_facts.json"), "utf8"));
  } catch {
    return {};
  }
}

export { settings };
