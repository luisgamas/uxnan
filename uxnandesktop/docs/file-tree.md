# File tree & search

The right panel's **Files** tab browses the active worktree, one directory at a
time (a folder is listed the first time it is expanded, so `node_modules` costs
nothing until you ask for it). Rows are colored from the same git status the
Changes tab shows, and git-ignored entries are dimmed.

The tree state lives in `src/lib/state/fileTree.svelte.ts`, so it survives
switching tabs; the filesystem watcher (`fswatch.rs` → the `fs:changed` event)
reloads whichever loaded folders actually changed.

**On a project that lives on an SSH host**, the same tree reads and saves over
SFTP (`$lib/fsRouter`), and three of the things above do not apply: rows are not
colored and nothing is dimmed (both come from git *here*), there is no watcher —
the refresh button is the reload — and search is hidden rather than offered
broken, because it walks this filesystem. If the host disconnects the tree
empties itself and says it is waiting, instead of leaving another machine's
folders on screen. See [`remote-hosts.md`](remote-hosts.md).

## Search

The magnifier opens a search bar for **file names**, and below it two sections
that stay collapsed until you open them. Both sections keep their contents while
search is open, and closing search clears the queries but keeps the filters and
match modes — reopening it resumes the setup you built.

| Surface | Backend | What it matches |
|---|---|---|
| Name bar | `fs_search_files` | Every whitespace token of the query, case-insensitively, against the worktree-relative path |
| **Search in file contents** | `fs_search_content` | The text inside files, as literal text (default), whole word, or a regular expression |
| **Filters** | both | Include / exclude globs, applied to both searches above |

Both walks use ripgrep's `ignore` crate, so they honor `.gitignore`, global
excludes and `.git/info/exclude`, and never descend `.git`. Dotfiles follow the
"…" menu's **Show hidden files** toggle. A row's **Find in folder** scopes either
search to that folder.

Content search wins the results area when its box has text: narrowing *which
files* are searched is what the filters are for.

### Filter patterns

Comma-separated, matched case-insensitively on every platform:

- `*.ts` — no `/`, so it matches the **file name** anywhere in the tree;
- `src/lib/**` — contains a `/`, so it matches the **worktree-relative path**;
- `docs` — a bare name also covers everything **inside** a folder of that name;
- exclude is applied after include, so `include: *.ts` + `exclude: dist` works
  the way it reads.

An unparsable pattern is ignored rather than blanking the results — you are
typing it live, and a half-written glob should narrow nothing.

### Content results

Matches are grouped by file, with the line number and the matching line; the
matched span itself is marked. Clicking a line opens the file's **Edit** view
scrolled to that line, with a brief highlight on it. Long lines (a minified
bundle) are windowed around the match and marked with a leading ellipsis.

Offsets cross the boundary as UTF-16 code units — JavaScript string indices — so
the frontend slices the snippet without ever building HTML from backend text.

Bounds the engine applies, all in `src-tauri/src/fs.rs`:

| Bound | Value | Why |
|---|---|---|
| File size | 2 MiB (`MAX_SEARCH_BYTES`) | Matches the editor's own limit: a file you cannot open is not a useful hit |
| Binary files | skipped | A NUL in the first 8 KiB, the same test the editor uses |
| Matches per file | 50 | One generated file must not crowd out the rest |
| Total matches | 1000 (`CONTENT_LIMIT`) | Past this the result set is a prefix and says so |

The content walk is multi-threaded (`WalkBuilder::build_parallel`) and runs on
the blocking pool; both searches are debounced (180 ms for names, 300 ms for
content, which reads files) and a superseded response is dropped rather than
overwriting a newer one.

## The tree follows the file you're looking at

Opening a search hit never closes the search — you close that when you are done.
Instead the tree keeps up behind the results: the open file's ancestors are
expanded, its row is scrolled into view, and it carries a quiet background mark.
Close the search and the tree is already showing where the file lives.

The mark follows `terminals.activeFilePath`: the most recently viewed file tab
that is still open. So it moves when you switch between file tabs, stays put
while you work in a terminal tab (the file is still open, just not frontmost),
falls back to the previously viewed file when you close the current one, and
goes away once no file tab is left.

The click **selection** is a separate, louder mark that clears on `Esc` or a
click in the empty area below the tree. When a row is both selected and open, the
selection is what you see — the two never stack.

## Verify

```bash
npm run check
npm test          # includes FileTreePanel + fileTree + activeFile suites
cd src-tauri
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
```

Visual acceptance should cover: a content search in a large repository (result
count, truncation notice), a regex with an unparsable pattern (the error under
the input, the tree untouched), include/exclude filters narrowing both searches,
a hit in a minified file (windowed snippet), and opening a hit then closing
search to confirm the tree is revealed at that file.
