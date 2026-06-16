import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Neural Expressive top bar (guide §4.1–4.2): a 56 dp **transparent** chrome
/// layer with a vertical *scroll veil* (surface → transparent) so content
/// scrolling underneath stays legible without a solid app bar cutting it off.
///
/// Designed to be overlaid at the top of a [Stack] above a scroll view whose
/// content is top-padded by [preferredHeight]. Structure is asymmetric:
/// [leading] + [title] on the left, [actions] on the right.
class NeTopBar extends StatelessWidget {
  /// Creates a [NeTopBar].
  const NeTopBar({
    this.leading,
    this.title,
    this.actions = const [],
    super.key,
  });

  /// Leading widget (typically a back `IconSurface`).
  final Widget? leading;

  /// Title area (e.g. a model-picker pill); expands to fill available width.
  final Widget? title;

  /// Trailing actions (typically `IconSurface`s and an overflow menu).
  final List<Widget> actions;

  /// Toolbar row height (excludes the status-bar inset).
  static const double toolbarHeight = 56;

  /// Total vertical space the bar occupies for [context], including the
  /// status-bar inset. Use to top-pad the scroll content behind it.
  static double preferredHeight(BuildContext context) =>
      MediaQuery.paddingOf(context).top + toolbarHeight + UxnanSpacing.sm;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final topInset = MediaQuery.paddingOf(context).top;

    return Container(
      padding: EdgeInsets.only(top: topInset),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            colors.surface,
            colors.surface.withValues(alpha: 0.85),
            colors.surface.withValues(alpha: 0),
          ],
          stops: const [0, 0.6, 1],
        ),
      ),
      child: SizedBox(
        height: toolbarHeight,
        child: Row(
          children: [
            const SizedBox(width: UxnanSpacing.xs),
            if (leading != null) leading!,
            const SizedBox(width: UxnanSpacing.xs),
            Expanded(child: title ?? const SizedBox.shrink()),
            ...actions,
            const SizedBox(width: UxnanSpacing.xs),
          ],
        ),
      ),
    );
  }
}
