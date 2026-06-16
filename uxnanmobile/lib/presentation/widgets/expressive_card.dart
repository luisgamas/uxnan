import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';

/// Position of a card within a [ExpressiveCardGroup].
enum CardGroupPosition {
  /// The only card in the group (all corners fully rounded).
  single,

  /// The first card (rounded top, tight bottom).
  first,

  /// A middle card (all corners tight).
  middle,

  /// The last card (tight top, rounded bottom).
  last,
}

/// Neural Expressive **dynamic-corner card** (guide §2.2 / §4.6): a tappable
/// surface whose corner radii adapt to its position in a group, so a tight
/// 3 dp gap + a 24/4 radius split reads the stack as one cohesive object.
/// Press feedback uses the M3E `spatialFast` spring (scale 1.0 → 0.98).
class ExpressiveCard extends StatefulWidget {
  /// Creates an [ExpressiveCard].
  const ExpressiveCard({
    required this.child,
    this.position = CardGroupPosition.single,
    this.onTap,
    this.onLongPress,
    this.color,
    this.outerRadius = 24,
    this.innerRadius = 4,
    this.padding = const EdgeInsets.all(16),
    super.key,
  });

  /// The card body.
  final Widget child;

  /// Position in the group, driving the corner radii.
  final CardGroupPosition position;

  /// Tap handler (the card animates a press regardless).
  final VoidCallback? onTap;

  /// Long-press handler (e.g. a context menu).
  final VoidCallback? onLongPress;

  /// Background color; defaults to `surfaceContainerHigh`.
  final Color? color;

  /// Radius of the corners on the outer edge of the group.
  final double outerRadius;

  /// Radius of the corners adjacent to a neighbour in the group.
  final double innerRadius;

  /// Inner padding around [child].
  final EdgeInsetsGeometry padding;

  @override
  State<ExpressiveCard> createState() => _ExpressiveCardState();
}

class _ExpressiveCardState extends State<ExpressiveCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _scale =
      AnimationController.unbounded(vsync: this, value: 1);

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  void _press() => _scale.animateWithSpring(0.98, M3ESprings.spatialFast);
  void _release() => _scale.animateWithSpring(1, M3ESprings.spatialFast);

  BorderRadius get _radius {
    final o = Radius.circular(widget.outerRadius);
    final i = Radius.circular(widget.innerRadius);
    return switch (widget.position) {
      CardGroupPosition.single => BorderRadius.all(o),
      CardGroupPosition.first => BorderRadius.only(
          topLeft: o,
          topRight: o,
          bottomLeft: i,
          bottomRight: i,
        ),
      CardGroupPosition.middle => BorderRadius.all(i),
      CardGroupPosition.last => BorderRadius.only(
          topLeft: i,
          topRight: i,
          bottomLeft: o,
          bottomRight: o,
        ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final radius = _radius;
    final interactive = widget.onTap != null || widget.onLongPress != null;

    return GestureDetector(
      onTapDown: interactive ? (_) => _press() : null,
      onTapUp: interactive ? (_) => _release() : null,
      onTapCancel: interactive ? _release : null,
      child: ScaleTransition(
        scale: _scale,
        child: Material(
          color: widget.color ?? colors.surfaceContainerHigh,
          borderRadius: radius,
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onTap,
            onLongPress: widget.onLongPress,
            child: Padding(padding: widget.padding, child: widget.child),
          ),
        ),
      ),
    );
  }
}

/// Lays out [count] [ExpressiveCard]s with a tight 3 dp gap, passing each its
/// [CardGroupPosition] so the corner radii communicate the group's cohesion.
class ExpressiveCardGroup extends StatelessWidget {
  /// Creates an [ExpressiveCardGroup].
  const ExpressiveCardGroup({
    required this.count,
    required this.itemBuilder,
    this.gap = 3,
    super.key,
  });

  /// Number of cards in the group.
  final int count;

  /// Builds the card for `index` given its computed [CardGroupPosition].
  final Widget Function(BuildContext context, int index, CardGroupPosition pos)
      itemBuilder;

  /// Gap between cards (3 dp per the spec — small, to read as one group).
  final double gap;

  CardGroupPosition _positionFor(int index) {
    if (count == 1) return CardGroupPosition.single;
    if (index == 0) return CardGroupPosition.first;
    if (index == count - 1) return CardGroupPosition.last;
    return CardGroupPosition.middle;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < count; i++) ...[
          if (i > 0) SizedBox(height: gap),
          itemBuilder(context, i, _positionFor(i)),
        ],
      ],
    );
  }
}
