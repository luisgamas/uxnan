# Workspace file viewer

The mobile workspace viewer is a capability-based surface shared by Android
and iOS. `FileViewerScreen` owns navigation and edit state; reusable media
widgets own image/PDF rendering; `FileBrowserManager` remains the only route to
workspace RPCs.

## Supported formats

| File | Preview | Source / edit | Git changes |
|---|---|---|---|
| Markdown (`.md`, `.markdown`) | GitHub-style Markdown, common README HTML, local/remote images | Yes | Yes |
| SVG (`.svg`) | Vector preview with zoom | Yes | Yes |
| Raster (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`) | Fit-to-screen with zoom | No | No |
| Animated GIF (`.gif`) | Animated, fit-to-screen with zoom | No | No |
| PDF (`.pdf`) | Native PDFium viewer with pan, zoom, selection, and links | No | No |
| Other UTF-8 files | Selectable syntax-highlighted source | Yes | Yes |
| Other binary files | Explicit unsupported-binary state | No | No |

The Preview / Source preference is a manual Riverpod `Notifier` shared by
Markdown and SVG. The existing Changes preference remains independent. Editing
always shows the raw UTF-8 buffer and saving re-fetches content and diff state.

## Markdown compatibility

`normalizeReadmeHtml` converts only the presentational HTML commonly found in
README files: headings, links, images, bold/emphasis, line breaks, and layout
containers. It preserves fenced code exactly. Scriptable or embedded elements
and their contents are removed rather than interpreted.

Every Markdown image is rendered by `MarkdownResourceImage`:

- HTTPS resources use Flutter's raster or SVG loaders; insecure or non-network
  schemes are not fetched.
- Relative resources resolve against the open document, so
  `docs/README.md` + `../assets/demo.gif` becomes `assets/demo.gif`.
- Query strings and fragments such as `?raw=true` are removed only for local
  bridge reads.
- HTML width/height hints are carried through normalization and constrained to
  the content surface. Common shield URLs default to a compact badge height.
- Local resources use `workspace/readImage`; animated GIF bytes are not
  transformed, so Flutter retains their animation.
- Relative file links push another `FileViewerScreen`. External links keep the
  viewer's explicit copy-to-clipboard behavior.

## Trust and resource boundaries

The client never constructs or reads an absolute project path. Local references
are normalized to workspace-relative POSIX paths, and attempts to climb above
the workspace return no resource. The bridge then independently applies
`resolveWithinRoot`, blocks `.git` and sensitive names, and enforces bounded
payloads: 5 MiB for ordinary files, 10 MiB for images, and 20 MiB for PDFs.

PDFs use the existing `workspace/readFile` response shape. The bridge identifies
the `.pdf` extension before binary sniffing and always sends the original bytes
as base64; this avoids corrupting PDFs whose prefix happens not to contain a NUL
byte. No shared JSON-RPC schema change is required.

## Regression coverage

- `test/unit/presentation/file_preview_support_test.dart` covers extension
  classification, safe relative-path normalization, query removal, escape
  rejection, README HTML conversion, metadata, and fenced-code preservation.
- `test/widget/presentation/file_viewer_screen_test.dart` covers narrow-screen
  Markdown layout, selectable source, full-surface raster behavior, constrained
  tablet Markdown, relative SVG/GIF loading, GIF animation-preserving delivery,
  and SVG Preview / Source switching.
- `bridge/test/workspace/workspace-service.test.ts` proves that a PDF with a
  text-looking prefix still round-trips as the exact original bytes.
