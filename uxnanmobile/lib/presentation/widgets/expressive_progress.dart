import 'package:flutter/material.dart';
import 'package:material_loading_indicator/loading_indicator.dart';

/// Uxnan's shared Material 3 Expressive shape-morphing loading indicator.
///
/// The underlying [LoadingIndicator] follows the AndroidX Material 3 geometry:
/// it morphs between normalized rounded polygons by matching their cubic
/// features, while rotating and briefly expanding each shape. This wrapper
/// preserves Uxnan's compact, token-friendly [size]/[color] API at every call
/// site and scales the component's canonical 48 dp canvas without changing its
/// internal proportions.
///
/// Motion is frozen on the first expressive shape when the platform requests
/// reduced motion. The indicator remains visible and semantic without running
/// a decorative animation.
class PolygonLoader extends StatelessWidget {
  /// Creates a shared M3 Expressive loading indicator.
  const PolygonLoader({
    this.size = 18,
    this.color,
    this.semanticsLabel,
    super.key,
  });

  /// Width and height of the rendered indicator.
  final double size;

  /// Active shape color; defaults to the ambient [ColorScheme.primary].
  final Color? color;

  /// Optional purpose announced by accessibility services.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final reducedMotion = MediaQuery.maybeDisableAnimationsOf(context) ?? false;

    return RepaintBoundary(
      child: SizedBox.square(
        dimension: size,
        child: FittedBox(
          child: TickerMode(
            enabled: !reducedMotion,
            child: LoadingIndicator(
              activeIndicatorColor: color ?? colors.primary,
              semanticsLabel: semanticsLabel,
            ),
          ),
        ),
      ),
    );
  }
}
