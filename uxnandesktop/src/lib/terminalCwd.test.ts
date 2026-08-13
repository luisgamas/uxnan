import { describe, expect, it } from "vitest";
import { inheritedCwd } from "$lib/terminalCwd";
import { workspaceKey } from "$lib/pathid";

/**
 * A terminal inherits the folder of the workspace it opens in — but only when
 * both are on the same machine.
 *
 * The rule exists because of a real failure: opening a terminal on a remote host
 * while a *local* project was the active workspace seeded the remote shell with
 * a local Windows path. The shell tried to `cd` somewhere that does not exist on
 * that machine and died immediately, which looked from the outside like a
 * terminal that flashed and refused to open.
 */
describe("inheritedCwd", () => {
  const LOCAL_PROJECT = "C:/code/uxnan";
  const REMOTE = "ssh:h1";

  it("an explicit cwd always wins", () => {
    expect(inheritedCwd("/tmp/here", LOCAL_PROJECT, undefined)).toBe("/tmp/here");
    expect(inheritedCwd("/tmp/here", LOCAL_PROJECT, REMOTE)).toBe("/tmp/here");
  });

  it("a local terminal inherits a local workspace's folder", () => {
    expect(inheritedCwd(undefined, LOCAL_PROJECT, undefined)).toBe(LOCAL_PROJECT);
    expect(inheritedCwd(undefined, LOCAL_PROJECT, "local")).toBe(LOCAL_PROJECT);
  });

  it("the Global space has no folder to inherit", () => {
    expect(inheritedCwd(undefined, "", undefined)).toBeUndefined();
    expect(inheritedCwd(undefined, "", REMOTE)).toBeUndefined();
  });

  it("a remote terminal never inherits a local project's path", () => {
    // The bug. `C:/code/uxnan` does not exist on the host, so seeding it makes
    // the remote shell exit before it can print anything.
    expect(inheritedCwd(undefined, LOCAL_PROJECT, REMOTE)).toBeUndefined();
  });

  it("a local terminal never inherits a remote workspace's path", () => {
    // The same mistake in the other direction, which will matter as soon as a
    // project can live on a host.
    const remoteWorkspace = workspaceKey(REMOTE, "/home/dev/app");
    expect(inheritedCwd(undefined, remoteWorkspace, undefined)).toBeUndefined();
  });

  it("a remote terminal inherits a workspace on the same host", () => {
    const remoteWorkspace = workspaceKey(REMOTE, "/home/dev/app");
    expect(inheritedCwd(undefined, remoteWorkspace, REMOTE)).toBe("/home/dev/app");
  });

  it("two hosts are not each other's machine", () => {
    const onH1 = workspaceKey("ssh:h1", "/home/dev/app");
    expect(inheritedCwd(undefined, onH1, "ssh:h2")).toBeUndefined();
  });
});
