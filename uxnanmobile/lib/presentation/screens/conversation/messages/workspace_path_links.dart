import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
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

/// Makes inline-code paths tappable while preserving their code styling.
class WorkspaceCodeLinkBuilder extends MarkdownElementBuilder {
  /// Creates a builder that reports local inline-code paths to [onTap].
  WorkspaceCodeLinkBuilder({required this.onTap});

  /// Called when the inline code contains a plausible local path.
  final ValueChanged<String> onTap;

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    // A fenced block's content always ends in a newline, so this is what keeps
    // a one-line ```path``` block rendering as a code block instead of a link.
    final raw = element.textContent;
    if (raw.contains('\n')) return null;
    final value = raw.trim();
    if (!_looksLikeFilePath(value)) return null;
    return Semantics(
      link: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(4),
        onTap: () => onTap(value),
        child: Text(
          element.textContent,
          style: preferredStyle?.copyWith(
            decoration: TextDecoration.underline,
          ),
        ),
      ),
    );
  }
}

bool _looksLikeFilePath(String value) {
  if (!isLocalWorkspaceHref(value) || value.contains('\n')) return false;
  if (_startsWithHost(value)) return false;
  return RegExp(r'^(?:[A-Za-z]:[\\/]|\\\\|/|~[\\/]|\.{1,2}[\\/])')
          .hasMatch(value) ||
      RegExp(r'^[A-Za-z0-9_.-]+[\\/].+\.[A-Za-z0-9_-]{1,16}(?::\d+(?::\d+)?)?(?:#[A-Za-z0-9_.:-]+)?$')
          .hasMatch(value);
}
