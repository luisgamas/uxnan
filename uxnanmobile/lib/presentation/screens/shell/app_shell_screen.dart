import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';

/// Lays a side [pane] beside a [detail] surface once the window is wide enough
/// to hold both, and collapses to [detail] alone when it is not.
///
/// This is the app's one adaptive container, used at two different levels:
///
/// 1. **The shell** — [pane] is the permanent navigation drawer (device,
///    spaces, profile) and [detail] is the content surface.
/// 2. **Nested splits inside the content** — file tree + viewer, commit list +
///    detail, settings sections + section.
///
/// Because of (2) the breakpoint is resolved from this widget's **own
/// constraints**, never from `MediaQuery`: with a 320 dp drawer already taken
/// out of a 1280 dp window, the content has ~955 dp, and that — not 1280 — is
/// what decides whether a second column fits.
///
/// The pane is *permanent*: it appears without an opening animation and cannot
/// be dismissed, per the Neural Expressive drawer rules for expanded windows
/// (`docs/neural-expressive-design.md` §4.4). Below expanded there is no pane
/// and no gesture to reveal one — those windows navigate with a screen stack.
class TwoPaneScaffold extends StatelessWidget {
  /// Creates a [TwoPaneScaffold].
  const TwoPaneScaffold({
    required this.detail,
    this.pane,
    this.paneWidth,
    super.key,
  });

  /// The primary surface. Rendered alone when there is no room for [pane].
  final Widget detail;

  /// The side surface, shown only on windows that fit a permanent pane. A null
  /// pane means this widget is a pass-through for [detail].
  final Widget? pane;

  /// Overrides the breakpoint's own [UxnanBreakpoint.sidePaneWidth] — for a
  /// nested split whose left column wants a different measure than the shell's
  /// drawer.
  final double? paneWidth;

  @override
  Widget build(BuildContext context) {
    final pane = this.pane;
    if (pane == null) return detail;

    return LayoutBuilder(
      builder: (context, constraints) {
        final breakpoint = UxnanBreakpoint.fromWidth(constraints.maxWidth);
        if (!breakpoint.usesPermanentPane) return detail;

        return Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: paneWidth ?? breakpoint.sidePaneWidth,
              child: pane,
            ),
            // M3's own divider tone (`outlineVariant`) — a hairline seam, not
            // a rule: the two surfaces already differ in content, and a heavy
            // border would read as two apps side by side.
            const VerticalDivider(width: 1, thickness: 1),
            Expanded(child: detail),
          ],
        );
      },
    );
  }
}
