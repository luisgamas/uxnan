# File viewer

The center area uses one durable tab per file. A tab can expose **Edit**,
**Preview**, and **Changes** without re-reading git or remounting the editor when
you switch modes.

## Supported views

| File | Edit | Preview | Changes |
|---|---:|---:|---:|
| Text/source | Yes, up to 2 MiB | No | When tracked by git |
| Markdown | Yes | Rendered Markdown | When tracked by git |
| Raster image | No | Image controls and metadata | Visual image diff |
| SVG | Yes | Rendered image | Visual/source diff as available |
| PDF | No | Native system-webview PDF viewer | Binary diff metadata |

Images and PDFs are read from the machine the file lives on: `fs_read_data_url`
here, `ssh_fs_read_data_url` over the host's SFTP session (both behind
`readDataUrlOn`, the same router every other file read goes through). Either
backend recognizes a known extension or file signature, rejects unrelated
formats, and caps a preview at 25 MiB — the remote one asks the host for the size
first, so an over-cap file is refused without crossing the link. PDF support
therefore depends on the operating system webview's native renderer; an explicit
fallback is shown when it is unavailable. A preview that fails states the reason
it failed.

## Markdown

The renderer is built on `@lezer/markdown` and produces typed Svelte nodes. It
supports the common GitHub-flavored surface, including tables, task lists,
alerts, disclosures, strikethrough, autolinks, fenced code, and repository
README conventions:

- fenced blocks use the same installed Lezer language parsers as the editor;
- headings receive unique GitHub-style ids and `#anchor` links scroll to them;
- relative links open sibling files in the existing Uxnan file-tab flow;
- images on disk are read through the bounded backend command, on the machine
  the document itself is on — a host's README renders its own screenshots;
- relative assets resolve correctly from native Windows, macOS/Linux, and UNC
  file paths;
- local GitHub-style paths accept URL encoding and delivery suffixes such as
  `?raw=true` without treating them as part of the filename;
- remote images, badges, and animated GIFs are fetched through the bounded
  25 MiB preview mode of the shared image command in the packaged app;
- the article stays readable and centered while the scroll container fills the
  panel; the container uses the same native overflow behavior as the CodeMirror
  Edit and Changes views, so the scrollbar remains on the far-right edge.

Repository READMEs often use raw HTML for centered logos and badges. Uxnan parses
only a small presentational allowlist: paragraphs/divs/spans, links, images,
emphasis, deletion, inline code, keyboard keys, line/rule breaks, headings, and
sub/superscript. Standalone safe `<img>` tags remain supported when a loose HTML
table causes the Markdown parser to classify them as inline HTML. Only safe
attributes (`href`, `src`, `alt`, `title`, dimensions, and alignment) survive.
Scripts, styles, event handlers, forms, embedded documents, SVG/MathML markup,
media, and unsafe URL schemes are dropped.
Rendering never uses Svelte `{@html}`.

## Security posture

- The Tauri CSP keeps `frame-src 'none'`; PDF preview adds only
  `object-src data:`.
- Local paths never become unrestricted filesystem URLs.
- Remote image responses retain the existing MIME and size validation.
- Relative file links use the normal tab-opening API rather than executing or
  handing paths to a shell.

## Verify

```bash
npm run check
npm test
npm run build
cd src-tauri
cargo test
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check
```

Visual acceptance should cover a badge-heavy README, a loose HTML-table README
with multiple local animated GIFs, Windows/macOS/Linux path resolution, a long
document (scrollbar at the panel edge), a local SVG, and a PDF in the packaged
system webview.
