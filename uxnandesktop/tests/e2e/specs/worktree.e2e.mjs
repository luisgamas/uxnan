/**
 * The git surface, against a real repository.
 *
 * The Rust tests already drive git against throwaway repos. What only this layer
 * shows is that the *app* reaches them: that a registered folder is recognised
 * as a repo, its worktrees are listed, and the changed files the fixture
 * deliberately dirtied come back through the command layer the UI uses.
 */

import { strict as assert } from "node:assert";
import { appState, invoke } from "../helpers.mjs";

describe("a git project", () => {
  let repo;

  before(async () => {
    const state = await appState();
    repo = state.repos[0];
  });

  it("is recognised as a repository, not a plain folder", () => {
    assert.equal(repo.name, "git-fixture");
    assert.notEqual(repo.isGit, false, "a real git checkout was registered as a plain folder");
  });

  it("lists its worktrees through the same command the sidebar uses", async () => {
    const worktrees = await invoke("worktree_list", { repoId: repo.id });
    assert.ok(worktrees.length >= 1, "no worktree came back for a real repository");
    assert.ok(
      worktrees.some((w) => w.isMain),
      "the main checkout is missing from the worktree list",
    );
  });

  it("reports the files the fixture dirtied", async () => {
    // The fixture modifies tracked files on purpose; an empty status here would
    // mean the app is looking at the wrong directory.
    const changes = await invoke("git_status", { path: repo.path });
    assert.ok(changes.length > 0, "git status came back clean on a deliberately dirty fixture");
  });
});
