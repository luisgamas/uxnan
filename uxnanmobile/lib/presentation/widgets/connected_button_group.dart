import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/motion.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// Neural Expressive **Connected Button Group** (guide §4.5): the official
/// M3E replacement for segmented buttons. A horizontal strip of buttons
/// physically fused into one container — outer corners fully rounded
/// (StadiumBorder on the edges), inner corners tight (4 dp) — so the group
/// reads as a single control. Press feedback uses the M3E `spatialFast`
/// spring for the **neighbour-squish** effect: the adjacent buttons
/// compress slightly along the collision axis when one is pressed.
///
/// Capped at 5 options per spec to avoid overflow on Compact (phone) widths.
class ConnectedButtonGroup<T> extends StatefulWidget {
  /// Creates a [ConnectedButtonGroup].
  const ConnectedButtonGroup({
    required this.values,
    required this.selected,
    required this.onChanged,
    required this.labelBuilder,
    this.height = 40,
    super.key,
  }) : assert(
          values.length >= 2 && values.length <= 5,
          'ConnectedButtonGroup requires 2-5 options',
        );

  /// The available options, in display order.
  final List<T> values;

  /// The currently selected option.
  final T selected;

  /// Called when the user taps a different option.
  final ValueChanged<T> onChanged;

  /// Builds the visible label + optional leading icon for each option.
  // ignore: avoid_positional_boolean_parameters
  final Widget Function(T value, bool selected) labelBuilder;

  /// Height of the strip in logical pixels.
  final double height;

  @override
  State<ConnectedButtonGroup<T>> createState() =>
      _ConnectedButtonGroupState<T>();
}

class _ConnectedButtonGroupState<T> extends State<ConnectedButtonGroup<T>> {
  /// Index being pressed (for the neighbour-squish effect).
  int? _pressedIndex;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final n = widget.values.length;
    return SizedBox(
      height: widget.height,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(widget.height / 2),
        ),
        child: Row(
          children: [
            for (var i = 0; i < n; i++)
              Expanded(
                child: _ConnectedButton<T>(
                  value: widget.values[i],
                  isFirst: i == 0,
                  isLast: i == n - 1,
                  isSelected: widget.values[i] == widget.selected,
                  squished: _pressedIndex != null &&
                      (_pressedIndex == i - 1 || _pressedIndex == i + 1),
                  label: widget.labelBuilder(
                    widget.values[i],
                    widget.values[i] == widget.selected,
                  ),
                  onTap: () => widget.onChanged(widget.values[i]),
                  onPressStart: () => setState(() => _pressedIndex = i),
                  onPressEnd: () => setState(() => _pressedIndex = null),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _ConnectedButton<T> extends StatefulWidget {
  const _ConnectedButton({
    required this.value,
    required this.isFirst,
    required this.isLast,
    required this.isSelected,
    required this.squished,
    required this.label,
    required this.onTap,
    required this.onPressStart,
    required this.onPressEnd,
  });

  final T value;
  final bool isFirst;
  final bool isLast;
  final bool isSelected;
  final bool squished;
  final Widget label;
  final VoidCallback onTap;
  final VoidCallback onPressStart;
  final VoidCallback onPressEnd;

  @override
  State<_ConnectedButton<T>> createState() => _ConnectedButtonState<T>();
}

class _ConnectedButtonState<T> extends State<_ConnectedButton<T>>
    with SingleTickerProviderStateMixin {
  late final AnimationController _scale =
      AnimationController.unbounded(vsync: this, value: 1);

  @override
  void didUpdateWidget(covariant _ConnectedButton<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Neighbour-squish: when an adjacent button is pressed, compress this
    // one horizontally. Magnitude (3%) is small — the goal is to communicate
    // physical contact, not to distort the layout.
    final target = widget.squished ? 0.97 : 1.0;
    _scale.animateWithSpring(target, M3ESprings.spatialFast);
  }

  @override
  void dispose() {
    _scale.dispose();
    super.dispose();
  }

  BorderRadius get _radius {
    // Stadium on the outer edges; tight 4 dp on the inner edges so adjacent
    // buttons fuse visually.
    final outer = Radius.circular(widget.isSelected ? 999 : 20);
    const inner = Radius.circular(UxnanSpacing.xs);
    if (widget.isFirst && widget.isLast) {
      return BorderRadius.all(outer);
    }
    if (widget.isFirst) {
      return BorderRadius.only(topLeft: outer, bottomLeft: outer)
          .copyWith(topRight: inner, bottomRight: inner);
    }
    if (widget.isLast) {
      return BorderRadius.only(topRight: outer, bottomRight: outer)
          .copyWith(topLeft: inner, bottomLeft: inner);
    }
    return const BorderRadius.all(inner);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => widget.onPressStart(),
      onTapUp: (_) => widget.onPressEnd(),
      onTapCancel: widget.onPressEnd,
      onTap: widget.onTap,
      child: ScaleTransition(
        scale: _scale,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          decoration: BoxDecoration(
            color: widget.isSelected
                ? colors.secondaryContainer
                : Colors.transparent,
            borderRadius: _radius,
          ),
          alignment: Alignment.center,
          child: IconTheme.merge(
            data: IconThemeData(
              color: widget.isSelected
                  ? colors.onSecondaryContainer
                  : colors.onSurfaceVariant,
              size: 18,
            ),
            child: DefaultTextStyle.merge(
              style: TextStyle(
                color: widget.isSelected
                    ? colors.onSecondaryContainer
                    : colors.onSurfaceVariant,
                fontWeight:
                    widget.isSelected ? FontWeight.w600 : FontWeight.w500,
                fontFamily: textTheme.labelMedium?.fontFamily,
                fontSize: textTheme.labelMedium?.fontSize,
              ),
              child: widget.label,
            ),
          ),
        ),
      ),
    );
  }
}
