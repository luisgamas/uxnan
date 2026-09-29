import 'dart:math' as math;

/// Visual representation available for a workspace file.
enum FilePreviewKind { text, markdown, rasterImage, svg, pdf }

/// Classifies a workspace path without relying on content sniffing in the UI.
FilePreviewKind previewKindForPath(String path) {
  final lower = path.toLowerCase().split(RegExp('[?#]')).first;
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return FilePreviewKind.markdown;
  }
  if (lower.endsWith('.svg')) return FilePreviewKind.svg;
  if (lower.endsWith('.pdf')) return FilePreviewKind.pdf;
  if (const <String>['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']
      .any(lower.endsWith)) {
    return FilePreviewKind.rasterImage;
  }
  return FilePreviewKind.text;
}

/// Resolves a Markdown resource against its workspace-relative document.
///
/// Query strings and fragments are intentionally removed before the bridge
/// request. A path that would escape the workspace root, an external URI, or a
/// document-only fragment returns `null`.
String? resolveWorkspaceResourcePath(String documentPath, String target) {
  if (target.trim().isEmpty || target.trimLeft().startsWith('#')) return null;
  final uri = Uri.tryParse(target.trim());
  if (uri == null || uri.hasScheme || uri.hasAuthority) return null;

  String resourcePath;
  try {
    resourcePath =
        Uri.decodeComponent(uri.path).replaceAll(String.fromCharCode(92), '/');
  } on FormatException {
    return null;
  }
  if (resourcePath.isEmpty || resourcePath.contains('\u0000')) return null;

  final segments = <String>[];
  if (!resourcePath.startsWith('/')) {
    final documentSegments =
        documentPath.replaceAll(String.fromCharCode(92), '/').split('/');
    if (documentSegments.isNotEmpty) documentSegments.removeLast();
    segments.addAll(documentSegments.where((segment) => segment.isNotEmpty));
  }

  for (final segment in resourcePath.split('/')) {
    if (segment.isEmpty || segment == '.') continue;
    if (segment == '..') {
      if (segments.isEmpty) return null;
      segments.removeLast();
      continue;
    }
    segments.add(segment);
  }
  return segments.isEmpty ? null : segments.join('/');
}

/// Whether [target] is an HTTPS resource that the preview may load directly.
bool isSafeRemoteResource(String target) {
  final uri = Uri.tryParse(target.trim());
  return uri != null && uri.hasAuthority && uri.scheme == 'https';
}

/// Conservative badge detection used to keep status shields at their intended
/// compact height instead of stretching them like README illustrations.
bool isLikelyBadgeResource(String target) {
  final lower = target.toLowerCase();
  return lower.contains('shields.io/') ||
      lower.contains('/badge/') ||
      lower.contains('/badges/') ||
      lower.contains('badge.svg');
}

/// Size metadata carried through Markdown's image `title` field.
class MarkdownImageMetadata {
  const MarkdownImageMetadata({this.width, this.height, this.title});

  factory MarkdownImageMetadata.fromTitle(String? value) {
    if (value == null || !value.startsWith(marker)) {
      return MarkdownImageMetadata(title: value);
    }
    final separator = value.indexOf('|', marker.length);
    final dimensions = separator == -1
        ? value.substring(marker.length)
        : value.substring(marker.length, separator);
    final parts = dimensions.split('x');
    final width = parts.isEmpty ? null : double.tryParse(parts.first);
    final height = parts.length < 2 ? null : double.tryParse(parts[1]);
    final title = separator == -1 ? null : value.substring(separator + 1);
    return MarkdownImageMetadata(
      width: width != null && width > 0 ? width : null,
      height: height != null && height > 0 ? height : null,
      title: title == null || title.isEmpty ? null : title,
    );
  }

  static const marker = 'uxnan-image-size:';

  final double? width;
  final double? height;
  final String? title;
}

/// What tapping a link in a Markdown preview should do.
sealed class MarkdownLinkAction {
  const MarkdownLinkAction();
}

/// Open another workspace file in a new viewer.
class OpenWorkspaceFile extends MarkdownLinkAction {
  /// Creates an action opening [path] (workspace-relative).
  const OpenWorkspaceFile(this.path);

