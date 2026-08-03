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
  output = output
      .replaceAll(RegExp(r'<br\s*/?>', caseSensitive: false), '\n')
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
