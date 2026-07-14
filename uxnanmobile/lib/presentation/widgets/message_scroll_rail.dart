import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' show lerpDouble;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Which screen edge the rail hugs (and the direction its ticks grow toward the
/// content). [right] is the default for a phone (thumb reach, clear of the
/// left-edge system back gesture).
enum MessageScrollRailEdge {
  /// Rail on the left edge; ticks grow rightward.
  left,

  /// Rail on the right edge; ticks grow leftward.
  right,
}

/// One anchor on the rail — typically one per user message in a chat timeline.
///
/// Pure data: [preview] is the primary line shown in the scrub bubble (e.g. the
/// user's own text) and [secondaryPreview] an optional supporting excerpt (e.g.
/// the assistant's reply for that turn). The rail never reads anything else, so
/// it stays decoupled from any app's message model.
@immutable
class MessageScrollRailItem {
  /// Creates a rail item.
  const MessageScrollRailItem({
    required this.preview,
    this.secondaryPreview,
  });

  /// The primary preview line (bold, single line in the bubble).
  final String preview;

  /// An optional secondary excerpt (muted, up to three lines in the bubble).
  final String? secondaryPreview;
}

/// Optional visual overrides for [MessageScrollRail]. Every field is nullable;
/// a null value falls back to a sensible default derived from the ambient
/// [ThemeData], so the widget looks right with zero configuration yet stays
/// fully themeable without any app-specific dependency.
@immutable
class MessageScrollRailTheme {
  /// Creates a rail theme override.
  const MessageScrollRailTheme({
    this.tickColor,
    this.activeTickColor,
    this.currentTickColor,
    this.previewBackground,
    this.previewForeground,
    this.previewSecondaryForeground,
    this.previewBorder,
    this.restLength,
    this.activeLength,
    this.thickness,
    this.spacing,
    this.edgeInset,
    this.hitWidth,
    this.previewWidth,
  });

  /// Colour of a resting / far tick.
  final Color? tickColor;

  /// Colour of the active (scrubbed) tick and its near neighbours.
  final Color? activeTickColor;

  /// Colour of the "you are here" tick (the anchor currently on screen).
  final Color? currentTickColor;

  /// Preview bubble surface / text / border colours.
  final Color? previewBackground;

  /// Preview bubble primary text colour.
  final Color? previewForeground;

  /// Preview bubble secondary text colour.
  final Color? previewSecondaryForeground;

  /// Preview bubble border colour.
  final Color? previewBorder;

  /// Resting tick length in logical pixels (default 8).
  final double? restLength;

  /// Active tick length in logical pixels (default 24).
  final double? activeLength;

  /// Tick thickness in logical pixels (default 2).
  final double? thickness;

  /// Ideal spacing between ticks before the rail compresses (default 8).
  final double? spacing;

  /// Distance of the ticks from the hugged edge (default 14).
  final double? edgeInset;

  /// Width of the invisible touch strip along the edge (default 32).
  final double? hitWidth;

  /// Maximum width of the preview bubble (default 320).
  final double? previewWidth;
}

/// A minimal, reusable "message minimap" that lives on one edge of a scrollable
/// surface: a vertical strip of short ticks, one per anchor (user message).
///
/// Dragging a finger (or hovering a mouse) along the strip reveals the rail,
/// grows the nearest tick with a dock-style *fisheye* falloff over its two
/// neighbours, and shows a preview bubble of that anchor; releasing commits the
/// selection. The widget is a **pure input control** — it owns no
/// [ScrollController] and knows nothing about messages beyond the [items] you
/// give it. It reports the chosen index through [onSelected]; the host is
/// responsible for actually scrolling its list to that anchor. This keeps the
/// rail trivially portable between apps (its only import is Flutter itself).
///
/// Tuned to the Neural Expressive language: unobtrusive at rest (faint ticks),
/// springing to full presence only on interaction, and auto-hiding shortly
/// after release.
class MessageScrollRail extends StatefulWidget {
  /// Creates a message scroll rail.
  const MessageScrollRail({
    required this.items,
    required this.onSelected,
    this.onActiveChanged,
    this.currentIndex,
    this.edge = MessageScrollRailEdge.right,
    this.theme,
    this.autoHideDelay = const Duration(milliseconds: 1400),
    this.minItems = 2,
    this.haptics = true,
    this.semanticLabel = 'Message scroll rail',
    super.key,
  });

  /// The anchors to represent, in top-to-bottom order.
  final List<MessageScrollRailItem> items;

  /// Called when the user commits a selection (drag release, tap, or keyboard
  /// activation) with the chosen anchor index.
  final ValueChanged<int> onSelected;

