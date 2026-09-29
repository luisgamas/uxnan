import 'package:flutter/material.dart';

/// A filesystem path on one line that, when it does not fit, gives up its
/// **beginning** rather than its end: `…/dev/mobile-app`, never
/// `/Users/me/Docum…`.
///
/// The leading folders of a path are the ones the user already knows — the
/// PC's home, the start folder the bridge was set up with — and they are the
/// same for every project. What tells two projects apart is the tail, which an
/// ordinary end ellipsis is exactly what cuts. `uxnandesktop` keeps the same
/// tail visible (a left-truncated path in the project settings), so the rule
/// is one rule across both apps.
///
/// It cuts at a folder boundary when one fits, so what remains is still a
/// path; only a last folder name too long for the line on its own is cut
/// mid-name, keeping its end.
class PathText extends StatelessWidget {
  /// Creates a [PathText] for [path].
  const PathText(this.path, {this.style, super.key});

  /// The path as the bridge reported it — POSIX or Windows separators.
  final String path;

  /// The text style; a monospace one (`UxnanTypography.codeSmall`) as a rule.
  final TextStyle? style;

  static const String _ellipsis = '…';

  @override
  Widget build(BuildContext context) {
    final effective = DefaultTextStyle.of(context).style.merge(style);
    final scaler = MediaQuery.textScalerOf(context);
    final direction = Directionality.of(context);
    return LayoutBuilder(
      builder: (context, constraints) {
        final shown = fitPathTail(
          path,
          maxWidth: constraints.maxWidth,
          fits: (text) {
            final painter = TextPainter(
              text: TextSpan(text: text, style: effective),
              textDirection: direction,
              textScaler: scaler,
              maxLines: 1,
            )..layout();
            final width = painter.width;
            painter.dispose();
            return width <= constraints.maxWidth;
          },
        );
        return Text(
          shown,
          style: effective,
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.clip,
          semanticsLabel: path,
        );
      },
    );
  }
}

/// The longest tail of [path] that [fits] on one line, led by an ellipsis when
/// anything was dropped.
///
/// Prefers a tail that starts at a separator (`…/dev/app`); falls back to the
/// last characters of the final name when even `…/name` is too wide. Exposed
/// for tests, which can measure with a character count instead of a painter.
String fitPathTail(
  String path, {
  required double maxWidth,
  required bool Function(String text) fits,
}) {
  if (maxWidth.isInfinite || fits(path)) return path;

  // Every separator, left to right: cutting at the earliest one that fits
  // keeps the most of the path.
  for (var i = 1; i < path.length; i++) {
    final char = path[i];
    if (char != '/' && char != r'\') continue;
    final candidate = '${PathText._ellipsis}${path.substring(i)}';
    if (fits(candidate)) return candidate;
  }

  // Not even the last name fits behind an ellipsis: keep as much of its end
  // as the line holds.
  for (var start = 1; start < path.length; start++) {
    final candidate = '${PathText._ellipsis}${path.substring(start)}';
    if (fits(candidate)) return candidate;
  }
  return PathText._ellipsis;
}