  /// Workspace-relative path of the target document.
  final String path;
}

/// Hand the destination to the OS (browser, mail client).
class OpenExternalLink extends MarkdownLinkAction {
  /// Creates an action launching [uri].
  const OpenExternalLink(this.uri);

  /// Destination to launch.
  final Uri uri;
}

/// Copy the destination — the honest fallback for anything not launchable.
class CopyLinkTarget extends MarkdownLinkAction {
  /// Creates an action copying [href].
  const CopyLinkTarget(this.href);

  /// Raw destination as written in the document.
  final String href;
}

/// Schemes handed to the OS. Everything else (an in-page `#anchor`, a `file:`
/// or app-specific scheme) is copied instead of launched, so a document can
/// never make the phone open something arbitrary.
const _launchableSchemes = {'http', 'https', 'mailto'};

/// Decides what a tapped Markdown link does, from the document it lives in.
///
/// A workspace-relative destination opens in the viewer; a web or mail address
/// goes to the OS the way a link in any reader does; anything else is copied.
MarkdownLinkAction resolveMarkdownLinkAction(String documentPath, String href) {
  final workspacePath = resolveWorkspaceResourcePath(documentPath, href);
  if (workspacePath != null) return OpenWorkspaceFile(workspacePath);

  final uri = Uri.tryParse(href.trim());
  if (uri != null && _launchableSchemes.contains(uri.scheme.toLowerCase())) {
    return OpenExternalLink(uri);
  }
  return CopyLinkTarget(href);
}

/// A GitHub-flavored alert (`> [!NOTE]` and friends).
enum MarkdownAlertKind {
  /// Useful information the reader should notice.
  note,

  /// Optional advice for doing something better.
  tip,

  /// Information essential to the reader's success.
  important,

  /// Something that needs immediate attention.
  warning,

  /// A risk with negative consequences.
  caution;

  /// Resolves the GitHub keyword (`NOTE`, `TIP`, …) to its kind, or `null`.
  static MarkdownAlertKind? parse(String keyword) {
    final normalized = keyword.trim().toLowerCase();
    for (final kind in MarkdownAlertKind.values) {
      if (kind.name == normalized) return kind;
    }
    return null;
  }
}

/// A run of a Markdown document that the viewer renders as one unit.
///
/// GitHub renders two constructs that Markdown itself has no notion of: the
/// `> [!NOTE]` alert and the `<details>` disclosure. Both are containers whose
/// *body* is ordinary Markdown, so the document is split into blocks and each
/// body is rendered by the same Markdown pipeline inside a widget that supplies
/// the missing chrome.
sealed class MarkdownBlock {
  const MarkdownBlock();
}

/// Ordinary Markdown handed straight to the renderer.
class MarkdownTextBlock extends MarkdownBlock {
  /// Creates a plain Markdown block.
  const MarkdownTextBlock(this.text);

  /// Raw Markdown source.
  final String text;
}

/// A GitHub alert callout.
class MarkdownAlertBlock extends MarkdownBlock {
  /// Creates an alert of [kind] carrying [body].
  const MarkdownAlertBlock({required this.kind, required this.body});

  /// Which alert this is.
  final MarkdownAlertKind kind;

  /// Markdown inside the callout.
  final String body;
}

/// A `<details>` disclosure.
class MarkdownDetailsBlock extends MarkdownBlock {
  /// Creates a disclosure with a [summary] label over [body].
  const MarkdownDetailsBlock({
    required this.summary,
    required this.body,
    required this.expanded,
  });

  /// Text shown on the always-visible row (already HTML-normalized).
  final String summary;

  /// Markdown revealed when the disclosure opens.
  final String body;

  /// Whether the document asked for it to start open (`<details open>`).
  final bool expanded;
}

