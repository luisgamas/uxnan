import 'package:flutter/material.dart';

/// Neural Expressive **primary / secondary action button** — the single
/// canonical CTA used across onboarding, manual pairing and the camera
/// permission screen so every primary action looks identical.
///
/// NE's action language is pill-shaped (guide §4.5), so this is a
/// `StadiumBorder` button at the M3 **Medium** size (48 dp height — guide §4.5
/// button hierarchy), rather than each screen rolling its own shape. Two
/// flavors:
///
/// - [NeButton] / [NeButton.icon] → a filled primary CTA.
/// - [NeButton.outlined] → the secondary (e.g. "Back") variant, same shape/size.
class NeButton extends StatelessWidget {
  /// Creates a filled primary [NeButton].
  const NeButton({
    required this.label,
    required this.onPressed,
    this.icon,
    super.key,
  }) : _outlined = false;

  /// Creates a filled primary [NeButton] with a leading [icon].
  const NeButton.icon({
    required this.label,
    required this.onPressed,
    required this.icon,
    super.key,
  }) : _outlined = false;

  /// Creates the secondary (outlined) variant, same pill shape and size.
  const NeButton.outlined({
    required this.label,
    required this.onPressed,
    this.icon,
    super.key,
  }) : _outlined = true;

  /// Button label.
  final String label;

  /// Tap handler; when null the button reads as disabled.
  final VoidCallback? onPressed;

  /// Optional leading glyph.
  final IconData? icon;

  final bool _outlined;

  /// M3 **Medium** button height (guide §4.5 button hierarchy).
  static const double height = 48;

  @override
  Widget build(BuildContext context) {
    const shape = StadiumBorder();
    const padding = EdgeInsets.symmetric(horizontal: 24);
    final iconWidget = icon == null ? null : Icon(icon, size: 20);

    final Widget button;
    if (_outlined) {
      final style = OutlinedButton.styleFrom(
        shape: shape,
        padding: padding,
        minimumSize: const Size(0, height),
      );
      button = iconWidget == null
          ? OutlinedButton(
              onPressed: onPressed,
              style: style,
              child: Text(label),
            )
          : OutlinedButton.icon(
              onPressed: onPressed,
              style: style,
              icon: iconWidget,
              label: Text(label),
            );
    } else {
      final style = FilledButton.styleFrom(
        shape: shape,
        padding: padding,
        minimumSize: const Size(0, height),
      );
      button = iconWidget == null
          ? FilledButton(
              onPressed: onPressed,
              style: style,
              child: Text(label),
            )
          : FilledButton.icon(
              onPressed: onPressed,
              style: style,
              icon: iconWidget,
              label: Text(label),
            );
    }

    return SizedBox(height: height, child: button);
  }
}
