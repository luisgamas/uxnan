// `buildTextSpan` overrides TextEditingController's signature, whose optional
// `style` sits between two required params — the override can't reorder them.
// ignore_for_file: always_put_required_named_parameters_first
import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/typography.dart';

/// A [TextEditingController] that renders `@`-file mentions as inline
/// code-style badges — monospace with a subtle primary tint, like a markdown
/// code span. **Purely visual**: [text] is never altered, so what the composer
/// sends stays plain text (the agent receives the raw `@path`).
class MentionTextController extends TextEditingController {
  /// Creates a [MentionTextController], optionally seeded with [text].
  MentionTextController({super.text});

  /// An `@` token: `@` followed by one or more non-space, non-`@` chars. The
  /// leading word boundary is checked separately (so an email like `a@b` is not
  /// styled).
  static final RegExp _mention = RegExp(r'@[^\s@]+');

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final base = style ?? const TextStyle();
    // While an IME composition is active (CJK, autocomplete), defer to the
    // default rendering so the composing underline isn't lost.
    if (withComposing &&
        value.isComposingRangeValid &&
        !value.composing.isCollapsed) {
      return super.buildTextSpan(
        context: context,
        style: style,
        withComposing: withComposing,
      );
    }

    final colors = Theme.of(context).colorScheme;
    final mentionStyle = base.copyWith(
      fontFamily: UxnanTypography.monoFontFamily,
      color: colors.primary,
      backgroundColor: colors.primary.withValues(alpha: 0.10),
      fontWeight: FontWeight.w500,
    );

    final spans = <InlineSpan>[];
    var last = 0;
    for (final match in _mention.allMatches(text)) {
      final boundaryOk = match.start == 0 || _isSpace(text[match.start - 1]);
      if (!boundaryOk) continue;
      if (match.start > last) {
        spans.add(
          TextSpan(text: text.substring(last, match.start), style: base),
        );
      }
      spans.add(
        TextSpan(
          text: text.substring(match.start, match.end),
          style: mentionStyle,
        ),
      );
      last = match.end;
    }
    if (spans.isEmpty) return TextSpan(text: text, style: base);
    if (last < text.length) {
      spans.add(TextSpan(text: text.substring(last), style: base));
    }
    return TextSpan(style: base, children: spans);
  }

  static bool _isSpace(String ch) => ch.trim().isEmpty;
}
