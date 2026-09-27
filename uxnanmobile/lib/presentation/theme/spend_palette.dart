import 'package:flutter/material.dart';
import 'package:uxnan/domain/value_objects/spend_view.dart';

/// The colours that tell agents apart in a chart: a categorical palette
/// assigned in [kSpendAgentOrder], so a colour belongs to its agent on every
/// screen and period, never to its rank. The same slots the desktop's
/// Providers panel uses; checked for colour-vision-deficiency separation
/// between neighbours, with a light and a dark step each.
///
/// These are chart colours, deliberately apart from `AgentVisuals.colorFor`
/// (brand accents): several brand accents are near-twins that a stacked bar
/// could not tell apart.
class SpendPalette {
  const SpendPalette._();

  static const List<Color> _light = [
    Color(0xFF2A78D6),
    Color(0xFFEB6834),
    Color(0xFF1BAF7A),
    Color(0xFFEDA100),
    Color(0xFFE87BA4),
    Color(0xFF008300),
    Color(0xFF4A3AA7),
  ];

  static const List<Color> _dark = [
    Color(0xFF3987E5),
    Color(0xFFD95926),
    Color(0xFF199E70),
    Color(0xFFC98500),
    Color(0xFFD55181),
    Color(0xFF008300),
    Color(0xFF9085E9),
  ];

  /// [agentId]'s chart colour; an agent outside the palette reads as the
  /// scheme's muted outline.
  static Color colorFor(String agentId, ColorScheme scheme) {
    final slot = kSpendAgentOrder.indexOf(agentId);
    if (slot == -1) return scheme.outline;
    return (scheme.brightness == Brightness.dark ? _dark : _light)[slot];
  }
}
