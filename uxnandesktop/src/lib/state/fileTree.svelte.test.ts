/**
 * The Files tab's search engine: the filename walk, the content search, the
 * include/exclude filters both share, and the reveal that keeps the tree pointed
 * at an open file.
 *
 * These run against the fake Tauri backend rather than a mocked `$lib/api`, so
 * the command names and argument shapes asserted here are the ones the Rust side
 * actually receives.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installFakeBackend, type FakeBackend } from "../../test/tauri";

const { fileTree } = await import("./fileTree.svelte");

const ROOT = "C:/repo";

/** A file hit as `fs_search_files` returns it. */
function fileHit(rel: string) {
  return { name: rel.split("/").pop(), path: `${ROOT}/${rel}`, isDir: false, ignored: false };
}

/** A content hit as `fs_search_content` returns it. */
function contentHit(rel: string, line: number, text: string, start: number, end: number) {
  return {
    path: `${ROOT}/${rel}`,
    name: rel.split("/").pop(),
    matches: [{ line, text, start, end, elided: false }],
    truncated: false,
  };
}

let backend: FakeBackend;

/** Let both debounced searches fire and their responses settle. */
async function settle() {
  await vi.advanceTimersByTimeAsync(500);
}

beforeEach(() => {
  vi.useFakeTimers();
  backend = installFakeBackend({
    fs_list_dir: () => [],
    fs_search_files: () => ({ entries: [], truncated: false }),
    fs_search_content: () => ({ files: [], total: 0, truncated: false }),
  });
  // A fresh root resets every piece of search state (`setRoot` no-ops on the
  // same root, so each test gets its own).
  fileTree.setRoot(null);
  fileTree.setRoot(ROOT);
  fileTree.filterInclude = "";
  fileTree.filterExclude = "";
  fileTree.contentCaseSensitive = false;
  fileTree.contentWholeWord = false;
  fileTree.contentRegex = false;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("filename search", () => {
  it("sends the query, the hidden toggle and the glob filters to the backend", async () => {
    backend.setCommands({
      fs_search_files: () => ({ entries: [fileHit("src/lib/panel.ts")], truncated: false }),
    });
    fileTree.filterInclude = "*.ts";
    fileTree.filterExclude = "dist";
    fileTree.showHidden = false;
    fileTree.query = "panel";
    fileTree.scheduleSearch();
    await settle();

    expect(backend.lastCallTo("fs_search_files")?.args).toMatchObject({
      root: ROOT,
      query: "panel",
      includeHidden: false,
      filters: { include: "*.ts", exclude: "dist" },
    });
    expect(fileTree.searchResults).toHaveLength(1);
  });

  it("searches the scoped folder instead of the root when one is set", async () => {
    fileTree.searchScope = `${ROOT}/src`;
    fileTree.query = "panel";
    fileTree.scheduleSearch();
    await settle();
    expect(backend.lastCallTo("fs_search_files")?.args.root).toBe(`${ROOT}/src`);
  });

  it("debounces typing into a single walk", async () => {
    for (const q of ["p", "pa", "pan", "pane", "panel"]) {
      fileTree.query = q;
      fileTree.scheduleSearch();
      await vi.advanceTimersByTimeAsync(20);
    }
    await settle();
    const calls = backend.callsTo("fs_search_files");
    expect(calls).toHaveLength(1);
    expect(calls[0].args.query).toBe("panel");
  });

  it("clears results as soon as the query is emptied, without asking the backend", async () => {
    backend.setCommands({
      fs_search_files: () => ({ entries: [fileHit("a.ts")], truncated: false }),
    });
    fileTree.query = "a";
    fileTree.scheduleSearch();
    await settle();
    expect(fileTree.searchResults).toHaveLength(1);

    backend.clearCalls();
    fileTree.query = "";
    fileTree.scheduleSearch();
    await settle();
    expect(fileTree.searchResults).toEqual([]);
    expect(backend.called("fs_search_files")).toBe(false);
  });
});

describe("content search", () => {
  it("sends the text, its match modes and the shared filters", async () => {
    backend.setCommands({
      fs_search_content: () => ({
        files: [contentHit("src/a.ts", 12, "let needle = 2;", 4, 10)],
        total: 1,
        truncated: false,
      }),
    });
    fileTree.filterInclude = "src";
    fileTree.contentCaseSensitive = true;
    fileTree.contentWholeWord = true;
    fileTree.contentRegex = false;
    fileTree.contentQuery = "needle";
    fileTree.scheduleContentSearch();
    await settle();

    expect(backend.lastCallTo("fs_search_content")?.args).toMatchObject({
      root: ROOT,
      query: { query: "needle", caseSensitive: true, wholeWord: true, isRegex: false },
      filters: { include: "src", exclude: "" },
    });
    expect(fileTree.contentTotal).toBe(1);
    expect(fileTree.contentResults[0].matches[0].line).toBe(12);
    expect(fileTree.contentError).toBeNull();
  });

  it("surfaces a bad regular expression under the input, without wiping the tree", async () => {
    backend.setCommands({
      fs_search_content: () => {
        throw new Error("invalid search pattern: unclosed group");
      },
    });
    fileTree.contentRegex = true;
    fileTree.contentQuery = "a(";
    fileTree.scheduleContentSearch();
    await settle();

    expect(fileTree.contentError).toContain("invalid search pattern");
    expect(fileTree.contentResults).toEqual([]);
    // The pattern only invalidates this one search — the panel-wide error, which
    // reports a broken *tree*, must stay clear.
    expect(fileTree.error).toBeNull();
  });

  it("drops a slow response that a newer query has already superseded", async () => {
    let call = 0;
    backend.setCommands({
      fs_search_content: async () => {
        call++;
        const mine = call;
        // The first search takes far longer than the second.
        await new Promise((r) => setTimeout(r, mine === 1 ? 400 : 10));
        return {
          files: [contentHit("a.ts", mine, `hit from call ${mine}`, 0, 3)],
          total: 1,
          truncated: false,
        };
      },
    });
    fileTree.contentQuery = "first";
    fileTree.scheduleContentSearch();
    await vi.advanceTimersByTimeAsync(320); // past the debounce, mid-flight
    fileTree.contentQuery = "second";
    fileTree.scheduleContentSearch();
    await settle();

    expect(fileTree.contentResults[0].matches[0].line).toBe(2);
    expect(fileTree.contentLoading).toBe(false);
  });

  it("closing search drops both queries but keeps the filters the user set up", async () => {
    fileTree.filterInclude = "*.ts";
    fileTree.filterExclude = "dist";
    fileTree.contentCaseSensitive = true;
    fileTree.query = "panel";
    fileTree.contentQuery = "needle";
    fileTree.scheduleSearch();
    fileTree.scheduleContentSearch();
    await settle();

    fileTree.resetSearch();
    expect(fileTree.query).toBe("");
    expect(fileTree.contentQuery).toBe("");
    expect(fileTree.searchResults).toEqual([]);
    expect(fileTree.contentResults).toEqual([]);
    expect(fileTree.filterInclude).toBe("*.ts");
    expect(fileTree.filterExclude).toBe("dist");
    expect(fileTree.contentCaseSensitive).toBe(true);
  });
});

describe("revealFile", () => {
  it("expands and loads every folder down to the file", async () => {
    await fileTree.revealFile(`${ROOT}/src/lib/state/panel.ts`);
    expect([...fileTree.expanded].sort()).toEqual([
      `${ROOT}/src`,
      `${ROOT}/src/lib`,
      `${ROOT}/src/lib/state`,
    ]);
    const listed = backend.callsTo("fs_list_dir").map((call) => call.args.path);
    expect(listed).toEqual(
      expect.arrayContaining([`${ROOT}/src`, `${ROOT}/src/lib`, `${ROOT}/src/lib/state`]),
    );
  });

  it("leaves a file at the root alone (nothing to expand)", async () => {
    await fileTree.revealFile(`${ROOT}/README.md`);
    expect([...fileTree.expanded]).toEqual([]);
  });

  it("ignores a file outside the current root", async () => {
    await fileTree.revealFile("D:/elsewhere/src/other.ts");
    expect([...fileTree.expanded]).toEqual([]);
  });
});

describe("waiting for a host", () => {
  it("stops waiting the moment the tree is pointed at a local project", async () => {
    // Reported with a screenshot: "waiting for this host to connect" sitting
    // above a **local** project's folders — which had listed perfectly well.
    // The flag survived the switch: `setRoot` cleared the error and everything
    // else, but not this, so a host that was down kept a line on screen over a
    // tree that has nothing to do with it.
    backend.setCommands({
      ssh_fs_list: () => {
        throw { code: "NOT_CONNECTED", message: "h1 is not connected" };
      },
    });
    fileTree.setRoot("C:/on/host", "ssh:h1");
    await settle();
    expect(fileTree.awaitingHost).toBe(true);

    fileTree.setRoot(ROOT);
    expect(fileTree.awaitingHost).toBe(false);
  });

  it("stops waiting as soon as a listing succeeds", async () => {
    // The other half: a tree that just listed is not waiting for anything,
    // whatever it was doing a moment ago.
    backend.setCommands({
      ssh_fs_list: () => {
        throw { code: "NOT_CONNECTED", message: "h1 is not connected" };
      },
    });
    fileTree.setRoot("C:/on/host", "ssh:h1");
    await settle();
    expect(fileTree.awaitingHost).toBe(true);

    backend.setCommands({ ssh_fs_list: () => [] });
    await fileTree.loadDir("C:/on/host", true);
    expect(fileTree.awaitingHost).toBe(false);
  });
});
