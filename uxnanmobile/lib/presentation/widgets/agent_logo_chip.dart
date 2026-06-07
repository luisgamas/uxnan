import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// A coding-agent logo on a soft, dark-surface container that lets the logo's
/// own colors stand out. Monochrome (`currentColor`) logos are tinted to the
/// on-surface color so they remain visible on the dark theme. Pair with the
/// asset paths in `AgentLogos`.
class AgentLogoChip extends StatelessWidget {
  /// Creates an [AgentLogoChip] for the SVG at [asset].
  const AgentLogoChip({required this.asset, this.size = 56, super.key});

  /// The SVG asset path (see `AgentLogos`).
  final String asset;

  /// The outer side length of the chip.
  final double size;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;

    return Container(
      width: size,
      height: size,
      padding: EdgeInsets.all(size * 0.22),
      decoration: BoxDecoration(
        color: colors.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(UxnanRadius.lg),
        border: Border.all(color: colors.outline),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.25),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: SvgPicture.asset(
        asset,
        theme: SvgTheme(currentColor: colors.onSurface),
      ),
    );
  }
}
