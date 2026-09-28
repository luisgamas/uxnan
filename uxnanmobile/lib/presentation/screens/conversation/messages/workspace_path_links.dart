import 'package:markdown/markdown.dart' as md;

/// Whether [href] can name a file on the paired PC.
///
/// Drive-letter paths are checked before URI schemes because `C:\\...` is a
/// Windows path, not a URI. Explicit remote links are deliberately excluded;
/// the conversation screen keeps those safe by copying them instead.
bool isLocalWorkspaceHref(String href) {
  final value = href.trim();
  if (value.isEmpty || value.startsWith('#')) return false;
  if (RegExp(r'^[A-Za-z]:[\\/]').hasMatch(value)) return true;
  if (value.toLowerCase().startsWith('file:')) return true;
  if (RegExp('^[A-Za-z][A-Za-z0-9+.-]*:').hasMatch(value)) return false;
  return true;
}

/// Turns bare paths commonly emitted by coding agents into Markdown anchors.
///
/// Explicit Markdown links continue through the package's native parser. This
/// syntax covers absolute, home-relative, dot-relative, UNC, and conventional
/// repo-relative file paths without treating `https://` as a local path.
class WorkspacePathSyntax extends md.InlineSyntax {
  /// Creates the bare-path syntax.
  WorkspacePathSyntax()
      : super(
          r'(?:[A-Za-z]:[\\/]|\\\\|/|~[\\/]|\.{1,2}[\\/])[^\s`<>\[\](){}]+|(?:[A-Za-z0-9_.-]+[\\/])+(?:[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]{1,16})(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_.:-]+)?',
        );

  @override
  bool tryMatch(md.InlineParser parser, [int? startMatchPos]) {
    final position = startMatchPos ?? parser.pos;
    if (position > 0) {
      final previous = parser.source[position - 1];
      if (!RegExp(r'''[\s("'\[]''').hasMatch(previous)) return false;
    }
    // A hostname is rejected here rather than in [onMatch]: the parser treats
    // any matched pattern as handled and would spin in place on a match that
    // consumes nothing.
    final match = pattern.matchAsPrefix(parser.source, position);
    if (match == null) return false;
    if (_startsWithHost(_withoutTrailingPunctuation(match[0]!))) return false;
    return super.tryMatch(parser, startMatchPos);
  }

  @override
  bool onMatch(md.InlineParser parser, Match match) {
    final raw = match[0]!;
    final path = _withoutTrailingPunctuation(raw);
    if (path.isEmpty) {
      // Never return false: the parser would not advance past this match.
      parser.addNode(md.Text(raw));
      return true;
    }
    final anchor = md.Element.text('a', path)..attributes['href'] = path;
    parser.addNode(anchor);
    if (path.length < raw.length) {
      parser.addNode(md.Text(raw.substring(path.length)));
    }
    return true;
  }
}

/// Whether [path] reads as a hostname rather than a repo path.
///
/// A bare `example.com/docs/x.md` or `www.site.dev/readme.md` has the exact
/// shape of a relative path, and GitHub-flavored Markdown already auto-links
/// `www.` hosts. Rooted paths are never hosts, and a leading dot keeps
/// `.github/workflows/ci.yml` a path.
bool _startsWithHost(String path) {
  if (RegExp(r'^(?:[A-Za-z]:[\\/]|\\\\|/|~[\\/]|\.{1,2}[\\/])')
      .hasMatch(path)) {
    return false;
  }
  final first = path.split(RegExp(r'[\\/]')).first;
  return RegExp(r'^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}$')
      .hasMatch(first);
}

String _withoutTrailingPunctuation(String value) {
  var end = value.length;
  while (end > 0 && '.,;:!?'.contains(value[end - 1])) {
    end -= 1;
  }
  return value.substring(0, end);
}

/// Makes an inline-code span that names a local file a link, inside the text.
///
/// `` `docs/agents.md` `` is matched exactly as the stock code-span syntax
/// matches it and, when its content reads as a file path, emitted as a `code`
/// wrapping an `a`. The renderer then lays it out as one more run of the
/// paragraph's text — the code look with the link's color and underline on
/// top (the `a` style carries only those, see `uxnanMarkdownStyleSheet`), and
/// the renderer's own link recognizer, reported through
/// `MarkdownBody.onTapLink` — so it wraps with the prose (inside the path when
/// the path is long) and the punctuation after it stays on its line. The
/// nesting is deliberate: inside an `a`, the `code` style would win and paint
/// the path as plain code, because the theme's code style sets its own color
/// and no decoration.
///
/// Building the link as a widget instead cannot do that: every inline child
/// that is not plain text becomes its own unbreakable box in the paragraph's
/// `Wrap`, which is what put a path, and the rest of its sentence, on lines of
/// their own.
///
/// Every other code span — a command, an identifier — is handed back to the
/// stock syntax untouched. Fenced blocks never reach an inline syntax.
class WorkspaceCodePathSyntax extends md.CodeSyntax {
  @override
  bool onMatch(md.InlineParser parser, Match match) {
    final path = _codeSpanContent(match[2]!).trim();
    if (!_looksLikeFilePath(path)) return super.onMatch(parser, match);
    final link = md.Element.text('a', path)..attributes['href'] = path;
    parser.addNode(md.Element('code', [link]));
    return true;
  }
}

/// A code span's content as CommonMark reads it: line endings become spaces,
/// and one space comes off each end when both ends have one (unless the span
/// is nothing but spaces).
String _codeSpanContent(String raw) {
  final code = raw.replaceAll('\n', ' ');
  if (code.trim().isEmpty) return code;
  if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ')) {
    return code.substring(1, code.length - 1);
  }
  return code;
}

bool _looksLikeFilePath(String value) {
  if (!isLocalWorkspaceHref(value) || value.contains('\n')) return false;
  if (_startsWithHost(value)) return false;
  return RegExp(r'^(?:[A-Za-z]:[\\/]|\\\\|/|~[\\/]|\.{1,2}[\\/])')
          .hasMatch(value) ||
      RegExp(r'^[A-Za-z0-9_.-]+[\\/].+\.[A-Za-z0-9_-]{1,16}(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_.:-]+)?$')
          .hasMatch(value);
}
