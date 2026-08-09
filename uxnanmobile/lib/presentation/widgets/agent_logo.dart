import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:uxnan/domain/enums/agent_id.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/agent_visuals.dart';
import 'package:uxnan/presentation/widgets/ux_icon.dart';

/// An agent's mark, drawn bare — no container, no border, no shadow.
///
/// The counterpart to `AgentLogoChip`, which frames the mark for the surfaces
/// that treat it as an object (the onboarding hero, the agent picker). In a
/// dense row the frame is what you notice instead of the logo, and stacking a
/// bordered, shadowed tile inside an already-elevated card reads as a bug. This
/// is what `uxnandesktop` draws in its agent rows, at the same small size.
///
/// A monochrome mark (one that paints in `currentColor`) is tinted to
/// [color] — or the ambient icon colour — so it stays legible in both themes;
/// a full-colour mark keeps its own palette. An agent with no mark of its own
/// falls back to the app's generic agent glyph.
class AgentLogo extends StatelessWidget {
  /// Creates an [AgentLogo] for [agent].
  const AgentLogo({required this.agent, this.size = 18, this.color, super.key});

  /// The agent whose mark to draw.
  final AgentId agent;

  /// Side length of the mark.
  final double size;

  /// Tint applied to monochrome marks; defaults to the ambient icon colour.
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tint = color ?? IconTheme.of(context).color ?? colorSchemeOf(context);
    final asset = AgentVisuals.logoFor(agent);
    if (asset == null) {
      return UxIcon(UxIcons.smartToy, size: size, color: tint);
    }
    return SizedBox.square(
      dimension: size,
      child: SvgPicture.asset(asset, theme: SvgTheme(currentColor: tint)),
    );
  }
}

/// The on-surface colour, as the last fallback for a monochrome mark.
Color colorSchemeOf(BuildContext context) =>
    Theme.of(context).colorScheme.onSurface;
