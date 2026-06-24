import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Neural Expressive **surface card**: a rounded `surfaceContainerHigh` panel
/// with optional thin outline, used for the git change cards and the commit
/// detail's per-file cards. Clips its child so nested content (e.g. a diff
/// body) follows the rounded corners.
class NeSurface extends StatelessWidget {
  /// Creates a [NeSurface].
  const NeSurface({
    required this.child,
    this.outlined = false,
    this.padding = const EdgeInsets.all(UxnanSpacing.md),
    super.key,
  });

  /// The widget this surface wraps.
  final Widget child;

  /// Whether to draw a thin `outlineVariant` border (use when the card sits
  /// on a background that matches `surfaceContainerHigh`).
  final bool outlined;

  /// Padding applied to [child].
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surfaceContainerHigh,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: outlined
            ? BorderSide(color: colors.outlineVariant)
            : BorderSide.none,
      ),
      clipBehavior: Clip.antiAlias,
      child: Padding(padding: padding, child: child),
    );
  }
}
