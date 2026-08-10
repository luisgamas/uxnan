import 'package:flutter/widgets.dart';
import 'package:uxnan/presentation/theme/spacing.dart';

/// The five Material 3 Expressive window classes, with the layout values the
/// Neural Expressive guide assigns to each one
/// (`docs/neural-expressive-design.md` §3 — *Responsive Breakpoints and Window
/// Classes*).
///
/// This enum is the **single** source for "how wide is the window, and what
/// does that mean". No widget may compare raw widths itself: a stray
/// `width < 600` is exactly how two screens end up disagreeing about what a
/// tablet is.
///
/// Two deliberate divergences from the guide's tables, agreed for this app:
///
/// 1. **No bottom navigation bar on compact and no navigation rail on medium.**
///    The guide prescribes both; uxnan navigates compact windows with a plain
///    screen stack and only introduces a side pane once it is *permanent*
///    ([usesPermanentPane]). There are no 3–5 top-level destinations to put in
///    a bar or a rail.
/// 2. **[maxContentWidth] is a layout clamp, not the reading measure.** The
///    conversation column keeps [UxnanSpacing.maxContentWidth] (760 dp), which
///    is a typographic line length; these values govern single-pane screens
///    (lists, settings, profile) that simply must not stretch edge to edge.
enum UxnanBreakpoint {
  /// < 600 dp — phones in portrait. One pane, full width.
  compact(
    minWidth: 0,
    contentMargin: UxnanSpacing.lg,
    maxContentWidth: double.infinity,
    sidePaneWidth: 0,
  ),

  /// 600–839 dp — portrait tablets, closed foldables. Still one pane: a
  /// 320 dp pane here would leave the detail under 300 dp, which reads worse
  /// than the stack it replaced.
  medium(
    minWidth: 600,
    contentMargin: UxnanSpacing.xl,
    maxContentWidth: double.infinity,
    sidePaneWidth: 0,
  ),

  /// 840–1199 dp — landscape tablets, open foldables. The permanent side pane
  /// starts here.
  expanded(
    minWidth: 840,
    contentMargin: UxnanSpacing.xl,
    maxContentWidth: 840,
    sidePaneWidth: UxnanSize.sidePane,
  ),

  /// 1200–1599 dp — laptops, small monitors.
  large(
    minWidth: 1200,
    contentMargin: UxnanSpacing.xxl,
    maxContentWidth: 1040,
    sidePaneWidth: UxnanSize.sidePane,
  ),

  /// ≥ 1600 dp — large monitors. The pane is allowed to grow.
  extraLarge(
    minWidth: 1600,
    contentMargin: UxnanSpacing.xxl,
    maxContentWidth: 1200,
    sidePaneWidth: UxnanSize.sidePaneWide,
  );

  const UxnanBreakpoint({
    required this.minWidth,
    required this.contentMargin,
    required this.maxContentWidth,
    required this.sidePaneWidth,
  });

  /// Smallest window width (dp) that resolves to this class.
  final double minWidth;

  /// Lateral margin a single-pane screen leaves against the window edge.
  final double contentMargin;

  /// Width past which single-pane content stops growing and the surplus
  /// becomes margin. [double.infinity] below [expanded], where the window is
  /// never wide enough for stretching to hurt.
  final double maxContentWidth;

  /// Width of the permanent side pane, or 0 where there is none.
  final double sidePaneWidth;

  /// The class [width] (in logical pixels) falls into.
  static UxnanBreakpoint fromWidth(double width) {
    if (width >= extraLarge.minWidth) return extraLarge;
    if (width >= large.minWidth) return large;
    if (width >= expanded.minWidth) return expanded;
    if (width >= medium.minWidth) return medium;
    return compact;
  }

  /// The class of the whole **window**.
  ///
  /// Correct for a screen that owns the window. A widget rendered inside a
  /// pane must use [fromWidth] with its own `constraints.maxWidth` instead —
  /// with a 320 dp pane taken out, the window's class says nothing about the
  /// space that widget actually has.
  static UxnanBreakpoint of(BuildContext context) =>
      fromWidth(MediaQuery.sizeOf(context).width);

  /// Whether this is the phone-sized class.
  bool get isCompact => this == UxnanBreakpoint.compact;

  /// Whether the window is at least [medium].
  bool get isAtLeastMedium => index >= UxnanBreakpoint.medium.index;

  /// Whether the window is at least [expanded].
  bool get isAtLeastExpanded => index >= UxnanBreakpoint.expanded.index;

  /// Whether a permanent (pinned, non-animated) side pane fits — the Neural
  /// Expressive rule for a standard drawer that pushes nothing and never
  /// opens: it is simply there (§4.4).
  bool get usesPermanentPane => isAtLeastExpanded;

  /// Horizontal inset that centers content of at most [maxContentWidth] inside
  /// a window (or pane) of [width], turning the surplus into margin.
  ///
  /// Returns 0 below [expanded], so adding this to an existing screen changes
  /// nothing on a phone — the screen's own padding still governs there.
  double horizontalInsetFor(double width) {
    if (!maxContentWidth.isFinite) return 0;
    final inset = (width - maxContentWidth) / 2;
    return inset > 0 ? inset : 0;
  }
}
