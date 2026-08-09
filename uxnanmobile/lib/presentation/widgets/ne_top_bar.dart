import 'package:flutter/material.dart';
import 'package:uxnan/presentation/theme/breakpoints.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/theme/spacing.dart';
import 'package:uxnan/presentation/theme/typography.dart';
import 'package:uxnan/presentation/widgets/icon_surface.dart';
import 'package:uxnan/presentation/widgets/ne_entrance_scope.dart';
import 'package:uxnan/presentation/widgets/ne_scroll_aware_fab.dart';

/// Neural Expressive top bar (guide §4.1–4.2): a 56 dp **transparent** chrome
/// layer with a vertical *scroll veil* (surface → transparent) so content
/// scrolling underneath stays legible without a solid app bar cutting it off.
///
/// Designed to be overlaid at the top of a [Stack] above a scroll view whose
/// content is top-padded by [preferredHeight]. Structure is asymmetric:
/// [leading] + [title] on the left, [actions] on the right.
class NeTopBar extends StatelessWidget {
  /// Creates a [NeTopBar].
  const NeTopBar({
    this.leading,
    this.title,
    this.actions = const [],
    super.key,
  });

  /// Leading widget (typically a back `IconSurface`).
  final Widget? leading;

  /// Title area (e.g. a model-picker pill); expands to fill available width.
  final Widget? title;

  /// Trailing actions (typically `IconSurface`s and an overflow menu).
  final List<Widget> actions;

  /// Toolbar row height (excludes the status-bar inset).
  static const double toolbarHeight = 56;

  /// Total vertical space the bar occupies for [context], including the
  /// status-bar inset. Use to top-pad the scroll content behind it.
  static double preferredHeight(BuildContext context) =>
      MediaQuery.paddingOf(context).top + toolbarHeight + UxnanSpacing.sm;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final topInset = MediaQuery.paddingOf(context).top;

    return Container(
      padding: EdgeInsets.only(top: topInset),
      decoration: BoxDecoration(
        // A scroll veil: a vertical surface gradient so the content
        // underneath reads through the bar instead of looking like a solid
        // app-bar band. The top is strong enough to give the back / actions
        // a confident, legible background (peaks at 0.92 alpha — noticeably
        // more present than a faint veil, but never a fully solid band); the
        // bottom dissolves into the surface so scrolling content shows
        // through the lower edge.
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            colors.surface.withValues(alpha: 0.92),
            colors.surface.withValues(alpha: 0.62),
            colors.surface.withValues(alpha: 0),
          ],
          stops: const [0, 0.55, 1],
        ),
      ),
      child: SizedBox(
        height: toolbarHeight,
        child: Row(
          children: [
            const SizedBox(width: UxnanSpacing.xs),
            if (leading != null) leading!,
            const SizedBox(width: UxnanSpacing.xs),
            Expanded(child: title ?? const SizedBox.shrink()),
            ...actions,
            const SizedBox(width: UxnanSpacing.xs),
          ],
        ),
      ),
    );
  }
}

/// A bottom "scroll veil" that backs a **floating composer** (the conversation
/// composer pill, the git commit bar): a vertical surface gradient — fully
/// transparent at the top, fading to the solid surface at the bottom — that
/// mirrors the [NeTopBar]'s top veil. Overlay it at the bottom of the screen
/// over a full-height scroll view (padded by its measured height) so the
/// timeline scrolls *under* the translucent upper edge and the composer reads
/// as a floating pill instead of a solid app-bar-style band.
class NeComposerVeil extends StatelessWidget {
  /// Creates a [NeComposerVeil] wrapping the floating chrome [child].
  const NeComposerVeil({required this.child, super.key});

  /// The floating chrome (banners + composer pill) painted over the veil.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            colors.surface.withValues(alpha: 0),
            colors.surface.withValues(alpha: 0.7),
            colors.surface,
          ],
          stops: const [0, 0.45, 1],
        ),
      ),
      child: child,
    );
  }
}

/// A [Scaffold] whose [slivers] scroll **under** an overlaid [NeTopBar], with a
/// top spacer so the first content clears the bar. The standard chrome for
/// list/detail screens, matching the conversation's transparent-bar treatment.
/// A back [IconSurface] is added automatically on pushed routes.
class NeScaffold extends StatefulWidget {
  /// Creates a [NeScaffold].
  const NeScaffold({
    required this.slivers,
    this.title,
    this.titleWidget,
    this.leading,
    this.actions = const [],
    this.floatingActionButton,
    this.floatingActionButtonLocation,
    this.hideFabOnScroll = false,
    this.scrollController,
    this.onRefresh,
    this.automaticBackButton = true,
    this.constrainContent = true,
    super.key,
  });

  /// Content slivers (a top spacer is prepended).
  final List<Widget> slivers;

  /// Optional bar title, rendered as a single truncated line.
  final String? title;

  /// A title built by the caller, for a bar that carries something other than
  /// text (the overview's brand mark). Wins over [title] when both are given.
  final Widget? titleWidget;

  /// Leading widget; defaults to a back [IconSurface] on pushed routes.
  final Widget? leading;

