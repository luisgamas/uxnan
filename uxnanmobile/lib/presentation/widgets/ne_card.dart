import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/widgets/expressive_card.dart';

/// The Neural Expressive **discrete card** primitive: one standalone,
/// fully-rounded surface for list/content cards (devices, threads, commits, …).
///
/// It centralizes the app's card look so every surface stays consistent and
/// low-noise (guide §2.2 / §2.4): a calm `surfaceContainer` tone (NOT
/// `surfaceContainerHighest`, which the guide reserves for inputs/active chips)
/// and a 16 dp "main card" radius. Interactive cards inherit the M3E
/// `spatialFast` press feedback from [ExpressiveCard] (which this wraps in the
/// `single` position).
///
/// Use [ExpressiveCardGroup] instead when rows should read as one fused group
/// (settings-style lists); use [NeCard] for independent cards that benefit from
/// clear separation.
class NeCard extends StatelessWidget {
  /// Creates an [NeCard].
  const NeCard({
    required this.child,
    this.onTap,
    this.onLongPress,
    this.color,
    this.radius = 16,
    this.padding = const EdgeInsets.all(UxnanSpacing.md),
    super.key,
  });

  /// The card body.
  final Widget child;

  /// Tap handler (the card animates a press when interactive).
  final VoidCallback? onTap;

  /// Long-press handler (e.g. a context menu).
  final VoidCallback? onLongPress;

  /// Background tone; defaults to `surfaceContainer`.
  final Color? color;

  /// Corner radius (defaults to the 16 dp NE main-card radius).
  final double radius;

  /// Inner padding around [child].
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return ExpressiveCard(
      onTap: onTap,
      onLongPress: onLongPress,
      color: color ?? Theme.of(context).colorScheme.surfaceContainer,
      outerRadius: radius,
      padding: padding,
      child: child,
    );
  }
}