/// Splits [source] into renderable blocks, leaving fenced code untouched.
///
/// Only the two container constructs are extracted; everything else stays in
/// [MarkdownTextBlock]s in document order, so a document with neither returns a
/// single block and renders exactly as before.
List<MarkdownBlock> splitMarkdownBlocks(String source) {
  final blocks = <MarkdownBlock>[];
  final buffer = <String>[];
  final lines = source.split('\n');

  void flush() {
    if (buffer.isEmpty) return;
    final text = buffer.join('\n');
    buffer.clear();
    if (text.trim().isEmpty) return;
    blocks.add(MarkdownTextBlock(text));
  }

  var index = 0;
  while (index < lines.length) {
    final line = lines[index];

    final fence = RegExp(r'^\s{0,3}(`{3,}|~{3,})').firstMatch(line);
    if (fence != null) {
      final marker = fence.group(1)!;
      final closing = RegExp('^\\s{0,3}${RegExp.escape(marker)}\\s*\$');
      buffer.add(lines[index++]);
      while (index < lines.length) {
        final fenced = lines[index++];
        buffer.add(fenced);
        if (closing.hasMatch(fenced)) break;
      }
      continue;
    }

    final alert = _alertOpening(line);
    if (alert != null) {
      flush();
      index++;
      final body = <String>[];
      while (index < lines.length && _isQuote(lines[index])) {
        body.add(_stripQuote(lines[index++]));
      }
      blocks.add(
        MarkdownAlertBlock(kind: alert, body: body.join('\n').trim()),
      );
      continue;
    }

    if (RegExp('<details[^>]*>', caseSensitive: false).hasMatch(line)) {
      final details = _readDetails(lines, index);
      if (details != null) {
        flush();
        blocks.add(details.block);
        index = details.next;
        continue;
      }
    }

    buffer.add(line);
    index++;
  }
  flush();
  return blocks.isEmpty ? const [MarkdownTextBlock('')] : blocks;
}

MarkdownAlertKind? _alertOpening(String line) {
  final match = RegExp(r'^\s{0,3}>\s*\[!([A-Za-z]+)\]\s*$').firstMatch(line);
  return match == null ? null : MarkdownAlertKind.parse(match.group(1)!);
}

bool _isQuote(String line) => RegExp(r'^\s{0,3}>').hasMatch(line);

String _stripQuote(String line) =>
    line.replaceFirst(RegExp(r'^\s{0,3}>\s?'), '');

class _DetailsScan {
  const _DetailsScan(this.block, this.next);
  final MarkdownDetailsBlock block;
  final int next;
}

/// Reads a `<details>` container starting at [start], balancing nested ones.
///
/// Returns `null` when the document never closes it, so an unbalanced tag falls
/// back to the plain-HTML path instead of swallowing the rest of the file.
_DetailsScan? _readDetails(List<String> lines, int start) {
  final open =
      RegExp('<details([^>]*)>', caseSensitive: false).firstMatch(lines[start]);
  if (open == null) return null;
  final expanded =
      RegExp(r'\bopen\b', caseSensitive: false).hasMatch(open.group(1) ?? '');

  final collected = <String>[lines[start].substring(open.end)];
  var depth = 1;
  var index = start + 1;
  while (index < lines.length && depth > 0) {
    final line = lines[index];
    depth += RegExp('<details', caseSensitive: false).allMatches(line).length;
    final closing =
        RegExp(r'</details\s*>', caseSensitive: false).firstMatch(line);
    if (closing != null && depth == 1) {
      collected.add(line.substring(0, closing.start));
      index++;
      depth = 0;
      break;
    }
    depth -= RegExp('</details', caseSensitive: false).allMatches(line).length;
    collected.add(line);
    index++;
  }
  if (depth > 0) return null;

  var body = collected.join('\n');
  var summary = '';
  final summaryMatch = RegExp(
    r'<summary[^>]*>([\s\S]*?)</summary\s*>',
    caseSensitive: false,
  ).firstMatch(body);
  if (summaryMatch != null) {
    summary = normalizeReadmeHtml(summaryMatch.group(1)!).trim();
    body = body.replaceRange(summaryMatch.start, summaryMatch.end, '');
  }
  return _DetailsScan(
    MarkdownDetailsBlock(
      summary: summary,
      body: body.trim(),
      expanded: expanded,
    ),
    index,
  );
}

