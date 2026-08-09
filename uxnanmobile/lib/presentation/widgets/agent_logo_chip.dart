import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// A coding-agent logo on a soft container that lets the mark's own colours
/// stand out, for the surfaces that treat an agent as an OBJECT you pick or
/// admire — the onboarding hero, the agent picker.
///
/// Deliberately flat: no border, no shadow. Framing the mark made it the thing
/// you noticed instead of the logo, and a bordered, shadowed tile sitting
/// inside a card read as the card itself having a shadow. In a dense row, use
/// `AgentLogo`, which draws the mark bare.
///
/// Monochrome (`currentColor`) marks are tinted to the on-surface colour so
/// they stay visible in both themes. Pair with the asset paths in `AgentLogos`.
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
      ),
      child: SvgPicture.asset(
        asset,
        theme: SvgTheme(currentColor: colors.onSurface),
      ),
    );
  }
}
