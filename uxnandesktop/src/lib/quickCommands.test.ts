import { describe, expect, it } from "vitest";
import {
  contextualQuickCommands,
  globalQuickCommands,
  resolveCommandCwd,
  substituteTokens,
  type CommandContext,
} from "./quickCommands";
import type { QuickCommand } from "./types";

const ctx: CommandContext = {
  worktreePath: "C:/dev/app--feat",
  branch: "feat/x",
  repoId: "repo-1",
  repoPath: "C:/dev/app",
  repoName: "app",
};

const emptyCtx: CommandContext = {
  worktreePath: "",
  branch: null,
  repoId: null,
  repoPath: null,
  repoName: null,
};

function cmd(partial: Partial<QuickCommand>): QuickCommand {
  return {
    id: partial.id ?? "id",
    name: partial.name ?? "n",
    command: partial.command ?? "c",
    scope: partial.scope ?? "global",
    runMode: partial.runMode ?? "execute",
    target: partial.target ?? "newTab",
    cwd: partial.cwd ?? "activeWorktree",
    confirm: partial.confirm ?? false,
    ...partial,
  };
}

describe("substituteTokens", () => {
  it("substitutes every known token from the context", () => {
    expect(
      substituteTokens("cd {worktree} && git checkout {branch} # {repoName} at {repo} ({path})", ctx),
    ).toBe("cd C:/dev/app--feat && git checkout feat/x # app at C:/dev/app (C:/dev/app--feat)");
  });

  it("is case-insensitive on the token name", () => {
    expect(substituteTokens("{Branch}-{REPONAME}", ctx)).toBe("feat/x-app");
  });

  it("empties tokens with no value instead of leaving the placeholder", () => {
    expect(substituteTokens("[{branch}]", emptyCtx)).toBe("[]");
  });

  it("leaves unknown tokens untouched", () => {
    expect(substituteTokens("echo {unknown} {branch}", ctx)).toBe("echo {unknown} feat/x");
  });
});

describe("resolveCommandCwd", () => {
  it("resolves the active worktree, or undefined when there's none", () => {
    expect(resolveCommandCwd(cmd({ cwd: "activeWorktree" }), ctx)).toBe("C:/dev/app--feat");
    expect(resolveCommandCwd(cmd({ cwd: "activeWorktree" }), emptyCtx)).toBeUndefined();
  });

  it("resolves the project root", () => {
    expect(resolveCommandCwd(cmd({ cwd: "projectRoot" }), ctx)).toBe("C:/dev/app");
    expect(resolveCommandCwd(cmd({ cwd: "projectRoot" }), emptyCtx)).toBeUndefined();
  });

  it("resolves a trimmed custom path, or undefined when blank", () => {
    expect(resolveCommandCwd(cmd({ cwd: "custom", customCwd: "  C:/x  " }), ctx)).toBe("C:/x");
    expect(resolveCommandCwd(cmd({ cwd: "custom", customCwd: "   " }), ctx)).toBeUndefined();
    expect(resolveCommandCwd(cmd({ cwd: "custom", customCwd: null }), ctx)).toBeUndefined();
  });
});

describe("contextualQuickCommands", () => {
  const list = [
    cmd({ id: "g", scope: "global" }),
    cmd({ id: "p-match", scope: "project", projectId: "repo-1" }),
    cmd({ id: "p-other", scope: "project", projectId: "repo-2" }),
    cmd({ id: "w-match", scope: "worktree", worktreePath: "C:/dev/app--feat" }),
    cmd({ id: "w-other", scope: "worktree", worktreePath: "C:/dev/app--main" }),
  ];

  it("returns worktree + project commands bound to the active context", () => {
    expect(contextualQuickCommands(list, ctx).map((c) => c.id)).toEqual(["p-match", "w-match"]);
  });

  it("returns nothing in the Global space (no active worktree/project)", () => {
    expect(contextualQuickCommands(list, emptyCtx)).toEqual([]);
  });
});

describe("globalQuickCommands", () => {
  it("returns only global-scoped commands", () => {
    const list = [
      cmd({ id: "g1", scope: "global" }),
      cmd({ id: "p", scope: "project", projectId: "repo-1" }),
      cmd({ id: "g2", scope: "global" }),
    ];
    expect(globalQuickCommands(list).map((c) => c.id)).toEqual(["g1", "g2"]);
  });
});