/// Converts the small, presentational HTML subset common in GitHub READMEs to
/// Markdown that `flutter_markdown_plus` can render. Fenced code is preserved
/// byte-for-byte, and executable/embedded HTML is removed with its contents.
String normalizeReadmeHtml(String source) {
  final protected = <String>[];
  final withoutFences = _protectFencedCode(source, protected);
  var output =
      withoutFences.replaceAll(RegExp(r'<!--[\s\S]*?-->'), '').replaceAll(
            RegExp(
              r'<(script|style|iframe|object|embed|form|canvas|svg|math)\b[^>]*>[\s\S]*?</\1\s*>',
              caseSensitive: false,
            ),
            '',
          );

  output = _convertHtmlTables(output);

  output = output.replaceAllMapped(
    RegExp(r'<img\b[^>]*>', caseSensitive: false),
    (match) {
      final tag = match.group(0)!;
      final src = _htmlAttribute(tag, 'src');
      if (src == null || src.isEmpty) return '';
      final alt = _escapeMarkdownText(_htmlAttribute(tag, 'alt') ?? '');
      final title = _htmlAttribute(tag, 'title') ?? '';
      final width = _dimension(_htmlAttribute(tag, 'width'));
      final height = _dimension(_htmlAttribute(tag, 'height'));
      final metadata = width == null && height == null
          ? title
          : '${MarkdownImageMetadata.marker}'
              '${width ?? ''}x${height ?? ''}|$title';
      final suffix = metadata.isEmpty ? '' : ' "${_escapeTitle(metadata)}"';
      return '![$alt](${_escapeDestination(src)}$suffix)';
    },
  );

  output = output.replaceAllMapped(
    RegExp(r'<a\b[^>]*>([\s\S]*?)</a\s*>', caseSensitive: false),
    (match) {
      final href = _htmlAttribute(match.group(0)!, 'href');
      final body = match.group(1) ?? '';
      if (href == null || href.isEmpty) return body;
      return '[$body](${_escapeDestination(href)})';
    },
  );
  output = output.replaceAllMapped(
    RegExp(r'<h([1-6])\b[^>]*>([\s\S]*?)</h\1\s*>', caseSensitive: false),
    (match) =>
        '\n${'#' * int.parse(match.group(1)!)} ${match.group(2)!.trim()}\n',
  );
  output = _convertInlineTags(output);
  output = output
      // A <br> becomes Markdown's hard break (two spaces + newline) and eats
      // the source newline that usually follows it. Emitting a bare "\n"
      // instead left a blank line — which ends the paragraph, so emphasis
      // opened before the <br> never found its closing delimiter and a bolded
      // sentence rendered with its literal asterisks.
      .replaceAll(RegExp(r'<br\s*/?>[ \t]*\n?', caseSensitive: false), '  \n')
      .replaceAll(RegExp(r'<hr\s*/?>', caseSensitive: false), '\n\n---\n\n')
      .replaceAll(RegExp(r'<(strong|b)\b[^>]*>', caseSensitive: false), '**')
      .replaceAll(RegExp(r'</(strong|b)\s*>', caseSensitive: false), '**')
      .replaceAll(RegExp(r'<(em|i)\b[^>]*>', caseSensitive: false), '_')
      .replaceAll(RegExp(r'</(em|i)\s*>', caseSensitive: false), '_')
      .replaceAll(
        RegExp(
          r'</?(p|div|center|table|thead|tbody|tfoot|tr|td|th|details|summary)\b[^>]*>',
          caseSensitive: false,
        ),
        '\n',
      )
      .replaceAll(RegExp('<[^>]+>'), '')
      .replaceAll(RegExp(r'\n[ \t]+\n'), '\n\n')
      .replaceAll(RegExp(r'\n{3,}'), '\n\n');

  output = _decodeHtmlEntities(output);
  for (var index = 0; index < protected.length; index++) {
    output = output.replaceAll(_fenceToken(index), protected[index]);
  }
  return output;
}

