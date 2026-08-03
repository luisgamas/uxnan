import 'package:flutter/material.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:highlight/highlight.dart' as syntax;
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// Syntax-highlighted source shared by the file viewer's full-file body and the
/// fenced code blocks inside a Markdown preview.
///
/// `flutter_highlight`'s own widget paints into a plain `RichText`, which
/// cannot expose the platform selection/copy menu; this keeps its parser and
/// themes while making every range selectable where selection makes sense. A
/// Markdown block opts out ([selectable] `false`) because the surrounding
/// `MarkdownBody` already owns the selection gesture.
class HighlightedSource extends StatelessWidget {
  /// Creates a highlighted view of [source] parsed as [language].
  const HighlightedSource({
    required this.source,
    required this.language,
    this.selectable = true,
    this.padding = const EdgeInsets.symmetric(
      horizontal: UxnanSpacing.sm,
      vertical: UxnanSpacing.xs,
    ),
    this.filled = true,
    super.key,
  });

  /// Raw source text.
  final String source;

  /// A `highlight`-package language id. Unknown ids fall back to plain text.
  final String language;

  /// Whether the text exposes the platform selection menu.
  final bool selectable;

  /// Padding inside the highlighted surface.
  final EdgeInsetsGeometry padding;

  /// Whether the theme's own code background is painted (a Markdown code block
  /// already sits on the stylesheet's `codeblockDecoration`).
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final theme = isDark ? atomOneDarkTheme : atomOneLightTheme;
    final rootStyle =
        TextStyle(color: theme['root']?.color).merge(UxnanTypography.codeBody);
    final nodes = syntax.highlight
        .parse(source.replaceAll('\t', '        '), language: language)
        .nodes;
    final span = TextSpan(
      style: rootStyle,
      children: _spans(nodes ?? const <syntax.Node>[], theme),
    );

    return Container(
      color: filled ? theme['root']?.backgroundColor : null,
      padding: padding,
      child: selectable ? SelectableText.rich(span) : Text.rich(span),
    );
  }

  List<TextSpan> _spans(
    List<syntax.Node> nodes,
    Map<String, TextStyle> theme,
  ) =>
      [
        for (final node in nodes)
          if (node.value != null)
            TextSpan(
              text: node.value,
              style: node.className == null ? null : theme[node.className],
            )
          else
            TextSpan(
              style: node.className == null ? null : theme[node.className],
              children: _spans(node.children ?? const <syntax.Node>[], theme),
            ),
      ];
}

/// Maps a Markdown fence info string (` ```ts `, ` ```Dockerfile `) to a
/// `highlight` language id.
///
/// Unknown ids are safe — the parser falls back to plain text — but the common
/// aliases are normalized so the most-used fences in a README actually colour.
String languageIdForFence(String info) {
  final token = info.trim().toLowerCase().split(RegExp(r'[\s,:{]')).first;
  if (token.isEmpty) return 'plaintext';
  return _fenceAliases[token] ?? token;
}

const Map<String, String> _fenceAliases = {
  'js': 'javascript',
  'jsx': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'node': 'javascript',
  'ts': 'typescript',
  'tsx': 'typescript',
  'sh': 'bash',
  'shell': 'bash',
  'zsh': 'bash',
  'console': 'bash',
  'terminal': 'bash',
  'ps': 'powershell',
  'pwsh': 'powershell',
  'bat': 'dos',
  'cmd': 'dos',
  'yml': 'yaml',
  'toml': 'ini',
  'conf': 'ini',
  'py': 'python',
  'rb': 'ruby',
  'rs': 'rust',
  'kt': 'kotlin',
  'kts': 'kotlin',
  'c': 'cpp',
  'h': 'cpp',
  'hpp': 'cpp',
  'objc': 'objectivec',
  'csharp': 'cs',
  'c#': 'cs',
  'html': 'xml',
  'vue': 'xml',
  'svelte': 'xml',
  'svg': 'xml',
  'jsonc': 'json',
  'json5': 'json',
  'md': 'markdown',
  'patch': 'diff',
  'text': 'plaintext',
  'txt': 'plaintext',
  'plain': 'plaintext',
};