  /// Called while scrubbing as the active anchor changes (and with `null` when
  /// the interaction ends). Useful for live host feedback; optional.
  final ValueChanged<int?>? onActiveChanged;

  /// The anchor currently visible in the host's viewport, highlighted as "you
  /// are here". Null disables the highlight.
  final int? currentIndex;

  /// Which edge the rail hugs.
  final MessageScrollRailEdge edge;

  /// Optional visual overrides.
  final MessageScrollRailTheme? theme;

  /// Idle delay after a release before the rail fades back to rest.
  final Duration autoHideDelay;

  /// The rail renders nothing below this many items (a one-anchor map is
  /// pointless). Defaults to 2.
  final int minItems;

  /// Whether to emit a selection-click haptic as the active tick changes.
  final bool haptics;

  /// Accessibility label for the interactive strip.
  final String semanticLabel;

  @override
  State<MessageScrollRail> createState() => _MessageScrollRailState();
}

class _MessageScrollRailState extends State<MessageScrollRail>
    with TickerProviderStateMixin {
  /// Reveal progress: 0 = resting (faint ticks), 1 = fully engaged.
  late final AnimationController _reveal;

  /// The active tick as a continuous position, so the fisheye glides smoothly
  /// between anchors instead of snapping.
  late final AnimationController _glide;
  late Animation<double> _glidePos;

  int? _activeIndex;
  Timer? _hideTimer;

  static const double _fisheyeRadius = 2;

  @override
  void initState() {
    super.initState();
    _reveal = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 240),
      reverseDuration: const Duration(milliseconds: 320),
    );
    _glide = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
    );
    _glidePos = const AlwaysStoppedAnimation<double>(0);
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    _reveal.dispose();
    _glide.dispose();
    super.dispose();
  }

  bool get _reduceMotion =>
      MediaQuery.maybeOf(context)?.disableAnimations ?? false;

  void _revealNow() {
    _hideTimer?.cancel();
    if (_reduceMotion) {
      _reveal.value = 1;
    } else if (_reveal.status != AnimationStatus.forward &&
        _reveal.value != 1) {
      _reveal.forward();
    }
  }

  void _scheduleHide() {
    _hideTimer?.cancel();
    _hideTimer = Timer(widget.autoHideDelay, () {
      if (!mounted) return;
      widget.onActiveChanged?.call(null);
      if (_reduceMotion) {
        _reveal.value = 0;
        setState(() => _activeIndex = null);
      } else {
        _reveal.reverse().whenComplete(() {
          // Only clear if the fade actually finished — a re-engagement (a new
          // touch) interrupts the reverse and its whenComplete still runs, so
          // guard against nulling the anchor the user just picked again.
          if (mounted && _reveal.status == AnimationStatus.dismissed) {
            setState(() => _activeIndex = null);
          }
        });
      }
    });
  }

  /// Maps a local Y within the rail band to the nearest anchor index.
  int _indexForY(double y, double railTop, double railHeight) {
    final count = widget.items.length;
    if (count <= 1 || railHeight <= 0) return 0;
    final progress = ((y - railTop) / railHeight).clamp(0.0, 1.0);
    return (progress * (count - 1)).round().clamp(0, count - 1);
  }

  void _setActive(int index) {
    if (index == _activeIndex) return;
    final from = _glidePos.value;
    _glidePos = Tween<double>(begin: from, end: index.toDouble()).animate(
      CurvedAnimation(parent: _glide, curve: Curves.easeOutCubic),
    );
    if (_reduceMotion) {
      _glide.value = 1;
    } else {
      _glide.forward(from: 0);
    }
    setState(() => _activeIndex = index);
    widget.onActiveChanged?.call(index);
    if (widget.haptics) HapticFeedback.selectionClick();
  }

  void _commit() {
    final index = _activeIndex;
    if (index != null) widget.onSelected(index);
    _scheduleHide();
  }

  /// Builds the scrub preview bubble as a [Positioned] child of the rail stack:
  /// bold primary line + up-to-3-line secondary excerpt, pinned to the active
  /// tick (top/centre/bottom anchored so it never leaves the region at the
  /// ends). Fades in/out with the reveal animation.
  Widget _buildPreview({
    required int index,
    required int count,
    required double railTop,
    required double railHeight,
    required double regionWidth,
    required _ResolvedRailStyle style,
    required bool isRight,
  }) {
    final centerY = count <= 1
        ? railTop + railHeight / 2
        : railTop + (index / (count - 1)) * railHeight;
    final anchorDy = index == 0
        ? 0.0
        : index == count - 1
            ? 1.0
            : 0.5;
    final gap = style.hitWidth + 8;
    final maxWidth = math.max<double>(0, regionWidth - gap - 8);
    final width = math.min(style.previewWidth, maxWidth);

    return Positioned(
      top: centerY,
      left: isRight ? null : gap,
      right: isRight ? gap : null,
      width: width,
      child: IgnorePointer(
        child: FractionalTranslation(
          translation: Offset(0, -anchorDy),
          child: AnimatedBuilder(
            animation: _reveal,
            builder: (context, child) => Opacity(
              opacity: Curves.easeOut.transform(_reveal.value.clamp(0.0, 1.0)),
              child: child,
            ),
            child: _PreviewCard(item: widget.items[index], style: style),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.items.length < widget.minItems) {
      return const SizedBox.shrink();
    }
    final resolved = _ResolvedRailStyle.from(context, widget.theme);
    final isRight = widget.edge == MessageScrollRailEdge.right;

    return LayoutBuilder(
      builder: (context, constraints) {
        final regionHeight = constraints.maxHeight;
        final regionWidth = constraints.maxWidth;
        final count = widget.items.length;
        final natural = math.max<double>(1, (count - 1) * resolved.spacing);
        // Cap so a long conversation compresses instead of overrunning the
        // available band; keep clear of the very top/bottom of the region.
        final maxHeight =
            math.max<double>(0, regionHeight - resolved.thickness);
        final railHeight = math.min(natural, maxHeight);
        final railTop = (regionHeight - railHeight) / 2;

        void handleAt(Offset local) {
          _revealNow();
          _setActive(_indexForY(local.dy, railTop, railHeight));
        }

        return Stack(
          clipBehavior: Clip.none,
          children: [
            // Painted ticks — visual only; interaction is via the strip below.
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: Listenable.merge([_reveal, _glide]),
                  builder: (context, _) => CustomPaint(
                    painter: _RailPainter(
                      count: count,
                      railTop: railTop,
                      railHeight: railHeight,
                      reveal: _reveal.value,
                      activePos: _activeIndex == null ? null : _glidePos.value,
                      currentIndex: widget.currentIndex,
                      style: resolved,
                      isRight: isRight,
                      fisheyeRadius: _fisheyeRadius,
                    ),
                  ),
                ),
              ),
            ),
            // Preview bubble — follows the active tick, non-interactive.
            if (_activeIndex != null)
              _buildPreview(
                index: _activeIndex!,
                count: count,
                railTop: railTop,
                railHeight: railHeight,
                regionWidth: regionWidth,
                style: resolved,
                isRight: isRight,
              ),
            // Invisible touch/hover strip along the edge — the only hit target.
            Positioned(
              top: 0,
              bottom: 0,
              left: isRight ? null : 0,
              right: isRight ? 0 : null,
              width: resolved.hitWidth,
              child: MouseRegion(
                onEnter: (event) => handleAt(event.localPosition),
                onHover: (event) => handleAt(event.localPosition),
                onExit: (_) => _scheduleHide(),
                child: Semantics(
                  label: widget.semanticLabel,
                  slider: true,
                  // Raw pointer tracking (not a GestureDetector): a scrubber
                  // needs every move whether the touch reads as a tap or a
                  // drag, without arena ambiguity. `opaque` also stops the
                  // timeline underneath from scrolling while the edge strip is
                  // in use (the strip is narrow, so normal scrolling is
                  // unaffected everywhere else).
                  child: Listener(
                    behavior: HitTestBehavior.opaque,
                    onPointerDown: (e) => handleAt(e.localPosition),
                    onPointerMove: (e) => handleAt(e.localPosition),
                    onPointerUp: (_) => _commit(),
                    onPointerCancel: (_) => _scheduleHide(),
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// Resolved (non-null) style values used by the painter and bubble.
class _ResolvedRailStyle {
  const _ResolvedRailStyle({
    required this.tickColor,
    required this.activeTickColor,
    required this.currentTickColor,
    required this.previewBackground,
    required this.previewForeground,
    required this.previewSecondaryForeground,
    required this.previewBorder,
    required this.restLength,
    required this.activeLength,
    required this.thickness,
    required this.spacing,
    required this.edgeInset,
    required this.hitWidth,
    required this.previewWidth,
  });

  factory _ResolvedRailStyle.from(
    BuildContext context,
    MessageScrollRailTheme? theme,
  ) {
    final colors = Theme.of(context).colorScheme;
    return _ResolvedRailStyle(
      tickColor: theme?.tickColor ?? colors.onSurfaceVariant,
      activeTickColor: theme?.activeTickColor ?? colors.primary,
      currentTickColor: theme?.currentTickColor ?? colors.onSurface,
      previewBackground:
          theme?.previewBackground ?? colors.surfaceContainerHighest,
      previewForeground: theme?.previewForeground ?? colors.onSurface,
      previewSecondaryForeground:
          theme?.previewSecondaryForeground ?? colors.onSurfaceVariant,
      previewBorder: theme?.previewBorder ?? colors.outlineVariant,
      restLength: theme?.restLength ?? 8,
      activeLength: theme?.activeLength ?? 24,
      thickness: theme?.thickness ?? 2,
      spacing: theme?.spacing ?? 8,
      edgeInset: theme?.edgeInset ?? 14,
      hitWidth: theme?.hitWidth ?? 32,
      previewWidth: theme?.previewWidth ?? 320,
    );
  }

  final Color tickColor;
  final Color activeTickColor;
  final Color currentTickColor;
  final Color previewBackground;
  final Color previewForeground;
  final Color previewSecondaryForeground;
  final Color previewBorder;
  final double restLength;
  final double activeLength;
  final double thickness;
  final double spacing;
  final double edgeInset;
  final double hitWidth;
  final double previewWidth;
}

/// Paints the tick strip with a fisheye falloff around the active anchor.
class _RailPainter extends CustomPainter {
  const _RailPainter({
    required this.count,
    required this.railTop,
    required this.railHeight,
    required this.reveal,
    required this.activePos,
    required this.currentIndex,
    required this.style,
    required this.isRight,
    required this.fisheyeRadius,
  });

  final int count;
  final double railTop;
  final double railHeight;
  final double reveal;
  final double? activePos;
  final int? currentIndex;
  final _ResolvedRailStyle style;
  final bool isRight;
  final double fisheyeRadius;

  // Tick opacity floors/ceilings: faint but present at rest, solid when engaged.
  static const double _restAlpha = 0.14;
  static const double _engagedAlpha = 0.5;
  static const double _activeAlpha = 0.95;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..style = PaintingStyle.fill;
    final radius = Radius.circular(style.thickness / 2);

    for (var i = 0; i < count; i++) {
      final centerY = count == 1
          ? railTop + railHeight / 2
          : railTop + (i / (count - 1)) * railHeight;

      // Fisheye emphasis for this tick (0 far / at rest, 1 dead-centre active).
      var emphasis = 0.0;
      if (activePos != null) {
        final d = (i - activePos!).abs();
        final t = (1 - d / fisheyeRadius).clamp(0.0, 1.0);
        emphasis = Curves.easeOut.transform(t);
      }

      final length =
          lerpDouble(style.restLength, style.activeLength, emphasis * reveal)!;

      // Colour: resting → engaged neutral → active accent, plus a "you are
      // here" tint when this is the on-screen anchor.
      final isCurrent = currentIndex == i;
      final baseColor = isCurrent ? style.currentTickColor : style.tickColor;
      final color = Color.lerp(baseColor, style.activeTickColor, emphasis)!;

      final restAlpha = isCurrent ? _engagedAlpha : _restAlpha;
      final engagedAlpha = isCurrent ? _activeAlpha : _engagedAlpha;
      final baseAlpha = lerpDouble(restAlpha, engagedAlpha, reveal)!;
      final alpha = lerpDouble(baseAlpha, _activeAlpha, emphasis)!;

      paint.color = color.withValues(alpha: alpha);

      final double left;
      final double right;
      if (isRight) {
        right = size.width - style.edgeInset;
        left = right - length;
      } else {
        left = style.edgeInset;
        right = left + length;
      }
      final rect = Rect.fromLTRB(
        left,
        centerY - style.thickness / 2,
        right,
        centerY + style.thickness / 2,
      );
      canvas.drawRRect(RRect.fromRectAndRadius(rect, radius), paint);
    }
  }

  @override
  bool shouldRepaint(_RailPainter old) =>
      old.count != count ||
      old.railTop != railTop ||
      old.railHeight != railHeight ||
      old.reveal != reveal ||
      old.activePos != activePos ||
      old.currentIndex != currentIndex ||
      old.isRight != isRight;
}

/// The scrub preview card: a bold primary line + an up-to-3-line secondary
/// excerpt on a rounded, shadowed surface.
class _PreviewCard extends StatelessWidget {
  const _PreviewCard({required this.item, required this.style});

  final MessageScrollRailItem item;
  final _ResolvedRailStyle style;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: style.previewBackground,
        borderRadius: const BorderRadius.all(Radius.circular(14)),
        border: Border.all(color: style.previewBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item.preview.isEmpty ? ' ' : item.preview,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodyMedium?.copyWith(
              color: style.previewForeground,
              fontWeight: FontWeight.w600,
            ),
          ),
          if ((item.secondaryPreview ?? '').isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              item.secondaryPreview!,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: textTheme.bodySmall?.copyWith(
                color: style.previewSecondaryForeground,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