/// Rewrites a *data* `<table>` as a GFM pipe table — and only a data table.
///
/// READMEs use `<table>` for two unrelated jobs. A **data** table (a matrix of
/// short values under `<th>` headers) is exactly what a pipe table expresses,
/// and flattening it put every cell on its own line — a list of fragments. A
/// **layout** table is scaffolding for something Markdown cannot say ("prose in
/// the left column, a screenshot in the right"), and its cells hold headings,
/// paragraphs, lists and images. Squeezing one of those into a pipe row
/// destroys the very content it was arranged to show, so a layout table is left
/// to the tag stripper, which flattens it into readable vertical flow.
///
/// The conversion therefore requires a `<th>` header row and rejects any cell
/// carrying block content or a sizing attribute. When in doubt it does not
/// convert: an unconverted table still reads, a mangled one does not.
String _convertHtmlTables(String source) {
  return source.replaceAllMapped(
    RegExp(r'<table\b[^>]*>([\s\S]*?)</table\s*>', caseSensitive: false),
    (match) {
      final body = match.group(1)!;
      if (RegExp('<table', caseSensitive: false).hasMatch(body)) {
        return match.group(0)!;
      }
      if (RegExp(r'\b(rowspan|colspan)\s*=', caseSensitive: false)
          .hasMatch(body)) {
        return match.group(0)!;
      }
      // A header row is what tells a table of data from a layout grid.
      if (!RegExp(r'<th\b', caseSensitive: false).hasMatch(body)) {
        return match.group(0)!;
      }

      final rows = <List<String>>[];
      var headerRow = -1;
      for (final row in RegExp(
        r'<tr\b[^>]*>([\s\S]*?)</tr\s*>',
        caseSensitive: false,
      ).allMatches(body)) {
        final cells = <String>[];
        var isHeader = false;
        for (final cell in RegExp(
          r'<(th|td)\b[^>]*>([\s\S]*?)</\1\s*>',
          caseSensitive: false,
        ).allMatches(row.group(1)!)) {
          if (_isLayoutCell(cell.group(0)!, cell.group(2)!)) {
            return match.group(0)!;
          }
          if (cell.group(1)!.toLowerCase() == 'th') isHeader = true;
          cells.add(_tableCell(cell.group(2)!));
        }
        if (cells.isEmpty) continue;
        if (isHeader && headerRow == -1) headerRow = rows.length;
        rows.add(cells);
      }
      if (rows.isEmpty || headerRow == -1) return match.group(0)!;

      final columns = rows.map((row) => row.length).reduce(math.max);
      if (rows.any((row) => row.length != columns)) return match.group(0)!;

      final header = rows.removeAt(headerRow);
      final buffer = StringBuffer('\n\n')
        ..writeln('| ${header.join(' | ')} |')
        ..writeln('| ${List.filled(columns, '---').join(' | ')} |');
      for (final row in rows) {
        buffer.writeln('| ${row.join(' | ')} |');
      }
      buffer.write('\n');
      return buffer.toString();
    },
  );
}

/// Whether a cell is scaffolding rather than a value: it is sized/aligned, or
/// it holds block content a single pipe cell cannot carry (an image, heading,
/// list, fenced code, nested block container, or more than one paragraph).
bool _isLayoutCell(String tag, String content) {
  final attributes = tag.split('>').first;
  if (RegExp(r'\b(width|height|align|valign)\s*=', caseSensitive: false)
      .hasMatch(attributes)) {
    return true;
  }
  if (RegExp(
    r'<(img|h[1-6]|p|div|ul|ol|li|pre|table|details|blockquote)\b',
    caseSensitive: false,
  ).hasMatch(content)) {
    return true;
  }
  final trimmed = content.trim();
  if (RegExp(r'^\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|```|~~~)', multiLine: true)
      .hasMatch(trimmed)) {
    return true;
  }
  return trimmed.contains(RegExp(r'\n\s*\n'));
}

/// Flattens one table cell to a single line of inline Markdown.
String _tableCell(String value) {
  final inline = _convertInlineTags(value)
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), ' ')
      .replaceAll(RegExp(r'<(strong|b)\b[^>]*>', caseSensitive: false), '**')
      .replaceAll(RegExp(r'</(strong|b)\s*>', caseSensitive: false), '**')
      .replaceAll(RegExp(r'<(em|i)\b[^>]*>', caseSensitive: false), '_')
      .replaceAll(RegExp(r'</(em|i)\s*>', caseSensitive: false), '_')
      .replaceAll('|', r'\|')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return inline.isEmpty ? ' ' : inline;
}

