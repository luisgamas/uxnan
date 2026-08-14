/**
 * The Files tab's search surface, mounted for real.
 *
 * What these cover is the wiring a type-check cannot: that opening search reveals
 * the two collapsible sections, that a content hit renders as a readable line with
 * the match marked, that clicking one opens the file *at that line*, and that the
 * tree keeps a quiet mark on whatever the center area is showing.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { mountWithProviders, until } from "../../test/render";
import { projects } from "$lib/state/projects.svelte";
import { fileTree } from "$lib/state/fileTree.svelte";
import { terminals } from "$lib/state/terminals.svelte";
import FileTreePanel from "./FileTreePanel.svelte";

const ROOT = "C:/repo";

function entry(rel: string, isDir = false) {
  return { name: rel.split("/").pop(), path: `${ROOT}/${rel}`, isDir, ignored: false };
}

/** `fs_list_dir` for a tiny tree: `src/` + `README.md`, with two files in `src`. */
function listDir(args: Record<string, unknown>) {
  const path = String(args.path);
  if (path === ROOT) return [entry("src", true), entry("README.md")];
  if (path === `${ROOT}/src`) return [entry("src/panel.ts"), entry("src/other.ts")];
  return [];
}

const CONTENT_HIT = {
  files: [
    {
      path: `${ROOT}/src/panel.ts`,
      name: "panel.ts",
      matches: [
        { line: 12, text: "const needle = 2;", start: 6, end: 12, elided: false },
        { line: 40, text: "  return needle;", start: 9, end: 15, elided: false },
      ],
      truncated: false,
    },
  ],
  total: 2,
  truncated: false,
};

/** The tree row for `rel`, once the lazy listing has produced it. */
async function rowFor(
  screen: ReturnType<typeof mountPanel>["screen"],
  rel: string,
): Promise<HTMLElement> {
  const selector = `[data-path="${ROOT}/${rel}"]`;
  await until(() => !!screen.container.querySelector(selector), { label: `the ${rel} row` });
  return screen.container.querySelector<HTMLElement>(selector)!;
}

/** Whether a row carries the quiet "this is what the center is showing" fill. */
function isMarked(row: HTMLElement): boolean {
  return row.className.includes("bg-foreground/[0.055]");
}

/** The tab the center area is showing (these tests never split the area). */
function activeTab() {
  const root = terminals.root;
  if (!root || root.kind !== "group") throw new Error("expected a single tab group");
  const tab = root.tabs.find((t) => t.id === root.activeTabId);
  if (!tab) throw new Error("expected an active tab");
  return tab;
}

function mountPanel(commands: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  return mountWithProviders(FileTreePanel, {
    commands: {
      fs_list_dir: (args) => listDir(args),
      fs_search_files: () => ({ entries: [], truncated: false }),
      fs_search_content: () => ({ files: [], total: 0, truncated: false }),
      fs_read_file: () => ({ content: "", binary: false, tooLarge: false }),
      git_diff_head: () => "",
      ...commands,
    },
  });
}

beforeEach(() => {
  projects.activeWorktreePath = ROOT;
  fileTree.setRoot(null);
  fileTree.filterInclude = "";
  fileTree.filterExclude = "";
  fileTree.contentOpen = false;
  fileTree.filtersOpen = false;
  fileTree.contentCaseSensitive = false;
  fileTree.contentWholeWord = false;
  fileTree.contentRegex = false;
  terminals.root = null;
});

describe("FileTreePanel — search sections", () => {
  it("keeps the advanced sections out of the way until search is opened", async () => {
    const { screen, user } = mountPanel();
    expect(screen.queryByText("Search in file contents")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Search files" }));

    // Both sections are there, and both are collapsed: the plain name search the
    // user came for is still the only thing asking for input.
    const content = screen.getByRole("button", { name: /Search in file contents/ });
    const filters = screen.getByRole("button", { name: /^Filters/ });
    expect(content).toHaveAttribute("aria-expanded", "false");
    expect(filters).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByPlaceholderText("Text to find in files…")).not.toBeVisible();
    expect(screen.getByLabelText("Include these files")).not.toBeVisible();

    await user.click(content);
    expect(content).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByPlaceholderText("Text to find in files…")).toBeVisible();
    // Opening one section leaves the other where the user left it.
    expect(filters).toHaveAttribute("aria-expanded", "false");
  });

  it("sends the match modes and the glob filters the sections collect", async () => {
    const { screen, user, backend } = mountPanel({ fs_search_content: () => CONTENT_HIT });
    await user.click(screen.getByRole("button", { name: "Search files" }));
    await user.click(screen.getByRole("button", { name: /Search in file contents/ }));
    await user.click(screen.getByRole("button", { name: /^Filters/ }));

    await user.type(screen.getByLabelText("Include these files"), "*.ts");
    await user.click(screen.getByRole("button", { name: "Match whole word" }));
    await user.type(screen.getByPlaceholderText("Text to find in files…"), "needle");

    await until(() => backend.called("fs_search_content"), { label: "the content search" });
    expect(backend.lastCallTo("fs_search_content")?.args).toMatchObject({
      query: { query: "needle", wholeWord: true, caseSensitive: false, isRegex: false },
      filters: { include: "*.ts" },
    });
  });

  it("shows each matching line, with the matched text marked out of the snippet", async () => {
    const { screen, user } = mountPanel({ fs_search_content: () => CONTENT_HIT });
    await user.click(screen.getByRole("button", { name: "Search files" }));
    await user.click(screen.getByRole("button", { name: /Search in file contents/ }));
    await user.type(screen.getByPlaceholderText("Text to find in files…"), "needle");

    const hit = await screen.findByRole("button", { name: "Open at line 12" });
    // The line number and the full line are both readable in the row…
    expect(hit).toHaveTextContent("12");
    expect(hit).toHaveTextContent("const needle = 2;");
    // …and the matched span is the marked one, sliced by the backend's offsets.
    expect(hit.querySelector(".bg-primary\\/25")?.textContent).toBe("needle");
    expect(screen.getByRole("button", { name: "Open at line 40" })).toBeInTheDocument();
    // The file groups its hits and says how many it has.
    expect(screen.getByRole("button", { name: /panel\.ts/ })).toHaveTextContent("2");
  });

  it("opens a hit at its line, and leaves the search open while doing it", async () => {
    const { screen, user } = mountPanel({ fs_search_content: () => CONTENT_HIT });
    await user.click(screen.getByRole("button", { name: "Search files" }));
    await user.click(screen.getByRole("button", { name: /Search in file contents/ }));
    await user.type(screen.getByPlaceholderText("Text to find in files…"), "needle");
    const hit = await screen.findByRole("button", { name: "Open at line 40" });

    await user.click(hit);

    // The file opened on its Edit view with the reveal queued for line 40 …
    expect(terminals.activeFilePath).toBe(`${ROOT}/src/panel.ts`);
    const tab = activeTab();
    expect(tab.kind === "file" && tab.view).toBe("edit");
    expect(terminals.fileState(tab.id)?.reveal?.line).toBe(40);
    // … and the search UI is untouched: closing it is the user's call.
    expect(screen.getByPlaceholderText("Text to find in files…")).toHaveValue("needle");
    expect(screen.getByRole("button", { name: "Open at line 40" })).toBeInTheDocument();
  });
});

