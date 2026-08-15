import { beforeEach, describe, expect, it } from "vitest";

import { installFakeBackend, type FakeBackend } from "../../test/tauri";
import { git } from "./git.svelte";
import { sessions } from "./sessions.svelte";

const LOCAL_CHANGE = { path: "local.rs", index: " ", worktree: "M" };
const REMOTE_CHANGE = { path: "remote.rs", index: "M", worktree: " " };

let backend: FakeBackend;

beforeEach(async () => {
  backend = installFakeBackend({
    git_set_watch: () => null,
    git_status: () => [LOCAL_CHANGE],
    git_numstat: () => [],
    worktree_status: () => ({ dirty: 1, ahead: 0, behind: 0 }),
    ssh_git_review: () => ({
      files: [REMOTE_CHANGE],
      numstat: [{ path: "remote.rs", added: 2, deleted: 0 }],
      dirty: 1,
      ahead: 1,
      behind: 0,
      head: "abc1234",
      isRepo: true,
    }),
    ssh_git_stage: () => null,
  });
  sessions.replace([{ hostId: "h1", generation: 3, label: "gamas" }]);
  await git.load(null);
});

describe("the git panel on a host", () => {
  it("reads that machine, and never asks this one about its path", async () => {
    await git.load("C:/Users/gamas/app", "ssh:h1");

    expect(backend.lastCallTo("ssh_git_review")?.args).toEqual({
      hostId: "h1",
      path: "C:/Users/gamas/app",
    });
    expect(backend.lastCallTo("git_status")).toBeUndefined();
    expect(git.files.map((f) => f.path)).toEqual(["remote.rs"]);
    expect(git.numstat["remote.rs"]).toEqual({ added: 2, deleted: 0 });
    expect(git.ahead).toBe(1);
    expect(git.remote).toBe(true);
  });

  it("stops this machine's watcher instead of pointing it at a remote path", async () => {
    // The watcher polls local git. Handed a host's path it would either fail
    // every three seconds or, worse, describe a folder of the same name here.
    await git.load("C:/Users/gamas/app", "ssh:h1");
    expect(backend.lastCallTo("git_set_watch")?.args).toEqual({ path: null });

    await git.load("/home/dev/app", "local");
    expect(backend.lastCallTo("git_set_watch")?.args).toEqual({ path: "/home/dev/app" });
  });

  it("ignores a local watcher snapshot for the same path", async () => {
    // The same absolute path exists on both machines often enough that this is
    // not hypothetical: without the target check, this machine's file list
    // would overwrite the host's review.
    await git.startListening();
    await git.load("C:/shared/app", "ssh:h1");
    expect(git.files.map((f) => f.path)).toEqual(["remote.rs"]);

    backend.emit("git:status-changed", {
      path: "C:/shared/app",
      files: [LOCAL_CHANGE],
      ahead: 9,
      behind: 9,
      head: "local",
    });

    expect(git.files.map((f) => f.path)).toEqual(["remote.rs"]);
    expect(git.ahead).toBe(1);
  });

  it("acts against the connection the user was looking at", async () => {
    await git.load("C:/Users/gamas/app", "ssh:h1");
    await git.stage("remote.rs");

    expect(backend.lastCallTo("ssh_git_stage")?.args).toMatchObject({
      hostId: "h1",
      file: "remote.rs",
      expect: { targetId: "ssh:h1", generation: 3 },
    });
  });

  it("can still show a host that dropped, but not act on it", async () => {
    await git.load("C:/Users/gamas/app", "ssh:h1");
    expect(git.actionable).toBe(true);

    sessions.replace([]);

    // The review stays on screen — it was true when it was read, and blanking it
    // would lose the user's place for a connection that may come straight back.
    expect(git.files.map((f) => f.path)).toEqual(["remote.rs"]);
    expect(git.actionable).toBe(false);

    backend.clearCalls();
    await git.stage("remote.rs");
    expect(backend.lastCallTo("ssh_git_stage")).toBeUndefined();
  });

  it("waits quietly for a host that has not connected yet", async () => {
    // The ordinary state between starting the app and the host coming up. A red
    // error line (or a toast) for something the app resolves by itself is noise
    // the user cannot act on — the file tree learned this first.
    backend.setCommands({
      ssh_git_review: () => {
        throw { code: "NOT_CONNECTED", message: "h1 is not connected" };
      },
    });
    await git.load("C:/Users/gamas/app", "ssh:h1");

    expect(git.awaitingHost).toBe(true);
    expect(git.error).toBeNull();
    expect(git.files).toEqual([]);
  });

  it("never waits for a host over a local worktree", async () => {
    // What the user reported: "waiting for this host to connect" on a local
    // project. The cause was upstream (the panel took the machine from the
    // focused terminal workspace and the path from the selected project), but
    // the message is also ruled out here — a local review has no host to wait
    // for, whatever the failure claims.
    backend.setCommands({
      git_status: () => {
        throw { code: "NOT_CONNECTED", message: "h1 is not connected" };
      },
    });
    await git.load("/home/dev/app", "local");

    expect(git.awaitingHost).toBe(false);
    expect(git.error).not.toBeNull();
  });

  it("says so when the host could not read the folder as a repository", async () => {
    backend.setCommands({
      ssh_git_review: () => ({
        files: [],
        numstat: [],
        dirty: 0,
        ahead: 0,
        behind: 0,
        head: null,
        isRepo: false,
      }),
    });
    await git.load("C:/Users/gamas/plain", "ssh:h1");

    // Not a repository, no git installed, or a shell that could not be named —
    // none of which is "no changes".
    expect(git.files).toEqual([]);
    expect(git.error).not.toBeNull();
  });
});
