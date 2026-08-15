import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import ChangesPanel from "./ChangesPanel.svelte";
import { git } from "$lib/state/git.svelte";
import { sessions } from "$lib/state/sessions.svelte";

// The file rows live inside a virtualizer, which measures nothing in jsdom, so
// what this file checks is everything around them: that the pane mounts at all
// for a worktree on a host (it used to be replaced by a notice), and that the
// controls reflect what may actually be sent to that machine. The data itself is
// covered by `state/git.svelte.test.ts`.

const REMOTE_REVIEW = {
  files: [{ path: "src/main.rs", index: "M", worktree: " " }],
  numstat: [{ path: "src/main.rs", added: 4, deleted: 1 }],
  dirty: 1,
  ahead: 0,
  behind: 0,
  head: "abc1234",
  isRepo: true,
};

const COMMANDS = {
  git_set_watch: () => null,
  ssh_git_review: () => REMOTE_REVIEW,
  ssh_git_stage: () => null,
};

beforeEach(async () => {
  sessions.replace([{ hostId: "h1", generation: 1, label: "gamas" }]);
  await git.load(null);
  git.message = "";
  git.amend = false;
});

describe("Changes on a host", () => {
  it("mounts the real pane where the notice used to be", async () => {
    const { screen } = mountWithProviders(ChangesPanel, { commands: COMMANDS });
    await git.load("C:/Users/gamas/app", "ssh:h1");
    await until(() => git.files.length > 0);

    // The composer is the proof: it only exists once a worktree is selected, and
    // the whole pane used to be swapped for "this project lives on {host}".
    expect(screen.container.querySelector("textarea")).toBeTruthy();
    expect(screen.queryByText(/lives on|vive en/i)).toBeNull();
  });

  it("leaves out the AI draft button, which reads this machine's git", async () => {
    const { screen } = mountWithProviders(ChangesPanel, { commands: COMMANDS });
    await git.load("C:/Users/gamas/app", "ssh:h1");
    await until(() => git.files.length > 0);

    // It drafts from the staged diff through local git, so on a host it is not
    // offered at all rather than offered and failing.
    expect(screen.queryByText(/^(Generate|Generar|Redactar)/i)).toBeNull();
  });

  it("refuses to commit to a host that dropped, without blanking the review", async () => {
    const { screen } = mountWithProviders(ChangesPanel, { commands: COMMANDS });
    await git.load("C:/Users/gamas/app", "ssh:h1");
    await until(() => git.files.length > 0);

    // Amend + a message is the state where the button is enabled with nothing
    // staged, so what changes below is only the connection.
    git.amend = true;
    git.message = "a message";
    const commit = await screen.findByRole("button", { name: /commit|enmendar|amend/i });
    await until(() => !(commit as HTMLButtonElement).disabled);

    sessions.replace([]);
    await until(() => (commit as HTMLButtonElement).disabled);

    // What was read stays: it was true of the moment it was read, and blanking
    // it would lose the user's place for a connection that may come right back.
    expect(git.files.length).toBe(1);
  });
});