/// Maps the inline HTML GitHub renders specially onto Markdown equivalents.
///
/// `<kbd>` becomes inline code (the nearest boxed-glyph affordance available),
/// and `<sub>`/`<sup>` become Unicode subscripts/superscripts when every
/// character has one — `H<sub>2</sub>O` reads as `H₂O` rather than `H2O`.
/// `<mark>` keeps its text; there is no Markdown highlight.
String _convertInlineTags(String source) {
  var output = source.replaceAllMapped(
    RegExp(r'<kbd\b[^>]*>([\s\S]*?)</kbd\s*>', caseSensitive: false),
    (match) {
      final inner = match.group(1)!;
      // Only a plain-text key label becomes inline code. READMEs also use
      // <kbd> as a chip around content — an agent logo plus its name — and by
      // this point an inner <img> is already Markdown, so backticks would print
      // `![](…)` instead of drawing the image. Anything that is not a short,
      // literal key label is handed back untouched for the later passes.
      final label = inner.trim();
      final isKeyLabel = label.isNotEmpty &&
          label.length <= 32 &&
          !label.contains(RegExp(r'[<>`\n]')) &&
          !label.contains('![') &&
          !label.contains('](');
      return isKeyLabel ? '`$label`' : inner;
    },
  );
  output = output.replaceAllMapped(
    RegExp(r'<(sub|sup)\b[^>]*>([\s\S]*?)</\1\s*>', caseSensitive: false),
    (match) {
      final inner = match.group(2)!;
      // Same rule: only a bare run of characters that all have a Unicode
      // sub/superscript is rewritten. Anything else keeps its original content
      // — including nested emphasis, which stripping tags would have lost.
      if (inner.contains('<')) return inner;
      final map = match.group(1)!.toLowerCase() == 'sub'
          ? _subscriptGlyphs
          : _superscriptGlyphs;
      final mapped = StringBuffer();
      for (final rune in inner.trim().runes) {
        final glyph = map[String.fromCharCode(rune)];
        if (glyph == null) return inner;
        mapped.write(glyph);
      }
      return mapped.toString();
    },
  );
  return output.replaceAllMapped(
    RegExp(r'<mark\b[^>]*>([\s\S]*?)</mark\s*>', caseSensitive: false),
    (match) => match.group(1)!,
  );
}

const Map<String, String> _subscriptGlyphs = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
};

const Map<String, String> _superscriptGlyphs = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  'n': 'ⁿ',
  'i': 'ⁱ',
};

String _protectFencedCode(String source, List<String> protected) {
  final lines = source.split('\n');
  final output = <String>[];
  var index = 0;
  while (index < lines.length) {
    final opening = RegExp(r'^\s{0,3}(`{3,}|~{3,})').firstMatch(lines[index]);
    if (opening == null) {
      output.add(lines[index]);
      index++;
      continue;
    }
    final marker = opening.group(1)!;
    final block = <String>[lines[index++]];
    final closing = RegExp('^\\s{0,3}${RegExp.escape(marker)}\\s*\$');
    while (index < lines.length) {
      final line = lines[index++];
      block.add(line);
      if (closing.hasMatch(line)) break;
    }
    final token = _fenceToken(protected.length);
    protected.add(block.join('\n'));
    output.add(token);
  }
  return output.join('\n');
}

String _fenceToken(int index) => 'UXNANFENCEDCODETOKEN${index}END';

String? _htmlAttribute(String tag, String name) {
  final match = RegExp(
    '''\\b${RegExp.escape(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))''',
    caseSensitive: false,
  ).firstMatch(tag);
  final value = match?.group(1) ?? match?.group(2) ?? match?.group(3);
  return value == null ? null : _decodeHtmlEntities(value.trim());
}

String? _dimension(String? value) {
  if (value == null) return null;
  return RegExp(r'^\d+(?:\.\d+)?').firstMatch(value)?.group(0);
}

String _escapeMarkdownText(String value) =>
    value.replaceAll(r'\', r'\\').replaceAll('[', r'\[').replaceAll(']', r'\]');

String _escapeDestination(String value) =>
    value.replaceAll(' ', '%20').replaceAll('(', '%28').replaceAll(')', '%29');

String _escapeTitle(String value) => value.replaceAll('"', r'\"');

String _decodeHtmlEntities(String value) => value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ');
