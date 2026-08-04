/**
 * The right-panel GitHub tab, tested for the one thing a *background* refresh
 * must never do: take something away from the user.
 *
 * The bug this locks down was reported from real use — open "Create PR", write a
 * description, pause to re-read it, and the panel blinks back to a spinner with
 * everything typed gone. It had nothing to do with PRs: the panel gated its whole
 * body on `github.contextLoading`, a flag the 45-second poll raises on every tick,
 * so each tick unmounted the body and re-created it empty. A refresh may add
 * information; it may not destroy what is on screen.
 *
 * These mount the real component against the fake backend and drive the store the
 * way the poll does, so they fail against the old markup rather than against a
 * paraphrase of it.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { github } from "$lib/state/github.svelte";
import { projects } from "$lib/state/projects.svelte";
import type { RepoContext } from "$lib/types";
import GithubPanel from "./GithubPanel.svelte";

const WORKTREE = "C:/repos/uxnan";

const CONTEXT: RepoContext = {
  nameWithOwner: "luisgamas/uxnan",
  host: "github.com",
  owner: "luisgamas",
  repo: "uxnan",
  branch: "feat/thing",
  pr: null,
};

/** The commands the digest reaches for once it has a context. */
const commands = {
  github_run_list: () => [],
  github_pr_list: () => [],
  github_issue_list: () => [],
  github_branches: () => ({
    local: ["main", "feat/thing"],
    remote: ["main"],
    defaultBase: "main",
    current: "feat/thing",
  }),
};

/** Stand the app in `path`, the way selecting a worktree does. Deliberately does
 *  NOT touch the parked drafts — walking between worktrees keeping each one's
 *  half-written PR is the behaviour under test. */
function signedInOn(path: string, context: RepoContext | null = CONTEXT) {
  github.status = {
    ghInstalled: true,
    authenticated: true,
    login: "luisgamas",
    host: "github.com",
    scopes: ["repo"],
    message: null,
  };
  github.statusChecked = true;
  github.context = context;
  github.contextPath = path;
  github.contextLoading = false;
  projects.activeWorktreePath = path;
}

beforeEach(() => {
  github.contextByPath = {};
  github.prDrafts = {};
  signedInOn(WORKTREE);
});

describe("GithubPanel — a background refresh preserves what is on screen", () => {
  it("keeps the repo digest rendered while a poll re-reads the context", async () => {
    const { screen } = mountWithProviders(GithubPanel, { commands });
    expect(await screen.findByText("luisgamas/uxnan")).toBeInTheDocument();

    // Exactly what `loadContext` does on every poll tick: raise the in-flight
    // flag while the previous answer stays put.
    github.contextLoading = true;
    await until(() => true);

    expect(screen.getByText("luisgamas/uxnan")).toBeInTheDocument();
  });

  it("does NOT lose a half-written pull request to a poll tick", async () => {
    const { screen, user } = mountWithProviders(GithubPanel, { commands });

    await user.click(await screen.findByRole("button", { name: "Create PR" }));
    const body = await screen.findByPlaceholderText("Description");
    await user.type(body, "Fixes the thing");

    // …the poll fires while the user is re-reading what they wrote.
    github.contextLoading = true;
    await until(() => true);
    github.contextLoading = false;
    await until(() => true);

    expect(screen.getByPlaceholderText("Description")).toHaveValue("Fixes the thing");
  });

  it("survives the form being unmounted outright and mounted again", async () => {
    const first = mountWithProviders(GithubPanel, { commands });
    await first.user.click(await first.screen.findByRole("button", { name: "Create PR" }));
    await first.user.type(
      await first.screen.findByPlaceholderText("Description"),
      "Draft that must survive",
    );
    await until(() => github.prDraft(`worktree:${WORKTREE}`)?.body === "Draft that must survive");
    first.screen.unmount();

    // A right-panel tab switch, closing the panel, or stepping to another
    // worktree and back all land here: a brand-new component instance.
    const second = mountWithProviders(GithubPanel, { commands });
    expect(await second.screen.findByPlaceholderText("Description")).toHaveValue(
      "Draft that must survive",
    );
  });

  it("forgets the draft when the user cancels — the one way out that discards", async () => {
    const { screen, user } = mountWithProviders(GithubPanel, { commands });
    await user.click(await screen.findByRole("button", { name: "Create PR" }));
    await user.type(await screen.findByPlaceholderText("Description"), "never mind");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(github.prDraft(`worktree:${WORKTREE}`)).toBeNull();
    expect(await screen.findByRole("button", { name: "Create PR" })).toBeInTheDocument();
  });

  it("keeps each worktree's draft to itself", async () => {
    const { screen, user } = mountWithProviders(GithubPanel, { commands });
    await user.click(await screen.findByRole("button", { name: "Create PR" }));
    await user.type(await screen.findByPlaceholderText("Description"), "for uxnan");
    await until(() => github.prDraft(`worktree:${WORKTREE}`)?.body === "for uxnan");

    signedInOn("C:/repos/other");
    expect(github.prDraft("worktree:C:/repos/other")).toBeNull();
    expect(github.prDraft(`worktree:${WORKTREE}`)?.body).toBe("for uxnan");
  });

  it("still says 'not a GitHub repo' when a worktree really has no context", async () => {
    signedInOn(WORKTREE, null);
    const { screen } = mountWithProviders(GithubPanel, { commands });
    expect(await screen.findByText("This worktree isn't a GitHub repository.")).toBeInTheDocument();
  });
});
