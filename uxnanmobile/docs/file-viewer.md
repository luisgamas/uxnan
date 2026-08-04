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

The preview targets **GitHub-flavored Markdown as GitHub renders it**, in three
layers:

1. **Block extraction** (`splitMarkdownBlocks`). GitHub renders two containers
   Markdown itself has no notion of, so they are lifted out of the document and
   given their chrome while their bodies stay ordinary Markdown:
   - **Alerts** — `> [!NOTE] | [!TIP] | [!IMPORTANT] | [!WARNING] | [!CAUTION]`
     become titled, colour-coded callouts (`MarkdownAlertCard`); the title is
     localized. A quote that is not an alert stays a blockquote.
   - **`<details>`** — becomes a real disclosure (`MarkdownDetailsTile`) that
     honours `open` and keeps its body collapsed until tapped.
   Fenced code is skipped while splitting, so an example *showing* `> [!NOTE]`
   stays an example. An unbalanced `<details>` falls back to plain HTML rather
   than swallowing the rest of the file.
2. **HTML normalization** (`normalizeReadmeHtml`) for the presentational subset
   READMEs use: headings, links, images, bold/emphasis, line breaks, layout
   containers, plus `<kbd>` (inline code) and `<sub>`/`<sup>` (Unicode
   subscripts/superscripts). Fenced code is preserved exactly; scriptable or
   embedded elements are removed with their contents. Two rules matter more
   than they look:
   - **A `<table>` converts to a pipe table only when it is a table of
     *data*** — it must have a `<th>` header row and no cell carrying block
     content (image, heading, list, fence, multiple paragraphs) or a sizing
     attribute. READMEs also use `<table>` as *layout* ("prose left, demo GIF
     right"); squeezing that into a pipe row destroys the content it was
     arranged to show, so it stays with the tag stripper, which flattens it
     into readable vertical flow.
   - **A conversion that cannot be represented returns the original content
     untouched.** A `<kbd>` wrapping a logo keeps the logo instead of printing
     its Markdown inside backticks; a `<sub>` whose characters have no Unicode
     form keeps its inner emphasis. `<br>` maps to Markdown's hard break and
     absorbs the source newline, so emphasis spanning a line break still
     closes.
3. **Renderer configuration.** `MarkdownBody` runs with the `gitHubWeb`
   extension set — tables, strikethrough, autolinks, task lists, `:emoji:`
   shortcodes and heading anchors — a checkbox builder that distinguishes
   `- [x]` from `- [ ]`, and a code-block builder that syntax-highlights the
   fence (`HighlightedSource`, shared with the full-file source view) and lets a
   long line **scroll horizontally** instead of being clipped.

Every Markdown image is rendered by `MarkdownResourceImage`:

- HTTPS resources are fetched once by `RemoteResourceService`
  (`infrastructure/media/`) and decoded by the media type the **response**
  declares, never by the URL. Badge endpoints are extensionless
  (`img.shields.io/github/stars/…` answers `image/svg+xml`), so choosing a
  decoder from the path handed SVG markup to the platform raster decoder and
  every shield rendered as a broken image. The service resolves the type from
  `content-type` plus the payload's own signature, caps the body at 5 MiB,
  accepts `https` only, and caches by URL so a repaint never refetches a badge.
  Insecure or non-network schemes are not fetched.
- Relative resources resolve against the open document, so
  `docs/README.md` + `../assets/demo.gif` becomes `assets/demo.gif`.
- Query strings and fragments such as `?raw=true` are removed only for local
  bridge reads.
- HTML width/height hints are carried through normalization and constrained to
  the content surface. Common shield URLs default to a compact badge height.
- Loading and broken-resource placeholders measure their slot: a badge row is
  shorter than the padded icon + caption box, so those slots render a single
  glyph instead of a column that would overflow the line.
- Local resources use `workspace/readImage`; animated GIF bytes are not
  transformed, so Flutter retains their animation.
- SVG is rendered by **`jovial_svg`** (`WorkspaceVectorImage`), not by the
  `flutter_svg` the app uses for its own bundled logos. This surface renders
  documents the user did not author, and `flutter_svg`/`vector_graphics` does
  not apply transforms to `<text>`: badge services emit
  `font-size="110" … transform="scale(.1)"` for coordinate precision, so every
  shield's label was painted ten times too large and covered the badge. Sizing
  is derived from the document's own viewport, so giving one axis lets the
  other follow the aspect ratio.
- Link taps are resolved by `resolveMarkdownLinkAction`: a workspace-relative
  destination pushes another `FileViewerScreen`; an `http`, `https` or `mailto`
  destination is handed to the OS (`url_launcher`, external application), the
  way a link in any reader behaves; anything else — an in-page `#anchor`, a
  `file:`/`javascript:`/app scheme, or a device with no handler — is copied to
  the clipboard so the tap is never silently ignored. A document therefore
  cannot make the phone open an arbitrary scheme.

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
  rejection, README HTML conversion, metadata, fenced-code preservation, block
  splitting (alerts, disclosures, fenced-code immunity, unbalanced tags), HTML
  table conversion, the `<kbd>`/`<sub>`/`<sup>` mapping, and fence-language
  aliases.
- `test/unit/infrastructure/remote_resource_service_test.dart` covers media-type
  sniffing, header-vs-payload precedence, caching, failure re-fetching, and the
  https/size guards through a stubbed Dio adapter.
- `test/widget/presentation/file_viewer_screen_test.dart` covers narrow-screen
  Markdown layout, selectable source, full-surface raster behavior, constrained
  tablet Markdown, relative SVG/GIF loading, GIF animation-preserving delivery,
  SVG Preview / Source switching, extensionless remote shields, a failing
  badge-sized slot, alert callouts, the `<details>` disclosure, and task
  lists / HTML tables / highlighted fences.
- `bridge/test/workspace/workspace-service.test.ts` proves that a PDF with a
  text-looking prefix still round-trips as the exact original bytes.
