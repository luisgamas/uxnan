/**
 * `terminals.activeFilePath` — the file the center area is showing, which the
 * Files tab marks in the tree.
 *
 * The rule these pin down: the mark follows the *viewer*, not the click. It moves
 * when the user switches between file tabs, survives a detour into a terminal (the
 * file is still open, just not frontmost), falls back to the previously viewed file
 * when the current one is closed, and disappears once no file tab is left.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { installFakeBackend } from "../../test/tauri";

const { terminals } = await import("./terminals.svelte");

const WT = "C:/repo";

beforeEach(() => {
  installFakeBackend({
    fs_read_file: () => ({ content: "", binary: false, tooLarge: false }),
    git_diff_head: () => "",
    term_buffers_set: () => undefined,
  });
  // Start from an empty layout so tabs from a previous test can't leak in.
  terminals.root = null;
});

describe("activeFilePath", () => {
  it("is null while nothing is open", () => {
    expect(terminals.activeFilePath).toBeNull();
  });

  it("follows the file tab the user opens, then the next one", () => {
    terminals.openFile(`${WT}/src/a.ts`, WT);
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);

    terminals.openFile(`${WT}/src/b.ts`, WT);
    expect(terminals.activeFilePath).toBe(`${WT}/src/b.ts`);
  });

  it("moves back when the user switches to an already-open file tab", () => {
    const a = terminals.openFile(`${WT}/src/a.ts`, WT);
    terminals.openFile(`${WT}/src/b.ts`, WT);
    // Re-opening an open file focuses its tab rather than duplicating it.
    terminals.openFile(`${WT}/src/a.ts`, WT);
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);
    expect(terminals.findTab(a)?.id).toBe(a);
  });

  it("survives a detour into a terminal tab", () => {
    terminals.openFile(`${WT}/src/a.ts`, WT);
    const term = terminals.create({ cwd: WT });
    expect(terminals.activePtyId()).toBe(term);
    // The file is still open — the user just looked away — so the tree keeps
    // showing where it lives instead of flickering off on every terminal click.
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);
  });

  it("falls back to the previously viewed file when the current one is closed", async () => {
    terminals.openFile(`${WT}/src/a.ts`, WT);
    const b = terminals.openFile(`${WT}/src/b.ts`, WT);
    expect(terminals.activeFilePath).toBe(`${WT}/src/b.ts`);

    await terminals.closeTab(terminals.activeGroupId, b);
    expect(terminals.activeFilePath).toBe(`${WT}/src/a.ts`);
  });

  it("goes dark once the last file tab is gone", async () => {
    const a = terminals.openFile(`${WT}/src/a.ts`, WT);
    await terminals.closeTab(terminals.activeGroupId, a);
    expect(terminals.activeFilePath).toBeNull();
  });

  it("clears when a whole subtree of open files is deleted from disk", () => {
    terminals.openFile(`${WT}/src/a.ts`, WT);
    terminals.openFile(`${WT}/src/b.ts`, WT);
    terminals.closeTabsUnder(`${WT}/src`);
    expect(terminals.activeFilePath).toBeNull();
  });
});