  /// Trailing bar actions.
  final List<Widget> actions;

  /// Optional FAB.
  final Widget? floatingActionButton;

  /// Where the [floatingActionButton] sits; defaults to the Scaffold's
  /// end-float (bottom-right). Use [FloatingActionButtonLocation.centerFloat]
  /// for bottom-centered floating scroll shortcuts.
  final FloatingActionButtonLocation? floatingActionButtonLocation;

  /// Whether the [floatingActionButton] hides while the content is scrolling
  /// and returns when it settles (see [NeScrollAwareFab]).
  ///
  /// **Opt-in, not the default.** A FAB that is an *action* on the list should
  /// take this; one that is a *scroll affordance* — the conversation history's
  /// back-to-top — must not, since it exists precisely for the moment this
  /// would hide it.
  final bool hideFabOnScroll;

  /// Optional scroll controller for the content.
  final ScrollController? scrollController;

  /// When set, wraps the content in a [RefreshIndicator].
  final Future<void> Function()? onRefresh;

  /// Whether to auto-add a back button when the route can pop.
  final bool automaticBackButton;

  /// Whether [slivers] stop growing at the window class's
  /// [UxnanBreakpoint.maxContentWidth], the surplus becoming lateral margin.
  ///
  /// On by default, and a **no-op below expanded**: the inset is 0 there, so a
  /// phone renders byte-for-byte what it rendered before. Turn it off for a
  /// screen that already centers itself, or one whose content is meant to span
  /// the full width (a media surface).
  ///
  /// The [NeTopBar] is deliberately left out: chrome spans the whole row even
  /// when the content under it does not, exactly as the conversation's bar
  /// already does.
  final bool constrainContent;

  @override
  State<NeScaffold> createState() => _NeScaffoldState();
}

class _NeScaffoldState extends State<NeScaffold> {
  bool _scrolling = false;

  /// Only the scroll view this scaffold owns may hide the button. A sheet or a
  /// menu opened from the screen scrolls inside its own overlay, and its
  /// notifications bubble through here on their way up — reacting to those
  /// would blink the FAB every time a menu moved.
  bool _isOwnScroll(ScrollNotification n) => n.depth == 0;

  bool _onScroll(ScrollNotification notification) {
    if (!widget.hideFabOnScroll || !_isOwnScroll(notification)) return false;
    final scrolling = switch (notification) {
      ScrollStartNotification() => true,
      ScrollEndNotification() => false,
      _ => _scrolling,
    };
    if (scrolling != _scrolling) setState(() => _scrolling = scrolling);
    return false;
  }

  @override
  Widget build(BuildContext context) {
    final canPop = ModalRoute.of(context)?.canPop ?? false;
    final lead = widget.leading ??
        (widget.automaticBackButton && canPop
            ? IconSurface(
                icon: UxIcons.arrowBack,
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
              )
            : null);

    // The width is read from THIS widget's constraints, not from MediaQuery:
    // inside a pane the window size says nothing about the space available
    // here (see [TwoPaneScaffold]).
    Widget scroll = LayoutBuilder(
      builder: (context, constraints) {
        final inset = widget.constrainContent
            ? UxnanBreakpoint.fromWidth(constraints.maxWidth)
                .horizontalInsetFor(constraints.maxWidth)
            : 0.0;
        final padding = EdgeInsets.symmetric(horizontal: inset);
        return CustomScrollView(
          controller: widget.scrollController,
          physics: const BouncingScrollPhysics(
            parent: AlwaysScrollableScrollPhysics(),
          ),
          slivers: [
            SliverToBoxAdapter(
              child: SizedBox(height: NeTopBar.preferredHeight(context)),
            ),
            for (final sliver in widget.slivers)
              if (inset > 0)
                SliverPadding(padding: padding, sliver: sliver)
              else
                sliver,
          ],
        );
      },
    );
    final onRefresh = widget.onRefresh;
    if (onRefresh != null) {
      scroll = RefreshIndicator(onRefresh: onRefresh, child: scroll);
    }

    final fab = widget.floatingActionButton;
    return Scaffold(
      floatingActionButton: fab == null || !widget.hideFabOnScroll
          ? fab
          : NeScrollAwareFab(visible: !_scrolling, child: fab),
      floatingActionButtonLocation: widget.floatingActionButtonLocation,
      // Every NeScaffold IS an entrance scope. Rows opt in by using
      // [NeEntranceRow]; a screen that does not simply never asks.
      // Putting it here rather than at each screen keeps the rule
      // uniform and spares every list the ceremony of wrapping its
      // own scaffold.
      body: NeEntranceScope(
        child: NotificationListener<ScrollNotification>(
          onNotification: _onScroll,
          child: Stack(
            children: [
              scroll,
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: NeTopBar(
                  leading: lead,
                  // Compact single-line title, truncated with an ellipsis
                  // when it doesn't fit.
                  title: widget.titleWidget ??
                      (widget.title == null
                          ? null
                          : Text(
                              widget.title!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: UxnanTypography.barTitle.copyWith(
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            )),
                  actions: widget.actions,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