describe("FileTreePanel — the tree follows the open file", () => {
  it("lets the click selection win, and keeps the quieter mark underneath it", async () => {
    const { screen, user } = mountPanel();
    await user.click(await rowFor(screen, "src")); // expand
    const panelRow = await rowFor(screen, "src/panel.ts");

    // Clicking a row both selects it and opens it, and while it is selected that
    // is the mark you see — the two never stack.
    await user.click(panelRow);
    await until(() => panelRow.className.includes("bg-accent"), {
      label: "the selection on panel.ts",
    });
    expect(isMarked(panelRow)).toBe(false);

    // Esc clears the selection; the file is still open, so the quiet mark takes over.
    await user.keyboard("{Escape}");
    await until(() => isMarked(panelRow), { label: "the open-file mark on panel.ts" });
  });

  it("moves the mark when the viewer switches to another open file", async () => {
    const { screen, user } = mountPanel();
    await user.click(await rowFor(screen, "src"));
    const panelRow = await rowFor(screen, "src/panel.ts");
    const otherRow = await rowFor(screen, "src/other.ts");
    await user.click(panelRow);
    await user.click(otherRow);
    await user.keyboard("{Escape}");

    await until(() => isMarked(otherRow), { label: "the open-file mark on other.ts" });
    expect(isMarked(panelRow)).toBe(false);
  });

  it("drops the mark when the last open file is closed", async () => {
    const { screen, user } = mountPanel();
    await user.click(await rowFor(screen, "src"));
    const panelRow = await rowFor(screen, "src/panel.ts");
    await user.click(panelRow);
    await user.keyboard("{Escape}");
    await until(() => isMarked(panelRow), { label: "the open-file mark" });

    await terminals.closeTab(terminals.activeGroupId, activeTab().id);
    await until(() => !isMarked(panelRow), { label: "the mark going away" });
  });

  it("expands the tree down to a file opened from a search hit, without closing search", async () => {
    const { screen, user } = mountPanel({ fs_search_content: () => CONTENT_HIT });
    await user.click(screen.getByRole("button", { name: "Search files" }));
    await user.click(screen.getByRole("button", { name: /Search in file contents/ }));
    await user.type(screen.getByPlaceholderText("Text to find in files…"), "needle");
    await user.click(await screen.findByRole("button", { name: "Open at line 12" }));

    // The tree is still behind the results list, but it has already expanded `src`
    // — so when the user closes search, the file is sitting there revealed.
    await until(() => fileTree.expanded.has(`${ROOT}/src`), {
      label: "the tree expanding to the opened file",
    });
    await user.click(screen.getByRole("button", { name: "Close" }));
    const panelRow = await rowFor(screen, "src/panel.ts");
    expect(isMarked(panelRow)).toBe(true);
  });
});

describe("FileTreePanel — a tree that could not be read", () => {
  it("does not call a folder empty when the listing failed", async () => {
    // Reported from the app: a host whose file session had died showed the
    // backend's error in red *and* "This folder is empty." underneath — two
    // claims, one of which nobody had checked.
    const { screen } = mountPanel({
      fs_list_dir: () => {
        throw new Error("could not list C:/code on that host: session closed");
      },
    });

    expect(await screen.findByText(/session closed/)).toBeInTheDocument();
    expect(screen.queryByText("This folder is empty.")).toBeNull();
  });

  it("says it is waiting for the host, and nothing else, until it connects", async () => {
    const { screen } = mountPanel({
      fs_list_dir: () => {
        throw { code: "NOT_CONNECTED", message: "host-1 is not connected" };
      },
    });

    expect(await screen.findByText("Waiting for this host to connect...")).toBeInTheDocument();
    expect(screen.queryByText("This folder is empty.")).toBeNull();
    // Not connected is a state, not a fault: no red line for it.
    expect(screen.queryByText(/not connected/)).toBeNull();
  });
});
