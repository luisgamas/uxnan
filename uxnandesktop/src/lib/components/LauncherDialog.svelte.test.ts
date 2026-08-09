import { describe, expect, it } from "vitest";

import { mountWithProviders } from "../../test/render";
import type { RepoData } from "$lib/types";
import LauncherDialog from "./LauncherDialog.svelte";

const repo: RepoData = {
  id: "repo-1",
  name: "sample",
  path: "C:/projects/sample",
  worktrees: [],
  isGit: true,
};

describe("LauncherDialog sources", () => {
  it("opens on the name-first new-worktree source and keeps it first", async () => {
    const { screen } = mountWithProviders(LauncherDialog, {
      props: { repo, open: true },
      commands: {
        branch_list: () => ({ branches: ["main"], remoteBranches: [], defaultBase: "main" }),
      },
    });

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((item) => item.textContent?.trim())).toEqual(["New", "Worktree", "PR", "Issue"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Open in sample" })).toBeInTheDocument();
    expect(
      await screen.findByPlaceholderText("Name, PR or issue reference…"),
    ).toBeInTheDocument();
  });

  it("keeps GitHub item naming automatic and hides storage details", async () => {
    const { screen, user } = mountWithProviders(LauncherDialog, {
      props: { repo, open: true },
      commands: {
        branch_list: () => ({ branches: ["main"], remoteBranches: [], defaultBase: "main" }),
        github_repo_context: () => ({
          nameWithOwner: "team/sample",
          host: "github.com",
          owner: "team",
          repo: "sample",
          branch: "main",
          pr: null,
        }),
        github_pr_list: () => [
          {
            number: 42,
            title: "Improve project import",
            url: "https://github.com/team/sample/pull/42",
            state: "OPEN",
            isDraft: false,
            author: "developer",
            headRefName: "feature/import",
            baseRefName: "main",
            updatedAt: "2026-08-08T12:00:00Z",
          },
        ],
      },
    });

    await user.click(screen.getByRole("tab", { name: "PR" }));
    await user.click(await screen.findByRole("option", { name: /#42 · Improve project import/ }));

    expect(screen.queryByLabelText("Branch")).not.toBeInTheDocument();
    expect(screen.queryByText("Worktree location")).not.toBeInTheDocument();
  });

  it("routes a PR URL from the first field into the matching source", async () => {
    const { screen, user } = mountWithProviders(LauncherDialog, {
      props: { repo, open: true },
      commands: {
        branch_list: () => ({ branches: ["main"], remoteBranches: [], defaultBase: "main" }),
        github_repo_context: () => ({
          nameWithOwner: "team/sample",
          host: "github.com",
          owner: "team",
          repo: "sample",
          branch: "main",
          pr: null,
        }),
        github_pr_list: () => [
          {
            number: 42,
            title: "Improve project import",
            url: "https://github.com/team/sample/pull/42",
            state: "OPEN",
            isDraft: false,
            author: "developer",
            headRefName: "feature/import",
            baseRefName: "main",
            updatedAt: "2026-08-08T12:00:00Z",
          },
        ],
      },
    });
    const input = await screen.findByPlaceholderText("Name, PR or issue reference…");

    await user.click(input);
    await user.paste("https://github.com/team/sample/pull/42");

    expect(await screen.findByText(/Selected #42/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "PR" })).toHaveAttribute("aria-selected", "true");
  });

  it("resolves a neutral number and opens the matching GitHub source", async () => {
    const { screen, user, backend } = mountWithProviders(LauncherDialog, {
      props: { repo, open: true },
      commands: {
        branch_list: () => ({ branches: ["main"], remoteBranches: [], defaultBase: "main" }),
        github_work_item_kind: () => "issue",
        github_repo_context: () => ({
          nameWithOwner: "team/sample",
          host: "github.com",
          owner: "team",
          repo: "sample",
          branch: "main",
          pr: null,
        }),
        github_issue_list: () => [
          {
            number: 42,
            title: "Improve project import",
            url: "https://github.com/team/sample/issues/42",
            state: "OPEN",
            author: "developer",
            labels: [],
            assignees: [],
            updatedAt: "2026-08-08T12:00:00Z",
            comments: 0,
          },
        ],
      },
    });
    const input = await screen.findByPlaceholderText("Name, PR or issue reference…");

    await user.click(input);
    await user.paste("#42");

    expect(await screen.findByText(/Selected #42/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Issue" })).toHaveAttribute("aria-selected", "true");
    expect(backend.lastCallTo("github_work_item_kind")?.args).toEqual({
      worktreePath: "C:/projects/sample",
      number: "42",
    });
  });
});
